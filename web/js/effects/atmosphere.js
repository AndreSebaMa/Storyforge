import { E, EASING_OPTIONS } from '../easing.js';
import { colorParams, fadeParams, pickColor, opt, SB, fitDurations, customImageParam, shapeOrImage, clearParams, insideCircle } from './common.js';
import { spectrum } from '../audio.js';
import { lerp, hexToRgb, hsvToRgb } from '../util.js';

const num = (key, label, min, max, step, def, group = 'Look', extra = {}) => ({ key, label, type: 'number', min, max, step, default: def, group, ...extra });
const bool = (key, label, def, group = 'Look', extra = {}) => ({ key, label, type: 'bool', default: def, group, ...extra });

function rangeFade(s, ctx, p, opacity) {
  const [fi, fo] = fitDurations(ctx.end - ctx.start, p.fadeIn || 0, p.fadeOut || 0);
  if (fi > 0) s.fade(ctx.start, ctx.start + fi, 0, opacity, E.OutQuad); else s.fade(ctx.start, ctx.start, opacity);
  if (fo > 0) s.fade(ctx.end - fo, ctx.end, opacity, 0, E.InQuad); else s.fade(ctx.end, ctx.end, opacity);
}

function beatTimes(ctx, every, kiaiOnly, offset = 0) {
  const ev = parseFloat(every);
  let beats = ctx.map.beats(ctx.start, ctx.end, ev < 1 ? 2 : 1);
  if (ev >= 1) beats = beats.filter((b) => Math.round(b.beat - offset) % ev === 0 && b.beat >= offset);
  if (kiaiOnly) beats = beats.filter((b) => ctx.map.isKiai(b.time));
  return beats;
}

