import { E, EASING_OPTIONS } from '../easing.js';
import { colorParams, pickColor, opt, SB, fitDurations, repeatParams, repeatTimes, pictureFor, lined, lineParam } from './common.js';
import { ease as easeFn } from '../easing.js';
import { hexToRgb } from '../util.js';

const num = (key, label, min, max, step, def, group = 'Look', extra = {}) => ({ key, label, type: 'number', min, max, step, default: def, group, ...extra });
const easing = (key, label, def, group = 'Timing') => ({ key, label, type: 'easing', default: def, group, options: EASING_OPTIONS });

export const flash = {
  id: 'flash', name: 'Flash', category: 'Transitions', icon: '✸', accent: '#ffffff', scope: 'point',
  description: 'A full-screen flash at one moment - perfect for the start of a kiai or a drop.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  length: (p) => p.duration,
  params: [
    num('intensity', 'Intensity', 0.05, 1, 0.05, 0.8),
    num('duration', 'Fade duration (ms)', 10, 10000, 5, 900, 'Timing'),
    num('build', 'Build-up before (ms)', 0, 8000, 5, 0, 'Timing', { help: 'Fade the screen towards white before the flash.' }),
    easing('buildEase', 'Build-up easing', E.InQuad),
    easing('ease', 'Fade easing', E.OutQuad),
    { key: 'additive', label: 'Additive (light) blending', type: 'bool', default: true, group: 'Look' },
    { key: 'color', label: 'Colour', type: 'color', default: '#ffffff', group: 'Look' },
    ...repeatParams(),
  ],
  presets: [
    { name: 'White flash', values: {} },
    { name: 'Stutter', values: { intensity: 0.7, duration: 80, ease: E.InSine, repeat: 3, repeatBeats: 0.25, additive: false } },
    { name: 'Long white-out', values: { build: 1200, duration: 1500, intensity: 1, additive: false } },
    { name: 'Swell & cut', values: { build: 1200, buildEase: E.Linear, duration: 90, ease: E.Linear, intensity: 1, additive: false } },
    { name: 'Red hit', values: { color: '#ff3355', intensity: 0.6, duration: 600 } },
    { name: 'Blackout', values: { color: '#000000', additive: false, intensity: 1, duration: 700, ease: E.InQuad } },
  ],
  generate(ctx, p) {
    const times = repeatTimes(ctx, p);
    const s = ctx.sprite(ctx.tex('pixel'), { x: 320, y: 240 });
    s.vec(times[0], times[0], 860, 482);
    s.color(times[0], times[0], p.color);
    times.forEach((t, i) => {
      const next = times[i + 1] ?? Infinity;
      if (p.build > 0 && i === 0) s.fade(t - p.build, t, 0, p.intensity, p.buildEase ?? E.InQuad);
      const t1 = Math.min(t + p.duration, next);
      const left = t1 < t + p.duration ? p.intensity * (1 - easeFn(p.ease, (t1 - t) / p.duration)) : 0;
      s.fade(t, t1, p.intensity, left, t1 < t + p.duration ? E.Linear : p.ease);
    });
    if (p.additive) s.additive();
  },
};

export const fadeColor = {
  id: 'fadeColor', name: 'Fade / Hold Colour', category: 'Transitions', icon: '◐', accent: '#999', scope: 'range',
  description: 'The whole screen fades to or from a colour, dips to it and back, or simply stays that colour for the selected range.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  params: [
    { key: 'mode', label: 'Mode', type: 'select', group: 'Look', default: 'out',
      options: opt([['in', 'Fade in from colour'], ['out', 'Fade out to colour'], ['through', 'Dip to colour and back'], ['hold', 'Hold colour (with soft edges)']]) },
    { key: 'color', label: 'Colour', type: 'color', default: '#000000', group: 'Look' },
    num('opacity', 'Max opacity', 0.05, 1, 0.05, 1),
    num('edge', 'Edge softness (ms)', 0, 3000, 50, 300, 'Timing', { showIf: (p) => p.mode === 'hold' }),
    num('edgeOut', 'Different at the end (ms)', -1, 3000, 1, -1, 'Timing', { showIf: (p) => p.mode === 'hold', help: '-1 = same as the start. 0 = cut.' }),
    easing('ease', 'Easing', E.InOutSine),
    { key: 'easeBack', label: 'Easing on the way back', type: 'easing', default: E.InOutSine, group: 'Timing', options: EASING_OPTIONS, showIf: (p) => p.mode === 'through' },
  ],
  presets: [
    { name: 'Fade to black', values: { mode: 'out' } },
    { name: 'Dip to black', values: { mode: 'through', ease: E.InSine, easeBack: E.OutSine } },
    { name: 'Fade from black', values: { mode: 'in' } },
    { name: 'Fade to white', values: { mode: 'out', color: '#ffffff' } },
    { name: 'Dip to white', values: { mode: 'through', color: '#ffffff' } },
    { name: 'Hold white', values: { mode: 'hold', color: '#ffffff', edge: 0 } },
    { name: 'Hold black', values: { mode: 'hold', edge: 0 } },
    { name: 'Break blackout', values: { mode: 'hold', opacity: 0.7 } },
  ],
  generate(ctx, p) {
    const { start, end } = ctx;
    const s = ctx.sprite(ctx.tex('pixel'), { x: 320, y: 240 });
    s.vec(start, start, 860, 482);
    s.color(start, start, p.color);
    const mid = (start + end) / 2;
    switch (p.mode) {
      case 'in': s.fade(start, end, p.opacity, 0, p.ease); break;
      case 'through': s.fade(start, mid, 0, p.opacity, p.ease); s.fade(mid, end, p.opacity, 0, p.easeBack ?? p.ease); break;
      case 'hold': {
        const [a, b] = fitDurations(end - start, p.edge, (p.edgeOut ?? -1) < 0 ? p.edge : p.edgeOut);
        s.fade(start, start + a, a > 0 ? 0 : p.opacity, p.opacity, p.ease); s.fade(end - b, end, p.opacity, b > 0 ? 0 : p.opacity, p.ease);
        if (b <= 0) s.fade(end, end, 0);
        break;
      }
      default: s.fade(start, end, 0, p.opacity, p.ease);
    }
  },
};

