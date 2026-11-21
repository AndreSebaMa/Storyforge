export const DEFAULT_COMBO_COLOURS = [[255, 192, 0], [0, 202, 0], [18, 124, 255], [242, 24, 57]];
export const PLAYFIELD_OFFSET = { x: 64, y: 56 };

export function parseOsu(text) {
  const bm = Object.assign(Object.create(BeatmapProto), {
    version: 14, general: {}, editor: {}, metadata: {}, difficulty: {},
    events: { background: null, video: null, breaks: [] },
    timingPoints: [], comboColours: [], objects: [], raw: text,
  });
  let section = null;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const vm = lines[0] && lines[0].match(/osu file format v(\d+)/);
  if (vm) bm.version = +vm[1];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith('//')) continue;
    const sec = line.match(/^\[(\w+)\]$/);
    if (sec) { section = sec[1]; continue; }
    switch (section) {
      case 'General': case 'Editor': case 'Metadata': case 'Difficulty': {
        const i = line.indexOf(':');
        if (i < 0) break;
        const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
        bm[section.toLowerCase()][k] = v;
        break;
      }
      case 'Colours': {
        const i = line.indexOf(':');
        if (i < 0) break;
        const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
        const m = k.match(/^Combo(\d+)$/);
        if (m) bm.comboColours[+m[1] - 1] = v.split(',').slice(0, 3).map(Number);
        break;
      }
      case 'Events': {
        const p = splitCsv(line);
        if ((p[0] === '0') && p[2]) bm.events.background = { file: unq(p[2]), x: +(p[3] || 0), y: +(p[4] || 0) };
        else if ((p[0] === '1' || p[0] === 'Video') && p[2]) bm.events.video = { file: unq(p[2]), offset: +p[1] };
        else if (p[0] === '2' || p[0] === 'Break') bm.events.breaks.push({ start: +p[1], end: +p[2] });
        break;
      }
      case 'TimingPoints': {
        const p = line.split(',');
        if (p.length < 2) break;
        const beatLength = parseFloat(p[1]);
        const uninherited = p.length > 6 ? p[6] === '1' : beatLength > 0;
        bm.timingPoints.push({
          time: parseFloat(p[0]), beatLength, meter: +(p[2] || 4) || 4,
          sampleSet: +(p[3] || 0), sampleIndex: +(p[4] || 0), volume: +(p[5] || 100),
          uninherited, kiai: (+(p[7] || 0) & 1) === 1,
        });
        break;
      }
      case 'HitObjects': {
        const o = parseHitObject(line);
        if (o) bm.objects.push(o);
        break;
      }
    }
  }
  bm.comboColours = bm.comboColours.filter(Boolean);
  if (!bm.comboColours.length) bm.comboColours = DEFAULT_COMBO_COLOURS.slice();
  bm.mode = +(bm.general.Mode || 0);
  bm.bookmarks = String(bm.editor.Bookmarks || '').split(',').map((x) => x.trim()).filter(Boolean).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  bm.timingPoints.sort((a, b) => a.time - b.time || (b.uninherited - a.uninherited));
  bm.uninherited = bm.timingPoints.filter((t) => t.uninherited);
  if (!bm.uninherited.length) bm.uninherited.push({ time: 0, beatLength: 500, meter: 4, uninherited: true, kiai: false });
  bm.objects.sort((a, b) => a.time - b.time);
  finalizeObjects(bm);
  applyStacking(bm);
  bm.kiai = computeKiai(bm);
  return bm;
}