export const streaks = {
  id: 'streaks', name: 'Rain & Streaks', category: 'Background & ambience', icon: '⁄', accent: '#9fd8ff', scope: 'range',
  description: 'Rain, hyperspace warp or speed lines. Built with osu! loops, so long sections stay light.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    { key: 'mode', label: 'Type', type: 'select', group: 'Look', default: 'rain', options: opt([['rain', 'Rain'], ['warp', 'Warp (from centre)'], ['speed', 'Speed lines']]) },
    num('count', 'Density', 5, 250, 1, 70),
    num('speed', 'Speed (px/s)', 100, 4000, 50, 900),
    num('length', 'Length (px)', 10, 500, 5, 70),
    num('thickness', 'Thickness', 0.5, 10, 0.5, 1.5),
    num('angle', 'Wind (degrees)', -45, 45, 1, 12, 'Look', { showIf: (p) => p.mode === 'rain' }),
    bool('splash', 'Splashes where it lands', false, 'Look', { showIf: (p) => p.mode === 'rain', help: 'The drops land on a ground line and leave a small ripple there.' }),
    num('ground', 'Ground height (Y)', 200, 480, 5, 420, 'Look', { showIf: (p) => p.mode === 'rain' && p.splash }),
    num('x', 'Centre X', -107, 747, 1, 320, 'Look', { showIf: (p) => p.mode === 'warp' }),
    num('y', 'Centre Y', 0, 480, 1, 240, 'Look', { showIf: (p) => p.mode === 'warp' }),
    { key: 'shape', label: 'Made of', type: 'select', group: 'Look', default: 'streak', showIf: (p) => p.mode === 'warp', options: opt([['streak', 'Streaks'], ['dot', 'Dots / stars']]) },
    { key: 'dotTex', label: 'Dot', type: 'select', group: 'Look', default: 'star4', showIf: (p) => p.mode === 'warp' && p.shape === 'dot' && !p.image,
      options: opt([['star4', 'Sparkle'], ['soft-dot', 'Soft dot'], ['dot', 'Hard dot'], ['glow', 'Glow'], ['star', 'Star'], ['diamond', 'Diamond'], ['square', 'Square'], ['heart', 'Heart']]) },
    ...customImageParam('Look', (p) => p.mode === 'warp' && p.shape === 'dot'),
    num('dotSize', 'Dot size', 0.01, 3, 0.01, 0.6, 'Look', { showIf: (p) => p.mode === 'warp' && p.shape === 'dot' }),
    bool('inward', 'Fly inward, into the centre', false, 'Look', { showIf: (p) => p.mode === 'warp', help: 'Everything streams in from the edges and is swallowed at the centre point.' }),
    bool('grow', 'Dots change size on the way', true, 'Look', { showIf: (p) => p.mode === 'warp' && p.shape === 'dot', help: 'Flying out they grow; flying in they shrink.' }),
    num('dotSpin', 'Dot spin (deg/s)', 0, 360, 5, 0, 'Look', { showIf: (p) => p.mode === 'warp' && p.shape === 'dot' }),
    num('cone', 'Opening angle (degrees)', 5, 360, 5, 360, 'Look', { showIf: (p) => p.mode === 'warp', help: '360 = all around. Smaller = a jet in one direction.' }),
    num('spiral', 'Spiral arms (degrees per dot, 0 = off)', 0, 180, 1, 0, 'Look', { showIf: (p) => p.mode === 'warp' && p.shape === 'dot' && p.cone >= 360, help: 'The dots leave one after another while the direction keeps turning, so they line up in curved arms.' }),
    num('coneDir', 'Jet direction (degrees, 0 = up)', -180, 180, 5, 0, 'Look', { showIf: (p) => p.mode === 'warp' && p.cone < 360 }),
    bool('coneBoth', 'Jet both ways', false, 'Look', { showIf: (p) => p.mode === 'warp' && p.cone < 360 }),
    ...clearParams('Look', () => true, (p) => p.mode !== 'warp'),
    bool('clearSplash', 'Splashes on the circle', false, 'Look', { showIf: (p) => p.clear > 0 && p.mode === 'rain', help: 'Each drop that lands on the circle leaves a small ripple there, as if it were a glass dome.' }),
    num('clearSplashArc', 'Splashes reach round the circle (degrees)', 20, 180, 5, 180, 'Look', { showIf: (p) => p.clear > 0 && p.mode === 'rain' && p.clearSplash, help: '180 = the whole side that faces the rain. Smaller = only near the top, none at the sides.' }),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.45),
    bool('additive', 'Glow (additive)', true),
    ...colorParams('#cfe8ff', 'fixed', ['#00f5d4', '#9b5de5', '#f15bb5']),
    ...fadeParams(800, 800),
  ],
  presets: [
    { name: 'Rain', values: {} },
    { name: 'Puddle rain', values: { splash: true, ground: 410, count: 90, speed: 1100, length: 60, angle: 6, opacity: 0.5 } },
    { name: 'Storm', values: { count: 160, speed: 1500, length: 120, angle: 22, opacity: 0.5 } },
    { name: 'Hyperspace', values: { mode: 'warp', count: 90, speed: 700, length: 150, color: '#ffffff', opacity: 0.8 } },
    { name: 'Neon warp', values: { mode: 'warp', count: 70, speed: 900, length: 200, thickness: 2, colorMode: 'random' } },
    { name: 'Speed lines', values: { mode: 'speed', count: 45, speed: 2400, length: 280, thickness: 1, opacity: 0.35, color: '#ffffff' } },
    { name: 'Star warp', values: { mode: 'warp', shape: 'dot', count: 200, speed: 800, dotSize: 0.5, color: '#ffffff', opacity: 1 } },
    { name: 'Pinwheel', values: { mode: 'warp', shape: 'dot', dotTex: 'diamond', grow: false, spiral: 23, count: 150, speed: 150, dotSize: 0.18, dotSpin: 120, color: '#ffffff', opacity: 0.9 } },
    { name: 'Gathering light', values: { mode: 'warp', shape: 'dot', inward: true, dotTex: 'glow', count: 110, speed: 420, dotSize: 0.3, colorMode: 'random', palette: ['#9fd8ff', '#c7a6ff', '#ffffff'], opacity: 0.9 } },
    { name: 'Drawn in', values: { mode: 'warp', inward: true, count: 60, speed: 800, length: 160, color: '#ffffff', opacity: 0.6 } },
    { name: 'Twin jets', values: { mode: 'warp', shape: 'dot', grow: false, count: 56, speed: 300, dotSize: 0.16, cone: 38, coneBoth: true, color: '#ffffff', opacity: 1 } },
  ],
  async generate(ctx, p) {
    const r = ctx.rng, { start, end } = ctx;
    if (end - start < 200) return;
    const dots = p.mode === 'warp' && p.shape === 'dot';
    let tex = ctx.tex('streak');
    if (dots) tex = await shapeOrImage(ctx, { ...p, dotTex: p.dotTex || 'star4' }, 'dotTex');
    const vy = p.thickness / 4;
    for (let i = 0; i < p.count; i++) {
      const op = p.opacity * r.range(0.55, 1);
      const len = p.length * r.range(0.7, 1.3);
      const arms = p.mode === 'warp' && p.shape === 'dot' && p.spiral > 0 && (p.cone ?? 360) >= 360;
      const speed = p.speed * (arms ? 1 : r.range(0.75, 1.25));
      let x0, y0, x1, y1, rot, ease = E.Linear, period;
      if (p.mode === 'warp') {
        let a = r() * Math.PI * 2;
        if (arms) a = (i * p.spiral * Math.PI) / 180;
        if ((p.cone ?? 360) < 360) {
          a = ((p.coneDir || 0) - 90) * Math.PI / 180 + r.range(-0.5, 0.5) * p.cone * Math.PI / 180;
          if (p.coneBoth && r() < 0.5) a += Math.PI;
        }
        const inward = !!p.inward;
        const r0 = (arms ? 0 : dots ? r.range(0, 8) : r.range(8, 70)) + (p.clear > 0 ? p.clear : 0);
        let far = Math.max(...[[SB.left, 0], [SB.right, 0], [SB.left, 480], [SB.right, 480]].map(([cx, cy]) => Math.hypot(cx - p.x, cy - p.y))) + 40;
        if (dots && (p.cone ?? 360) < 360) {
          const cx = Math.cos(a), cy = Math.sin(a);
          const tx = cx > 0 ? (SB.right - p.x) / cx : cx < 0 ? (SB.left - p.x) / cx : Infinity;
          const ty = cy > 0 ? (480 - p.y) / cy : cy < 0 ? (0 - p.y) / cy : Infinity;
          far = Math.min(far, Math.max(20, Math.min(tx, ty)) + 5);
        }
        x0 = p.x + Math.cos(a) * r0; y0 = p.y + Math.sin(a) * r0;
        x1 = p.x + Math.cos(a) * far; y1 = p.y + Math.sin(a) * far;
        rot = a; ease = dots ? (p.grow ? E.InCirc : E.Linear) : E.InQuad;
        if (inward) {
          const from = dots ? far * r.range(0.45, 1) : far;
          [x0, y0, x1, y1] = [p.x + Math.cos(a) * from, p.y + Math.sin(a) * from, x0, y0];
          far = from; ease = dots ? E.InSine : E.OutQuad;
        }
        period = ((far - r0) / speed) * 1000 * (dots ? 1 : 1.6);
      } else if (p.mode === 'speed') {
        y0 = y1 = r.range(-10, 490);
        x0 = SB.right + len; x1 = SB.left - len;
        rot = Math.PI;
        period = ((x0 - x1) / speed) * 1000;
      } else {
        const th = ((90 - p.angle) * Math.PI) / 180;
        const D = (480 + 2 * len) / Math.sin(th);
        const dx = Math.cos(th) * D;
        x0 = r.range(SB.left - Math.max(0, dx), SB.right - Math.min(0, dx)); y0 = -len;
        x1 = x0 + dx; y1 = 480 + len;
        rot = th;
        period = (D / speed) * 1000;
        if (p.splash) {
          const gy = Math.min(480, p.ground + r.range(-28, 28)), u = (gy - y0) / (y1 - y0);
          x1 = x0 + dx * u; y1 = gy; period *= u;
        }
      }
      period = Math.max(120, Math.round(period));
      const t0 = Math.round(start + (arms ? i / p.count : r()) * period);
      const count = Math.floor((end - t0) / period);
      if (count < 1) continue;
      const s = ctx.sprite(tex, { x: x0, y: y0 });
      if (!dots) s.rotate(t0, t0, rot);
      const col = pickColor(ctx, p, null, i);
      s.color(t0, t0, col);
      if (p.additive) s.additive();
      if (dots) {
        const size = p.dotSize * (r() < 0.5 ? 1 : 1 / 3);
        if (!p.grow) s.scale(t0, t0, size);
        if (p.dotSpin) { const a0 = r() * 6.28, te = t0 + count * period; s.rotate(t0, te, a0, a0 + ((te - t0) / 1000) * p.dotSpin * (Math.PI / 180) * r.sign()); }
        s.loop(t0, count, (l) => {
          l.move(0, period, x0, y0, x1, y1, ease);
          if (p.inward) {
            if (p.grow) l.scale(0, period, size, size * 0.25, E.InQuad);
            l.fade(0, period * 0.2, 0, op, E.OutSine); l.fade(period * 0.7, period, op, 0, E.InQuad);
          } else if (p.grow) { l.scale(0, period, 0, size, E.InQuint); l.fade(0, period, op, 0, E.InExpo); }
          else { l.fade(0, period * 0.7, 0, op, E.InSine); l.fade(period, period, op, 0); }
        });
      } else if (p.mode === 'warp') {
        s.loop(t0, count, (l) => {
          l.move(0, period, x0, y0, x1, y1, ease);
          if (p.inward) { l.vec(0, period, (len * 1.4) / 256, vy, (len * 0.1) / 256, vy, E.OutQuad); l.fade(0, period * 0.25, 0, op); l.fade(period * 0.75, period, op, 0); return; }
          l.vec(0, period, (len * 0.15) / 256, vy, (len * 1.4) / 256, vy, E.InQuad);
          l.fade(0, period * 0.35, 0, op);
        });
      } else {
        const loopEnd = t0 + count * period;
        const [fi, fo] = fitDurations(loopEnd - t0, Math.max(50, p.fadeIn), Math.max(50, p.fadeOut));
        const fly = (sp, a, b) => {
          sp.vec(t0, t0, len / 256, vy);
          sp.loop(t0, count, (l) => {
            const ta = Math.round(period * a), tb = Math.round(period * b), OFF = -3000;
            if (ta > 0) l.move(0, ta, OFF, OFF, OFF, OFF);
            l.move(ta, tb, x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b, ease);
            if (tb < period) l.move(tb, period, OFF, OFF, OFF, OFF);
          });
          sp.fade(t0, t0 + fi, 0, op, E.OutQuad);
          sp.fade(loopEnd - fo, loopEnd, op, 0, E.InQuad);
        };
        const D1 = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / D1, uy = (y1 - y0) / D1, hx = ux * len / 2, hy = uy * len / 2;
        const cX = p.clearX ?? 320, cY = p.clearY ?? 240;
        const tip = p.clear > 0 ? insideCircle(x0 + hx, y0 + hy, x1 + hx, y1 + hy, cX, cY, p.clear) : null;
        const gap = tip && [tip[0], Math.min(1, tip[1] + len / D1)];
        if (!gap) fly(s, 0, 1);
        else {
          const parts = [[0, gap[0]], [gap[1], 1]].filter(([a, b]) => b - a > 0.02);
          if (!parts.length) s.fade(t0, t0, 0);
          const lx = x0 + (x1 - x0) * gap[0] + hx, ly = y0 + (y1 - y0) * gap[0] + hy;
          const off = Math.acos(Math.max(-1, Math.min(1, (-(lx - cX) * ux - (ly - cY) * uy) / p.clear))) * 180 / Math.PI;
          if (p.clearSplash && p.mode === 'rain' && gap[0] > 0.02 && off <= (p.clearSplashArc ?? 180) / 2) {
            const ta = Math.round(period * gap[0]), d = Math.min(period, 380), w = r.range(0.07, 0.15);
            const rp = ctx.sprite(ctx.tex('ring-thin'), { x: lx, y: ly });
            rp.color(t0, t0, col);
            if (p.additive) rp.additive();
            rp.loop(t0 + ta, count, (l) => { l.scale(0, d, 0, w, E.OutQuad); l.fade(0, d, Math.min(1, op * 1.8), 0, E.InQuad); if (d < period) l.fade(period, period, 0, 0); });
          }
          parts.forEach(([a, b], k) => {
            let sp = s;
            if (k) { sp = ctx.sprite(tex, { x: x0, y: y0 }); sp.rotate(t0, t0, rot); sp.color(t0, t0, col); if (p.additive) sp.additive(); }
            fly(sp, a, b);
          });
        }
        if (p.mode === 'rain' && p.splash && count > 1) {
          const sp = ctx.sprite(ctx.tex('ring-thin'), { x: x1, y: y1 }), d = Math.min(period, 420), w = r.range(0.12, 0.24);
          sp.color(t0, t0, pickColor(ctx, p, null, i));
          if (p.additive) sp.additive();
          sp.loop(t0 + period, count - 1, (l) => { l.vec(0, d, 0, 0, w, w * 0.3, E.OutQuad); l.fade(0, d, Math.min(1, op * 1.6), 0, E.InQuad); if (d < period) l.fade(period, period, 0, 0); });
        }
      }
    }
  },
};

