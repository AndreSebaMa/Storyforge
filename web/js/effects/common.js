import { Sprite } from '../sb.js';
import * as A from '../assets.js';
import { rng, hexToRgb, hsvToRgb, varyRgb } from '../util.js';
import { PLAYFIELD_OFFSET, sliderEndPosition, sliderPositionAt, sliderPath } from '../osu.js';
import { isMine, resolveMine } from '../creations.js';

export const SB = { left: -107, right: 747, width: 854, height: 480, cx: 320, cy: 240 };

export function makeContext(map, inst, targets, extra = {}) {
  const r = rng(inst.seed || 1);
  const sprites = [];
  const mine = new Map(), anims = new Map();
  const ctx = {
    map, inst, rng: r, sprites,
    start: inst.start, end: inst.end, objects: targets || [],
    layer: inst.layer,
    sprite(path, opts = {}) {
      const real = mine.get(path)?.path || path, anim = anims.get(real);
      const s = new Sprite(real, { layer: inst.layer, ...opts });
      if (anim) { s.animate(anim.frames, anim.delay); if (anim.once && s.anim) s.anim.once = true; }
      if (inst.params?.syncAnim) s.inStep = true;
      sprites.push(s);
      return s;
    },
    tex: A.tex, texSize: A.texSize, textImage: A.textImage, layoutLine: A.layoutLine,
    ensureFont: A.ensureFont, blurredImage: (p, r) => A.blurredImage(p, r, ctx.loadMapImage), asset: A.get,
    async loadMapImage(path) {
      if (!isMine(path)) return A.loadMapImage(path);
      if (!mine.has(path)) {
        const m = await resolveMine(path);
        mine.set(path, m);
        if (m?.anim) anims.set(m.path, m.anim);
      }
      return mine.get(path);
    },
    ownCopy: (p) => A.ownCopy(p, ctx.loadMapImage),
    treatedImage: (p, o) => A.treatedImage(p, o, ctx.loadMapImage),
    gifFrames: A.gifFrames,
    pf: (x, y) => ({ x: x + PLAYFIELD_OFFSET.x, y: y + PLAYFIELD_OFFSET.y }),
    beatLength: (t = inst.start) => map.beatLengthAt(t),
    ...extra,
  };
  return ctx;
}

export const opt = (pairs) => pairs.map((p) => (Array.isArray(p) ? p : [p, p]));

export const targetParams = (d = {}) => [
  { key: 'filter', label: 'Trigger on', type: 'select', group: 'Targets', default: d.filter || 'all',
    options: opt([['all', 'Every note'], ['allends', 'Every note and slider ends'], ['circles', 'Circles only'],
      ['sliderboth', 'Sliders'], ['sliders', 'Slider heads only'], ['sliderends', 'Slider ends only'],
      ['newcombo', 'New combos'], ['finish', 'Finish hitsound'], ['clap', 'Clap hitsound'], ['whistle', 'Whistle hitsound'],
      ['anysound', 'Any added hitsound']]),
    help: 'Which of the selected notes fire the effect. Hitsound filters are a great way to make the storyboard follow the music.' },
  { key: 'every', label: 'Every Nth note', type: 'number', min: 1, max: 16, step: 1, default: d.every || 1, group: 'Targets' },
  { key: 'chance', label: 'Density %', type: 'number', min: 5, max: 100, step: 5, default: d.chance || 100, group: 'Targets',
    help: 'Randomly skip notes to thin the effect out.' },
  { key: 'sliderEnds', label: 'Also slider ends', type: 'bool', default: d.sliderEnds ?? false, group: 'Targets', showIf: () => false },
  { key: 'position', label: 'Position', type: 'select', group: 'Targets', default: d.position || 'note',
    options: opt([['note', 'At the note'], ['centre', 'Screen centre'], ['random', 'Random on screen'], ['fixed', 'Fixed point'], ['mirror', 'Mirrored note']]) },
  { key: 'posX', label: 'X', type: 'number', min: -107, max: 747, step: 1, default: 320, group: 'Targets', showIf: (p) => p.position === 'fixed' },
  { key: 'posY', label: 'Y', type: 'number', min: 0, max: 480, step: 1, default: 240, group: 'Targets', showIf: (p) => p.position === 'fixed' },
  { key: 'jitter', label: 'Position jitter', type: 'number', min: 0, max: 120, step: 1, default: d.jitter || 0, group: 'Targets' },
];