function unq(s) { return String(s).trim().replace(/^"|"$/g, ''); }
function splitCsv(line) {
  const out = []; let cur = ''; let q = false;
  for (const ch of line) {
    if (ch === '"') { q = !q; cur += ch; } else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseHitObject(line) {
  const p = line.split(',');
  if (p.length < 5) return null;
  const type = +p[3];
  const o = {
    x: +p[0], y: +p[1], time: Math.round(+p[2]), typeBits: type,
    newCombo: (type & 4) !== 0, comboSkip: (type >> 4) & 7, hitSound: +p[4] || 0,
    kind: type & 1 ? 'circle' : type & 2 ? 'slider' : type & 8 ? 'spinner' : type & 128 ? 'hold' : 'circle',
  };
  o.endTime = o.time;
  if (o.kind === 'slider') {
    const curve = p[5].split('|');
    o.curveType = curve[0];
    o.controlPoints = [{ x: o.x, y: o.y }, ...curve.slice(1).map((s) => { const [x, y] = s.split(':'); return { x: +x, y: +y }; })];
    o.slides = Math.max(1, +p[6] || 1);
    o.pixelLength = Math.max(0, +p[7] || 0);
    o.edgeSounds = p[8] ? p[8].split('|').map(Number) : [];
  } else if (o.kind === 'spinner') {
    o.endTime = Math.round(+p[5]);
  } else if (o.kind === 'hold') {
    o.endTime = Math.round(+String(p[5]).split(':')[0]);
  }
  return o;
}

function finalizeObjects(bm) {
  const sliderMult = parseFloat(bm.difficulty.SliderMultiplier || 1.4);
  const n = bm.comboColours.length;
  let combo = 0, colour = -1, prevSpinner = false;
  const keys = Math.max(1, Math.round(+bm.difficulty.CircleSize || 4));
  bm.objects.forEach((o, i) => {
    o.index = i;
    const nc = i === 0 || o.newCombo || prevSpinner || o.kind === 'spinner';
    if (nc) {
      combo = 1;
      if (o.kind !== 'spinner' || colour < 0) colour = (colour + 1 + (i === 0 ? 0 : o.comboSkip)) % n;
    } else combo++;
    o.comboNumber = combo;
    o.comboIndex = Math.max(0, colour);
    o.isNewCombo = nc;
    prevSpinner = o.kind === 'spinner';
    if (bm.mode === 3) o.column = Math.min(keys - 1, Math.floor(o.x * keys / 512));
    if (o.kind === 'slider') {
      const tp = bm.uninheritedAt(o.time);
      const sv = bm.svAt(o.time);
      const spanDuration = o.pixelLength / (sliderMult * 100 * sv) * tp.beatLength;
      o.spanDuration = spanDuration;
      o.endTime = Math.round(o.time + spanDuration * o.slides);
    }
  });
}

function applyStacking(bm) {
  if (bm.mode !== 0) return;
  const objs = bm.objects;
  const leniency = parseFloat(bm.general.StackLeniency ?? 0.7);
  const threshold = bm.preempt * (isFinite(leniency) ? leniency : 0.7);
  const D = 3;
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < D;
  const endPos = (o) => (o.kind === 'slider' ? sliderEndPosition(o) : o);
  for (const o of objs) o.stackHeight = 0;
  for (let i = objs.length - 1; i > 0; i--) {
    let n = i, oi = objs[i];
    if (oi.stackHeight !== 0 || oi.kind === 'spinner') continue;
    if (oi.kind === 'circle') {
      while (--n >= 0) {
        const on = objs[n];
        if (on.kind === 'spinner') continue;
        if (oi.time - on.endTime > threshold) break;
        if (on.kind === 'slider' && near(endPos(on), oi)) {
          const offset = oi.stackHeight - on.stackHeight + 1;
          for (let j = n + 1; j <= i; j++) if (near(endPos(on), objs[j])) objs[j].stackHeight -= offset;
          break;
        }
        if (near(on, oi)) { on.stackHeight = oi.stackHeight + 1; oi = on; }
      }
    } else if (oi.kind === 'slider') {
      while (--n >= 0) {
        const on = objs[n];
        if (on.kind === 'spinner') continue;
        if (oi.time - on.time > threshold) break;
        if (near(endPos(on), oi)) { on.stackHeight = oi.stackHeight + 1; oi = on; }
      }
    }
  }
  const step = bm.circleRadius / 10;
  for (const o of objs) {
    if (!o.stackHeight) continue;
    const d = -o.stackHeight * step;
    delete o._path;
    o.x += d; o.y += d;
    if (o.controlPoints) o.controlPoints = o.controlPoints.map((p) => ({ x: p.x + d, y: p.y + d }));
  }
}

function computeKiai(bm) {
  const out = []; let cur = null;
  for (const tp of bm.timingPoints) {
    if (tp.kiai && !cur) cur = { start: tp.time };
    else if (!tp.kiai && cur) { cur.end = tp.time; out.push(cur); cur = null; }
  }
  if (cur) { cur.end = Math.max(cur.start + 1, bm.objects.length ? bm.objects[bm.objects.length - 1].endTime : cur.start + 1000); out.push(cur); }
  return out;
}

const BeatmapProto = {
  uninheritedAt(t) {
    const u = this.uninherited;
    let r = u[0];
    for (const tp of u) { if (tp.time <= t + 1) r = tp; else break; }
    return r;
  },
  svAt(t) {
    let sv = 1;
    for (const tp of this.timingPoints) {
      if (tp.time > t + 1) break;
      if (tp.uninherited) sv = 1;
      else if (tp.beatLength < 0) sv = Math.min(10, Math.max(0.1, -100 / tp.beatLength));
    }
    return sv;
  },
  beatLengthAt(t) { return this.uninheritedAt(t).beatLength; },
  bpmAt(t) { return 60000 / this.beatLengthAt(t); },
  beats(start, end, divisor = 1) {
    const out = [];
    const u = this.uninherited;
    for (let i = 0; i < u.length; i++) {
      const tp = u[i];
      const segEnd = i + 1 < u.length ? u[i + 1].time : Infinity;
      if (segEnd <= start || tp.time > end) continue;
      const step = tp.beatLength / divisor;
      if (!(step > 1)) continue;
      let k = Math.max(0, Math.ceil((start - tp.time) / step - 1e-6));
      for (; ; k++) {
        const t = tp.time + k * step;
        if (t >= segEnd - 1 || t > end + 0.5) break;
        if (t < start - 0.5) continue;
        const beatIdx = k / divisor;
        out.push({ time: Math.round(t), beat: beatIdx, onBeat: Number.isInteger(beatIdx), downbeat: Number.isInteger(beatIdx) && beatIdx % tp.meter === 0 });
      }
    }
    return out;
  },
  snap(t, divisor = 4) {
    const tp = this.uninheritedAt(t);
    const step = tp.beatLength / divisor;
    return Math.round(tp.time + Math.round((t - tp.time) / step) * step);
  },
  objectsInRange(start, end) { return this.objects.filter((o) => o.time >= start - 1 && o.time <= end + 1); },
  isKiai(t) { return this.kiai.some((k) => t >= k.start && t < k.end); },
  get preempt() {
    const ar = parseFloat(this.difficulty.ApproachRate ?? this.difficulty.OverallDifficulty ?? 9);
    return ar < 5 ? 1200 + 600 * (5 - ar) / 5 : ar === 5 ? 1200 : 1200 - 750 * (ar - 5) / 5;
  },
  get circleRadius() { return 54.4 - 4.48 * parseFloat(this.difficulty.CircleSize ?? 4); },
  get lastTime() { return this.objects.length ? this.objects[this.objects.length - 1].endTime : 0; },
};

export function resolveTimestamp(bm, ts) {
  if (!ts) return [];
  if (!ts.refs.length) return [];
  if (ts.refs[0].column != null) {
    const out = [];
    for (const r of ts.refs) {
      const o = bm.objects.find((o) => Math.abs(o.time - r.time) <= 1 && (o.column == null || o.column === r.column));
      if (o && !out.includes(o)) out.push(o);
    }
    return out;
  }
  const objs = bm.objects;
  const n = ts.refs.length;
  let starts = [];
  objs.forEach((o, i) => { if (Math.abs(o.time - ts.time) <= 2) starts.push(i); });
  if (!starts.length) {
    let best = -1, bd = 11;
    objs.forEach((o, i) => { const d = Math.abs(o.time - ts.time); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) starts = [best];
  }
  for (const s of starts) {
    const seq = objs.slice(s, s + n);
    if (seq.length === n && seq.every((o, k) => o.comboNumber === ts.refs[k].combo)) return seq;
  }
  return starts.length ? objs.slice(starts[0], starts[0] + n) : [];
}

export function sliderPath(o) {
  if (o._path) return o._path;
  const pts = o.controlPoints;
  let poly = [];
  const type = o.curveType;
  if (type === 'L' || pts.length === 2) {
    poly = pts.map((p) => ({ ...p }));
  } else if (type === 'P' && pts.length === 3) {
    poly = circleArc(pts) || bezierSegments(pts);
  } else if (type === 'C') {
    poly = catmull(pts);
  } else {
    poly = bezierSegments(pts);
  }
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + dist(poly[i - 1], poly[i]));
  const target = o.pixelLength || cum[cum.length - 1];
  const out = [poly[0]], outCum = [0];
  for (let i = 1; i < poly.length; i++) {
    if (cum[i] >= target) {
      const segLen = cum[i] - cum[i - 1];
      const t = segLen > 0 ? (target - cum[i - 1]) / segLen : 0;
      out.push({ x: poly[i - 1].x + (poly[i].x - poly[i - 1].x) * t, y: poly[i - 1].y + (poly[i].y - poly[i - 1].y) * t });
      outCum.push(target);
      break;
    }
    out.push(poly[i]); outCum.push(cum[i]);
  }
  if (outCum[outCum.length - 1] < target && out.length >= 2) {
    const a = out[out.length - 2], b = out[out.length - 1];
    const d = dist(a, b) || 1;
    const extra = target - outCum[outCum.length - 1];
    out.push({ x: b.x + (b.x - a.x) / d * extra, y: b.y + (b.y - a.y) / d * extra });
    outCum.push(target);
  }
  o._path = { points: out, cum: outCum, length: target };
  return o._path;
}

export function sliderPositionAt(o, t) {
  const path = sliderPath(o);
  if (!o.spanDuration) return path.points[0];
  let p = (t - o.time) / o.spanDuration;
  p = Math.max(0, Math.min(o.slides, p));
  const span = Math.min(Math.floor(p), o.slides - 1);
  let f = p - span;
  if (span % 2 === 1) f = 1 - f;
  return pointAtDistance(path, f * path.length);
}
export function sliderEndPosition(o) {
  const path = sliderPath(o);
  return o.slides % 2 === 1 ? path.points[path.points.length - 1] : path.points[0];
}
export function pointAtDistance(path, d) {
  const { points, cum } = path;
  if (d <= 0) return points[0];
  for (let i = 1; i < points.length; i++) {
    if (cum[i] >= d) {
      const seg = cum[i] - cum[i - 1];
      const t = seg > 0 ? (d - cum[i - 1]) / seg : 0;
      return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t };
    }
  }
  return points[points.length - 1];
}

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

function bezierSegments(pts) {
  const segs = []; let cur = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x === pts[i - 1].x && pts[i].y === pts[i - 1].y) { if (cur.length > 1) segs.push(cur); cur = [pts[i]]; } else cur.push(pts[i]);
  }
  if (cur.length > 1) segs.push(cur);
  const out = [];
  for (const s of segs) {
    if (s.length === 2) { if (!out.length) out.push(s[0]); out.push(s[1]); continue; }
    let len = 0; for (let i = 1; i < s.length; i++) len += dist(s[i - 1], s[i]);
    const steps = Math.max(8, Math.min(200, Math.ceil(len / 3)));
    for (let k = out.length ? 1 : 0; k <= steps; k++) out.push(deCasteljau(s, k / steps));
  }
  return out.length ? out : [pts[0], pts[0]];
}
function deCasteljau(pts, t) {
  const tmp = pts.map((p) => ({ ...p }));
  for (let r = 1; r < tmp.length; r++) {
    for (let i = 0; i < tmp.length - r; i++) {
      tmp[i].x = tmp[i].x + (tmp[i + 1].x - tmp[i].x) * t;
      tmp[i].y = tmp[i].y + (tmp[i + 1].y - tmp[i].y) * t;
    }
  }
  return tmp[0];
}
function circleArc([a, b, c]) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-3) return null;
  const aS = a.x * a.x + a.y * a.y, bS = b.x * b.x + b.y * b.y, cS = c.x * c.x + c.y * c.y;
  const cx = (aS * (b.y - c.y) + bS * (c.y - a.y) + cS * (a.y - b.y)) / d;
  const cy = (aS * (c.x - b.x) + bS * (a.x - c.x) + cS * (b.x - a.x)) / d;
  const r = Math.hypot(a.x - cx, a.y - cy);
  let tStart = Math.atan2(a.y - cy, a.x - cx);
  let tMid = Math.atan2(b.y - cy, b.x - cx);
  let tEnd = Math.atan2(c.y - cy, c.x - cx);
  while (tMid < tStart) tMid += 2 * Math.PI;
  while (tEnd < tStart) tEnd += 2 * Math.PI;
  if (tMid > tEnd) tEnd -= 2 * Math.PI;
  const range = tEnd - tStart;
  const steps = Math.max(8, Math.ceil(Math.abs(range) * r / 3));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = tStart + range * i / steps;
    out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return out;
}
function catmull(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < 50; k++) {
      const t = k / 50, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
