// Renders a heavy, soft fog over the mirrored camera feed.
//
// Layers (back to front):
//   1. <video>      sharp mirrored camera (CSS, object-fit: cover)
//   2. fog canvas   heavily blurred + whitened copy of the camera,
//                   multiplied by a "fog density" mask
//
// The mask is an offscreen canvas whose alpha is how foggy each pixel is:
// 1 = fully fogged, 0 = wiped clean. Drawing removes alpha, breathing adds it.

const FOG_TINT = "rgba(232, 236, 240, 0.5)";
const GRAIN_ALPHA = 0.05;
const BLUR_DOWNSCALE = 22;
// Applied at 1/4 resolution, so the effective blur on screen is ~4x larger.
const MEDIUM_BLUR = "blur(6px) saturate(0.7)";
// The mask is softened at half resolution so wiped edges feather into the fog
// like condensation instead of looking like a hard digital pen.
const MASK_SOFTEN = "blur(2px)";
// Each stamp only clears part of the fog, so the core of a stroke fills in
// fully while the edges stay feathered. Small size jitter keeps edges organic.
const STAMP_ALPHA = 0.5;
const STAMP_SPACING = 0.18;
const STAMP_JITTER = 0.08;

export class FogLayer {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.video = video;
    this.ctx = canvas.getContext("2d");

    this.mask = document.createElement("canvas");
    this.maskCtx = this.mask.getContext("2d");

    this.tiny = document.createElement("canvas");
    this.tinyCtx = this.tiny.getContext("2d");
    this.medium = document.createElement("canvas");
    this.mediumCtx = this.medium.getContext("2d");
    this.softMask = document.createElement("canvas");
    this.softMaskCtx = this.softMask.getContext("2d");

    this.supportsFilter = "filter" in this.ctx;
    this.grain = makeGrainPattern(this.ctx);
    this.brush = makeSoftBrush();
    this.puff = makeBreathPuff();

