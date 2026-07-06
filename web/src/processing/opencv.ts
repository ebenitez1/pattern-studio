/**
 * opencv.js loader. `@techstark/opencv-js` ships a single self-contained
 * module with the WASM embedded, so no extra asset paths are needed — ideal
 * for a static GitHub Pages deploy. The module is loaded lazily (dynamic
 * import) so the ~9MB WASM only downloads when the user actually processes an
 * image, and the result is cached for the session.
 *
 * The default export shape varies by build (Promise, ready object, async
 * factory, or an onRuntimeInitialized-style object); we normalize all of them.
 */
import type cvNamespace from "@techstark/opencv-js";

export type Cv = typeof cvNamespace;

let readyPromise: Promise<Cv> | null = null;

export function loadOpenCv(): Promise<Cv> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = (await import("@techstark/opencv-js")).default;

    if (mod instanceof Promise) return (await mod) as Cv;
    if (mod && typeof mod.Mat === "function") return mod as Cv;
    if (typeof mod === "function") return (await mod()) as Cv;
    // fall back to the onRuntimeInitialized callback style
    await new Promise<void>((resolve) => {
      if (mod && typeof mod.Mat === "function") return resolve();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mod as any).onRuntimeInitialized = () => resolve();
    });
    return mod as Cv;
  })();
  return readyPromise;
}
