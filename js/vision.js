// Shared MediaPipe loader so hand and face tracking reuse one WASM runtime.

// @mediapipe/tasks-vision 1.1.1, vendored so the app doesn't depend on a CDN.
// Only the SIMD WASM build is included, which every current browser supports.
export const MEDIAPIPE_URL = new URL("../vendor/mediapipe/vision_bundle.mjs", import.meta.url).href;
const WASM_URL = new URL("../vendor/mediapipe/wasm", import.meta.url).href;

let filesetPromise;

async function getFileset() {
  if (!filesetPromise) {
    const { FilesetResolver } = await import(MEDIAPIPE_URL);
    filesetPromise = FilesetResolver.forVisionTasks(WASM_URL);
  }
  return filesetPromise;
}

// Creates a MediaPipe task in VIDEO mode, preferring the GPU and falling back
// to the CPU on machines where WebGL inference isn't available.
export async function createVisionTask(TaskClass, modelUrl, options = {}) {
  const fileset = await getFileset();
  for (const delegate of ["GPU", "CPU"]) {
    try {
      return await TaskClass.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl, delegate },
        runningMode: "VIDEO",
        ...options,
      });
    } catch (err) {
      if (delegate === "CPU") throw err;
      console.warn("GPU delegate failed, retrying on CPU", err);
    }
  }
}