    this.resize();
    this.fillFog();
    window.addEventListener("resize", () => this.resize());
  }

  get width() {
    return this.canvas.width;
  }

  get height() {
    return this.canvas.height;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w === this.canvas.width && h === this.canvas.height) return;

    let previous = null;
    if (this.mask.width && this.mask.height) {
      previous = document.createElement("canvas");
      previous.width = this.mask.width;
      previous.height = this.mask.height;
      previous.getContext("2d").drawImage(this.mask, 0, 0);
    }

    this.canvas.width = this.mask.width = w;
    this.canvas.height = this.mask.height = h;

    this.tiny.width = Math.max(1, Math.round(w / BLUR_DOWNSCALE));
    this.tiny.height = Math.max(1, Math.round(h / BLUR_DOWNSCALE));
    this.medium.width = Math.max(1, Math.round(w / 4));
    this.medium.height = Math.max(1, Math.round(h / 4));
    this.softMask.width = Math.max(1, Math.round(w / 2));
    this.softMask.height = Math.max(1, Math.round(h / 2));

    if (previous) {
      this.maskCtx.drawImage(previous, 0, 0, w, h);
    } else {
      this.fillFog();
    }
  }

  fillFog() {
    this.maskCtx.globalCompositeOperation = "source-over";
    this.maskCtx.fillStyle = "#fff";
    this.maskCtx.fillRect(0, 0, this.mask.width, this.mask.height);
  }

  // Wipes fog along a straight line, like a fingertip on glass.
  clearLine(x0, y0, x1, y1, radius) {
    const control = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    this.clearCurve({ x: x0, y: y0 }, control, { x: x1, y: y1 }, radius, radius);
  }

  // Wipes fog along a quadratic curve from p0 to p1, with the radius easing
  // from r0 to r1 so stroke width can swell and taper.
  clearCurve(p0, control, p1, r0, r1) {
    const ctx = this.maskCtx;
    const length =
      Math.hypot(control.x - p0.x, control.y - p0.y) +
      Math.hypot(p1.x - control.x, p1.y - control.y);
    const step = Math.max(1, Math.min(r0, r1) * STAMP_SPACING);
    const count = Math.max(1, Math.ceil(length / step));

    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = STAMP_ALPHA;
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const u = 1 - t;
      const x = u * u * p0.x + 2 * u * t * control.x + t * t * p1.x;
      const y = u * u * p0.y + 2 * u * t * control.y + t * t * p1.y;
      const r = (r0 + (r1 - r0) * t) * (1 + (Math.random() - 0.5) * STAMP_JITTER);
      ctx.drawImage(this.brush, x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // Breathes fog back onto the glass: a soft cloud that's densest at the
  // center. `amount` is how much fog to add this frame (0..1).
  addFog(x, y, radius, amount) {
    const ctx = this.maskCtx;
    const size = radius * 2;
    // Additive, so repeated breaths saturate to exactly full fog instead of
    // stalling just below it from 8-bit rounding.
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = Math.min(1, amount);
    ctx.drawImage(this.puff, x - radius, y - radius, size, size);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // Maps normalized video coordinates (0..1, un-mirrored, as returned by
  // MediaPipe) to fog-canvas pixels, matching the CSS object-fit: cover crop
  // and the horizontal mirror.
  toScreen(nx, ny) {
    const { dx, dy, dw, dh } = this.coverRect(this.width, this.height);
    return {
      x: this.width - (dx + nx * dw),
      y: dy + ny * dh,
    };
  }

  coverRect(w, h) {
    const vw = this.video.videoWidth || w;
    const vh = this.video.videoHeight || h;
    const scale = Math.max(w / vw, h / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    return { dx: (w - dw) / 2, dy: (h - dh) / 2, dw, dh };
  }

  drawMirroredVideo(ctx, w, h) {
    const { dx, dy, dw, dh } = this.coverRect(w, h);
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(this.video, dx, dy, dw, dh);
    ctx.restore();
  }

  render() {
    const { ctx, width: w, height: h } = this;
    if (this.video.readyState < 2) return;

    // Downscale twice and upscale back for a cheap, very heavy blur.
    this.drawMirroredVideo(this.tinyCtx, this.tiny.width, this.tiny.height);

    const m = this.mediumCtx;
    m.imageSmoothingQuality = "high";
    if (this.supportsFilter) m.filter = MEDIUM_BLUR;
    // Overdraw past the edges so the blur doesn't fade in from the borders.
    const pad = 4;
    m.drawImage(this.tiny, -pad, -pad, this.medium.width + pad * 2, this.medium.height + pad * 2);
    if (this.supportsFilter) m.filter = "none";

    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.medium, 0, 0, w, h);

    ctx.fillStyle = FOG_TINT;
    ctx.fillRect(0, 0, w, h);

    ctx.globalAlpha = GRAIN_ALPHA;
    ctx.fillStyle = this.grain;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(this.softenedMask(), 0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
  }

  softenedMask() {
    const s = this.softMaskCtx;
    const { width: sw, height: sh } = this.softMask;
    s.clearRect(0, 0, sw, sh);
    s.imageSmoothingQuality = "high";
    if (this.supportsFilter) s.filter = MASK_SOFTEN;
    // Overdraw past the edges so the blur doesn't thin the fog at the borders.
    const pad = 3;
    s.drawImage(this.mask, -pad, -pad, sw + pad * 2, sh + pad * 2);
    if (this.supportsFilter) s.filter = "none";
    return this.softMask;
  }
}

function makeSoftBrush() {
  const size = 128;
  const r = size / 2;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(0.35, "rgba(0,0,0,0.9)");
  grad.addColorStop(0.7, "rgba(0,0,0,0.4)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function makeBreathPuff() {
  const size = 256;
  const r = size / 2;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.55, "rgba(255,255,255,1)");
  grad.addColorStop(0.8, "rgba(255,255,255,0.5)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function makeGrainPattern(ctx) {
  const size = 160;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 200 + Math.random() * 55;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return ctx.createPattern(c, "repeat");
}
