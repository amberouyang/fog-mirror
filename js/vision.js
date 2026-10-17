// Shared MediaPipe loader so hand and face tracking reuse one WASM runtime.

export const MEDIAPIPE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/vision_bundle.mjs";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";

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