export const colorParams = (def = '#ffffff', mode = 'fixed', palette) => [
  { key: 'colorMode', label: 'Colour mode', type: 'select', group: 'Colour', default: mode,
    options: opt([['fixed', 'Single colour'], ['combo', 'Combo colours'], ['cycle', 'Cycle palette'], ['random', 'Random from palette'], ['rainbow', 'Rainbow']]) },
  { key: 'color', label: 'Colour', type: 'color', default: def, group: 'Colour', showIf: (p) => p.colorMode === 'fixed' },
  { key: 'palette', label: 'Palette', type: 'palette', default: palette || ['#ff66aa', '#66ccff', '#ffffff'], group: 'Colour', showIf: (p) => p.colorMode === 'cycle' || p.colorMode === 'random' },
  { key: 'colorVar', label: 'Colour variation', type: 'number', min: 0, max: 1, step: 0.05, default: 0, group: 'Colour' },
];

export const clearParams = (group = 'Look', showIf = () => true, showXY = showIf) => [
  { key: 'clear', label: 'Keep a circle clear (radius px, 0 = off)', type: 'number', min: 0, max: 400, step: 1, default: 0, group, showIf,
    help: 'Nothing is shown inside this circle: whatever would cross it disappears at its edge and comes back on the other side.' },
  { key: 'clearX', label: 'Circle X', type: 'number', min: -107, max: 747, step: 1, default: 320, group, showIf: (p) => p.clear > 0 && showXY(p) },
  { key: 'clearY', label: 'Circle Y', type: 'number', min: 0, max: 480, step: 1, default: 240, group, showIf: (p) => p.clear > 0 && showXY(p) },
];
export function insideCircle(x0, y0, x1, y1, cx, cy, rad) {
  const dx = x1 - x0, dy = y1 - y0, fx = x0 - cx, fy = y0 - cy;
  const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - rad * rad;
  if (a < 1e-9) return c < 0 ? [0, 1] : null;
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return null;
  const q = Math.sqrt(disc), u0 = (-b - q) / (2 * a), u1 = (-b + q) / (2 * a);
  if (u1 <= 0 || u0 >= 1) return null;
  return [Math.max(0, u0), Math.min(1, u1)];
}
export function bounceLegs({ x, y, vx, vy, t0, t1, box, circle, keep = 1, maxLegs = 80 }) {
  const legs = [];
  let t = t0;
  while (t < t1 - 1 && legs.length < maxLegs) {
    const sp2 = vx * vx + vy * vy;
    if (sp2 < 4) { legs.push({ t0: t, t1, x0: x, y0: y, x1: x, y1: y, hit: false }); break; }
    let dt = (t1 - t) / 1000, nx = 0, ny = 0;
    if (box) {
      const [L, T, R, B] = box;
      if (vx > 0 && (R - x) / vx < dt) { dt = (R - x) / vx; nx = -1; ny = 0; }
      if (vx < 0 && (L - x) / vx < dt) { dt = (L - x) / vx; nx = 1; ny = 0; }
      if (vy > 0 && (B - y) / vy < dt) { dt = (B - y) / vy; nx = 0; ny = -1; }
      if (vy < 0 && (T - y) / vy < dt) { dt = (T - y) / vy; nx = 0; ny = 1; }
    }
    if (circle) {
      const fx = x - circle.x, fy = y - circle.y, b = 2 * (fx * vx + fy * vy), c = fx * fx + fy * fy - circle.r * circle.r, disc = b * b - 4 * sp2 * c;
      if (disc > 0 && (circle.inside || b < 0)) {
        const u = (-b + (circle.inside ? 1 : -1) * Math.sqrt(disc)) / (2 * sp2);
        if (u > 1e-6 && u < dt) { dt = u; const hx = fx + vx * u, hy = fy + vy * u, n = Math.hypot(hx, hy) || 1; nx = hx / n; ny = hy / n; }
      }
    }
    dt = Math.max(0, dt);
    const x1 = x + vx * dt, y1 = y + vy * dt, te = Math.min(t1, t + dt * 1000);
    legs.push({ t0: t, t1: te, x0: x, y0: y, x1, y1, hit: !!(nx || ny) });
    x = x1; y = y1; t = te;
    if (nx || ny) { const d = vx * nx + vy * ny; vx = (vx - 2 * d * nx) * keep; vy = (vy - 2 * d * ny) * keep; }
  }
  return legs;
}
export const aimParams = (showIf, group = 'Look') => [
  { key: 'aimX', label: 'Point X', type: 'number', min: -107, max: 747, step: 1, default: 320, group, showIf },
  { key: 'aimY', label: 'Point Y', type: 'number', min: 0, max: 480, step: 1, default: 240, group, showIf },
  { key: 'aimStop', label: 'Stops this far from the point (px)', type: 'number', min: 0, max: 400, step: 1, default: 0, group, showIf,
    help: 'It reaches for the point and ends on a circle of this radius around it.' },
];

