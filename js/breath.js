import { MEDIAPIPE_URL, createVisionTask } from "./vision.js";
import { matchDetections } from "./tracking.js";

const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const MAX_FACES = 2;
// A detection within this many face widths of a tracked face is the same face.
const MATCH_SCALE = 1;

// MediaPipe face mesh indices.
const UPPER_LIP = 13;
const LOWER_LIP = 14;
const FACE_LEFT = 234;
const FACE_RIGHT = 454;

// Pursed / "o" mouth detection from blendshapes, with hysteresis.
const BLOW_FACE_START = 0.3;
const BLOW_FACE_END = 0.2;
const FACE_EVERY_N_FRAMES = 2;

// Microphone loudness. The threshold adapts to the room's background noise.
const MIN_THRESHOLD = 0.02;
const NOISE_MULTIPLIER = 3;
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
const ONSET_MS = 200;
const MIC_DROPOUT_MS = 180;
// Once blowing, keep it going through tiny gaps, and keep the last known face
// for a moment if it's briefly lost (e.g. a hand in front of it).
const BLOW_GRACE_MS = 300;
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

// The mic is shared, so it can't tell who is blowing; the fog comes from
// whichever faces have pursed lips while the mic hears a steady breath.
export class BreathTracker {
  static async create(video, fog, mic) {
    const { FaceLandmarker } = await import(MEDIAPIPE_URL);
    const landmarker = await createVisionTask(FaceLandmarker, FACE_MODEL_URL, {
      numFaces: MAX_FACES,
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
    this.faces = [];
    this.loudSince = null;
    this.lastLoudAt = -Infinity;
    this.blowing = false;
  }

  update(dt) {
    const now = performance.now();
    const level = this.mic.update();
    this.detectFaces(now);

    if (level > 0) {
      this.loudSince ??= now;
      this.lastLoudAt = now;
    } else if (now - this.lastLoudAt > MIC_DROPOUT_MS) {
      this.loudSince = null;
    }

    const held = (since) => since !== null && now - since >= ONSET_MS;
    const maxRadius = Math.hypot(this.fog.width, this.fog.height);
    this.blowing = false;

    for (const face of this.faces) {
      if (face.blowFace) {
        face.puckerSince ??= now;
      } else {
        face.puckerSince = null;
      }
      if (held(this.loudSince) && held(face.puckerSince)) face.lastBlowAt = now;

      if (now - face.lastBlowAt >= BLOW_GRACE_MS) {
        face.breathTime = Math.max(0, face.breathTime - dt * 2);
        continue;
      }

      this.blowing = true;
      const { position: mouth, width } = face;
      face.breathTime = Math.min(face.breathTime + dt, maxRadius / (width * SPREAD_SPEED));
      const radius = Math.min(
        maxRadius,
        width * (START_RADIUS + SPREAD_SPEED * face.breathTime + 0.35 * level),
      );
      const amount = dt * (FOG_RATE + FOG_RATE_LOUD * level);
      this.fog.addFog(mouth.x, mouth.y, radius, amount);
    }
  }

  detectFaces(now) {
    this.frame++;
    if (this.frame % FACE_EVERY_N_FRAMES) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, now);
    const detections = (result.faceLandmarks ?? []).map((landmarks, i) =>
      this.readFace(landmarks, result.faceBlendshapes?.[i]?.categories ?? []),
    );

    const { matches, unmatchedDetections } = matchDetections(
      this.faces,
      detections,
      (d) => d.width * MATCH_SCALE,
    );

    for (const { track, detection } of matches) {
      track.position = {
        x: track.position.x + (detection.position.x - track.position.x) * 0.5,
        y: track.position.y + (detection.position.y - track.position.y) * 0.5,
      };
      track.width = detection.width;
      track.seenAt = now;
      track.blowFace =
        detection.blowScore > (track.blowFace ? BLOW_FACE_END : BLOW_FACE_START);
    }
    for (const detection of unmatchedDetections) {
      this.faces.push({
        position: detection.position,
        width: detection.width,
        seenAt: now,
        blowFace: detection.blowScore > BLOW_FACE_START,
        puckerSince: null,
        lastBlowAt: -Infinity,
        breathTime: 0,
      });
    }
    // Unmatched faces keep their last known spot for a moment (e.g. a hand
    // passing in front of the face), then are forgotten.
    this.faces = this.faces.filter((face) => now - face.seenAt < FACE_GRACE_MS);
  }

  readFace(landmarks, blendshapes) {
    const toScreen = (i) => this.fog.toScreen(landmarks[i].x, landmarks[i].y);
    const upper = toScreen(UPPER_LIP);
    const lower = toScreen(LOWER_LIP);
    const left = toScreen(FACE_LEFT);
    const right = toScreen(FACE_RIGHT);
    const score = (name) => blendshapes.find((c) => c.categoryName === name)?.score ?? 0;
    return {
      position: { x: (upper.x + lower.x) / 2, y: (upper.y + lower.y) / 2 },
      width: Math.hypot(left.x - right.x, left.y - right.y),
      blowScore: Math.max(score("mouthPucker"), score("mouthFunnel")),
    };
  }
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