export const barWipe = {
  id: 'barWipe', name: 'Bar Wipe', category: 'Transitions', icon: '☰', accent: '#ef476f', scope: 'range',
  description: 'Staggered bars sweep across the screen - covering it, revealing it, or both.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  params: [
    { key: 'direction', label: 'Direction', type: 'select', group: 'Look', default: 'lr', options: opt([['lr', 'Left → right'], ['rl', 'Right → left'], ['tb', 'Top → bottom'], ['bt', 'Bottom → top'], ['meet', 'Both sides → middle (doors)'], ['alt', 'Alternating sides (shutters)']]),
      help: '"Doors" close in the middle and open back to their own side. "Shutters": every other bar comes from the other side.' },
    { key: 'mode', label: 'Mode', type: 'select', group: 'Look', default: 'through', options: opt([['through', 'Cover then reveal'], ['cover', 'Cover only'], ['reveal', 'Reveal only']]) },
    num('bars', 'Bars', 1, 32, 1, 8),
    num('stagger', 'Stagger', 0, 0.9, 0.05, 0.5),
    { key: 'order', label: 'Order', type: 'select', group: 'Look', default: 'seq', options: opt([['seq', 'Sequential'], ['rev', 'Sequential, backwards'], ['centre', 'Centre out'], ['random', 'Random']]) },
    num('slant', 'Slant (degrees)', -30, 30, 0.5, 0),
    { key: 'widen', label: 'Bars start thin and widen', type: 'bool', default: false, group: 'Look' },
    num('overrun', 'Cut off before it finishes (ms)', 0, 3000, 10, 0, 'Timing', { help: 'The wipe is still under way when the range ends: it is cut there.' }),
    num('hold', 'Hold covered (ms)', 0, 2000, 10, 0, 'Timing', { showIf: (p) => p.mode === 'through' }),
    easing('ease', 'Easing', E.InOutCubic),
    ...colorParams('#000000', 'fixed', ['#ff66aa', '#66ccff', '#ffd166']),
  ],
  presets: [
    { name: 'Black bars', values: {} },
    { name: 'Colour stripes', values: { colorMode: 'cycle', bars: 6, direction: 'tb' } },
    { name: 'Venetian', values: { bars: 16, stagger: 0.2, direction: 'tb', order: 'centre' } },
    { name: 'Slanted panel', values: { bars: 1, stagger: 0, mode: 'cover', direction: 'lr', slant: 14, ease: E.InQuart } },
    { name: 'Closing doors', values: { direction: 'meet', bars: 1, stagger: 0, mode: 'cover', slant: 6, ease: E.InOutCubic } },
    { name: 'Doors open', values: { direction: 'meet', bars: 1, stagger: 0, mode: 'reveal', slant: 6, ease: E.OutCubic } },
    { name: 'Side shutters', values: { direction: 'alt', bars: 14, stagger: 0.35, mode: 'reveal', order: 'random', ease: E.OutCubic } },
    { name: 'Rising blades', values: { bars: 36, mode: 'cover', direction: 'bt', order: 'rev', stagger: 0.5, slant: -7, widen: true, ease: E.OutQuad } },
  ],
  generate(ctx, p) {
    const { start } = ctx;
    const cut = ctx.end, end = ctx.end + (p.overrun || 0);
    const meet = p.direction === 'meet', alt = p.direction === 'alt';
    const horiz = p.direction === 'lr' || p.direction === 'rl' || meet || alt;
    const n = p.bars;
    const total = end - start;
    const coverSpan = p.mode === 'through' ? (total - p.hold) / 2 : p.mode === 'cover' ? total : 0;
    const revealSpan = p.mode === 'through' ? (total - p.hold) / 2 : p.mode === 'reveal' ? total : 0;
    const order = Array.from({ length: n }, (_, i) => i);
    if (p.order === 'rev') order.reverse();
    if (p.order === 'centre') order.sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2));
    if (p.order === 'random') order.sort(() => ctx.rng() - 0.5);
    const rank = new Array(n); order.forEach((bar, k) => { rank[bar] = k; });
    const th = ((p.slant || 0) * Math.PI) / 180;
    const L0 = horiz ? SB.width + 4 : 484;
    const T = (horiz ? 482 : SB.width + 4) / n;
    const L = th ? L0 / Math.cos(th) + Math.abs(Math.tan(th)) * T + 2 : L0;
    const extra = th ? Math.ceil((L0 * Math.abs(Math.tan(th))) / T) : 0;
    const T0 = T;
    const sides = [];
    for (let i = -extra; i < n + extra; i++) {
      const far = L0 * Math.tan(th);
      if (meet && n === 1) {
        if (i !== 0) continue;
        const back = 241 * Math.abs(Math.tan(th)) + 2, D = L0 + 2 * back;
        const wide = 482 / Math.cos(th) + D * Math.abs(Math.tan(th)) + 4;
        sides.push([0, true, (D * Math.cos(th)) / 2 + 0.5, 0, true, back, wide], [0, false, (D * Math.cos(th)) / 2 + 0.5, 0, true, back, wide]);
      } else if (meet) sides.push([i, true, L / 2 + 1, 0, true], [i, false, L / 2 + 1, far, true]);
      else if (alt) { const f = ((i % 2) + 2) % 2 === 0; sides.push([i, f, L, f ? 0 : far, p.mode === 'reveal']); }
      else sides.push([i, p.direction === 'lr' || p.direction === 'tb', L, 0, false]);
    }
    for (const [i, fwd, L, shift, retreat, back = 0, T = T0] of sides) {
      const ri = Math.min(n - 1, Math.max(0, i));
      const k = n > 1 ? rank[ri] / (n - 1) : 0;
      const across = (horiz ? i * T0 + T0 / 2 : SB.left - 2 + i * T0 + T0 / 2) + shift;
      const origin = horiz ? (fwd ? 'CentreLeft' : 'CentreRight') : (fwd ? 'TopCentre' : 'BottomCentre');
      const edge0 = horiz ? (fwd ? SB.left - 2 - back : SB.right + 2 + back) : (fwd ? -2 : 482);
      const s = ctx.sprite(ctx.tex('pixel'), { origin, x: horiz ? edge0 : across, y: horiz ? across : edge0 });
      s.color(start, start, pickColor(ctx, p, null, ri));
      if (th) s.rotate(start, start, th);
      const thick = (len) => (p.widen ? ((T + 1) * len) / L : T + 1);
      const one = (t0, t1, a, b, e) => (horiz ? s.vec(t0, t1, a, thick(a), b, thick(b), e) : s.vec(t0, t1, thick(a), a, thick(b), b, e));
      const vec = (t0, t1, a, b) => {
        if (t0 >= cut && t1 > t0) return;
        if (t1 <= cut) { one(t0, t1, a, b, p.ease); return; }
        const N = 4, f = (cut - t0) / (t1 - t0);
        for (let q = 0; q < N; q++) {
          const u0 = (f * q) / N, u1 = (f * (q + 1)) / N;
          one(t0 + (t1 - t0) * u0, t0 + (t1 - t0) * u1, a + (b - a) * easeFn(p.ease, u0), a + (b - a) * easeFn(p.ease, u1), E.Linear);
        }
      };
      if (coverSpan > 0) {
        const len = coverSpan * (1 - p.stagger), t0 = start + coverSpan * p.stagger * k;
        if (t0 > start) vec(start, start, 0, 0);
        vec(t0, t0 + len, 0, L);
      }
      if (revealSpan > 0) {
        const r0 = end - revealSpan, len = revealSpan * (1 - p.stagger), t0 = r0 + revealSpan * p.stagger * k;
        if (coverSpan === 0) vec(start, start, L, L);
        vec(t0, t0 + len, L, 0);
        const dir = fwd ? 1 : -1;
        if (retreat) { }
        else if (horiz) s.moveX(t0, t0 + len, edge0, edge0 + dir * L * Math.cos(th), p.ease);
        else s.moveY(t0, t0 + len, edge0, edge0 + dir * L * Math.cos(th), p.ease);
      }
      if (cut < end) s.fade(cut, cut, 1, 0);
    }
  },
};
export const impact = {
  id: 'impact', name: 'Drop Impact', category: 'Transitions', icon: '💥', accent: '#ff9f1c', scope: 'point',
  description: 'Flash + shockwave + particle explosion + light streak in one hit. Made for drops and kiai starts.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  length: (p) => p.duration,
  params: [
    num('x', 'X', -107, 747, 1, 320, 'Position'),
    num('y', 'Y', 0, 480, 1, 240, 'Position'),
    num('intensity', 'Flash intensity', 0, 1, 0.05, 0.7),
    num('rings', 'Shockwaves', 0, 4, 1, 2),
    num('particles', 'Particles', 0, 80, 1, 36),
    num('size', 'Size', 0.3, 3, 0.05, 1),
    { key: 'streak', label: 'Horizontal light streak', type: 'bool', default: true, group: 'Look' },
    { key: 'rays', label: 'Burst of rays', type: 'bool', default: false, group: 'Look', help: 'A fan of light rays swells out of the point and turns a little as it fades.' },
    num('raysTurn', 'Rays turn (degrees)', -90, 90, 1, 14, 'Look', { showIf: (p) => p.rays }),
    num('duration', 'Duration (ms)', 200, 4000, 10, 1400, 'Timing'),
    ...colorParams('#ffe3b3', 'fixed'),
  ],
  presets: [
    { name: 'Big drop', values: {} },
    { name: 'Clean shock', values: { particles: 0, rings: 3, intensity: 0.4 } },
    { name: 'Neon burst', values: { colorMode: 'random', palette: ['#00f5d4', '#f15bb5', '#fee440'], particles: 50 } },
    { name: 'Sunburst', values: { rays: true, particles: 0, rings: 1, streak: false, intensity: 0.5, y: 300, size: 1.2, duration: 1100, color: '#fff3c4' } },
  ],
  generate(ctx, p) {
    const t = ctx.start, r = ctx.rng, D = p.duration;
    const col = pickColor(ctx, p, null, 0);
    if (p.intensity > 0) {
      const f = ctx.sprite(ctx.tex('pixel'), { x: 320, y: 240 }).vec(t, t, 860, 482).color(t, t, col).additive();
      f.fade(t, t + D * 0.5, p.intensity, 0, E.OutQuad);
      const g = ctx.sprite(ctx.tex('glow'), { x: p.x, y: p.y }).color(t, t, col).additive();
      g.scale(t, t + D * 0.6, 2 * p.size, 6 * p.size, E.OutExpo); g.fade(t, t + D * 0.6, 1, 0, E.OutQuad);
    }
    for (let k = 0; k < p.rings; k++) {
      const t0 = t + k * 90;
      const s = ctx.sprite(ctx.tex(k ? 'ring-thin' : 'ring'), { x: p.x, y: p.y }).color(t0, t0, col).additive();
      s.scale(t0, t0 + D * 0.7, 0.2 * p.size, (3 - k * 0.6) * p.size, E.OutExpo);
      s.fade(t0, t0 + D * 0.7, 0.9, 0, E.InQuad);
    }
    if (p.rays) {
      const s = ctx.sprite(ctx.tex('sunrays'), { x: p.x, y: p.y }).color(t, t, col).additive();
      const a0 = r() * 6.28;
      s.scale(t, t + D, 1.1 * p.size, 2.4 * p.size, E.OutCubic);
      s.rotate(t, t + D, a0, a0 + ((p.raysTurn || 0) * Math.PI) / 180, E.OutQuad);
      s.fade(t, t + D * 0.35, 0.9, 0.9); s.fade(t + D * 0.35, t + D, 0.9, 0, E.InOutSine);
    }
    if (p.streak) {
      const s = ctx.sprite(ctx.tex('flare'), { x: p.x, y: p.y }).color(t, t, col).additive();
      s.vec(t, t + D * 0.6, 0.5 * p.size, 0.8 * p.size, 3.2 * p.size, 0.3 * p.size, E.OutExpo);
      s.fade(t, t + D * 0.6, 1, 0, E.InQuad);
    }
    for (let k = 0; k < p.particles; k++) {
      const a = r() * Math.PI * 2, d = r.range(80, 320) * p.size, life = D * r.range(0.5, 1);
      const s = ctx.sprite(ctx.tex('soft-dot'), { x: p.x, y: p.y }).additive();
      s.move(t, t + life, p.x, p.y, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, E.OutExpo);
      const sz = r.range(0.1, 0.35) * p.size;
      s.scale(t, t + life, sz, 0, E.InQuad);
      s.fade(t, t + life, 1, 0, E.InQuad);
      s.color(t, t, p.colorMode === 'random' ? pickColor(ctx, p, null, k) : col);
    }
  },
};

