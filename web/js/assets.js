import { hashStr, rng } from './util.js';

export const PREFIX = 'sb/storyforge/';
export const OUR_PREFIXES = [PREFIX, 'sb/sbkit/'];
export const isOurs = (path) => { const p = String(path).replace(/\\/g, '/').toLowerCase(); return OUR_PREFIXES.some((x) => p.startsWith(x)); };
const registry = new Map();
let fileUrl = (p) => p;
export function setFileUrlResolver(fn) { fileUrl = fn; }

let makeCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
};
export function setCanvasFactory(fn) { makeCanvas = fn; }

export function get(path) { return registry.get(path); }
export function clearMapImages() {
  for (const [k, v] of registry) if (!v.generated) registry.delete(k);
}

function register(path, canvas, format = 'png') {
  const e = { path, source: canvas, w: canvas.width, h: canvas.height, generated: true, format };
  registry.set(path, e);
  return e;
}

const G = {
  'grain-a': () => grain(11), 'grain-b': () => grain(23), 'grain-c': () => grain(37),
  pixel: () => { const c = makeCanvas(1, 1); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1, 1); return c; },
  glow: () => radial(128, (r) => Math.exp(-r * r * 9)),
  'glow-core': () => radial(128, (r) => Math.min(1, Math.exp(-r * r * 40) * 1.2 + Math.exp(-r * r * 6) * 0.45)),
  dot: () => radial(32, (r) => (r < 0.82 ? 1 : r < 1 ? 1 - (r - 0.82) / 0.18 : 0)),
  'soft-dot': () => radial(64, (r) => Math.max(0, 1 - r) ** 1.6),
  ring: () => radial(256, (r) => band(r, 0.9, 0.06)),
  'ring-thin': () => radial(256, (r) => band(r, 0.94, 0.022)),
  'ring-glow': () => radial(256, (r) => Math.exp(-((r - 0.8) ** 2) / 0.006) * 0.9),
  bokeh: () => radial(128, (r) => (r < 0.86 ? 0.55 + 0.25 * (r / 0.86) ** 6 : r < 1 ? (1 - (r - 0.86) / 0.14) * 0.8 : 0)),
  star4: () => star4(128),
  disc: () => radial(256, (r) => (r < 0.975 ? 1 : r < 1 ? 1 - (r - 0.975) / 0.025 : 0)),
  hex: () => shape(256, (x) => polyPath256(x, 6, 124, 0), true),
  tri: () => shape(256, (x) => polyPath256(x, 3, 124, -Math.PI / 2), true),
  'ring-gap2': () => gappedRing(2, 0.16), 'ring-gap3': () => gappedRing(3, 0.14), 'ring-gap6': () => gappedRing(6, 0.3),
  star: () => shape(128, (x) => starPath(x, 5, 60, 26), true),
  square: () => shape(64, (x) => x.rect(4, 4, 56, 56), true),
  'square-o': () => shape(128, (x) => x.rect(10, 10, 108, 108), false, 7),
  'tri-o': () => shape(128, (x) => polyPath(x, 3, 54, -Math.PI / 2), false, 7),
  'hex-o': () => shape(128, (x) => polyPath(x, 6, 56, 0), false, 7),
  'circle-o': () => shape(128, (x) => x.arc(64, 64, 56, 0, Math.PI * 2), false, 7),
  diamond: () => shape(64, (x) => { x.moveTo(32, 3); x.lineTo(61, 32); x.lineTo(32, 61); x.lineTo(3, 32); }, true),
  heart: () => shape(128, heartPath, true),
  'heart-o': () => shape(128, heartPath, false, 7),
  ray: () => beam(64, 512, 6, true),
  beam: () => beam(48, 512, 3, false),
  vignette: () => {
    const w = 427, h = 240, c = makeCanvas(w, h), x = c.getContext('2d');
    const img = x.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const dx = (i / w - 0.5) * 2, dy = (j / h - 0.5) * 2;
      const r = Math.sqrt(dx * dx * 0.85 + dy * dy * 1.1);
      const a = Math.min(1, Math.max(0, (r - 0.45) / 0.85)) ** 1.5;
      const k = (j * w + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = a * 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  },
  'grad-v': () => {
    const c = makeCanvas(4, 256), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 256, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 4, 256); return c;
  },
  'grad-h': () => {
    const c = makeCanvas(256, 4), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 256, 0);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 4); return c;
  },
  flare: () => {
    const w = 512, h = 64, c = makeCanvas(w, h), x = c.getContext('2d');
    const img = x.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const dx = Math.abs(i / w - 0.5) * 2, dy = Math.abs(j / h - 0.5) * 2;
      const a = Math.exp(-dy * dy * 30) * (1 - dx) ** 2 + Math.exp(-(dx * dx * 40 + dy * dy * 40)) * 0.6;
      const k = (j * w + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.min(1, a) * 255;
    }
    x.putImageData(img, 0, 0); return c;
  },
  sunrays: () => {
    const s = 512, c = makeCanvas(s, s), x = c.getContext('2d');
    const img = x.createImageData(s, s);
    const r = rng(7);
    const rays = Array.from({ length: 22 }, () => ({ a: r() * Math.PI * 2, w: r.range(0.02, 0.07), i: r.range(0.4, 1) }));
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const dx = i / s - 0.5, dy = j / s - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const ang = Math.atan2(dy, dx);
      let v = 0;
      for (const ray of rays) {
        let da = Math.abs(ang - ray.a); da = Math.min(da, Math.PI * 2 - da);
        v += Math.exp(-(da * da) / (ray.w * ray.w)) * ray.i;
      }
      const a = Math.min(1, v) * Math.max(0, 1 - d) ** 1.4 * Math.min(1, d * 6);
      const k = (j * s + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = a * 255;
    }
    x.putImageData(img, 0, 0); return c;
  },
  petal: () => {
    const c = makeCanvas(64, 64), x = c.getContext('2d');
    x.beginPath();
    x.moveTo(32, 61);
    x.bezierCurveTo(4, 46, 6, 14, 23, 5);
    x.lineTo(32, 13); x.lineTo(41, 5);
    x.bezierCurveTo(58, 14, 60, 46, 32, 61);
    const g = x.createLinearGradient(0, 61, 0, 5);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0.8)');
    x.fillStyle = g; x.fill();
    return c;
  },
  leaf: () => {
    const c = makeCanvas(64, 64), x = c.getContext('2d');
    x.beginPath(); x.moveTo(32, 3); x.quadraticCurveTo(62, 30, 32, 61); x.quadraticCurveTo(2, 30, 32, 3);
    x.fillStyle = '#fff'; x.fill();
    x.globalCompositeOperation = 'destination-out';
    x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(32, 8); x.lineTo(32, 58); x.stroke();
    for (const y of [20, 32, 44]) { x.beginPath(); x.moveTo(32, y + 6); x.lineTo(20, y); x.moveTo(32, y + 6); x.lineTo(44, y); x.stroke(); }
    return c;
  },
  streak: () => {
    const w = 256, h = 16, c = makeCanvas(w, h), x = c.getContext('2d');
    const img = x.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const u = i / (w - 1), dy = Math.abs((j + 0.5) / h - 0.5) * 2;
      const a = u ** 1.6 * Math.min(1, (1 - u) * 25) * Math.exp(-dy * dy * 5);
      const k = (j * w + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = a * 255;
    }
    x.putImageData(img, 0, 0); return c;
  },
  scanlines: () => {
    const w = 856, h = 480, c = makeCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#fff';
    for (let y = 0; y < h; y += 3) x.fillRect(0, y, w, 1);
    return c;
  },
  iris: () => {
    const s = 512, c = makeCanvas(s, s), x = c.getContext('2d');
    const img = x.createImageData(s, s), R = s * 0.46;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const r = Math.hypot(i + 0.5 - s / 2, j + 0.5 - s / 2);
      const k = (j * s + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.max(0, Math.min(1, (r - R + 1.5) / 3)) * 255;
    }
    x.putImageData(img, 0, 0); return c;
  },
  spot: () => {
    const s = 1024, c = makeCanvas(s, s), x = c.getContext('2d');
    const img = x.createImageData(s, s);
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const r = Math.hypot(i + 0.5 - s / 2, j + 0.5 - s / 2);
      const k = (j * s + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.max(0, Math.min(1, (r - 9) / 2)) * 255;
    }
    x.putImageData(img, 0, 0); return c;
  },
  tile: () => shape(64, (x) => roundRectPath(x, 4, 4, 56, 56, 9), true),
  'tile-o': () => shape(64, (x) => roundRectPath(x, 5, 5, 54, 54, 9), false, 4),
  cloud: () => {
    const w = 256, h = 160, c = makeCanvas(w, h), x = c.getContext('2d');
    const r = rng(11);
    for (let i = 0; i < 28; i++) {
      const cx = r.range(50, w - 50), cy = r.range(45, h - 45), rad = r.range(22, 50);
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    }
    return c;
  },
};