export const fadeParams = (fin = 500, fout = 500) => [
  { key: 'fadeIn', label: 'Fade in (ms)', type: 'number', min: 0, max: 5000, step: 50, default: fin, group: 'Timing' },
  { key: 'fadeOut', label: 'Fade out (ms)', type: 'number', min: 0, max: 5000, step: 50, default: fout, group: 'Timing' },
];

function passes(o, p, map) {
  const hs = o.kind === 'slider' && o.edgeSounds && o.edgeSounds.length ? o.edgeSounds[0] | o.hitSound : o.hitSound;
  switch (p.filter) {
    case 'circles': return o.kind === 'circle';
    case 'sliders': case 'sliderends': case 'sliderboth': return o.kind === 'slider';
    case 'newcombo': return o.isNewCombo;
    case 'finish': return (hs & 4) !== 0;
    case 'clap': return (hs & 8) !== 0;
    case 'whistle': return (hs & 2) !== 0;
    case 'anysound': return (hs & 14) !== 0;
    case 'kiai': return map.isKiai(o.time);
    default: return true;
  }
}

// Which notes an effect fires on, in storyboard coordinates.
export function hitPoints(ctx, p, { spinners = true } = {}) {
  const out = [];
  let n = 0;
  const r = ctx.rng;
  for (const o of ctx.objects) {
    if (o.kind === 'spinner' && !spinners) continue;
    if (!passes(o, p, ctx.map)) continue;
    n++;
    if ((n - 1) % (p.every || 1) !== 0) continue;
    if ((p.chance ?? 100) < 100 && r() * 100 >= p.chance) continue;
    const head = o.kind === 'spinner' ? { x: 256, y: 192 } : { x: o.x, y: o.y };
    const endsOnly = p.filter === 'sliderends';
    if (!endsOnly) out.push({ time: o.kind === 'spinner' ? o.endTime : o.time, ...ctx.pf(head.x, head.y), obj: o, kind: 'head' });
    if ((p.sliderEnds || endsOnly || p.filter === 'sliderboth' || p.filter === 'allends') && o.kind === 'slider') {
      const e = sliderEndPosition(o);
      out.push({ time: o.endTime, ...ctx.pf(e.x, e.y), obj: o, kind: 'end' });
    }
  }
  out.sort((a, b) => a.time - b.time);
  out.forEach((h, i) => {
    h.index = i;
    switch (p.position) {
      case 'centre': h.x = SB.cx; h.y = SB.cy; break;
      case 'random': h.x = r.range(-40, 680); h.y = r.range(40, 440); break;
      case 'fixed': h.x = p.posX; h.y = p.posY; break;
      case 'mirror': h.x = 640 - h.x; break;
    }
    if (p.jitter) { h.x += r.range(-p.jitter, p.jitter); h.y += r.range(-p.jitter, p.jitter); }
  });
  return out;
}

