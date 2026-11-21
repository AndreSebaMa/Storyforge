import { Sprite } from './sb.js';

const LAYERS = ['Background', 'Fail', 'Pass', 'Foreground', 'Overlay'];
const ORIGINS = ['TopLeft', 'Centre', 'CentreLeft', 'TopRight', 'BottomCentre', 'TopCentre', 'TopLeft', 'CentreRight', 'BottomLeft', 'BottomRight'];
const NVALS = { F: 1, S: 1, R: 1, MX: 1, MY: 1, M: 2, V: 2, C: 3 };
const MAX_LOOP_EXPANSION = 20000;

const unq = (s) => String(s || '').trim().replace(/^"|"$/g, '').replace(/\\/g, '/');
const layerName = (v) => (/^\d$/.test(v) ? LAYERS[+v] : v) || 'Background';
const originName = (v) => {
  const o = /^\d$/.test(v) ? ORIGINS[+v] : v;
  return !o || o === 'Custom' ? 'TopLeft' : o;
};

function addCommand(target, sprite, p) {
  const type = p[0];
  if (type === 'P') {
    if (p[4] === 'A') sprite._additive = true;
    if (p[4] === 'H') sprite._flipH = true;
    if (p[4] === 'V') sprite._flipV = true;
    return;
  }
  const n = NVALS[type];
  if (!n) return;
  const easing = +p[1] || 0;
  const s = +p[2];
  const e = p[3] === '' || p[3] == null ? s : +p[3];
  const vals = p.slice(4).filter((v) => v !== '').map(Number);
  if (!isFinite(s) || !isFinite(e) || vals.length < n || vals.some((v) => !isFinite(v))) return;
  const group = (i) => (n === 1 ? vals[i] : vals.slice(i * n, i * n + n));
  const groups = Math.floor(vals.length / n);
  if (groups === 1) { target._add(type, s, e, group(0), group(0), easing); return; }
  const d = e - s;
  for (let i = 0; i < groups - 1; i++) target._add(type, s + i * d, e + i * d, group(i), group(i + 1), easing);
}

export function parseStoryboard(text, { skipPrefix = ['sb/storyforge/', 'sb/sbkit/'] } = {}) {
  const skip = [].concat(skipPrefix);
  const vars = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let inVars = false;
  for (const raw of lines) {
    const sec = raw.match(/^\[(\w+)\]\s*$/);
    if (sec) { inVars = sec[1] === 'Variables'; continue; }
    const m = inVars && raw.match(/^(\$[^=]+)=(.*)$/);
    if (m) vars.push([m[1].trim(), m[2].trim()]);
  }
  vars.sort((a, b) => b[0].length - a[0].length);
  const sprites = [];
  let section = null, cur = null, loop = null, inTrigger = false;
  const finishLoop = () => {
    if (!loop || !cur) { loop = null; return; }
    const { start, cmds } = loop;
    let count = loop.count;
    if (count * cmds.length > MAX_LOOP_EXPANSION) count = Math.max(1, Math.floor(MAX_LOOP_EXPANSION / cmds.length));
    const sprite = cur;
    cur.loop(start, count, (l) => { for (const p of cmds) addCommand(l, sprite, p); });
    loop = null;
  };
  for (let raw of lines) {
    if (!raw.trim() || raw.startsWith('//')) continue;
    const sec = raw.match(/^\[(\w+)\]\s*$/);
    if (sec) { finishLoop(); section = sec[1]; cur = null; continue; }
    if (section !== 'Events') continue;
    if (raw.includes('$')) for (const [k, v] of vars) raw = raw.split(k).join(v);
    const depth = raw.match(/^[ _]*/)[0].length;
    const p = raw.slice(depth).split(',').map((s) => s.trim());
    if (depth === 0) {
      finishLoop();
      cur = null; inTrigger = false;
      const kind = p[0];
      if (kind !== 'Sprite' && kind !== '4' && kind !== 'Animation' && kind !== '6') continue;
      const path = unq(p[3]);
      if (!path || skip.some((x) => path.toLowerCase().startsWith(x))) continue;
      cur = new Sprite(path, { layer: layerName(p[1]), origin: originName(p[2]), x: +p[4] || 0, y: +p[5] || 0 });
      if (kind === 'Animation' || kind === '6') cur.anim = { frames: Math.max(1, +p[6] || 1), delay: Math.max(1, +p[7] || 100), once: p[8] === 'LoopOnce' || p[8] === '1' };
      cur.imported = true;
      sprites.push(cur);
    } else if (cur) {
      if (depth === 1) {
        finishLoop();
        inTrigger = false;
        if (p[0] === 'L') { loop = { start: +p[1] || 0, count: Math.max(1, +p[2] || 1), cmds: [] }; continue; }
        if (p[0] === 'T') { inTrigger = true; continue; }
        addCommand(cur, cur, p);
      } else if (loop) loop.cmds.push(p);
    }
  }
  finishLoop();
  return sprites.filter((s) => isFinite(s.start)).map((s) => s.finalize());
}