function grain(seed) {
  const w = 320, h = 180, c = makeCanvas(w, h), x = c.getContext('2d');
  const img = x.createImageData(w, h);
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let k = 0; k < w * h * 4; k += 4) {
    const v = rnd();
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
    img.data[k + 3] = Math.round(255 * v * v);
  }
  x.putImageData(img, 0, 0);
  return c;
}
function band(r, center, half) {
  const d = Math.abs(r - center);
  return d < half ? 1 : d < half + 0.035 ? 1 - (d - half) / 0.035 : 0;
}
function polyPath256(x, n, r, a0) {
  for (let k = 0; k < n; k++) { const a = a0 + (k * Math.PI * 2) / n; x[k ? 'lineTo' : 'moveTo'](128 + Math.cos(a) * r, 128 + Math.sin(a) * r); }
}
function gappedRing(n, gap) {
  const c = makeCanvas(256, 256), x = c.getContext('2d'), part = (Math.PI * 2) / n;
  x.strokeStyle = '#fff'; x.lineWidth = 6; x.lineCap = 'butt';
  for (let k = 0; k < n; k++) { x.beginPath(); x.arc(128, 128, 122, k * part + (part * gap) / 2, (k + 1) * part - (part * gap) / 2); x.stroke(); }
  return c;
}
function radial(size, f) {
  const c = makeCanvas(size, size), x = c.getContext('2d');
  const img = x.createImageData(size, size);
  const h = size / 2;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const r = Math.hypot(i + 0.5 - h, j + 0.5 - h) / h;
    const a = r >= 1 ? 0 : Math.max(0, Math.min(1, f(r)));
    const k = (j * size + i) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = a * 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}
