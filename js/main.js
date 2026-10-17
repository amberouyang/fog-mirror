import { FogLayer } from "./fog.js";

const landing = document.getElementById("landing");
const startBtn = document.getElementById("start-btn");
const subtitle = document.querySelector(".subtitle");
const mirror = document.getElementById("mirror");
const video = document.getElementById("video");
const fogCanvas = document.getElementById("fog");

let fog;

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
}

function loop() {
  fog.render();
  requestAnimationFrame(loop);
}
