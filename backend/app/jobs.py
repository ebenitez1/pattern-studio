"""Job registry: in-memory state guarded by a lock, plus on-disk artifacts
under data/jobs/{job_id}/ (original upload + result.json) so finished results
survive a server restart."""

from __future__ import annotations

import json
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional

from .pipeline.run import run_pipeline

BACKEND_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("PATTERN_STUDIO_DATA", str(BACKEND_ROOT / "data")))
JOBS_DIR = DATA_DIR / "jobs"

MAX_WORKERS = 2


@dataclass
class Job:
    job_id: str
    state: str = "queued"  # queued | processing | done | error
    progress: float = 0.0
    stage: str = "queued"
    error: Optional[str] = None
    result: Optional[dict] = None
    input_path: Optional[Path] = None

    def status_dict(self) -> dict:
        return {
            "job_id": self.job_id,
            "state": self.state,
            "progress": round(self.progress, 4),
            "stage": self.stage,
            "error": self.error,
        }


class JobRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: Dict[str, Job] = {}
        self._executor = ThreadPoolExecutor(
            max_workers=MAX_WORKERS, thread_name_prefix="pipeline"
        )

    # -- creation / execution -------------------------------------------------

    def create(self, filename: str, data: bytes) -> Job:
        job_id = uuid.uuid4().hex[:12]
        suffix = Path(filename).suffix.lower() or ".png"
        job_dir = JOBS_DIR / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        input_path = job_dir / f"original{suffix}"
        input_path.write_bytes(data)

        job = Job(job_id=job_id, input_path=input_path)
        with self._lock:
            self._jobs[job_id] = job
        return job

    def submit(self, job_id: str) -> None:
        self._executor.submit(self._process, job_id)

    def _process(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            return

        def on_progress(stage: str, frac: float) -> None:
            with self._lock:
                job.stage = stage
                job.progress = float(frac)

        with self._lock:
            job.state = "processing"
            job.stage = "starting"

        try:
            result = run_pipeline(job.input_path, progress=on_progress)
        except Exception as exc:  # noqa: BLE001 - job errors surface via API
            with self._lock:
                job.state = "error"
                job.error = f"{type(exc).__name__}: {exc}"
                job.stage = "error"
            return

        result_path = JOBS_DIR / job_id / "result.json"
        result_path.write_text(json.dumps(result), encoding="utf-8")
        with self._lock:
            job.result = result
            job.state = "done"
            job.stage = "done"
            job.progress = 1.0

    # -- lookup ----------------------------------------------------------------

    def get(self, job_id: str) -> Optional[Job]:
        """Look up a job; fall back to disk for results from earlier runs."""
        with self._lock:
            job = self._jobs.get(job_id)
        if job is not None:
            return job
        return self._load_from_disk(job_id)

    def _load_from_disk(self, job_id: str) -> Optional[Job]:
        result_path = JOBS_DIR / job_id / "result.json"
        if not result_path.is_file():
            return None
        try:
            result = json.loads(result_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        job = Job(job_id=job_id, state="done", progress=1.0, stage="done",
                  result=result)
        with self._lock:
            self._jobs.setdefault(job_id, job)
        return job


registry = JobRegistry()


def ensure_data_dirs() -> None:
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