export const radialSpectrum = {
  id: 'radialSpectrum', name: 'Radial Spectrum', category: 'Background & ambience', icon: '✺', accent: '#b388ff', scope: 'range',
  description: 'A ring of bars that dances to the song - the classic circular visualizer.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    num('bars', 'Bars', 8, 128, 2, 60),
    num('radius', 'Radius', 10, 300, 1, 85, 'Position'),
    num('x', 'Centre X', -107, 747, 1, 320, 'Position'),
    num('y', 'Centre Y', 0, 480, 1, 240, 'Position'),
    num('height', 'Max height', 5, 300, 1, 70),
    num('thickness', 'Bar thickness', 0.1, 1, 0.05, 0.55),
    bool('mirror', 'Mirror (symmetric)', true),
    bool('ring', 'Pulsing ring', true),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.75),
    bool('additive', 'Glow (additive)', true),
    num('fps', 'Updates per second', 5, 60, 1, 24, 'Analysis'),
    num('smooth', 'Smoothing', 0, 0.9, 0.05, 0.4, 'Analysis'),
    num('threshold', 'Optimise (px)', 0, 10, 0.5, 1.5, 'Analysis'),
    ...colorParams('#ffffff', 'rainbow', ['#00f5d4', '#9b5de5', '#f15bb5']),
    ...fadeParams(600, 600),
  ],
  presets: [
    { name: 'Rainbow ring', values: {} },
    { name: 'White minimal', values: { colorMode: 'fixed', color: '#ffffff', bars: 90, thickness: 0.4, height: 50, opacity: 0.6 } },
    { name: 'Neon gradient', values: { colorMode: 'cycle', bars: 72 } },
    { name: 'Big & bold', values: { radius: 140, height: 120, bars: 40, thickness: 0.7 } },
  ],
  async generate(ctx, p) {
    const audio = await ctx.audio();
    if (!audio) return;
    const { start, end } = ctx;
    const n = Math.max(4, Math.round(p.bars));
    const bands = p.mirror ? Math.ceil(n / 2) : n;
    const step = 1000 / p.fps;
    const times = [];
    for (let t = start; t <= end; t += step) times.push(Math.round(t));
    const frames = spectrum(audio, times, { bars: bands, minFreq: 40, maxFreq: 12000, log: true });
    const pal = (p.colorMode === 'cycle' || p.colorMode === 'random') && p.palette.length > 1 ? p.palette.map(hexToRgb) : null;
    const w = ((2 * Math.PI * p.radius) / n) * p.thickness;
    const simplify = (keys) => {
      const kept = [keys[0]];
      for (let k = 1; k < keys.length - 1; k++) {
        const a = kept[kept.length - 1], c = keys[k + 1];
        const est = a[1] + ((c[1] - a[1]) * (keys[k][0] - a[0])) / (c[0] - a[0]);
        if (Math.abs(est - keys[k][1]) > p.threshold) kept.push(keys[k]);
      }
      kept.push(keys[keys.length - 1]);
      return kept;
    };
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const band = p.mirror ? Math.min(i, n - 1 - i) : i;
      const s = ctx.sprite(ctx.tex('pixel'), { origin: 'BottomCentre', x: p.x + Math.cos(a) * p.radius, y: p.y + Math.sin(a) * p.radius });
      s.rotate(start, start, a + Math.PI / 2);
      let col;
      if (p.colorMode === 'rainbow') col = hsvToRgb((i / n) * 360, 0.6, 1);
      else if (pal) { const f = (band / Math.max(1, bands - 1)) * (pal.length - 1), k = Math.min(pal.length - 2, Math.floor(f)); col = pal[k].map((v, j) => lerp(v, pal[k + 1][j], f - k)); }
      else col = pickColor(ctx, p, null, i);
      s.color(start, start, col.map(Math.round));
      if (p.additive) s.additive();
      let prev = 0;
      const keys = simplify(frames.map((v, k) => { prev = prev * p.smooth + v[band] * (1 - p.smooth); return [times[k], 1 + prev * p.height]; }));
      for (let k = 0; k < keys.length - 1; k++) s.vec(keys[k][0], keys[k + 1][0], w, keys[k][1], w, keys[k + 1][1]);
      rangeFade(s, ctx, p, p.opacity);
    }
    if (p.ring) {
      const ring = ctx.sprite(ctx.tex('ring-thin'), { x: p.x, y: p.y });
      const RING_PX = 120.3;
      let prev = 0;
      const keys = simplify(frames.map((v, k) => { prev = prev * 0.5 + v[0] * 0.5; return [times[k], p.radius * (1 + prev * 0.12)]; }));
      for (let k = 0; k < keys.length - 1; k++) ring.scale(keys[k][0], keys[k + 1][0], keys[k][1] / RING_PX, keys[k + 1][1] / RING_PX);
      ring.color(start, start, p.colorMode === 'fixed' ? hexToRgb(p.color) : [255, 255, 255]);
      if (p.additive) ring.additive();
      rangeFade(ring, ctx, p, p.opacity * 0.8);
    }
  },
};