export function pickColor(ctx, p, hit, i) {
  const r = ctx.rng;
  let c;
  switch (p.colorMode) {
    case 'combo': c = ctx.map.comboColours[(hit?.obj?.comboIndex || 0) % ctx.map.comboColours.length]; break;
    case 'cycle': c = hexToRgb(p.palette[i % p.palette.length] || '#ffffff'); break;
    case 'random': c = hexToRgb(r.pick(p.palette) || '#ffffff'); break;
    case 'rainbow': c = hsvToRgb(i * 27, 0.65, 1); break;
    default: c = hexToRgb(p.color || '#ffffff');
  }
  if (p.colorVar) c = varyRgb(c, p.colorVar, r);
  return c.map(Math.round);
}

export { sliderPositionAt, sliderEndPosition };

export const customImageParam = (group = 'Look', showIf = () => true) => [
  { key: 'image', label: 'Own image', type: 'image', default: '', none: 'None (built-in shape)', group, showIf,
    help: 'Use your own picture instead of the built-in shape: pick one from the map folder or import a file.' },
  { key: 'imageFit', label: 'Same size as the built-in shape', type: 'bool', default: true, group, showIf: (p) => !!p.image && showIf(p),
    help: 'On: your picture is shown as large as the shape it replaces, so presets keep their look. Off: the sizes are the plain scale of your picture.' },
];

export const lined = A.lined;
const HAS_LINE = ['square-o', 'tri-o', 'hex-o', 'circle-o', 'ring-thin', 'ring'];
export const lineParam = (shown = (p) => HAS_LINE.includes(p.texture)) => ({
  key: 'lineX', label: 'Line thickness', type: 'number', min: 0.05, max: 3, step: 0.05, default: 1, group: 'Look', showIf: (p) => !p.image && shown(p),
  help: '1 = the normal line, 0.5 = half as thick, 2 = twice as thick.',
});
export async function shapeOrImage(ctx, p, texKey = 'texture') {
  const shape = ctx.tex(A.lined(p[texKey], p.lineX));
  if (p.image) {
    const src = await ctx.loadMapImage(p.image);
    if (src) {
      const bg = ctx.map.events.background?.file;
      const path = (bg && bg.toLowerCase() === p.image.toLowerCase() && (await ctx.ownCopy(p.image))) || src.path || p.image;
      if (p.imageFit) {
        const t = ctx.asset(shape);
        if (t) ctx.fit = { path, k: Math.max(t.w, t.h) / Math.max(src.w, src.h) };
      }
      return path;
    }
  }
  return shape;
}

export async function pictureFor(ctx, img) {
  const bg = ctx.map.events.background?.file;
  if (bg && bg.toLowerCase() === img.toLowerCase()) return (await ctx.ownCopy(img)) || img;
  return img;
}

export function fitOwnImage(ctx) {
  const f = ctx.fit;
  if (!f || !isFinite(f.k) || f.k <= 0 || f.k === 1) return;
  const mul = (v) => (Array.isArray(v) ? v.map((x) => x * f.k) : v * f.k);
  for (const s of ctx.sprites) {
    if (s.path !== f.path || !isFinite(s.start)) continue;
    const lists = [s.cmds.S, s.cmds.V, ...(s.loops || []).map((l) => l.cmds.filter(([t]) => t === 'S' || t === 'V').map(([, c]) => c))];
    let any = false;
    for (const list of lists) for (const c of list || []) { c.a = mul(c.a); c.b = mul(c.b); any = true; }
    if (!any) s.scale(s.start, s.start, f.k);
  }
}

