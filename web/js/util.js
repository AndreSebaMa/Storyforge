export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function fmtTime(ms) {
  if (ms == null || !isFinite(ms)) return '--:--:---';
  const neg = ms < 0;
  ms = Math.round(Math.abs(ms));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${neg ? '-' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(r).padStart(3, '0')}`;
}

export function parseTime(str) {
  if (typeof str === 'number') return str;
  str = String(str || '').trim();
  let m = str.match(/^(-)?(\d+):(\d{1,2})[:.](\d{1,3})/);
  if (m) {
    const ms = (+m[2]) * 60000 + (+m[3]) * 1000 + +m[4].padEnd(3, '0');
    return m[1] ? -ms : ms;
  }
  m = str.match(/^(-?\d+(?:\.\d+)?)\s*s$/i);
  if (m) return Math.round(parseFloat(m[1]) * 1000);
  m = str.match(/^-?\d+(?:\.\d+)?$/);
  if (m) return Math.round(parseFloat(str));
  return null;
}

export function parseOsuTimestamp(text) {
  const m = String(text).trim().match(/^(\d+):(\d{2})[:.](\d{3})\s*(?:\(([^)]*)\))?/);
  if (!m) return null;
  const time = (+m[1]) * 60000 + (+m[2]) * 1000 + (+m[3]);
  const refs = [];
  if (m[4]) {
    for (const part of m[4].split(',')) {
      const p = part.trim();
      if (!p) continue;
      if (p.includes('|')) {
        const [t, c] = p.split('|');
        refs.push({ time: +t, column: +c });
      } else {
        refs.push({ combo: +p });
      }
    }
  }
  return { time, refs };
}

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  const next = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = () => next();
  r.range = (a, b) => a + (b - a) * next();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * next());
  r.pick = (arr) => arr[Math.floor(next() * arr.length)];
  r.sign = () => (next() < 0.5 ? -1 : 1);
  r.chance = (p) => next() < p;
  return r;
}

export function hashStr(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export function hexToRgb(hex) {
  if (Array.isArray(hex)) return hex;
  hex = String(hex || '#ffffff').replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
export function varyRgb(rgb, amount, r) {
  if (!amount) return rgb;
  const [R, G, B] = rgb.map((v) => v / 255);
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
  }
  const s = max ? d / max : 0;
  return hsvToRgb(h + r.range(-60, 60) * amount, clamp(s + r.range(-0.3, 0.3) * amount, 0, 1), clamp(max + r.range(-0.3, 0.15) * amount, 0, 1));
}

export function debounce(fn, ms) {
  let t, pending = null;
  const d = (...a) => {
    clearTimeout(t);
    pending = a;
    t = setTimeout(() => { pending = null; fn(...a); }, ms);
  };
  d.flush = () => { if (pending) { clearTimeout(t); const a = pending; pending = null; fn(...a); } };
  return d;
}

export const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
};

export function fmtCount(n) {
  if (n >= 10000) return (n / 1000).toFixed(0) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