export const beatGrid = {
  id: 'beatGrid', name: 'Beat Grid', category: 'Background & ambience', icon: '▦', accent: '#06d6a0', scope: 'range',
  description: 'A grid of tiles that light up on the beat - random, sweeping, ripples or checkerboard.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    { key: 'pattern', label: 'Pattern', type: 'select', group: 'Look', default: 'random', options: opt([['random', 'Random tiles'], ['wave', 'Sweep'], ['ripple', 'Ripple from centre'], ['checker', 'Checkerboard']]) },
    num('cols', 'Columns', 4, 32, 1, 14),
    num('perBeat', 'Tiles per beat', 1, 60, 1, 8, 'Look', { showIf: (p) => p.pattern === 'random' }),
    { key: 'style', label: 'Tiles', type: 'select', group: 'Look', default: 'tile', options: opt([['tile', 'Filled'], ['tile-o', 'Outlined']]) },
    num('gap', 'Gap', 0, 0.6, 0.02, 0.12),
    num('intensity', 'Brightness', 0.05, 1, 0.05, 0.3),
    bool('additive', 'Glow (additive)', true),
    { key: 'every', label: 'Every', type: 'select', group: 'Rhythm', default: '1', options: opt([['0.5', '½ beat'], ['1', '1 beat'], ['2', '2 beats'], ['4', '1 bar']]) },
    num('decay', 'Decay', 0.2, 2, 0.05, 0.9, 'Rhythm'),
    ...colorParams('#ffffff', 'fixed', ['#00f5d4', '#9b5de5', '#f15bb5', '#fee440']),
  ],
  presets: [
    { name: 'Random flicker', values: {} },
    { name: 'Sweep', values: { pattern: 'wave', intensity: 0.25, cols: 16 } },
    { name: 'Ripple', values: { pattern: 'ripple', style: 'tile-o', intensity: 0.5 } },
    { name: 'Neon checker', values: { pattern: 'checker', every: '2', intensity: 0.12, colorMode: 'cycle' } },
  ],
  generate(ctx, p) {
    const r = ctx.rng;
    const beats = beatTimes(ctx, p.every, p.kiaiOnly);
    if (!beats.length) return;
    const cols = Math.round(p.cols), cw = SB.width / cols, rows = Math.ceil(480 / cw);
    const oy = (480 - rows * cw) / 2;
    const center = [(cols - 1) / 2, (rows - 1) / 2];
    const lit = new Map();
    const ringOf = (c, rr) => Math.floor(Math.max(Math.abs(c - center[0]), Math.abs(rr - center[1])) + 1e-9);
    const maxRing = ringOf(0, 0) + 1;
    beats.forEach((b, k) => {
      let tiles = [];
      if (p.pattern === 'wave') { const c = k % cols; for (let rr = 0; rr < rows; rr++) tiles.push(rr * cols + c); }
      else if (p.pattern === 'ripple') {
        const ring = k % maxRing;
        for (let rr = 0; rr < rows; rr++) for (let c = 0; c < cols; c++) if (ringOf(c, rr) === ring) tiles.push(rr * cols + c);
      } else if (p.pattern === 'checker') { for (let rr = 0; rr < rows; rr++) for (let c = 0; c < cols; c++) if ((c + rr + k) % 2 === 0) tiles.push(rr * cols + c); }
      else { const set = new Set(); for (let j = 0; j < p.perBeat; j++) set.add(r.int(0, rows * cols - 1)); tiles = [...set]; }
      for (const t of tiles) { if (!lit.has(t)) lit.set(t, []); lit.get(t).push({ t: b.time, i: k }); }
    });
    const gap = beats.length > 1 ? beats[1].time - beats[0].time : ctx.map.beatLengthAt(ctx.start);
    const dur = Math.max(80, gap * p.decay);
    const scale = (cw * (1 - p.gap)) / 56;
    const fixed = p.colorMode === 'fixed' && !p.colorVar;
    for (const [tile, evs] of lit) {
      const c = tile % cols, rr = Math.floor(tile / cols);
      const s = ctx.sprite(ctx.tex(p.style), { x: SB.left + (c + 0.5) * cw, y: oy + (rr + 0.5) * cw });
      s.scale(evs[0].t, evs[0].t, scale);
      if (p.additive) s.additive();
      if (fixed) s.color(evs[0].t, evs[0].t, pickColor(ctx, p, null, 0));
      evs.forEach((ev, j) => {
        const t1 = Math.min(ev.t + dur, evs[j + 1]?.t ?? Infinity);
        s.fade(ev.t, t1, p.intensity, t1 < ev.t + dur ? p.intensity * (1 - (t1 - ev.t) / dur) : 0, E.OutQuad);
        if (!fixed) s.color(ev.t, ev.t, pickColor(ctx, p, null, ev.i));
      });
    }
  },
};