function shape(size, pathFn, fill, line = 6) {
  const c = makeCanvas(size, size), x = c.getContext('2d');
  x.beginPath(); pathFn(x); x.closePath();
  if (fill) { x.fillStyle = '#fff'; x.fill(); } else { x.strokeStyle = '#fff'; x.lineWidth = line; x.lineJoin = 'round'; x.stroke(); }
  return c;
}
function heartPath(x) {
  x.moveTo(64, 114);
  x.bezierCurveTo(6, 72, 8, 20, 38, 20); x.bezierCurveTo(52, 20, 61, 30, 64, 40);
  x.bezierCurveTo(67, 30, 76, 20, 90, 20); x.bezierCurveTo(120, 20, 122, 72, 64, 114);
}
function roundRectPath(x, px, py, w, h, r) {
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r);
}
function polyPath(x, n, r, rot) {
  for (let i = 0; i < n; i++) {
    const a = rot + i * Math.PI * 2 / n;
    const px = 64 + Math.cos(a) * r, py = 64 + Math.sin(a) * r;
    if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
  }
}
function starPath(x, n, R, r) {
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + i * Math.PI / n, rad = i % 2 ? r : R;
    const px = 64 + Math.cos(a) * rad, py = 64 + Math.sin(a) * rad;
    if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
  }
}
function star4(size) {
  const c = makeCanvas(size, size), x = c.getContext('2d');
  const img = x.createImageData(size, size), h = size / 2;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const dx = Math.abs(i + 0.5 - h) / h, dy = Math.abs(j + 0.5 - h) / h;
    const cross = Math.exp(-dy * dy * 900) * (1 - dx) ** 2 + Math.exp(-dx * dx * 900) * (1 - dy) ** 2;
    const core = Math.exp(-(dx * dx + dy * dy) * 60);
    const a = Math.min(1, cross + core);
    const k = (j * size + i) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = a * 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}
