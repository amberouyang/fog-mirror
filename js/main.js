import { FogLayer } from "./fog.js";
import { HandTracker } from "./hands.js";
import { MicLevel, BreathTracker } from "./breath.js";

const landing = document.getElementById("landing");
const startBtn = document.getElementById("start-btn");
const subtitle = document.querySelector(".subtitle");
const mirror = document.getElementById("mirror");
const video = document.getElementById("video");
const fogCanvas = document.getElementById("fog");
const penCursor = document.getElementById("pen-cursor");
const hint = document.getElementById("hint");
const breathMeter = document.getElementById("breath-meter");
const breathLevel = document.getElementById("breath-level");

let fog;
let hands;
let mic;
let breath;
let lastTime = performance.now();

startBtn.addEventListener("click", start);

async function start() {
  startBtn.disabled = true;
  startBtn.textContent = "Starting…";

  // Created inside the click so the browser allows audio to start.
  const audioCtx = new AudioContext();

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      // Browser noise suppression treats blowing as noise and removes it.
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (err) {
    console.error(err);
    audioCtx.close();
    subtitle.textContent =
      "Camera and microphone access is needed. Please allow it and try again.";
    startBtn.disabled = false;
    startBtn.textContent = "Start";
    return;
  }

  video.srcObject = stream;
  await video.play();
  await audioCtx.resume();

  fog = new FogLayer(fogCanvas, video);
  mic = new MicLevel(audioCtx, stream);

  mirror.classList.remove("hidden");
  landing.classList.add("hidden");
  landing.addEventListener("transitionend", () => landing.remove(), { once: true });

  requestAnimationFrame(loop);
  loadTracking();
}

async function loadTracking() {
  hint.textContent = "Loading hand and face tracking…";
  const [handResult, breathResult] = await Promise.allSettled([
    HandTracker.create(video, fog, penCursor),
    BreathTracker.create(video, fog, mic),
  ]);

  if (handResult.status === "fulfilled") hands = handResult.value;
  if (breathResult.status === "fulfilled") breath = breathResult.value;

  if (hands && breath) {
    hint.textContent = "Pinch to draw · Make a fist to wipe · Blow to fog it up";
  } else {
    console.error(handResult.reason ?? breathResult.reason);
    hint.textContent = "Tracking failed to load. Check your connection and refresh.";
  }
}

function loop(now) {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  hands?.update();
  if (breath) {
    breath.update(dt);
  } else {
    mic.update();
  }
  updateBreathMeter();
  fog.render();
  requestAnimationFrame(loop);
}

function updateBreathMeter() {
  breathLevel.style.transform = `scaleX(${mic.level})`;
  breathMeter.classList.toggle("blowing", !!breath?.blowing);
}