export const fountains = {
  id: 'fountains', name: 'Side Fountains', category: 'Background & ambience', icon: '⛲', accent: '#ffd166', scope: 'range',
  description: 'Sparkles shoot up from the bottom corners on the beat, like osu!’s kiai fountains.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  params: [
    { key: 'side', label: 'From', type: 'select', group: 'Look', default: 'both', options: opt([['both', 'Both corners'], ['left', 'Left corner'], ['right', 'Right corner'], ['centre', 'Bottom centre'], ['floor', 'The whole bottom edge']]) },
    { key: 'style', label: 'Flight', type: 'select', group: 'Look', default: 'arc', options: opt([['arc', 'Up and falling back'], ['shoot', 'Shoot up and shrink away']]) },
    { key: 'texture', label: 'Particle', type: 'select', group: 'Look', default: 'star4', options: opt([['star4', 'Sparkle'], ['soft-dot', 'Soft dot'], ['glow', 'Glow'], ['star', 'Star'], ['petal', 'Petal']]), showIf: (p) => !p.image },
    ...customImageParam(),
    num('count', 'Particles per burst', 1, 200, 1, 7),
    num('height', 'Height (px)', 60, 520, 5, 300),
    num('spread', 'Spread (px)', 0, 500, 5, 200),
    num('sizeMin', 'Size min', 0.05, 2, 0.05, 0.15),
    num('sizeMax', 'Size max', 0.05, 2, 0.05, 0.35),
    num('life', 'Lifetime (ms)', 400, 4000, 50, 1500),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.9),
    bool('additive', 'Glow (additive)', true),
    { key: 'every', label: 'Every', type: 'select', group: 'Rhythm', default: '1', options: opt([['0.5', '½ beat'], ['1', '1 beat'], ['2', '2 beats'], ['4', '1 bar']]) },
    ...colorParams('#ffffff', 'combo'),
  ],
  presets: [
    { name: 'Kiai fountains', values: {} },
    { name: 'Gold rain', values: { colorMode: 'fixed', color: '#ffd166', count: 12, height: 380 } },
    { name: 'Petal burst', values: { texture: 'petal', additive: false, colorMode: 'random', palette: ['#ffc4dd', '#ff9ec7', '#ffffff'], count: 6, sizeMin: 0.12, sizeMax: 0.22 } },
    { name: 'Centre geyser', values: { side: 'centre', spread: 300, count: 14, height: 420 } },
    { name: 'Floor burst', values: { side: 'floor', style: 'shoot', count: 120, height: 460, sizeMin: 0.03, sizeMax: 0.35, life: 1600, opacity: 1, additive: false, every: '4', colorMode: 'fixed', color: '#ffffff' } },
  ],
  async generate(ctx, p) {
    const r = ctx.rng;
    const beats = beatTimes(ctx, p.every, p.kiaiOnly);
    const tex = await shapeOrImage(ctx, p);
    const sources = p.side === 'both' ? [-1, 1] : p.side === 'left' ? [-1] : p.side === 'right' ? [1] : [0];
    const sMax = Math.max(p.sizeMin, p.sizeMax);
    beats.forEach((b, bi) => {
      for (const side of sources) {
        const x0 = side < 0 ? SB.left + 25 : side > 0 ? SB.right - 25 : 320, y0 = 495;
        for (let k = 0; k < p.count; k++) {
          if (p.style === 'shoot') {
            const xs = p.side === 'floor' ? r.range(SB.left, SB.right) : x0 + (side === 0 ? r.range(-1, 1) * p.spread * 0.5 : -side * r.range(0, 1) * p.spread);
            const s = ctx.sprite(tex, { x: xs, y: 480 });
            s.moveY(b.time, b.time + p.life * 0.667, 480, 480 - p.height * r(), E.OutExpo);
            s.scale(b.time, b.time + p.life, r.range(p.sizeMin, sMax), 0);
            if (p.opacity < 1) s.fade(b.time, b.time, p.opacity);
            s.color(b.time, b.time, pickColor(ctx, p, null, bi * 31 + k));
            if (p.additive) s.additive();
            continue;
          }
          const t0 = b.time + r.range(0, 70), life = p.life * r.range(0.75, 1.15), t1 = t0 + life, tp = t0 + life * 0.45;
          const dx = side === 0 ? r.range(-1, 1) * p.spread * 0.5 : -side * r.range(0.15, 1) * p.spread;
          const h = p.height * r.range(0.55, 1);
          const s = ctx.sprite(tex, { x: x0, y: y0 });
          s.moveX(t0, t1, x0, x0 + dx);
          s.moveY(t0, tp, y0, y0 - h, E.OutQuad);
          s.moveY(tp, t1, y0 - h, y0 - h * 0.55, E.InQuad);
          const size = r.range(p.sizeMin, sMax);
          s.scale(t0, t1, size, size * 0.4);
          s.fade(t0, t1, p.opacity, 0, E.InQuad);
          const r0 = r() * Math.PI;
          s.rotate(t0, t1, r0, r0 + r.sign() * r.range(1, 4));
          s.color(t0, t0, pickColor(ctx, p, null, bi * 31 + k));
          if (p.additive) s.additive();
        }
      }
    });
  },
};

