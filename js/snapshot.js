// Saves a photo of the mirror: the sharp reflection with the fog drawing on top.
// UI elements (hint, slider, cursor) live in the DOM, so they're left out.

export function takeSnapshot(fog, flashEl) {
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(fog.width * scale);
  const h = Math.round(fog.height * scale);

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");

  fog.render();
  fog.drawMirroredVideo(ctx, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(fog.canvas, 0, 0, w, h);

  flash(flashEl);

  out.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fog-mirror-${timestamp()}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

function flash(el) {
  el.classList.remove("active");
  void el.offsetWidth;
  el.classList.add("active");
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}