export const irisWipe = {
  id: 'irisWipe', name: 'Iris Wipe', category: 'Transitions', icon: '◍', accent: '#7f5af0', scope: 'range',
  description: 'A circle closes to a colour and opens again - the classic cartoon transition.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  params: [
    { key: 'mode', label: 'Mode', type: 'select', group: 'Look', default: 'through', options: opt([['through', 'Close, then open'], ['close', 'Close and stay'], ['open', 'Open from closed']]) },
    num('closeDur', 'Close (ms)', 50, 4000, 50, 600, 'Timing', { showIf: (p) => p.mode !== 'open' }),
    num('openDur', 'Open (ms)', 50, 4000, 50, 600, 'Timing', { showIf: (p) => p.mode !== 'close' }),
    num('x', 'Centre X', -107, 747, 1, 320, 'Position'),
    num('y', 'Centre Y', 0, 480, 1, 240, 'Position'),
    num('hole', 'Stays open at (radius px, 0 = shuts fully)', 0, 400, 1, 0, 'Look', { help: 'The circle stops at this size, so whatever is in its middle stays visible while the rest is covered.' }),
    { key: 'color', label: 'Colour', type: 'color', default: '#000000', group: 'Look' },
    easing('ease', 'Easing', E.InOutCubic),
  ],
  presets: [{ name: 'Iris', values: {} }, { name: 'Porthole', values: { hole: 80, closeDur: 1200, openDur: 1200 } }, { name: 'Quick blink', values: { closeDur: 250, openDur: 250, ease: E.InOutQuad } }, { name: 'White out', values: { color: '#ffffff' } }],
  generate(ctx, p) {
    const { start, end } = ctx;
    const HOLE = 512 * 0.46;
    const far = Math.max(...[[SB.left, 0], [SB.right, 0], [SB.left, 480], [SB.right, 480]].map(([cx, cy]) => Math.hypot(cx - p.x, cy - p.y))) + 20;
    const kMax = far / HOLE;
    const [cd, od] = fitDurations(end - start, p.mode === 'open' ? 0 : p.closeDur, p.mode === 'close' ? 0 : p.openDur);
    const iris = ctx.sprite(ctx.tex('iris'), { x: p.x, y: p.y });
    const BIG = 2000;
    const bars = [
      ctx.sprite(ctx.tex('pixel'), { origin: 'BottomCentre', x: p.x, y: p.y }).vec(start, start, BIG, BIG),
      ctx.sprite(ctx.tex('pixel'), { origin: 'TopCentre', x: p.x, y: p.y }).vec(start, start, BIG, BIG),
      ctx.sprite(ctx.tex('pixel'), { origin: 'CentreRight', x: p.x, y: p.y }).vec(start, start, BIG, BIG),
      ctx.sprite(ctx.tex('pixel'), { origin: 'CentreLeft', x: p.x, y: p.y }).vec(start, start, BIG, BIG),
    ];
    const anim = (t0, t1, k0, k1) => {
      iris.scale(t0, t1, k0, k1, p.ease);
      const h0 = 256 * k0, h1 = 256 * k1;
      bars[0].moveY(t0, t1, p.y - h0, p.y - h1, p.ease);
      bars[1].moveY(t0, t1, p.y + h0, p.y + h1, p.ease);
      bars[2].moveX(t0, t1, p.x - h0, p.x - h1, p.ease);
      bars[3].moveX(t0, t1, p.x + h0, p.x + h1, p.ease);
    };
    const kh = Math.min(kMax, (p.hole || 0) / HOLE);
    if (p.mode !== 'open') anim(start, start + cd, kMax, kh);
    else anim(start, start, kh, kh);
    if (p.mode !== 'close') anim(end - od, end, kh, kMax);
    else anim(end, end, kh, kh);
    for (const s of [iris, ...bars]) { s.color(start, start, p.color); s.fade(start, start, 1); }
  },
};