function beam(w, h, sharp, soft) {
  const c = makeCanvas(w, h), x = c.getContext('2d');
  const img = x.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const dx = Math.abs((i + 0.5) / w - 0.5) * 2, dy = (j + 0.5) / h;
    const across = soft ? Math.exp(-dx * dx * sharp) * (1 - dx) : Math.exp(-dx * dx * sharp * 3) * 0.7 + Math.exp(-dx * dx * 80) * 0.6;
    const along = Math.min(1, dy * 3) * Math.min(1, (1 - dy) * 3);
    const k = (j * w + i) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.min(1, across * along) * 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

const RING = { ring: [0.995, 0.06, 0.035], 'ring-thin': [0.997, 0.022, 0.035] };
function ringScaled(name, m) {
  const [outer, half0, edge0] = RING[name], half = half0 * m, edge = edge0 * m, centre = outer - half - edge;
  const f = (r) => { const d = Math.abs(r - centre); return d < half ? 1 : d < half + edge ? 1 - (d - half) / edge : 0; };
  const px = 1 / 128, at = [-0.4, -0.2, 0, 0.2, 0.4];
  return radial(256, (r) => at.reduce((sum, k) => sum + f(r + k * px), 0) / at.length);
}
const OUTLINE = {
  'square-o': (x) => x.rect(10, 10, 108, 108), 'tri-o': (x) => polyPath(x, 3, 54, -Math.PI / 2),
  'hex-o': (x) => polyPath(x, 6, 56, 0), 'circle-o': (x) => x.arc(64, 64, 56, 0, Math.PI * 2),
};
const OUTLINE_PX = 7;
export function lined(name, m) {
  if (!(m > 0) || Math.abs(m - 1) < 0.005 || !(RING[name] || OUTLINE[name])) return name;
  return name + '-x' + Math.round(m * 100);
}
function beamEdge(hard) {
  const w = 48, h = 512, c = makeCanvas(w, h), x = c.getContext('2d'), img = x.createImageData(w, h);
  const feather = Math.max(0.05, 1 - hard * 0.95);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const dx = Math.abs((i + 0.5) / w - 0.5) * 2, dy = (j + 0.5) / h;
    const across = Math.max(0, Math.min(1, (1 - dx) / feather)), along = Math.min(1, dy * 3) * Math.min(1, (1 - dy) * 3);
    const k = (j * w + i) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = across * along * 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}
export const TEXTURES = Object.keys(G);

export function tex(name) {
  const path = `${PREFIX}${name}.png`;
  if (!registry.has(path)) {
    const thick = /^(ring|ring-thin|square-o|tri-o|hex-o|circle-o)-x(\d+)$/.exec(name);
    const edge = /^beam-edge-(\d+)$/.exec(name);
    const gen = thick ? (RING[thick[1]] ? () => ringScaled(thick[1], thick[2] / 100) : () => shape(128, OUTLINE[thick[1]], false, Math.max(0.1, OUTLINE_PX * thick[2] / 100)))
      : edge ? () => beamEdge(Math.min(1, edge[1] / 20)) : G[name];
    if (!gen) throw new Error(`unknown texture ${name}`);
    register(path, gen());
  }
  return path;
}
export function texSize(name) { const e = registry.get(tex(name)); return { w: e.w, h: e.h }; }

const QUALITY = 2;
export function fontString(style, q = QUALITY) {
  return `${style.italic ? 'italic ' : ''}${style.weight || 400} ${Math.round(style.size * q)}px "${style.font}", "Segoe UI", sans-serif`;
}
export async function ensureFont(style, text = 'Ag') {
  if (typeof document === 'undefined' || !document.fonts) return;
  const timeout = new Promise((r) => setTimeout(r, 2500));
  try { await Promise.race([document.fonts.load(fontString(style), text), timeout]); } catch { }
}
const fontReady = (style) => {
  try { return typeof document !== 'undefined' && document.fonts ? document.fonts.check(fontString(style)) : true; } catch { return true; }
};
let measureCtx = null;
function mctx(style) {
  if (!measureCtx) measureCtx = makeCanvas(8, 8).getContext('2d');
  measureCtx.font = fontString(style);
  return measureCtx;
}
function fontBox(style) {
  const m = mctx(style).measureText('HgÅjy');
  const fs = style.size * QUALITY;
  const asc = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? fs * 0.8;
  const desc = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? fs * 0.25;
  return { asc, desc };
}

export function layoutLine(text, style) {
  const x = mctx(style);
  const sp = style.letterSpacing || 0;
  const chars = [];
  const arr = Array.from(text);
  let prefix = '';
  for (let i = 0; i < arr.length; i++) {
    const before = x.measureText(prefix).width / QUALITY + i * sp;
    const w = x.measureText(arr[i]).width / QUALITY;
    chars.push({ ch: arr[i], cx: before + w / 2, w });
    prefix += arr[i];
  }
  const width = arr.length ? x.measureText(text).width / QUALITY + (arr.length - 1) * sp : 0;
  const { asc, desc } = fontBox(style);
  return { chars, width, height: (asc + desc) / QUALITY };
}

export function textImage(text, style, kind = 'fill') {
  const key = JSON.stringify([text, style.font, style.weight, style.italic, style.size, kind,
    kind === 'glow' ? style.glowSize : 0, kind === 'outline' ? style.outlineWidth : 0, fontReady(style)]);
  const path = `${PREFIX}t/${hashStr(key)}.png`;
  if (!registry.has(path)) {
    const q = QUALITY;
    const m = mctx(style);
    const adv = m.measureText(text).width;
    const mm = m.measureText(text);
    const inkW = (mm.actualBoundingBoxLeft || 0) + (mm.actualBoundingBoxRight || adv);
    const { asc, desc } = fontBox(style);
    const extra = kind === 'glow' ? (style.glowSize || 8) * q * 2.2 : kind === 'outline' ? (style.outlineWidth || 2) * q * 1.5 : 0;
    const pad = Math.ceil(style.size * q * 0.12 + extra);
    const W = Math.ceil(Math.max(adv, inkW) + pad * 2);
    const H = Math.ceil(asc + desc + pad * 2);
    const c = makeCanvas(W, H), x = c.getContext('2d');
    x.font = fontString(style);
    x.textBaseline = 'alphabetic';
    const tx = (W - adv) / 2, ty = pad + asc;
    if (kind === 'fill') {
      x.fillStyle = '#fff'; x.fillText(text, tx, ty);
    } else if (kind === 'outline') {
      x.strokeStyle = '#fff'; x.lineJoin = 'round'; x.miterLimit = 2;
      x.lineWidth = (style.outlineWidth || 2) * 2 * q; x.strokeText(text, tx, ty);
    } else {
      const off = W * 3;
      x.shadowColor = '#fff'; x.shadowBlur = (style.glowSize || 8) * q; x.shadowOffsetX = off;
      x.fillStyle = '#fff';
      x.fillText(text, tx - off, ty); x.fillText(text, tx - off, ty);
    }
    register(path, c);
  }
  return { path, scale: 1 / QUALITY };
}

const loading = new Map();
export function loadMapImage(path) {
  if (registry.has(path)) return Promise.resolve(registry.get(path));
  if (loading.has(path)) return loading.get(path);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const e = { path, source: img, w: img.naturalWidth, h: img.naturalHeight, generated: false };
      registry.set(path, e); loading.delete(path); resolve(e);
    };
    img.onerror = () => { loading.delete(path); resolve(null); };
    img.src = fileUrl(path);
  });
  loading.set(path, p);
  return p;
}

