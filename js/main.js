import { FogLayer } from "./fog.js";
import { HandTracker } from "./hands.js";

const landing = document.getElementById("landing");
const startBtn = document.getElementById("start-btn");
const subtitle = document.querySelector(".subtitle");
const mirror = document.getElementById("mirror");
const video = document.getElementById("video");
const fogCanvas = document.getElementById("fog");
const penCursor = document.getElementById("pen-cursor");
const hint = document.getElementById("hint");

let fog;
let hands;

startBtn.addEventListener("click", start);

async function start() {
  startBtn.disabled = true;
  startBtn.textContent = "Starting…";

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
    subtitle.textContent =
      "Camera and microphone access is needed. Please allow it and try again.";
    startBtn.disabled = false;
    startBtn.textContent = "Start";
    return;
  }

  video.srcObject = stream;
  await video.play();

  fog = new FogLayer(fogCanvas, video);

  mirror.classList.remove("hidden");
  landing.classList.add("hidden");
  landing.addEventListener("transitionend", () => landing.remove(), { once: true });

  requestAnimationFrame(loop);
  loadTracking();
}

async function loadTracking() {
  hint.textContent = "Loading hand tracking…";
  try {
    hands = await HandTracker.create(video, fog, penCursor);
    hint.textContent = "Pinch to draw · Make a fist to wipe";
  } catch (err) {
    console.error(err);
    hint.textContent = "Hand tracking failed to load. Check your connection and refresh.";
  }
}

function loop() {
  hands?.update();
  fog.render();
  requestAnimationFrame(loop);
}