export const zoomEcho = {
  id: 'zoomEcho', name: 'Zoom Echo', category: 'Transitions', icon: '⧉', accent: '#8ab8ff', scope: 'point',
  description: 'A copy of the background (or any picture) zooms and fades away from one moment: the "impact echo" at a drop. Shrinking works too, e.g. for an end card.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  length: (p) => p.duration,
  params: [
    { key: 'image', label: 'Image', type: 'image', default: '', group: 'Image', help: 'Leave on "Map background" to use the beatmap background.' },
    { key: 'fit', label: 'Size', type: 'select', group: 'Image', default: 'cover', options: opt([['cover', 'Fill the screen'], ['custom', 'Own scale']]),
      help: '"Fill the screen": the sizes below are relative to a picture that just covers the screen. "Own scale": they are the plain sprite scale.' },
    num('x', 'X', -107, 747, 1, 320, 'Image', { showIf: (p) => p.fit === 'custom' }),
    num('y', 'Y', 0, 480, 1, 240, 'Image', { showIf: (p) => p.fit === 'custom' }),
    num('from', 'Start size (×)', 0, 4, 0.01, 1, 'Motion'),
    num('to', 'End size (×)', 0, 12, 0.01, 1.9, 'Motion'),
    num('zoomPart', 'Zoom finishes after (%)', 10, 100, 5, 100, 'Motion', { help: 'Below 100 the picture stops growing early and only keeps fading.' }),
    easing('zoomEase', 'Zoom easing', E.Linear, 'Motion'),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 1, 'Image'),
    { key: 'additive', label: 'Additive (light) blending', type: 'bool', default: false, group: 'Image' },
    { key: 'tint', label: 'Tint', type: 'color', default: '#ffffff', group: 'Image' },
    num('duration', 'Duration (ms)', 50, 10000, 10, 2400, 'Timing'),
    easing('ease', 'Fade easing', E.Out),
    { key: 'reveal', label: 'Fade in instead of out', type: 'bool', default: false, group: 'Timing', help: 'The picture grows in until it fills the view, e.g. a flare that whites out the screen.' },
    ...repeatParams(),
  ],
  presets: [
    { name: 'Impact echo', values: {} },
    { name: 'Beat glow', values: { to: 1.03, duration: 1000, ease: E.OutSine, zoomEase: E.OutExpo, repeat: 4, repeatBeats: 16 } },
    { name: 'Flare-out', values: { fit: 'custom', from: 0, to: 9, zoomEase: E.InExpo, ease: E.OutExpo, reveal: true, duration: 1600 } },
    { name: 'Quick pulse', values: { to: 1.35, zoomPart: 80, duration: 1000, ease: E.Linear } },
    { name: 'Glow pulse', values: { to: 1.25, duration: 900, additive: true, opacity: 0.6 } },
    { name: 'Breathe in', values: { reveal: true, from: 1.07, to: 1, zoomEase: E.OutQuad, ease: E.InQuad, duration: 900, opacity: 0.8, tint: '#a8c8ff' } },
    { name: 'Shrink away', values: { fit: 'custom', from: 1, to: 0.1, zoomEase: E.Out, ease: E.Linear, duration: 6000 } },
  ],
  async generate(ctx, p) {
    const img = p.image || ctx.map.events.background?.file;
    if (!img) return;
    const src = await ctx.loadMapImage(img);
    if (!src) return;
    const k = p.fit === 'custom' ? 1 : Math.max(SB.width / src.w, SB.height / src.h);
    const times = repeatTimes(ctx, p);
    const s = ctx.sprite(await pictureFor(ctx, img), p.fit === 'custom' ? { x: p.x, y: p.y } : { x: 320, y: 240 });
    times.forEach((t, i) => {
      const t1 = Math.min(t + p.duration, times[i + 1] ?? Infinity);
      const tz = t + Math.max(1, Math.round((p.duration * p.zoomPart) / 100));
      s.scale(t, Math.min(tz, t1), k * p.from, k * p.to, p.zoomEase);
      if (p.reveal) s.fade(t, t1, 0, p.opacity, p.ease); else s.fade(t, t1, p.opacity, 0, p.ease);
      if (p.reveal && i === times.length - 1) s.fade(t1, t1, 0);
    });
    if (p.tint && p.tint.toLowerCase() !== '#ffffff') s.color(times[0], times[0], p.tint);
    if (p.additive) s.additive();
  },
};

