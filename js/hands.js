import { MEDIAPIPE_URL, createVisionTask } from "./vision.js";
import { matchDetections } from "./tracking.js";

const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Two people, two hands each.
const MAX_HANDS = 4;
// A hand that disappears for this many detection frames is forgotten, and its
// stroke ends. Short dropouts keep the same stroke going.
const LOST_FRAMES = 4;
// A detection within this many hand sizes of a tracked hand is the same hand.
const MATCH_SCALE = 3;

// MediaPipe hand landmark indices.
const WRIST = 0;
const THUMB_TIP = 4;
const MIDDLE_MCP = 9;
const INDEX_TIP = 8;
const PALM = [0, 5, 9, 13, 17];
// [tip, pip] for index, middle, ring, pinky.
const FINGERS = [
  [8, 6],
  [12, 10],
  [16, 14],
  [20, 18],
];

// Pinch distance relative to hand size. Separate start/stop thresholds
// (hysteresis) keep the pen from flickering on and off mid-stroke.
const PINCH_START = 0.32;
const PINCH_END = 0.48;
const SMOOTHING = 0.5;
// Moving farther than this (in hand sizes) in one frame is a tracking glitch,
// so the pen lifts instead of drawing a line across the mirror.
const MAX_JUMP_SCALE = 2.5;
// How much faster movement thins the stroke, and the thinnest it can get.
const SPEED_TAPER = 0.06;
const MIN_TAPER = 0.72;

// A fist must hold for a few frames before wiping starts (and vice versa), so
// the transition into or out of a pinch doesn't smear a big wipe.
const FIST_FRAMES = 3;
const WIPE_SCALE = 0.85;

export class HandTracker {
  static async create(video, fog, cursorLayer) {
    const { HandLandmarker } = await import(MEDIAPIPE_URL);
    const landmarker = await createVisionTask(HandLandmarker, HAND_MODEL_URL, {
      numHands: MAX_HANDS,
      minHandDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    return new HandTracker(landmarker, video, fog, cursorLayer);
  }

  constructor(landmarker, video, fog, cursorLayer) {
    this.landmarker = landmarker;
    this.video = video;
    this.fog = fog;
    this.cursorLayer = cursorLayer;

    this.brushSize = 22;
    this.hands = [];
    this.lastVideoTime = -1;
  }

  update() {
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, performance.now());
    const detections = (result.landmarks ?? []).map((landmarks) => {
      const pts = landmarks.map((lm) => this.fog.toScreen(lm.x, lm.y));
      const handSize = dist(pts[WRIST], pts[MIDDLE_MCP]) || 1;
      return { pts, handSize, position: average(PALM.map((i) => pts[i])) };
    });

    const { matches, unmatchedTracks, unmatchedDetections } = matchDetections(
      this.hands,
      detections,
      (d) => d.handSize * MATCH_SCALE,
    );

    for (const { track, detection } of matches) track.update(detection, this.brushSize);
    for (const detection of unmatchedDetections) {
      const hand = new Hand(this.fog, this.cursorLayer);
      hand.update(detection, this.brushSize);
      this.hands.push(hand);
    }
    for (const hand of unmatchedTracks) {
      hand.missed++;
      if (hand.missed > LOST_FRAMES) hand.remove();
    }
    this.hands = this.hands.filter((hand) => !hand.removed);
  }
}

// One tracked hand: its gesture state, its stroke, and its own cursor.
class Hand {
  constructor(fog, cursorLayer) {
    this.fog = fog;
    this.cursorEl = document.createElement("div");
    this.cursorEl.className = "pen-cursor";
    cursorLayer.appendChild(this.cursorEl);

    this.position = { x: 0, y: 0 };
    this.missed = 0;
    this.removed = false;
    this.mode = "hover";
    this.pinching = false;
    this.fistFrames = 0;
    this.openFrames = 0;
    this.wiping = false;
    this.pen = null;
    this.curveStart = null;
  }

  update({ pts, handSize, position }, brushSize) {
    this.position = position;
    this.missed = 0;

    const fistNow = isFist(pts);
    this.updateFist(fistNow);
    // A closed fist also brings the thumb to the index finger, so it must not
    // count as a pinch while the fist is still being confirmed.
    const pinchRatio = dist(pts[THUMB_TIP], pts[INDEX_TIP]) / handSize;
    this.pinching = !fistNow && pinchRatio < (this.pinching ? PINCH_END : PINCH_START);
    this.maxJump = handSize * MAX_JUMP_SCALE;

    if (this.wiping) {
      const size = handSize * WIPE_SCALE * 2;
      this.setMode("wipe");
      this.stroke(position, size / 2);
      this.moveCursor(position, size);
    } else if (this.pinching) {
      const tip = midpoint(pts[THUMB_TIP], pts[INDEX_TIP]);
      this.setMode("draw");
      this.stroke(tip, brushSize / 2);
      this.moveCursor(tip, brushSize);
    } else {
      this.setMode("hover");
      this.moveCursor(midpoint(pts[THUMB_TIP], pts[INDEX_TIP]), brushSize);
    }
  }

  remove() {
    this.endStroke();
    this.cursorEl.remove();
    this.removed = true;
  }

  updateFist(fistNow) {
    if (fistNow) {
      this.fistFrames++;
      this.openFrames = 0;
      if (this.fistFrames >= FIST_FRAMES) this.wiping = true;
    } else {
      this.openFrames++;
      this.fistFrames = 0;
      if (this.openFrames >= FIST_FRAMES) this.wiping = false;
    }
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.endStroke();
    this.cursorEl.classList.toggle("drawing", mode === "draw");
    this.cursorEl.classList.toggle("wiping", mode === "wipe");
  }

  // Strokes are drawn as quadratic curves between the midpoints of successive
  // pen positions, so the path bends smoothly instead of joining straight
  // segments. Width tapers a little with speed, like a fingertip dragged faster.
  stroke(target, radius) {
    if (!this.pen || dist(this.pen, target) > this.maxJump) {
      this.endStroke();
      this.pen = { ...target };
      this.curveStart = { ...target };
      this.penRadius = radius;
      this.fog.clearLine(target.x, target.y, target.x, target.y, radius);
      return;
    }

    const prev = this.pen;
    const next = {
      x: prev.x + (target.x - prev.x) * SMOOTHING,
      y: prev.y + (target.y - prev.y) * SMOOTHING,
    };
    const speed = dist(prev, next) / radius;
    const targetRadius = radius * clamp(1 - speed * SPEED_TAPER, MIN_TAPER, 1);
    const nextRadius = this.penRadius + (targetRadius - this.penRadius) * 0.3;

    const mid = midpoint(prev, next);
    this.fog.clearCurve(this.curveStart, prev, mid, this.penRadius, nextRadius);

    this.pen = next;
    this.curveStart = mid;
    this.penRadius = nextRadius;
  }

  endStroke() {
    if (this.pen && this.curveStart) {
      const { x, y } = this.pen;
      this.fog.clearLine(this.curveStart.x, this.curveStart.y, x, y, this.penRadius);
    }
    this.pen = null;
    this.curveStart = null;
  }

  moveCursor(point, size) {
    const el = this.cursorEl;
    el.style.width = el.style.height = `${size}px`;
    el.style.transform = `translate(${point.x - size / 2}px, ${point.y - size / 2}px)`;
    el.classList.add("visible");
  }
}

// All four fingertips folded closer to the wrist than their middle knuckles.
function isFist(pts) {
  const wrist = pts[WRIST];
  return FINGERS.every(([tip, pip]) => dist(pts[tip], wrist) < dist(pts[pip], wrist));
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function average(points) {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}
