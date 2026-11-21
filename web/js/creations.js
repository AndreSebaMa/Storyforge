import * as A from './assets.js';
import { hashStr } from './util.js';

const lib = new Map();
let version = 0;

export function setCreations(list) { lib.clear(); for (const c of list || []) lib.set(c.id, c); version++; }
export const creations = () => [...lib.values()].sort((a, b) => a.name.localeCompare(b.name));
export const getCreation = (id) => lib.get(id) || null;
export function putCreation(c) { lib.set(c.id, c); version++; }
export function dropCreation(id) { lib.delete(id); version++; }
export const creationsVersion = () => version;
export const assetUrl = (id, name) => `/api/creation/file?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`;
export const isVideo = (name) => /[.](mp4|webm|mov|m4v)$/i.test(name);

export const characterOptions = () => creations().map((c) => [c.id, c.name]);
export const poseOptions = (id) => (getCreation(id)?.poses || []).map((p) => [p.id, p.name]);

export const MAX_FRAMES = 160;
export const MAX_SIDE = 320;
const VIDEO_FPS = 12;

export const sourceOptions = (c, name) => ({ cut: false, tol: 28, ...(c.sourceOpts?.[name] || {}) });

const raw = new Map();
const treated = new Map();

function fit(w, h) { const k = Math.min(1, MAX_SIDE / Math.max(w, h)); return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))]; }

async function decodeImage(data) {
  const head = new Uint8Array(data, 0, 12);
  const type = head[0] === 0x52 && head[8] === 0x57 ? 'image/webp' : head[0] === 0x89 ? 'image/png' : head[0] === 0xff ? 'image/jpeg' : 'image/gif';
  const dec = new ImageDecoder({ data, type });
  await dec.tracks.ready; await dec.completed;
  const n = Math.min(dec.tracks.selectedTrack.frameCount, MAX_FRAMES), frames = [];
  for (let i = 0; i < n; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    const [w, h] = fit(image.displayWidth, image.displayHeight), canvas = A.newCanvas(w, h);
    canvas.getContext('2d').drawImage(image, 0, 0, w, h);
    frames.push({ canvas, ms: Math.max(20, Math.round((image.duration || 100000) / 1000)) });
    image.close();
  }
  return frames;
}

async function decodeVideo(data) {
  const url = URL.createObjectURL(new Blob([data])), v = document.createElement('video');
  try {
    v.muted = true; v.preload = 'auto'; v.src = url;
    await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = () => no(new Error('video cannot be played')); });
    const dur = Math.min(v.duration || 0, 60);
    if (!(dur > 0)) return [];
    const n = Math.max(1, Math.min(MAX_FRAMES, Math.round(dur * VIDEO_FPS))), step = dur / n, frames = [];
    const [w, h] = fit(v.videoWidth, v.videoHeight);
    for (let i = 0; i < n; i++) {
      await new Promise((ok) => { v.onseeked = ok; v.currentTime = Math.min(dur - 0.001, (i + 0.5) * step); });
      const canvas = A.newCanvas(w, h);
      canvas.getContext('2d').drawImage(v, 0, 0, w, h);
      frames.push({ canvas, ms: Math.max(20, Math.round(step * 1000)) });
    }
    return frames;
  } finally { URL.revokeObjectURL(url); v.removeAttribute('src'); v.load?.(); }
}

function rawFrames(id, name) {
  const key = id + '/' + name;
  if (raw.has(key)) return raw.get(key);
  const job = (async () => {
    try {
      if (typeof fetch === 'undefined' || typeof document === 'undefined') return null;
      const data = await (await fetch(assetUrl(id, name))).arrayBuffer();
      const frames = isVideo(name) ? await decodeVideo(data) : (typeof ImageDecoder === 'undefined' ? [] : await decodeImage(data));
      return frames.length ? { frames, w: frames[0].canvas.width, h: frames[0].canvas.height } : null;
    } catch (e) { return null; }
  })();
  raw.set(key, job);
  return job;
}