export const colorSplit = {
  id: 'colorSplit', name: 'Colour Split', category: 'Transitions', icon: '◭', accent: '#ff4e6a', scope: 'point',
  description: 'The picture comes apart into its red, green and blue for a moment and snaps back: a glitch hit for a drop or an accent.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  length: (p) => p.duration + p.back,
  params: [
    { key: 'image', label: 'Image', type: 'image', default: '', group: 'Image', help: 'Leave on "Map background" to use the beatmap background.' },
    num('blur', 'Blur (px)', 0, 40, 1, 0, 'Image', { help: 'Over a blurred background, give it the same blur so the picture does not jump back to sharp.' }),
    { key: 'tint', label: 'Tint', type: 'color', default: '#ffffff', group: 'Image', help: 'Over a tinted or dimmed background, give it the same colour.' },
    num('distance', 'How far apart (px)', 1, 80, 1, 22),
    num('angle', 'Direction (degrees)', 0, 360, 1, 127),
    num('zoom', 'Zoom (×)', 1, 1.5, 0.01, 1.08, 'Look', { help: 'A little zoom keeps the edges of the picture out of view while it is apart.' }),
    num('duration', 'Coming apart (ms)', 30, 5000, 10, 680, 'Timing'),
    num('back', 'Snapping back (ms)', 0, 2000, 10, 100, 'Timing'),
    easing('ease', 'Easing', E.Out),
    ...repeatParams(),
  ],
  presets: [
    { name: 'RGB split', values: {} },
    { name: 'Quick glitch', values: { distance: 12, duration: 160, back: 60, ease: E.OutExpo } },
    { name: 'Split on every bar', values: { distance: 9, duration: 260, back: 90, ease: E.OutExpo, repeat: 8, repeatBeats: 4 } },
    { name: 'Wide tear', values: { distance: 46, angle: 0, duration: 420, back: 140, ease: E.OutExpo } },
  ],
  async generate(ctx, p) {
    const img = p.image || ctx.map.events.background?.file;
    if (!img) return;
    const src = await ctx.loadMapImage(img);
    if (!src) return;
    let path, w = src.w, h = src.h;
    if (p.blur > 0) { path = await ctx.blurredImage(img, p.blur); const e = ctx.asset(path); w = e.w; h = e.h; }
    else path = await pictureFor(ctx, img);
    const k = Math.max(SB.width / w, SB.height / h) * p.zoom;
    const times = repeatTimes(ctx, p);
    const tint = hexToRgb(p.tint || '#ffffff'), hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    const a = (p.angle * Math.PI) / 180, dx = Math.cos(a) * p.distance, dy = Math.sin(a) * p.distance;
    const cover = ctx.sprite(ctx.tex('pixel'), { x: 320, y: 240 });
    cover.color(times[0], times[0], '#000000');
    cover.vec(times[0], times[0], SB.width + 4, SB.height + 4);
    const parts = [[hex(tint[0], 0, 0), 1], [hex(0, tint[1], 0), 0], [hex(0, 0, tint[2]), -1]].map(([c, dir]) => {
      const s = ctx.sprite(path, { x: 320, y: 240 });
      s.color(times[0], times[0], c); s.scale(times[0], times[0], k); s.additive();
      return [s, dir];
    });
    times.forEach((t, i) => {
      const t1 = Math.min(t + p.duration, times[i + 1] ?? Infinity), t2 = Math.min(t1 + p.back, times[i + 1] ?? Infinity);
      for (const s of [cover, ...parts.map((q) => q[0])]) { s.fade(t, t, 1); s.fade(t2, t2, 0); }
      for (const [s, dir] of parts) {
        if (!dir) continue;
        s.move(t, t1, 320, 240, 320 + dx * dir, 240 + dy * dir, p.ease);
        if (t2 > t1) s.move(t1, t2, 320 + dx * dir, 240 + dy * dir, 320, 240, E.In);
      }
    });
  },
};