const gifs = new Map();
export function gifFrames(srcPath) {
  if (gifs.has(srcPath)) return gifs.get(srcPath);
  const job = (async () => {
    if (typeof ImageDecoder === 'undefined') return null;
    try {
      const data = await (await fetch(fileUrl(srcPath))).arrayBuffer();
      const head = new Uint8Array(data, 0, 12), riff = head[0] === 0x52 && head[1] === 0x49 && head[8] === 0x57 && head[9] === 0x45;
      const dec = new ImageDecoder({ data, type: riff ? 'image/webp' : head[0] === 0x89 ? 'image/png' : 'image/gif' });
      await dec.tracks.ready; await dec.completed;
      const n = Math.min(dec.tracks.selectedTrack.frameCount, 120), base = `${PREFIX}gif-${hashStr(srcPath + data.byteLength)}`;
      let w = 0, h = 0, total = 0;
      for (let i = 0; i < n; i++) {
        const { image } = await dec.decode({ frameIndex: i });
        w = image.displayWidth; h = image.displayHeight; total += image.duration || 100000;
        const c = makeCanvas(w, h);
        c.getContext('2d').drawImage(image, 0, 0);
        image.close();
        register(`${base}${i}.png`, c);
      }
      return n ? { path: base + '.png', frames: n, w, h, delay: Math.max(20, Math.round(total / n / 1000)) } : null;
    } catch (e) { return null; }
  })();
  gifs.set(srcPath, job);
  return job;
}

