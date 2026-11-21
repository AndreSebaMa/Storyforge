import { ease } from './easing.js';
import { hexToRgb } from './util.js';

export const LAYERS = ['Background', 'Fail', 'Pass', 'Foreground', 'Overlay'];
export const ORIGINS = {
  TopLeft: [0, 0], TopCentre: [0.5, 0], TopRight: [1, 0],
  CentreLeft: [0, 0.5], Centre: [0.5, 0.5], CentreRight: [1, 0.5],
  BottomLeft: [0, 1], BottomCentre: [0.5, 1], BottomRight: [1, 1],
};
const TYPES = ['F', 'M', 'MX', 'MY', 'S', 'V', 'R', 'C'];

const n3 = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const ti = (v) => String(Math.round(v));
const n5 = (v) => {
  const r = Math.round(v * 100000) / 100000;
  return Object.is(r, -0) ? '0' : String(r);
};

// One storyboard sprite and its commands; written out as .osb lines.
export class Sprite {
  constructor(path, { origin = 'Centre', x = 320, y = 240, layer = 'Foreground' } = {}) {
    this.path = path;
    this.origin = origin;
    this.x = x; this.y = y;
    this.layer = layer;
    this.cmds = {};
    this.params = [];
    this.start = Infinity; this.end = -Infinity;
  }

  _add(type, s, e, a, b, easing = 0, fromLoop = false) {
    s = Math.round(s); e = Math.round(e);
    if (e < s) [s, e] = [e, s];
    (this.cmds[type] ||= []).push({ s, e, a, b: b === undefined ? a : b, easing: easing | 0, loop: fromLoop });
    if (s < this.start) this.start = s;
    if (e > this.end) this.end = e;
    return this;
  }
  loop(start, count, build) {
    const inner = new Sprite(this.path);
    build(inner);
    const cmds = [];
    for (const t in inner.cmds) for (const c of inner.cmds[t]) cmds.push([t, c]);
    count = Math.floor(count);
    if (!cmds.length || count < 1) return this;
    const dur = Math.max(...cmds.map(([, c]) => c.e));
    if (dur <= 0) return this;
    start = Math.round(start);
    (this.loops ||= []).push({ start, count, cmds });
    for (let i = 0; i < count; i++) for (const [t, c] of cmds) this._add(t, start + i * dur + c.s, start + i * dur + c.e, c.a, c.b, c.easing, true);
    return this;
  }
  fade(s, e, a, b, easing) { return this._add('F', s, e, a, b, easing); }
  move(s, e, x1, y1, x2, y2, easing) {
    return this._add('M', s, e, [x1, y1], x2 === undefined ? [x1, y1] : [x2, y2], easing);
  }
  moveX(s, e, a, b, easing) { return this._add('MX', s, e, a, b, easing); }
  moveY(s, e, a, b, easing) { return this._add('MY', s, e, a, b, easing); }
  scale(s, e, a, b, easing) { return this._add('S', s, e, a, b, easing); }
  vec(s, e, ax, ay, bx, by, easing) {
    return this._add('V', s, e, [ax, ay], bx === undefined ? [ax, ay] : [bx, by], easing);
  }
  rotate(s, e, a, b, easing) { return this._add('R', s, e, a, b, easing); }
  color(s, e, c1, c2, easing) {
    const a = hexToRgb(c1).map(Math.round);
    const b = c2 === undefined ? a : hexToRgb(c2).map(Math.round);
    return this._add('C', s, e, a, b, easing);
  }
  additive() { this._additive = true; return this; }
  flipH() { this._flipH = true; return this; }
  animate(frames, delay = 100) { if (frames > 1) this.anim = { frames: Math.floor(frames), delay: Math.max(1, Math.round(delay)), once: false }; return this; }
  framePaths() {
    if (!this.anim) return [this.path];
    const dot = this.path.lastIndexOf('.');
    return Array.from({ length: this.anim.frames }, (_, i) => (dot < 0 ? this.path + i : this.path.slice(0, dot) + i + this.path.slice(dot)));
  }
  flipV() { this._flipV = true; return this; }

  get commandCount() {
    let n = 0;
    for (const t in this.cmds) for (const c of this.cmds[t]) if (!c.loop) n++;
    for (const l of this.loops || []) n += 1 + l.cmds.length;
    return n + (this._additive ? 1 : 0) + (this._flipH ? 1 : 0) + (this._flipV ? 1 : 0);
  }

  pathAt(t) {
    const a = this.anim;
    if (!a) return this.path;
    let i = Math.max(0, Math.floor((t - this.start) / a.delay));
    i = a.once ? Math.min(i, a.frames - 1) : i % a.frames;
    const dot = this.path.lastIndexOf('.');
    return dot < 0 ? this.path + i : this.path.slice(0, dot) + i + this.path.slice(dot);
  }