export const tileWipe = {
  id: 'tileWipe', name: 'Tile Wipe', category: 'Transitions', icon: '▦', accent: '#4cc9f0', scope: 'range',
  description: 'The screen fills with a grid of tiles that grow (and turn) until everything is covered, or shrink away to uncover it.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  params: [
    { key: 'mode', label: 'Mode', type: 'select', group: 'Look', default: 'through', options: opt([['through', 'Cover, then uncover'], ['cover', 'Cover'], ['reveal', 'Uncover']]) },
    { key: 'shape', label: 'Tiles', type: 'select', group: 'Look', default: 'square', options: opt([['square', 'Squares'], ['dot', 'Dots'], ['diamond', 'Diamonds']]) },
    num('cell', 'Tile size (px)', 24, 240, 2, 72, 'Look', { help: 'Smaller tiles look finer but need many more sprites.' }),
    num('spin', 'Turn while growing (degrees)', -360, 360, 15, 90, 'Look', { showIf: (p) => p.shape !== 'dot' }),
    { key: 'order', label: 'Order', type: 'select', group: 'Timing', default: 'diag',
      options: opt([['together', 'All together'], ['lr', 'Sweep left to right'], ['rl', 'Sweep right to left'], ['tb', 'Top to bottom'], ['diag', 'Diagonal sweep'], ['centre', 'From the centre'], ['edges', 'From the edges'], ['random', 'Random']]) },
    num('stagger', 'Spread in time', 0, 0.9, 0.05, 0.5, 'Timing', { showIf: (p) => p.order !== 'together', help: '0 = every tile at once, more = a longer wave across the screen.' }),
    num('hold', 'Stay covered (ms)', 0, 4000, 10, 0, 'Timing', { showIf: (p) => p.mode === 'through' }),
    easing('ease', 'Easing', E.InOutSine),
    ...colorParams('#000000', 'fixed'),
  ],
  presets: [
    { name: 'Tiles', values: {} },
    { name: 'Halftone dots', values: { shape: 'dot', cell: 44, order: 'lr', stagger: 0.6, ease: E.InSine } },
    { name: 'Checker flip', values: { mode: 'reveal', cell: 96, spin: 180, order: 'random', stagger: 0.7, ease: E.OutCubic } },
    { name: 'Diamond bloom', values: { shape: 'diamond', cell: 60, spin: 0, order: 'centre', stagger: 0.55, color: '#ffffff' } },
    { name: 'Colour mosaic', values: { cell: 84, order: 'random', stagger: 0.75, colorMode: 'random', palette: ['#ff66aa', '#66ccff', '#ffd166', '#b388ff'] } },
  ],
  generate(ctx, p) {
    const S0 = ctx.start, S1 = ctx.end, total = S1 - S0;
    if (total < 60) return;
    const cols = Math.ceil((SB.width + 2) / p.cell), rows = Math.ceil(482 / p.cell);
    const x0 = 320 - (cols * p.cell) / 2, y0 = 240 - (rows * p.cell) / 2;
    const tex = p.shape === 'dot' ? 'dot' : 'pixel';
    const full = (p.shape === 'dot' ? (p.cell * 1.46) / ctx.texSize('dot').w : p.shape === 'diamond' ? p.cell * 1.46 : p.cell + 1);
    const hold = p.mode === 'through' ? Math.min(p.hold, total * 0.6) : 0;
    const span = p.mode === 'through' ? (total - hold) / 2 : total;
    const stag = p.order === 'together' ? 0 : p.stagger;
    const one = Math.max(30, span * (1 - stag));
    const rnd = ctx.rng, base = p.shape === 'diamond' ? Math.PI / 4 : 0, turn = p.shape === 'dot' ? 0 : (p.spin * Math.PI) / 180;
    let i = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++, i++) {
      const u = cols > 1 ? c / (cols - 1) : 0, v = rows > 1 ? r / (rows - 1) : 0;
      const d = Math.hypot(u - 0.5, (v - 0.5) * (rows / cols)) / Math.hypot(0.5, 0.5 * (rows / cols));
      const k = { together: 0, lr: u, rl: 1 - u, tb: v, diag: (u + v * 0.6) / 1.6, centre: d, edges: 1 - d, random: rnd() }[p.order] ?? 0;
      const s = ctx.sprite(ctx.tex(tex), { x: x0 + (c + 0.5) * p.cell, y: y0 + (r + 0.5) * p.cell });
      const a = S0 + k * stag * span, cov = p.mode !== 'reveal', unc = p.mode !== 'cover';
      const b = p.mode === 'through' ? S0 + span + hold + k * stag * span : a;
      s.color(a, a, pickColor(ctx, p, null, i));
      if (cov) {
        s.scale(a, a + one, 0, full, p.ease);
        if (turn || base) s.rotate(a, a + one, base - turn, base, p.ease);
      }
      if (unc) {
        s.scale(b, b + one, full, 0, p.ease);
        if (turn || base) s.rotate(b, b + one, base, base + turn, p.ease);
      }
      if (!unc) s.fade(S1, S1, 1, 0);
    }
  },
};

