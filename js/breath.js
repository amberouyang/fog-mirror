import { MEDIAPIPE_URL, createVisionTask } from "./vision.js";

const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// MediaPipe face mesh indices.
const UPPER_LIP = 13;
const LOWER_LIP = 14;
const FACE_LEFT = 234;
const FACE_RIGHT = 454;

// Pursed / "o" mouth detection from blendshapes, with hysteresis.
const BLOW_FACE_START = 0.3;
const BLOW_FACE_END = 0.18;
const FACE_EVERY_N_FRAMES = 2;

// Microphone loudness. The threshold adapts to the room's background noise.
const MIN_THRESHOLD = 0.012;
const NOISE_MULTIPLIER = 2.5;
const LEVEL_RANGE = 0.12;

// How fast fog builds up (mask alpha per second) and how far it spreads.
const FOG_RATE = 1.4;
const FOG_RATE_LOUD = 2.2;
const SPREAD_TIME = 1.5;

export class MicLevel {
  constructor(audioCtx, stream) {
    const source = audioCtx.createMediaStreamSource(stream);
    this.analyser = audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);
    this.samples = new Float32Array(this.analyser.fftSize);
    this.noiseFloor = MIN_THRESHOLD / NOISE_MULTIPLIER;
    this.level = 0;
  }

  update() {
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const s of this.samples) sum += s * s;
    const rms = Math.sqrt(sum / this.samples.length);

    // Follow quiet moments quickly and loud ones very slowly, so a long breath
    // doesn't get mistaken for background noise.
    const rate = rms < this.noiseFloor ? 0.05 : 0.0005;
    this.noiseFloor += (rms - this.noiseFloor) * rate;

    const threshold = Math.max(MIN_THRESHOLD, this.noiseFloor * NOISE_MULTIPLIER);
    this.level = clamp((rms - threshold) / LEVEL_RANGE, 0, 1);
    return this.level;
  }
}

export class BreathTracker {
  static async create(video, fog, mic) {
    const { FaceLandmarker } = await import(MEDIAPIPE_URL);
    const landmarker = await createVisionTask(FaceLandmarker, FACE_MODEL_URL, {
      numFaces: 1,
      outputFaceBlendshapes: true,
    });
    return new BreathTracker(landmarker, video, fog, mic);
  }

  constructor(landmarker, video, fog, mic) {
    this.landmarker = landmarker;
    this.video = video;
    this.fog = fog;
    this.mic = mic;

    this.frame = 0;
    this.lastVideoTime = -1;
    this.face = null;
    this.blowFace = false;
    this.breathTime = 0;
    this.blowing = false;
  }

  update(dt) {
    const level = this.mic.update();
    this.detectFace();

    this.blowing = level > 0 && this.blowFace && !!this.face;
    if (!this.blowing) {
      this.breathTime = Math.max(0, this.breathTime - dt * 3);
      return;
    }

    this.breathTime = Math.min(SPREAD_TIME, this.breathTime + dt);
    const spread = this.breathTime / SPREAD_TIME;
    const { mouth, width } = this.face;
    const radius = width * (0.45 + 0.75 * spread + 0.35 * level);
    const amount = dt * (FOG_RATE + FOG_RATE_LOUD * level);
    this.fog.addFog(mouth.x, mouth.y, radius, amount);
  }

  detectFace() {
    this.frame++;
    if (this.frame % FACE_EVERY_N_FRAMES) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, performance.now());
    const landmarks = result.faceLandmarks?.[0];
    if (!landmarks) {
      this.face = null;
      this.blowFace = false;
      return;
    }

    const toScreen = (i) => this.fog.toScreen(landmarks[i].x, landmarks[i].y);
    const upper = toScreen(UPPER_LIP);
    const lower = toScreen(LOWER_LIP);
    const mouth = { x: (upper.x + lower.x) / 2, y: (upper.y + lower.y) / 2 };
    const width = Math.hypot(
      toScreen(FACE_LEFT).x - toScreen(FACE_RIGHT).x,
      toScreen(FACE_LEFT).y - toScreen(FACE_RIGHT).y,
    );

    if (this.face) {
      mouth.x = this.face.mouth.x + (mouth.x - this.face.mouth.x) * 0.5;
      mouth.y = this.face.mouth.y + (mouth.y - this.face.mouth.y) * 0.5;
    }
    this.face = { mouth, width };

    const shapes = result.faceBlendshapes?.[0]?.categories ?? [];
    const score = (name) => shapes.find((c) => c.categoryName === name)?.score ?? 0;
    const blowScore = Math.max(score("mouthPucker"), score("mouthFunnel"));
    this.blowFace = blowScore > (this.blowFace ? BLOW_FACE_END : BLOW_FACE_START);
  }
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
