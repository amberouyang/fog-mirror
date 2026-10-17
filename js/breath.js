import { MEDIAPIPE_URL, createVisionTask } from "./vision.js";

const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// MediaPipe face mesh indices.
const UPPER_LIP = 13;
const LOWER_LIP = 14;
const FACE_LEFT = 234;
const FACE_RIGHT = 454;

// Pursed / "o" mouth detection from blendshapes, with hysteresis.
const BLOW_FACE_START = 0.35;
const BLOW_FACE_END = 0.25;
const FACE_EVERY_N_FRAMES = 2;

// Microphone loudness. The threshold adapts to the room's background noise.
const MIN_THRESHOLD = 0.03;
const NOISE_MULTIPLIER = 3.5;
const LEVEL_RANGE = 0.12;

// How fast fog builds up (mask alpha per second).
const FOG_RATE = 2.5;
const FOG_RATE_LOUD = 3;
// The breath cloud starts around the mouth and keeps spreading (in face
// widths per second) the longer you blow, until it covers the whole mirror.
const START_RADIUS = 0.6;
const SPREAD_SPEED = 1.4;
// A breath is one steady sound with steady pursed lips, while talking is
// choppy and only rounds the lips briefly on "oo" sounds. So both must hold
// continuously for ONSET_MS before fog starts. The mic may dip briefly (breath
// noise flickers around the threshold) without breaking the hold.
const ONSET_MS = 300;
const MIC_DROPOUT_MS = 120;
// Once blowing, keep it going through tiny gaps, and keep the last known face
// for a moment if it's briefly lost (e.g. a hand in front of it).
const BLOW_GRACE_MS = 200;
const FACE_GRACE_MS = 800;

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
    this.faceSeenAt = 0;
    this.loudSince = null;
    this.lastLoudAt = -Infinity;
    this.puckerSince = null;
    this.lastBlowAt = -Infinity;
    this.breathTime = 0;
    this.blowing = false;
  }

  update(dt) {
    const now = performance.now();
    const level = this.mic.update();
    this.detectFace(now);

    if (level > 0) {
      this.loudSince ??= now;
      this.lastLoudAt = now;
    } else if (now - this.lastLoudAt > MIC_DROPOUT_MS) {
      this.loudSince = null;
    }

    const faceRecent = this.face && now - this.faceSeenAt < FACE_GRACE_MS;
    if (this.blowFace && faceRecent) {
      this.puckerSince ??= now;
    } else {
      this.puckerSince = null;
    }

    const held = (since) => since !== null && now - since >= ONSET_MS;
    if (held(this.loudSince) && held(this.puckerSince)) this.lastBlowAt = now;
    this.blowing = now - this.lastBlowAt < BLOW_GRACE_MS;

    if (!this.blowing) {
      this.breathTime = Math.max(0, this.breathTime - dt * 2);
      return;
    }

    const { mouth, width } = this.face;
    const maxRadius = Math.hypot(this.fog.width, this.fog.height);
    this.breathTime = Math.min(this.breathTime + dt, maxRadius / (width * SPREAD_SPEED));
    const radius = Math.min(
      maxRadius,
      width * (START_RADIUS + SPREAD_SPEED * this.breathTime + 0.35 * level),
    );
    const amount = dt * (FOG_RATE + FOG_RATE_LOUD * level);
    this.fog.addFog(mouth.x, mouth.y, radius, amount);
  }

  detectFace(now) {
    this.frame++;
    if (this.frame % FACE_EVERY_N_FRAMES) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, now);
    const landmarks = result.faceLandmarks?.[0];
    // Keep the last known face; `faceSeenAt` decides how long it stays valid.
    if (!landmarks) return;
    this.faceSeenAt = now;

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