export const progressBar = {
  id: 'progressBar', name: 'Progress Bar', category: 'Background & ambience', icon: '▭', accent: '#ff66aa', scope: 'range',
  description: 'A thin bar that fills up across the selected range (e.g. the whole song).',
  defaultLayer: 'Overlay', defaultOutput: 'osb',
  params: [
    { key: 'position', label: 'Position', type: 'select', group: 'Look', default: 'bottom', options: opt([['bottom', 'Bottom'], ['top', 'Top']]) },
    num('thickness', 'Thickness', 1, 16, 0.5, 3),
    { key: 'color', label: 'Colour', type: 'color', default: '#ff66aa', group: 'Look' },
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.9),
    num('track', 'Track opacity', 0, 1, 0.05, 0.15),
    bool('head', 'Glowing head', true),
    ...fadeParams(400, 400),
  ],
  presets: [{ name: 'Pink line', values: {} }, { name: 'Subtle white', values: { color: '#ffffff', opacity: 0.5, thickness: 2, head: false } }, { name: 'Top bar', values: { position: 'top', thickness: 4 } }],
  generate(ctx, p) {
    const { start, end } = ctx;
    const y = p.position === 'top' ? p.thickness / 2 : 480 - p.thickness / 2;
    if (p.track > 0) {
      const tr = ctx.sprite(ctx.tex('pixel'), { origin: 'CentreLeft', x: SB.left, y }).vec(start, start, SB.width, p.thickness).color(start, start, p.color);
      rangeFade(tr, ctx, p, p.opacity * p.track);
    }
    const fill = ctx.sprite(ctx.tex('pixel'), { origin: 'CentreLeft', x: SB.left, y });
    fill.vec(start, end, 0, p.thickness, SB.width, p.thickness);
    fill.color(start, start, p.color);
    rangeFade(fill, ctx, p, p.opacity);
    if (p.head) {
      const h = ctx.sprite(ctx.tex('glow'), { x: SB.left, y }).additive();
      h.moveX(start, end, SB.left, SB.right);
      h.scale(start, start, Math.max(0.15, p.thickness / 18));
      h.color(start, start, p.color);
      rangeFade(h, ctx, p, p.opacity);
    }
  },
};

