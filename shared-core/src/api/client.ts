import type {
  ExportRequest,
  JobResult,
  JobStatus,
  UploadResponse,
} from "../types";

/**
 * Platform-agnostic API client for the FastAPI backend.
 *
 * Uses the global `fetch` / `FormData` / `Blob` available in both modern
 * browsers and React Native. File input differs per platform, so `upload`
 * accepts a pre-built FormData part descriptor instead of a File.
 */

export interface UploadFilePart {
  /** web: File | Blob;  react-native: { uri, name, type } object */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  file: any;
  name: string;
  type: string;
}

export interface ApiClientOptions {
  baseUrl: string;
  /** injected fetch, defaults to global fetch (lets tests stub the network) */
  fetchFn?: typeof fetch;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API error ${status}: ${body}`);
    this.name = "ApiError";
  }
}

export class PatternApiClient {
  private baseUrl: string;
  private fetchFn: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    // Browsers throw "Illegal invocation" if the global fetch is called with a
    // `this` other than the global object. Storing it as a method and calling
    // `this.fetchFn(...)` rebinds `this`, so bind it to the global here.
    // A caller-supplied fetchFn is assumed to be already bound / self-contained.
    const globalObj = typeof globalThis !== "undefined" ? globalThis : undefined;
    this.fetchFn =
      opts.fetchFn ?? (globalObj ? fetch.bind(globalObj) : fetch);
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, "");
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, init);
    if (!res.ok) {
      throw new ApiError(res.status, await res.text());
    }
    return (await res.json()) as T;
  }

  /** POST /upload — image or PDF; returns a job id to poll. */
  async upload(part: UploadFilePart): Promise<UploadResponse> {
    const form = new FormData();
    // Web File/Blob objects are appended directly; RN needs the {uri,name,type}
    // shape which FormData in RN understands natively.
    if (typeof part.file === "object" && "uri" in part.file) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      form.append("file", part.file as any);
    } else {
      form.append("file", part.file, part.name);
    }
    return this.request<UploadResponse>("/upload", {
      method: "POST",
      body: form,
    });
  }

  /** GET /job/{id} */
  getJobStatus(jobId: string): Promise<JobStatus> {
    return this.request<JobStatus>(`/job/${encodeURIComponent(jobId)}`);
  }

  /** GET /job/{id}/result */
  getJobResult(jobId: string): Promise<JobResult> {
    return this.request<JobResult>(`/job/${encodeURIComponent(jobId)}/result`);
  }

  /**
   * POST /job/{id}/export — returns the exported file as a Blob.
   * Caller decides what to do with it (download on web, share sheet on mobile).
   */
  async export(jobId: string, req: ExportRequest): Promise<Blob> {
    const res = await this.fetchFn(
      `${this.baseUrl}/job/${encodeURIComponent(jobId)}/export`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      },
    );
    if (!res.ok) {
      throw new ApiError(res.status, await res.text());
    }
    return res.blob();
  }

  /**
   * Poll job status until done or error.
   * @param onProgress called on every poll tick
   */
  async waitForJob(
    jobId: string,
    onProgress?: (status: JobStatus) => void,
    intervalMs = 750,
  ): Promise<JobResult> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const status = await this.getJobStatus(jobId);
      onProgress?.(status);
      if (status.state === "done") return this.getJobResult(jobId);
      if (status.state === "error") {
        throw new Error(status.error ?? "Processing failed");
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