  finalize() {
    // Animation in step: an invisible first command puts every copy on the same frame clock.
    if (this.inStep && !this._stepped && this.anim && !this.anim.once && isFinite(this.start)) {
      this._stepped = true;
      const round = this.anim.frames * this.anim.delay, st = this.start, t0 = st - (((st % round) + round) % round);
      if (t0 < st) {
        const first = (this.cmds.F || []).reduce((m, c) => (!m || c.s < m.s ? c : m), null);
        if (!first || first.s > st) this.fade(st, st, first ? first.a : 1);
        this.fade(t0, t0, 0);
      }
    }
    for (const t in this.cmds) this.cmds[t].sort((p, q) => p.s - q.s);
    return this;
  }

  toLines() {
    const lines = [this.anim && !this.imported
      ? `Animation,${this.layer},${this.origin},"${this.path}",${n3(this.x)},${n3(this.y)},${this.anim.frames},${this.anim.delay},${this.anim.once ? 'LoopOnce' : 'LoopForever'}`
      : `Sprite,${this.layer},${this.origin},"${this.path}",${n3(this.x)},${n3(this.y)}`];
    const all = [];
    for (const t of TYPES) for (const c of this.cmds[t] || []) if (!c.loop) all.push([t, c]);
    all.sort((p, q) => p[1].s - q[1].s);
    for (const [t, c] of all) lines.push(' ' + cmdLine(t, c));
    for (const l of this.loops || []) {
      lines.push(` L,${l.start},${l.count}`);
      for (const [t, c] of [...l.cmds].sort((p, q) => p[1].s - q[1].s)) lines.push('  ' + cmdLine(t, c));
    }
    const ps = isFinite(this.start) ? this.start : 0;
    if (this._additive) lines.push(` P,0,${ps},${ps},A`);
    if (this._flipH) lines.push(` P,0,${ps},${ps},H`);
    if (this._flipV) lines.push(` P,0,${ps},${ps},V`);
    return lines;
  }

  stateAt(t) {
    if (t < this.start || t > this.end) return null;
    const c = this.cmds;
    const opacity = c.F ? valueAt(c.F, t) : 1;
    if (opacity <= 0.001) return null;
    let x = this.x, y = this.y;
    if (c.M) [x, y] = valueAt(c.M, t);
    if (c.MX) x = valueAt(c.MX, t);
    if (c.MY) y = valueAt(c.MY, t);
    let sx = 1, sy = 1;
    if (c.S) sx = sy = valueAt(c.S, t);
    if (c.V) { const v = valueAt(c.V, t); sx *= v[0]; sy *= v[1]; }
    if (sx === 0 || sy === 0) return null;
    const rot = c.R ? valueAt(c.R, t) : 0;
    const color = c.C ? valueAt(c.C, t) : null;
    return { x, y, opacity: Math.min(1, opacity), sx, sy, rot, color };
  }
}

function cmdLine(t, c) {
  const nf = t === 'S' || t === 'V' || t === 'R' ? n5 : n3;
  const fmtV = (v) => (Array.isArray(v) ? (t === 'C' ? v.map(ti) : v.map(nf)).join(',') : nf(v));
  const same = JSON.stringify(c.a) === JSON.stringify(c.b);
  const times = c.s === c.e ? `${c.s},` : `${c.s},${c.e}`;
  const vals = same ? fmtV(c.a) : `${fmtV(c.a)},${fmtV(c.b)}`;
  return `${t},${c.easing},${times},${vals}`;
}

function binSearch(list, t) {
  let lo = 0, hi = list.length - 1, r = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].s <= t) { r = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return r;
}

function valueAt(list, t) {
  const i = binSearch(list, t);
  if (i < 0) return list[0].a;
  const cmd = list[i];
  if (t >= cmd.e) return cmd.b;
  const p = ease(cmd.easing, (t - cmd.s) / (cmd.e - cmd.s));
  const { a, b } = cmd;
  if (Array.isArray(a)) return a.map((v, k) => v + (b[k] - v) * p);
  return a + (b - a) * p;
}

export function serialize(sprites) {
  const blocks = {};
  for (const s of sprites) {
    if (!isFinite(s.start)) continue;
    const arr = (blocks[s.layer] ||= []);
    for (const line of s.toLines()) arr.push(line);
  }
  return blocks;
}

export function stats(sprites) {
  let commands = 0;
  for (const s of sprites) commands += s.commandCount;
  return { sprites: sprites.length, commands };
}