export const filmGrain = {
  id: 'filmGrain', name: 'Film Grain', category: 'Background & ambience', icon: '▒', accent: '#bbbbbb', scope: 'range',
  description: 'Flickering grain over the picture, like old film or a bad signal. Good on a tense or sad part.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    num('opacity', 'Strength', 0.02, 1, 0.01, 0.22),
    num('frame', 'A new grain every (ms)', 20, 400, 5, 50),
    { key: 'color', label: 'Colour', type: 'color', default: '#ffffff', group: 'Look' },
    bool('additive', 'Additive (light) blending', false),
  ],
  presets: [
    { name: 'Old film', values: {} },
    { name: 'Heavy static', values: { opacity: 0.4, frame: 40 } },
    { name: 'Dark dust', values: { color: '#000000', opacity: 0.3, frame: 80 } },
    { name: 'Glowing noise', values: { additive: true, opacity: 0.25 } },
  ],
  generate(ctx, p) {
    const { start, end } = ctx;
    const f = Math.max(20, Math.round(p.frame)), names = ['grain-a', 'grain-b', 'grain-c'];
    const n = Math.max(1, Math.ceil((end - start) / (f * 3)));
    const k = Math.max(SB.width / ctx.texSize(names[0]).w, SB.height / ctx.texSize(names[0]).h) * 1.01;
    names.forEach((name, i) => {
      const s = ctx.sprite(ctx.tex(name), { x: 320, y: 240 });
      s.scale(start, start, k);
      s.color(start, start, p.color);
      if (p.additive) s.additive();
      if (i % 2) s.flipH();
      s.loop(start, n, (l) => {
        if (i > 0) l.fade(0, i * f, 0, 0);
        l.fade(i * f, (i + 1) * f, p.opacity, p.opacity);
        if (i < 2) l.fade((i + 1) * f, 3 * f, 0, 0);
      });
      s.fade(start + n * f * 3, start + n * f * 3, 0);
    });
  },
};