export function playPath(ctx) {
  const objs = ctx.map.objects.filter((o) => o.kind !== 'spinner');
  const at = (t) => {
    if (!objs.length) return { x: SB.cx, y: SB.cy };
    let lo = 0, hi = objs.length - 1, i = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (objs[mid].time <= t) { i = mid; lo = mid + 1; } else hi = mid - 1; }
    if (i < 0) return ctx.pf(objs[0].x, objs[0].y);
    const o = objs[i];
    if (o.kind === 'slider' && t <= o.endTime) { const q = sliderPositionAt(o, t); return ctx.pf(q.x, q.y); }
    const from = o.kind === 'slider' ? sliderEndPosition(o) : o;
    const next = objs[i + 1];
    if (!next) return ctx.pf(from.x, from.y);
    const u = Math.min(1, Math.max(0, (t - o.endTime) / Math.max(1, next.time - o.endTime)));
    return ctx.pf(from.x + (next.x - from.x) * u, from.y + (next.y - from.y) * u);
  };
  const knots = (t0, t1) => {
    const out = [t0];
    for (const o of objs) {
      if (o.endTime < t0 || o.time > t1) continue;
      out.push(o.time);
      if (o.kind === 'slider' && o.spanDuration) {
        const path = sliderPath(o);
        const straight = path.points.length === 2 || (o.curveType === 'L' && o.controlPoints.length === 2);
        const per = straight ? 1 : Math.max(2, Math.min(24, Math.ceil(path.length / 14)));
        const n = o.slides * Math.max(1, Math.min(per, Math.floor(160 / o.slides)));
        for (let k = 1; k <= n; k++) out.push(o.time + ((o.endTime - o.time) * k) / n);
      }
    }
    out.push(t1);
    return [...new Set(out.map(Math.round))].filter((t) => t >= t0 && t <= t1).sort((a, b) => a - b);
  };
  return { at, knots };
}

export const repeatParams = () => [
  { key: 'repeat', label: 'Times', type: 'number', min: 1, max: 64, step: 1, default: 1, group: 'Repeat', help: 'Play the effect this many times in a row.' },
  { key: 'repeatBeats', label: 'Every (beats)', type: 'number', min: 0.25, max: 64, step: 0.25, default: 4, group: 'Repeat', showIf: (p) => p.repeat > 1 },
];
export function repeatTimes(ctx, p) {
  const n = Math.max(1, Math.round(p.repeat || 1));
  const gap = (p.repeatBeats || 4) * ctx.map.beatLengthAt(ctx.start);
  return Array.from({ length: n }, (_, i) => Math.round(ctx.start + i * gap));
}

export function rideSlider(ctx, s, o) {
  const path = sliderPath(o);
  const dur = o.endTime - o.time;
  const straight = path.points.length === 2 || (o.curveType === 'L' && o.controlPoints.length === 2);
  const perPass = straight ? 1 : Math.max(2, Math.min(40, Math.ceil(path.length / 10)));
  const steps = o.slides * Math.max(1, Math.min(perPass, Math.floor(240 / o.slides)));
  let prev = ctx.pf(o.x, o.y);
  for (let k = 1; k <= steps; k++) {
    const t = o.time + (dur * k) / steps;
    const pos = sliderPositionAt(o, t);
    const cur = ctx.pf(pos.x, pos.y);
    s.move(o.time + (dur * (k - 1)) / steps, t, prev.x, prev.y, cur.x, cur.y);
    prev = cur;
  }
}

export function fitDurations(total, a, b) {
  if (a + b <= total || a + b === 0) return [a, b];
  const k = total / (a + b);
  return [a * k, b * k];
}
