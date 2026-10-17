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

    this.supportsFilter = "filter" in this.ctx;
    this.grain = makeGrainPattern(this.ctx);
    this.brush = makeSoftBrush();

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

  // Wipes fog along a line by stamping soft circles, like a fingertip on glass.
  clearLine(x0, y0, x1, y1, radius) {
    const ctx = this.maskCtx;
    const length = Math.hypot(x1 - x0, y1 - y0);
    const step = Math.max(1, radius * 0.3);
    const count = Math.max(1, Math.ceil(length / step));
    const size = radius * 2;

    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      ctx.drawImage(this.brush, x - radius, y - radius, size, size);
    }
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
    ctx.drawImage(this.mask, 0, 0);
    ctx.globalCompositeOperation = "source-over";
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
  grad.addColorStop(0.55, "rgba(0,0,0,0.85)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
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