function cutBackground(src, tol) {
  const w = src.width, h = src.height, c = A.newCanvas(w, h), x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  const img = x.getImageData(0, 0, w, h), d = img.data;
  const corner = [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]].map(([cx, cy]) => { const i = (cy * w + cx) * 4; return [d[i], d[i + 1], d[i + 2]]; });
  const bg = [0, 1, 2].map((k) => corner.map((p) => p[k]).sort((a, b) => a - b)[1]);
  const far = (i) => Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2]));
  const out = new Uint8Array(w * h), stack = [];
  const push = (px, py) => { if (px < 0 || py < 0 || px >= w || py >= h) return; const p = py * w + px; if (!out[p] && far(p * 4) <= tol) { out[p] = 1; stack.push(p); } };
  for (let i = 0; i < w; i++) { push(i, 0); push(i, h - 1); }
  for (let j = 0; j < h; j++) { push(0, j); push(w - 1, j); }
  while (stack.length) { const p = stack.pop(), px = p % w, py = (p - px) / w; push(px + 1, py); push(px - 1, py); push(px, py + 1); push(px, py - 1); }
  const soft = tol * 3.5;
  for (let p = 0; p < w * h; p++) {
    if (out[p]) { d[p * 4 + 3] = 0; continue; }
    const px = p % w, py = (p - px) / w;
    if (!((px > 0 && out[p - 1]) || (px < w - 1 && out[p + 1]) || (py > 0 && out[p - w]) || (py < h - 1 && out[p + w]))) continue;
    const f = far(p * 4);
    if (f >= soft) continue;
    const a = Math.max(0.15, (f - tol) / (soft - tol)), i = p * 4;
    for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, Math.round((d[i + k] - bg[k] * (1 - a)) / a)));
    d[i + 3] = Math.round(d[i + 3] * a);
  }
  x.putImageData(img, 0, 0);
  return c;
}

export function sourceFrames(c, name) {
  const o = sourceOptions(c, name);
  if (!o.cut) return rawFrames(c.id, name);
  const key = `${c.id}/${name}|cut${o.tol}`;
  if (treated.has(key)) return treated.get(key);
  const job = rawFrames(c.id, name).then((s) => {
    if (!s) return null;
    try { return { ...s, frames: s.frames.map((f) => ({ ...f, canvas: cutBackground(f.canvas, o.tol) })) }; } catch (e) { return s; }
  });
  treated.set(key, job);
  return job;
}
const treatKey = (c, name) => { const o = sourceOptions(c, name); return o.cut ? `|cut${o.tol}` : ''; };

export async function poseFrames(creation, pose, alwaysAnim = false) {
  if (!creation || !pose?.frames?.length) return null;
  const out = [];
  let names = '';
  for (const [src, index] of pose.frames) {
    const s = await sourceFrames(creation, src);
    const f = s?.frames[index];
    if (!f) continue;
    const tag = creation.id + '/' + src + treatKey(creation, src);
    const path = `${A.PREFIX}my-${hashStr(tag)}-${index}.png`;
    A.registerImage(path, f.canvas);
    names += tag + '#' + index + ';';
    out.push({ path, ms: pose.ms > 0 ? pose.ms : f.ms, w: f.canvas.width, h: f.canvas.height, canvas: f.canvas });
  }
  if (!out.length) return null;
  const loop = pose.play !== 'once';
  let anim = null;
  if ((loop || alwaysAnim) && out.length > 1) {
    const base = `${A.PREFIX}my-${hashStr(names)}_`;
    out.forEach((f, i) => A.registerImage(`${base}${i}.png`, f.canvas));
    anim = { path: base + '.png', frames: out.length, delay: Math.round(out.reduce((a, f) => a + f.ms, 0) / out.length) };
  }
  return { frames: out, loop, anim };
}

export const isMine = (v) => typeof v === 'string' && v.startsWith('my:');
export const mineValue = (id, poseId) => `my:${id}${poseId ? ':' + poseId : ''}`;
export function mineOptions() {
  const out = [];
  for (const c of creations()) {
    if (!c.sources?.length) continue;
    out.push([mineValue(c.id), c.name]);
    for (const p of c.poses || []) out.push([mineValue(c.id, p.id), `${c.name} · ${p.name}`]);
  }
  return out;
}
export async function resolveMine(value) {
  const [, id, poseId] = String(value).split(':');
  const c = getCreation(id);
  if (!c) return null;
  let pose = poseId ? c.poses.find((p) => p.id === poseId) : null;
  if (!pose) {
    const src = c.sources?.[0], s = src ? await sourceFrames(c, src) : null;
    if (!s) return null;
    pose = { frames: s.frames.map((_, i) => [src, i]), play: 'loop', ms: 0 };
  }
  const look = await poseFrames(c, pose, true);
  if (!look) return null;
  const f = look.frames[0];
  return { path: look.anim ? look.anim.path : f.path, w: f.w, h: f.h, source: f.canvas, anim: look.anim ? { ...look.anim, once: !look.loop } : null };
}
