import { MEDIAPIPE_URL, createVisionTask } from "./vision.js";

const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// MediaPipe hand landmark indices.
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;

// Pinch distance relative to hand size. Separate start/stop thresholds
// (hysteresis) keep the pen from flickering on and off mid-stroke.
const PINCH_START = 0.32;
const PINCH_END = 0.48;
const SMOOTHING = 0.5;

export class HandTracker {
  static async create(video, fog, cursorEl) {
    const { HandLandmarker } = await import(MEDIAPIPE_URL);
    const landmarker = await createVisionTask(HandLandmarker, HAND_MODEL_URL, {
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    return new HandTracker(landmarker, video, fog, cursorEl);
  }

  constructor(landmarker, video, fog, cursorEl) {
    this.landmarker = landmarker;
    this.video = video;
    this.fog = fog;
    this.cursorEl = cursorEl;

    this.brushSize = 22;
    this.pinching = false;
    this.pen = null;
    this.lastVideoTime = -1;
  }

  update() {
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, performance.now());
    const landmarks = result.landmarks?.[0];

    if (!landmarks) {
      this.liftPen();
      this.cursorEl.classList.remove("visible");
      return;
    }

    const pts = landmarks.map((lm) => this.fog.toScreen(lm.x, lm.y));
    const handSize = dist(pts[WRIST], pts[MIDDLE_MCP]) || 1;
    const pinchRatio = dist(pts[THUMB_TIP], pts[INDEX_TIP]) / handSize;

    this.pinching = pinchRatio < (this.pinching ? PINCH_END : PINCH_START);

    const target = midpoint(pts[THUMB_TIP], pts[INDEX_TIP]);
    this.moveCursor(target, this.pinching);

    if (this.pinching) {
      this.draw(target);
    } else {
      this.liftPen();
    }
  }

  draw(target) {
    if (!this.pen) {
      this.pen = { ...target };
      this.fog.clearLine(this.pen.x, this.pen.y, this.pen.x, this.pen.y, this.brushSize / 2);
      return;
    }
    const prev = this.pen;
    this.pen = {
      x: prev.x + (target.x - prev.x) * SMOOTHING,
      y: prev.y + (target.y - prev.y) * SMOOTHING,
    };
    this.fog.clearLine(prev.x, prev.y, this.pen.x, this.pen.y, this.brushSize / 2);
  }

  liftPen() {
    this.pen = null;
  }

  moveCursor(point, active) {
    const el = this.cursorEl;
    const size = this.brushSize;
    el.style.width = el.style.height = `${size}px`;
    el.style.transform = `translate(${point.x - size / 2}px, ${point.y - size / 2}px)`;
    el.classList.add("visible");
    el.classList.toggle("drawing", active);
  }
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