export const splitScreen = {
  id: 'splitScreen', name: 'Split Screen', category: 'Background & ambience', icon: '◧', accent: '#c9a2ff', scope: 'range',
  description: 'Covers or tints one half of the screen, with an optional line of light on the divide. For pictures with two sides (two characters, day and night): show one side at a time, or colour each side differently.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    { key: 'side', label: 'Which side', type: 'select', group: 'Look', default: 'right', options: opt([['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']]) },
    num('edge', 'Divide at (X or Y)', -107, 747, 1, 320, 'Look', { help: 'Where the two sides meet: X for left/right (320 = middle), Y for top/bottom (240 = middle).' }),
    { key: 'color', label: 'Veil colour', type: 'color', default: '#000000', group: 'Look' },
    num('opacity', 'Veil strength', 0, 1, 0.05, 0.8, 'Look', { help: '1 hides that side completely, less only dims or tints it. 0 = no veil, just the line.' }),
    bool('additive', 'Veil adds light instead of covering', false, 'Look', { help: 'For a bright tint that glows over the picture.' }),
    { key: 'enter', label: 'Comes in', type: 'select', group: 'Timing', default: 'fade', options: opt([['fade', 'Fading'], ['divide', 'Growing from the divide'], ['outside', 'Sliding in from the outside']]) },
    { key: 'leave', label: 'Goes out', type: 'select', group: 'Timing', default: 'fade', options: opt([['fade', 'Fading'], ['divide', 'Shrinking back to the divide'], ['outside', 'Sliding off to the outside']]) },
    num('inMs', 'Comes in over (ms)', 0, 5000, 10, 250, 'Timing'),
    num('outMs', 'Goes out over (ms)', 0, 5000, 10, 250, 'Timing'),
    { key: 'ease', label: 'Easing', type: 'easing', default: E.OutCubic, group: 'Timing', options: EASING_OPTIONS },
    bool('line', 'Line of light on the divide', false, 'Divide'),
    { key: 'lineColor', label: 'Line colour', type: 'color', default: '#ffffff', group: 'Divide', showIf: (p) => p.line },
    num('lineWidth', 'Line width (px)', 1, 40, 1, 3, 'Divide', { showIf: (p) => p.line }),
    num('lineGlow', 'Glow around it (px)', 0, 200, 2, 50, 'Divide', { showIf: (p) => p.line }),
    num('lineOpacity', 'Line opacity', 0.05, 1, 0.05, 0.9, 'Divide', { showIf: (p) => p.line }),
  ],
  presets: [
    { name: 'Hide the right side', values: {} },
    { name: 'Hide the left side', values: { side: 'left' } },
    { name: 'Dim one side', values: { opacity: 0.55 } },
    { name: 'Curtain from the middle', values: { opacity: 1, enter: 'divide', leave: 'divide', inMs: 500, outMs: 500 } },
    { name: 'White-out side', values: { color: '#ffffff', opacity: 0.85 } },
    { name: 'Colour one side', values: { color: '#b01030', opacity: 0.35, additive: true } },
    { name: 'Line of light', values: { opacity: 0, line: true, inMs: 400, outMs: 600 } },
  ],
  generate(ctx, p) {
    const S0 = ctx.start, S1 = ctx.end;
    if (S1 - S0 < 40) return;
    const [ti, to] = fitDurations(S1 - S0, p.inMs, p.outMs);
    const a = S0 + ti, b = S1 - to;
    const horiz = p.side === 'left' || p.side === 'right', low = p.side === 'left' || p.side === 'top';
    const lo = horiz ? SB.left - 2 : -2, hi = horiz ? SB.right + 2 : 482;
    const len = low ? p.edge - lo : hi - p.edge, across = horiz ? 484 : SB.width + 4;
    if (p.opacity > 0 && len > 0) {
      const mk = (anchorOutside) => {
        const atOut = low ? lo : hi, at = anchorOutside ? atOut : p.edge;
        const towardLow = anchorOutside ? !low : low;
        const origin = horiz ? (towardLow ? 'CentreRight' : 'CentreLeft') : (towardLow ? 'BottomCentre' : 'TopCentre');
        return ctx.sprite(ctx.tex('pixel'), { origin, x: horiz ? at : 320, y: horiz ? 240 : at });
      };
      const size = (s, t0, t1, l0, l1, ease) => (horiz ? s.vec(t0, t1, l0, across, l1, across, ease) : s.vec(t0, t1, across, l0, across, l1, ease));
      const slideIn = p.enter !== 'fade' && ti > 0, slideOut = p.leave !== 'fade' && to > 0;
      const sameAnchor = !slideIn || !slideOut || (p.enter === 'outside') === (p.leave === 'outside');
      const s = mk(slideIn ? p.enter === 'outside' : slideOut ? p.leave === 'outside' : false);
      s.color(S0, S0, p.color);
      if (p.additive) s.additive();
      if (slideIn) { size(s, S0, a, 0, len, p.ease); s.fade(S0, S0, p.opacity); } else { size(s, S0, S0, len, len); s.fade(S0, a, ti > 0 ? 0 : p.opacity, p.opacity); }
      if (sameAnchor) {
        if (slideOut) { size(s, b, S1, len, 0, E.InCubic); s.fade(S1, S1, p.opacity, 0); } else s.fade(b, S1, p.opacity, 0);
      } else {
        s.fade(b, b, p.opacity, 0);
        const s2 = mk(p.leave === 'outside');
        s2.color(b, b, p.color);
        if (p.additive) s2.additive();
        size(s2, b, S1, len, 0, E.InCubic); s2.fade(b, b, p.opacity); s2.fade(S1, S1, p.opacity, 0);
      }
    }
    if (p.line) {
      const put = (tex, w, op) => {
        const s = ctx.sprite(ctx.tex(tex), { x: horiz ? p.edge : 320, y: horiz ? 240 : p.edge });
        const tw = ctx.texSize(tex).w, th = ctx.texSize(tex).h;
        if (!horiz) s.rotate(S0, S0, Math.PI / 2);
        const L = (horiz ? 484 : SB.width + 4) / th;
        s.vec(S0, a, w / tw, 0, w / tw, L, E.OutCubic);
        if (to > 0) s.vec(b, S1, w / tw, L, w / tw, 0, E.InCubic);
        s.fade(S0, S0, op); s.fade(S1, S1, op, 0);
        s.color(S0, S0, p.lineColor); s.additive();
      };
      if (p.lineGlow > 0) put('beam', p.lineGlow, p.lineOpacity * 0.6);
      put('pixel', p.lineWidth, p.lineOpacity);
    }
  },
};

export default [streaks, radialSpectrum, beatGrid, fountains, progressBar, filmGrain, splitScreen];