export async function blurredImage(srcPath, radius, load = loadMapImage) {
  const path = `${PREFIX}bg-blur-${hashStr(srcPath + radius)}.jpg`;
  if (registry.has(path)) return path;
  const src = await load(srcPath);
  if (!src) return null;
  const scale = Math.min(1, 960 / src.w);
  const w = Math.round(src.w * scale), h = Math.round(src.h * scale);
  const c = makeCanvas(w, h), x = c.getContext('2d');
  const pad = radius * 3;
  x.filter = `blur(${radius}px)`;
  x.drawImage(src.source, -pad, -pad, w + pad * 2, h + pad * 2);
  register(path, c, 'jpg');
  return path;
}

export async function treatedImage(srcPath, { blur = 0, grey = 0, cut = null } = {}, load = loadMapImage) {
  const path = `${PREFIX}bg-${hashStr(`${srcPath}|${blur}|${grey}${cut ? `|${cut.x}|${cut.y}|${cut.r}|${cut.soft}` : ''}`)}.${cut ? 'png' : 'jpg'}`;
  if (registry.has(path)) return path;
  const src = await load(srcPath);
  if (!src?.source) return null;
  const scale = Math.min(1, (blur > 0 ? 960 : 1920) / src.w);
  const w = Math.round(src.w * scale), h = Math.round(src.h * scale);
  const c = makeCanvas(w, h), x = c.getContext('2d');
  const pad = blur * 3;
  x.filter = `${blur > 0 ? `blur(${blur}px) ` : ''}grayscale(${Math.max(0, Math.min(1, grey))})`;
  x.drawImage(src.source, -pad, -pad, w + pad * 2, h + pad * 2);
  if (cut) {
    const k = Math.max(854 / w, 480 / h);
    const cx = w / 2 + (cut.x - 320) / k, cy = h / 2 + (cut.y - 240) / k, rad = cut.r / k, soft = Math.min(rad, (cut.soft || 0) / k);
    const g = x.createRadialGradient(cx, cy, Math.max(0, rad - soft), cx, cy, rad + 0.01);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.filter = 'none'; x.globalCompositeOperation = 'destination-in';
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'source-over';
  }
  register(path, c, cut ? 'png' : 'jpg');
  return path;
}

export async function ownCopy(srcPath, load = loadMapImage) {
  const png = /\.png$/i.test(srcPath);
  const path = `${PREFIX}copy-${hashStr(srcPath)}.${png ? 'png' : 'jpg'}`;
  if (registry.has(path)) return path;
  const src = await load(srcPath);
  if (!src?.source) return null;
  const c = makeCanvas(src.w, src.h);
  c.getContext('2d').drawImage(src.source, 0, 0);
  register(path, c, png ? 'png' : 'jpg');
  return path;
}

export async function exportAssets(paths) {
  const out = [];
  for (const p of paths) {
    const e = registry.get(p);
    if (!e || !e.generated) continue;
    const url = e.format === 'jpg' ? e.source.toDataURL('image/jpeg', 0.88) : e.source.toDataURL('image/png');
    out.push({ path: p, data: url.slice(url.indexOf(',') + 1) });
  }
  return out;
}

export function registerImage(path, canvas) { return registry.get(path) || register(path, canvas); }
export const newCanvas = (w, h) => makeCanvas(w, h);