export const frameBurst = {
  id: 'frameBurst', name: 'Frame Burst', category: 'Transitions', icon: '◈', accent: '#ffffff', scope: 'point',
  description: 'Outlined shapes rush out past the screen edges from one point, or close in onto it: a clean geometric accent for a drop or a scene change.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  length: (p) => p.duration + (p.copies - 1) * p.delay,
  params: [
    num('x', 'X', -107, 747, 1, 320, 'Position'),
    num('y', 'Y', 0, 480, 1, 240, 'Position'),
    { key: 'texture', label: 'Shape', type: 'select', group: 'Look', default: 'hex-o', options: opt([['hex-o', 'Hexagon'], ['square-o', 'Square'], ['tri-o', 'Triangle'], ['circle-o', 'Circle'], ['ring-thin', 'Thin ring']]) },
    lineParam(),
    { key: 'dir', label: 'Direction', type: 'select', group: 'Look', default: 'out', options: opt([['out', 'Burst outward'], ['in', 'Close in']]) },
    num('copies', 'Frames', 1, 6, 1, 3),
    num('delay', 'Delay between frames (ms)', 0, 600, 5, 110, 'Timing', { showIf: (p) => p.copies > 1 }),
    num('reach', 'Largest size (×)', 1, 20, 0.5, 6.5),
    num('small', 'Smallest size (×)', 0, 4, 0.05, 0.1),
    num('turn', 'Turned (degrees)', -180, 180, 1, 0),
    num('twist', 'Twists while moving (degrees)', -360, 360, 5, 30),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.9),
    { key: 'additive', label: 'Additive (light) blending', type: 'bool', default: true, group: 'Look' },
    num('duration', 'Duration (ms)', 100, 5000, 10, 900, 'Timing'),
    easing('ease', 'Easing', E.OutQuart),
    ...colorParams('#ffffff', 'fixed'),
    ...repeatParams(),
  ],
  presets: [
    { name: 'Hex burst', values: {} },
    { name: 'Closing squares', values: { texture: 'square-o', dir: 'in', turn: 45, twist: -45, copies: 2, delay: 160, ease: E.InQuart, duration: 800 } },
    { name: 'Single ring out', values: { texture: 'ring-thin', copies: 1, twist: 0, reach: 8, duration: 700 } },
    { name: 'Triangle tunnel', values: { texture: 'tri-o', copies: 5, delay: 140, twist: 60, duration: 1200, colorMode: 'random', palette: ['#66ccff', '#b388ff', '#ffffff'] } },
  ],
  generate(ctx, p) {
    const rad = (d) => (d * Math.PI) / 180;
    repeatTimes(ctx, p).forEach((t) => {
      for (let k = 0; k < p.copies; k++) {
        const a = t + k * p.delay, b = a + p.duration, out = p.dir !== 'in';
        const s = ctx.sprite(ctx.tex(lined(p.texture, p.lineX)), { x: p.x, y: p.y });
        const r0 = rad(p.turn + k * (p.twist / Math.max(1, p.copies)));
        s.scale(a, b, out ? p.small : p.reach, out ? p.reach : p.small, p.ease);
        s.rotate(a, b, r0, r0 + rad(p.twist), p.ease);
        if (out) s.fade(a, b, p.opacity, 0, E.InQuad); else { s.fade(a, a + p.duration * 0.3, 0, p.opacity); s.fade(b, b, p.opacity, 0); }
        s.color(a, a, pickColor(ctx, p, null, k));
        if (p.additive) s.additive();
      }
    });
  },
};

export default [flash, impact, frameBurst, zoomEcho, colorSplit, fadeColor, barWipe, tileWipe, irisWipe];
