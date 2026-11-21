import { E, EASING_OPTIONS } from '../easing.js';
import { colorParams, pickColor, opt, SB, targetParams, hitPoints, repeatParams, repeatTimes, fadeParams, fitDurations } from './common.js';
import { hexToRgb } from '../util.js';

const num = (key, label, min, max, step, def, group = 'Look', extra = {}) => ({ key, label, type: 'number', min, max, step, default: def, group, ...extra });
const easing = (key, label, def, group = 'Timing', extra = {}) => ({ key, label, type: 'easing', default: def, group, options: EASING_OPTIONS, ...extra });
const bool = (key, label, def, group = 'Look', extra = {}) => ({ key, label, type: 'bool', default: def, group, ...extra });
const select = (key, label, options, def, group = 'Look', extra = {}) => ({ key, label, type: 'select', options: opt(options), default: def, group, ...extra });
const additive = (def = true) => bool('additive', 'Additive (glowy) blending', def);
const rad = (d) => (d * Math.PI) / 180;

const FILLED = [['square', 'Square'], ['disc', 'Disc'], ['diamond', 'Diamond'], ['hex', 'Hexagon'], ['tri', 'Triangle'], ['star', 'Star'], ['heart', 'Heart'], ['soft-dot', 'Soft dot'], ['glow', 'Glow']];
const OUTLINES = [['ring-thin', 'Thin ring'], ['ring', 'Ring'], ['ring-gap2', 'Ring with 2 gaps'], ['ring-gap3', 'Ring with 3 gaps'], ['ring-gap6', 'Dashed ring'], ['circle-o', 'Circle outline'], ['square-o', 'Square outline'], ['hex-o', 'Hexagon outline'], ['tri-o', 'Triangle outline']];
const fit = (ctx, name, px) => px / ctx.texSize(name).w;
function beatTimes(ctx, every, from = ctx.start, to = ctx.end) {
  const gap = Math.max(20, every * ctx.map.beatLengthAt(from)), out = [];
  for (let t = from; t <= to + 1 && out.length < 4000; t += gap) out.push(Math.round(t));
  return out;
}
const SOUND = { finish: 4, clap: 8, whistle: 2, anysound: 14 };
function triggerTimes(ctx, on, every) {
  if (on === 'beat') return beatTimes(ctx, every);
  const out = [];
  for (const o of ctx.objects) {
    if (o.kind === 'spinner') continue;
    const hs = o.kind === 'slider' && o.edgeSounds?.length ? o.edgeSounds[0] | o.hitSound : o.hitSound;
    if (on === 'notes' || (hs & SOUND[on]) !== 0) out.push(o.time);
  }
  return out;
}
const TRIGGERS = [['beat', 'The beat'], ['notes', 'Every note'], ['finish', 'Finish hitsounds'], ['clap', 'Clap hitsounds'], ['whistle', 'Whistle hitsounds'], ['anysound', 'Any added hitsound']];

export const shapeRow = {
  id: 'shapeRow', name: 'Shape Row', category: 'Background & ambience', icon: '┅', accent: '#7ee0ff', scope: 'range',
  description: 'A row of the same shape across the screen. It can carry a wave, swell on the beat or on notes, or sway like grass.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    select('texture', 'Shape', [['bar', 'Bar'], ...FILLED], 'bar'),
    num('count', 'Pieces', 2, 80, 1, 24),
    num('x', 'Middle X', -107, 747, 1, 320, 'Position'),
    num('y', 'Middle Y', 0, 480, 1, 400, 'Position'),
    num('length', 'Length of the row (px)', 20, 1200, 5, 760, 'Position'),
    num('angle', 'Row turned (degrees)', -180, 180, 1, 0, 'Position'),
    num('size', 'Width of a piece (px)', 1, 200, 1, 14),
    num('tall', 'Height (× width)', 0.05, 20, 0.05, 3),
    select('behave', 'What it does', [['wave', 'A wave travels along it'], ['pulse', 'Swells on the beat or on notes'], ['jump', 'Each piece jumps to a new height'], ['sway', 'Sways (pieces stand on the row)'], ['still', 'Stands still']], 'wave', 'Motion'),
    num('amp', 'Wave height (px)', 0, 200, 1, 18, 'Motion', { showIf: (p) => p.behave === 'wave' }),
    num('period', 'One cycle (beats)', 0.25, 32, 0.25, 2, 'Motion', { showIf: (p) => p.behave === 'wave' || p.behave === 'sway' }),
    num('shift', 'Delay per piece (% of a cycle)', -50, 50, 0.5, 6, 'Motion', { showIf: (p) => p.behave === 'wave', help: 'How far each piece is behind its neighbour. 0 = all move together; a small value makes one long wave.' }),
    bool('flip', 'Pieces flip while they move', false, 'Motion', { showIf: (p) => p.behave === 'wave' }),
    select('on', 'Reacts to', TRIGGERS, 'beat', 'Motion', { showIf: (p) => p.behave === 'pulse' || p.behave === 'jump' }),
    num('every', 'Every (beats)', 0.25, 16, 0.25, 1, 'Motion', { showIf: (p) => (p.behave === 'pulse' || p.behave === 'jump') && p.on === 'beat' }),
    num('grow', 'Swells to (×)', 1, 8, 0.05, 2.2, 'Motion', { showIf: (p) => p.behave === 'pulse' || p.behave === 'jump' }),
    bool('growTall', 'Only gets taller', true, 'Motion', { showIf: (p) => p.behave === 'pulse' }),
    num('settle', 'Settles in (ms)', 40, 3000, 10, 320, 'Motion', { showIf: (p) => p.behave === 'pulse' || p.behave === 'jump' }),
    num('delay', 'Delay per piece (ms)', 0, 200, 1, 0, 'Motion', { showIf: (p) => p.behave === 'pulse', help: '0 = the whole row at once. More = the swell runs along the row.' }),
    select('from', 'Runs from', [['left', 'One end'], ['right', 'The other end'], ['centre', 'The middle outwards']], 'centre', 'Motion', { showIf: (p) => p.behave === 'pulse' && p.delay > 0 }),
    num('rock', 'Sways by (degrees)', 0, 90, 1, 10, 'Motion', { showIf: (p) => p.behave === 'sway' }),
    num('spread', 'Out of step (%)', 0, 100, 5, 40, 'Motion', { showIf: (p) => p.behave === 'sway' }),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.8),
    additive(false),
    ...colorParams('#ffffff', 'fixed'),
    ...fadeParams(400, 400),
  ],
  presets: [
    { name: 'Wave ribbon', values: {} },
    { name: 'Beat bars', values: { behave: 'pulse', count: 32, size: 10, tall: 2, grow: 4, y: 470, delay: 6 } },
    { name: 'Bead line', values: { texture: 'disc', behave: 'pulse', on: 'notes', count: 18, size: 16, tall: 1, growTall: false, grow: 1.8, y: 240, length: 620 } },
    { name: 'Rhythm bars', values: { behave: 'jump', count: 36, size: 12, tall: 1, grow: 8, y: 470, every: 0.5, settle: 160 } },
    { name: 'Grass', values: { behave: 'sway', count: 40, size: 5, tall: 14, y: 480, rock: 8, period: 4, color: '#9fe6a0', opacity: 0.6 } },
    { name: 'Running lights', values: { texture: 'soft-dot', behave: 'pulse', count: 30, size: 14, tall: 1, growTall: false, grow: 2.6, delay: 30, from: 'left', y: 60, additive: true } },
  ],
  generate(ctx, p) {
    const r = ctx.rng, a = rad(p.angle), n = Math.round(p.count);
    const name = p.texture === 'bar' ? 'pixel' : p.texture;
    const sx = p.texture === 'bar' ? p.size : fit(ctx, name, p.size), sy = sx * p.tall;
    const [fi, fo] = fitDurations(ctx.end - ctx.start, p.fadeIn, p.fadeOut);
    const bl = ctx.map.beatLengthAt(ctx.start);
    const times = p.behave === 'pulse' || p.behave === 'jump' ? triggerTimes(ctx, p.on, p.every) : [];
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) - 0.5 : 0;
      const x = p.x + Math.cos(a) * p.length * u, y = p.y + Math.sin(a) * p.length * u;
      const s = ctx.sprite(ctx.tex(name), { x, y, origin: p.behave === 'sway' || p.behave === 'jump' ? 'BottomCentre' : 'Centre' });
      s.fade(ctx.start, ctx.start + fi, 0, p.opacity); s.fade(ctx.end - fo, ctx.end, p.opacity, 0);
      s.color(ctx.start, ctx.start, pickColor(ctx, p, null, i));
      if (p.additive) s.additive();
      if (p.behave !== 'sway' && a) s.rotate(ctx.start, ctx.start, a);
      if (p.behave === 'wave') {
        const P = Math.max(60, p.period * bl), ph = ((((i * p.shift) / 100) % 1) + 1) % 1 * P;
        const t0 = ctx.start - ph, k = Math.ceil((ctx.end - t0) / P);
        const nx = -Math.sin(a) * p.amp, ny = Math.cos(a) * p.amp;
        s.loop(t0, k, (l) => {
          if (p.amp) { l.move(0, P / 2, x - nx, y - ny, x + nx, y + ny, E.InOutSine); l.move(P / 2, P, x + nx, y + ny, x - nx, y - ny, E.InOutSine); }
          if (p.flip) { l.vec(0, P / 2, sx, sy, sx * 0.04, sy, E.InOutSine); l.vec(P / 2, P, sx * 0.04, sy, sx, sy, E.InOutSine); }
          else if (!p.amp) l.vec(0, P, sx, sy);
        });
        if (!p.flip) s.vec(ctx.start, ctx.start, sx, sy);
      } else if (p.behave === 'pulse') {
        s.vec(ctx.start, ctx.start, sx, sy);
        const order = p.from === 'left' ? i : p.from === 'right' ? n - 1 - i : Math.abs(i - (n - 1) / 2);
        const gx = p.growTall ? sx : sx * p.grow, gy = sy * p.grow;
        times.forEach((t, k) => {
          const t0 = t + order * p.delay, next = k + 1 < times.length ? times[k + 1] + order * p.delay : Infinity;
          if (t0 >= ctx.end) return;
          s.vec(t0, Math.min(t0 + p.settle, next, ctx.end), gx, gy, sx, sy, E.OutQuad);
        });
      } else if (p.behave === 'jump') {
        let cur = sy;
        s.vec(ctx.start, ctx.start, sx, sy);
        times.forEach((t, k) => {
          if (t >= ctx.end) return;
          const next = sy * r.range(1, p.grow);
          s.vec(t, Math.min(t + p.settle, times[k + 1] ?? Infinity, ctx.end), sx, cur, sx, next, E.OutQuad); cur = next;
        });
      } else if (p.behave === 'sway') {
        s.vec(ctx.start, ctx.start, sx, sy);
        const P = Math.max(80, p.period * bl * (1 + r.range(-p.spread, p.spread) / 200)), t0 = ctx.start - r() * P * (p.spread / 100);
        const w = rad(p.rock);
        s.loop(t0, Math.ceil((ctx.end - t0) / P), (l) => { l.rotate(0, P / 2, a - w, a + w, E.InOutSine); l.rotate(P / 2, P, a + w, a - w, E.InOutSine); });
      } else s.vec(ctx.start, ctx.start, sx, sy);
    }
  },
};

export const herald = {
  id: 'herald', name: 'Note Herald', category: 'Hit effects', icon: '◔', accent: '#ffd98a', scope: 'objects',
  description: 'Announces a note before it is hit: a shape appears, closes in or flies in ahead of time, arrives exactly on the hit and reacts there.',
  defaultLayer: 'Foreground', defaultOutput: 'diff',
  params: [
    ...targetParams(),
    select('texture', 'Shape', [...OUTLINES, ...FILLED], 'ring-thin'),
    select('mode', 'How it comes', [['close', 'Closes in on the note'], ['appear', 'Appears on the spot'], ['fly', 'Flies in']], 'close'),
    num('lead', 'Starts this long before the hit (ms)', 80, 4000, 10, 600, 'Timing'),
    num('size', 'Size on the hit (px)', 4, 400, 1, 70),
    num('startSize', 'Starts at (× that size)', 0.1, 8, 0.05, 2.4, 'Look', { showIf: (p) => p.mode === 'close' }),
    select('origin', 'Flies in from', [['random', 'Any direction'], ['above', 'Above'], ['below', 'Below'], ['left', 'The left'], ['right', 'The right'], ['prev', 'The note before'], ['point', 'A point']], 'random', 'Look', { showIf: (p) => p.mode === 'fly' }),
    num('dist', 'From how far (px)', 20, 900, 5, 260, 'Look', { showIf: (p) => p.mode === 'fly' && !['prev', 'point'].includes(p.origin) }),
    num('fromX', 'Point X', -107, 747, 1, 320, 'Look', { showIf: (p) => p.mode === 'fly' && p.origin === 'point' }),
    num('fromY', 'Point Y', 0, 480, 1, 0, 'Look', { showIf: (p) => p.mode === 'fly' && p.origin === 'point' }),
    num('spin', 'Turns on the way (degrees)', -720, 720, 5, 0),
    easing('ease', 'Approach easing', E.OutCubic),
    select('react', 'On the hit', [['pop', 'Pops and fades'], ['shrink', 'Shrinks away'], ['fade', 'Fades'], ['none', 'Vanishes']], 'pop'),
    num('reactTime', 'Reaction (ms)', 20, 2000, 10, 220, 'Timing', { showIf: (p) => p.react !== 'none' }),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.9),
    additive(true),
    ...colorParams('#ffffff', 'combo'),
  ],
  presets: [
    { name: 'Closing ring', values: {} },
    { name: 'Marker', values: { mode: 'appear', texture: 'square-o', size: 60, lead: 800, spin: 90, react: 'shrink' } },
    { name: 'Incoming light', values: { mode: 'fly', texture: 'glow', size: 60, lead: 900, ease: E.InOutSine, react: 'pop' } },
    { name: 'Falling star', values: { mode: 'fly', origin: 'above', texture: 'star', size: 34, dist: 420, lead: 700, spin: 360, ease: E.InQuad, react: 'pop', additive: false } },
    { name: 'Chain', values: { mode: 'fly', origin: 'prev', texture: 'soft-dot', size: 26, lead: 300, ease: E.InOutQuad, react: 'fade' } },
  ],
  generate(ctx, p) {
    const r = ctx.rng, tex = ctx.tex(p.texture), sc = fit(ctx, p.texture, p.size);
    const hits = hitPoints(ctx, p);
    hits.forEach((h, i) => {
      const t0 = h.time - p.lead, s = ctx.sprite(tex, { x: h.x, y: h.y });
      s.fade(t0, t0 + Math.min(200, p.lead * 0.4), 0, p.opacity);
      if (p.mode === 'close') s.scale(t0, h.time, sc * p.startSize, sc, p.ease); else s.scale(t0, t0, sc);
      if (p.mode === 'fly') {
        let fx, fy;
        const prev = hits[i - 1];
        if (p.origin === 'point') { fx = p.fromX; fy = p.fromY; }
        else if (p.origin === 'prev' && prev) { fx = prev.x; fy = prev.y; }
        else {
          const ang = { above: -90, below: 90, left: 180, right: 0 }[p.origin] ?? r.range(0, 360);
          fx = h.x + Math.cos(rad(ang)) * p.dist; fy = h.y + Math.sin(rad(ang)) * p.dist;
        }
        s.move(t0, h.time, fx, fy, h.x, h.y, p.ease);
      }
      if (p.spin) s.rotate(t0, h.time, -rad(p.spin), 0, p.ease);
      const a = h.time, b = a + p.reactTime;
      if (p.react === 'pop') { s.scale(a, b, sc, sc * 1.7, E.OutQuad); s.fade(a, b, p.opacity, 0); }
      else if (p.react === 'shrink') { s.scale(a, b, sc, 0, E.InQuad); s.fade(b, b, p.opacity, 0); }
      else if (p.react === 'fade') s.fade(a, b, p.opacity, 0);
      else s.fade(a, a, p.opacity, 0);
      s.color(t0, t0, pickColor(ctx, p, h, i));
      if (p.additive) s.additive();
    });
  },
};

const PANEL_ANIM = [['fade', 'Fades'], ['line', 'Opens from a thin line'], ['wipe', 'Grows along its length'], ['pop', 'Pops'], ['none', 'Just there']];
export const panel = {
  id: 'panel', name: 'Shape / Panel', category: 'Background & ambience', icon: '▰', accent: '#c9a2ff', scope: 'range',
  description: 'One flat shape where you put it: a band behind a title, a disc, a slanted plate. It can open from a line, turn slowly, change colour over time and take a new slant on every beat.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    select('shape', 'Shape', [['rect', 'Band / rectangle'], ['disc', 'Disc'], ['diamond', 'Diamond'], ['hex', 'Hexagon'], ['tri', 'Triangle'], ['ring', 'Ring'], ['square-o', 'Square outline']], 'rect'),
    num('x', 'X', -107, 747, 1, 320, 'Position'),
    num('y', 'Y', 0, 480, 1, 240, 'Position'),
    num('width', 'Width (px)', 1, 1800, 1, 520, 'Position'),
    num('height', 'Height (px)', 1, 1800, 1, 70, 'Position'),
    num('angle', 'Turned (degrees)', -180, 180, 1, 0, 'Position'),
    num('turn', 'Turns while shown (degrees)', -1440, 1440, 5, 0, 'Motion', { showIf: (p) => !p.jump }),
    num('jump', 'New slant on the beat (± degrees, 0 = off)', 0, 90, 1, 0, 'Motion'),
    num('jumpBeats', 'Every (beats)', 0.25, 16, 0.25, 1, 'Motion', { showIf: (p) => p.jump > 0 }),
    num('jumpTime', 'Takes (ms, 0 = snaps)', 0, 1000, 10, 0, 'Motion', { showIf: (p) => p.jump > 0 }),
    select('inAnim', 'Comes in', PANEL_ANIM, 'line', 'Timing'),
    num('inTime', 'Coming in takes (ms)', 0, 5000, 10, 400, 'Timing', { showIf: (p) => p.inAnim !== 'none' }),
    select('outAnim', 'Goes out', PANEL_ANIM, 'line', 'Timing'),
    num('outTime', 'Going out takes (ms)', 0, 5000, 10, 300, 'Timing', { showIf: (p) => p.outAnim !== 'none' }),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.85),
    additive(false),
    { key: 'color', label: 'Colour', type: 'color', default: '#101018', group: 'Colour' },
    bool('cycle', 'Changes colour while shown', false, 'Colour'),
    { key: 'palette', label: 'Colours', type: 'palette', default: ['#ff66aa', '#66ccff', '#ffd166'], group: 'Colour', showIf: (p) => p.cycle },
    num('cycleBeats', 'Next colour every (beats)', 0.25, 64, 0.25, 4, 'Colour', { showIf: (p) => p.cycle }),
    bool('blend', 'Blends from one to the next', true, 'Colour', { showIf: (p) => p.cycle }),
  ],
  presets: [
    { name: 'Title band', values: {} },
    { name: 'Disc', values: { shape: 'disc', width: 220, height: 220, inAnim: 'pop', outAnim: 'pop', color: '#ffffff', opacity: 0.9 } },
    { name: 'Slanted plate', values: { width: 1100, height: 300, angle: -12, y: 420, inAnim: 'wipe', outAnim: 'fade', color: '#1b1030', opacity: 0.7 } },
    { name: 'Beat slant', values: { width: 1400, height: 520, y: 480, jump: 14, inAnim: 'fade', outAnim: 'fade', cycle: true, cycleBeats: 4, opacity: 0.55 } },
    { name: 'Turning frame', values: { shape: 'square-o', width: 300, height: 300, turn: 180, inAnim: 'pop', outAnim: 'fade', color: '#ffffff', additive: true, opacity: 0.6 } },
  ],
  generate(ctx, p) {
    const r = ctx.rng, a = ctx.start, b = ctx.end;
    const name = p.shape === 'rect' ? 'pixel' : p.shape, tw = p.shape === 'rect' ? 1 : ctx.texSize(name).w;
    const W = p.width / tw, H = p.height / tw, hair = Math.min(H, 1.5 / tw);
    const [ti, to] = fitDurations(b - a, p.inAnim === 'none' ? 0 : p.inTime, p.outAnim === 'none' ? 0 : p.outTime);
    const s = ctx.sprite(ctx.tex(name), { x: p.x, y: p.y });
    if (p.inAnim === 'line' && ti > 0) { s.vec(a, a + ti * 0.6, 0, hair, W, hair, E.OutCubic); s.vec(a + ti * 0.6, a + ti, W, hair, W, H, E.OutCubic); }
    else if (p.inAnim === 'wipe' && ti > 0) s.vec(a, a + ti, 0, H, W, H, E.OutCubic);
    else if (p.inAnim === 'pop' && ti > 0) s.vec(a, a + ti, 0, 0, W, H, E.OutBack);
    else s.vec(a, a, W, H);
    if (p.outAnim === 'line' && to > 0) { s.vec(b - to, b - to * 0.6, W, H, W, hair, E.InCubic); s.vec(b - to * 0.6, b, W, hair, 0, hair, E.InCubic); }
    else if (p.outAnim === 'wipe' && to > 0) s.vec(b - to, b, W, H, 0, H, E.InCubic);
    else if (p.outAnim === 'pop' && to > 0) s.vec(b - to, b, W, H, 0, 0, E.InBack);
    s.fade(a, a + (p.inAnim === 'fade' ? ti : 0), p.inAnim === 'fade' ? 0 : p.opacity, p.opacity);
    s.fade(b - (p.outAnim === 'fade' ? to : 0), b, p.opacity, p.outAnim === 'fade' ? 0 : p.opacity);
    const base = rad(p.angle);
    if (p.jump > 0) {
      let cur = base;
      s.rotate(a, a, cur);
      for (const t of beatTimes(ctx, p.jumpBeats).slice(1)) {
        const nxt = base + rad(r.range(-p.jump, p.jump));
        s.rotate(t, Math.min(b, t + p.jumpTime), cur, nxt, E.OutCubic); cur = nxt;
      }
    } else if (p.turn || base) s.rotate(a, b, base, base + rad(p.turn));
    if (p.cycle && p.palette?.length > 1) {
      const ts = beatTimes(ctx, p.cycleBeats), col = (k) => hexToRgb(p.palette[k % p.palette.length]).map(Math.round);
      ts.forEach((t, k) => {
        const next = ts[k + 1] ?? b;
        if (p.blend) s._add('C', t, next, col(k), col(k + 1)); else s._add('C', t, t, col(k), col(k));
      });
    } else s.color(a, a, p.color);
    if (p.additive) s.additive();
  },
};

export const stripeSteps = {
  id: 'stripeSteps', name: 'Stripe Steps', category: 'Background & ambience', icon: '☷', accent: '#ffe08a', scope: 'range',
  description: 'Thin stripes across the screen light up one after the other, a step on every beat, like a staircase of light.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    select('orient', 'Stripes run', [['h', 'Sideways'], ['v', 'Up and down']], 'h'),
    num('count', 'Stripes', 2, 40, 1, 8),
    num('thick', 'Thickness (px)', 1, 200, 1, 12),
    num('span', 'Spread over (% of the screen)', 10, 100, 1, 85),
    select('order', 'Order', [['fwd', 'Top to bottom / left to right'], ['back', 'The other way'], ['ping', 'There and back'], ['random', 'Random']], 'fwd', 'Motion'),
    select('on', 'Steps on', TRIGGERS, 'beat', 'Motion'),
    num('every', 'Every (beats)', 0.25, 16, 0.25, 0.5, 'Motion', { showIf: (p) => p.on === 'beat' }),
    num('decay', 'Fades in (ms)', 40, 5000, 10, 500, 'Timing'),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.8),
    additive(true),
    ...colorParams('#ffffff', 'fixed'),
  ],
  presets: [
    { name: 'Light stairs', values: {} },
    { name: 'Colour ladder', values: { count: 6, thick: 60, span: 100, every: 1, decay: 900, opacity: 0.45, colorMode: 'cycle', palette: ['#ff5d8f', '#ffb347', '#ffe066', '#7ee081', '#66ccff', '#b388ff'] } },
    { name: 'Scan columns', values: { orient: 'v', count: 16, thick: 6, order: 'ping', every: 0.25, decay: 300 } },
    { name: 'Random flicker', values: { count: 14, thick: 4, order: 'random', every: 0.25, decay: 220, opacity: 0.6 } },
  ],
  generate(ctx, p) {
    const n = Math.round(p.count), r = ctx.rng, horiz = p.orient !== 'v';
    const times = triggerTimes(ctx, p.on, p.every), per = Array.from({ length: n }, () => []);
    times.forEach((t, k) => {
      const cyc = 2 * n - 2 || 1, m = k % cyc;
      const i = p.order === 'fwd' ? k % n : p.order === 'back' ? n - 1 - (k % n) : p.order === 'ping' ? (m < n ? m : cyc - m) : Math.floor(r() * n);
      per[i].push(t);
    });
    per.forEach((ts, i) => {
      if (!ts.length) return;
      const u = (n > 1 ? i / (n - 1) - 0.5 : 0) * (p.span / 100);
      const s = ctx.sprite(ctx.tex('pixel'), horiz ? { x: 320, y: 240 + u * 480 } : { x: 320 + u * 854, y: 240 });
      s.vec(ts[0], ts[0], horiz ? 860 : p.thick, horiz ? p.thick : 484);
      ts.forEach((t, k) => s.fade(t, Math.min(t + p.decay, ts[k + 1] ?? Infinity), p.opacity, 0, E.OutQuad));
      s.color(ts[0], ts[0], pickColor(ctx, p, null, i));
      if (p.additive) s.additive();
    });
  },
};

function figurePoint(kind, n, u) {
  const TAU = Math.PI * 2;
  if (kind === 'spiral') { const th = TAU * n * u - Math.PI / 2; return [Math.cos(th) * u, Math.sin(th) * u]; }
  if (kind === 'flower') { const th = TAU * u - Math.PI / 2, k = 0.55 + 0.45 * Math.cos(n * th + (n * Math.PI) / 2); return [Math.cos(th) * k, Math.sin(th) * k]; }
  if (kind === 'circle') { const th = TAU * u - Math.PI / 2; return [Math.cos(th), Math.sin(th)]; }
  const corners = kind === 'star' ? n * 2 : n, f = u * corners, i = Math.floor(f) % corners, t = f - Math.floor(f);
  const at = (k) => { const th = (TAU * k) / corners - Math.PI / 2, rr = kind === 'star' && k % 2 ? 0.45 : 1; return [Math.cos(th) * rr, Math.sin(th) * rr]; };
  const A = at(i), B = at(i + 1);
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
}
export const dotFigure = {
  id: 'dotFigure', name: 'Dotted Figure', category: 'Background & ambience', icon: '⁘', accent: '#ffffff', scope: 'range',
  description: 'A figure made of dots that is drawn point by point: a circle, a polygon, a star, a spiral or a flower. It stays, then fades, falls or scatters.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    select('figure', 'Figure', [['circle', 'Circle'], ['polygon', 'Polygon'], ['star', 'Star'], ['spiral', 'Spiral'], ['flower', 'Flower']], 'circle'),
    num('n', 'Corners / points / turns / petals', 2, 16, 1, 5, 'Look', { showIf: (p) => p.figure !== 'circle' }),
    num('x', 'Centre X', -107, 747, 1, 320, 'Position'),
    num('y', 'Centre Y', 0, 480, 1, 240, 'Position'),
    num('radius', 'Radius (px)', 10, 600, 1, 150, 'Position'),
    num('turned', 'Turned (degrees)', -180, 180, 1, 0, 'Position'),
    num('dots', 'Dots', 6, 600, 1, 90),
    select('texture', 'Dot', [['soft-dot', 'Soft dot'], ['dot', 'Hard dot'], ['glow', 'Glow'], ['star4', 'Sparkle'], ['square', 'Square'], ['diamond', 'Diamond']], 'soft-dot'),
    num('dotSize', 'Dot size (px)', 1, 80, 0.5, 7),
    num('draw', 'Drawn over (beats)', 0, 64, 0.25, 4, 'Timing'),
    num('pens', 'Drawn from this many places at once', 1, 12, 1, 1, 'Timing'),
    select('exit', 'How it leaves', [['fade', 'Fades'], ['undraw', 'Is undrawn again'], ['fall', 'Dots fall'], ['scatter', 'Dots scatter']], 'fade', 'Timing'),
    num('exitTime', 'Leaving takes (ms)', 0, 8000, 50, 900, 'Timing'),
    num('spin', 'Whole figure turns (degrees)', -1440, 1440, 5, 0, 'Motion', { help: 'The dots travel round the centre while it is shown. Costs a few commands per dot.' }),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.9),
    additive(true),
    ...colorParams('#ffffff', 'fixed'),
  ],
  presets: [
    { name: 'Drawn circle', values: {} },
    { name: 'Star', values: { figure: 'star', n: 5, dots: 120, pens: 5, exit: 'scatter' } },
    { name: 'Spiral', values: { figure: 'spiral', n: 3, dots: 140, radius: 200, exit: 'undraw', colorMode: 'rainbow' } },
    { name: 'Falling ring', values: { dots: 70, dotSize: 9, draw: 2, exit: 'fall', exitTime: 1600 } },
    { name: 'Hexagon', values: { figure: 'polygon', n: 6, dots: 96, pens: 6, texture: 'square', dotSize: 5, additive: false } },
  ],
  generate(ctx, p) {
    const r = ctx.rng, n = Math.round(p.dots), a = ctx.start, b = ctx.end;
    const sc = fit(ctx, p.texture, p.dotSize), tex = ctx.tex(p.texture);
    const out = Math.min(p.exitTime, (b - a) * 0.6), e0 = b - out;
    const drawFor = Math.min(p.draw * ctx.map.beatLengthAt(a), Math.max(0, e0 - a));
    const per = Math.ceil(n / Math.max(1, Math.round(p.pens))), rot = rad(p.turned);
    const spinSteps = p.spin ? Math.max(2, Math.min(24, Math.ceil(Math.abs(p.spin) / 20))) : 0;
    for (let i = 0; i < n; i++) {
      const [ux, uy] = figurePoint(p.figure, Math.round(p.n), i / n);
      const place = (extra) => { const c = Math.cos(rot + extra), s2 = Math.sin(rot + extra); return [p.x + (ux * c - uy * s2) * p.radius, p.y + (ux * s2 + uy * c) * p.radius]; };
      const [x, y] = place(0);
      const s = ctx.sprite(tex, { x, y });
      const order = (i % per) / per, tIn = a + drawFor * order;
      s.scale(tIn, tIn, sc);
      s.fade(tIn, Math.min(e0, tIn + 140), 0, p.opacity);
      let [ex, ey] = [x, y];
      if (spinSteps && e0 > a) {
        let px = x, py = y;
        for (let k = 1; k <= spinSteps; k++) {
          const [qx, qy] = place((rad(p.spin) * k) / spinSteps);
          s.move(a + ((e0 - a) * (k - 1)) / spinSteps, a + ((e0 - a) * k) / spinSteps, px, py, qx, qy);
          px = qx; py = qy;
        }
        ex = px; ey = py;
      }
      if (out <= 0) { s.fade(b, b, p.opacity, 0); }
      else if (p.exit === 'undraw') { const t = e0 + out * 0.85 * (1 - order); s.fade(t, t + out * 0.15, p.opacity, 0); }
      else if (p.exit === 'fall' || p.exit === 'scatter') {
        const t = e0 + r() * out * 0.5, d = out * 0.5;
        if (p.exit === 'fall') s.move(t, t + d, ex, ey, ex + r.range(-12, 12), ey + r.range(50, 160), E.InQuad);
        else { const th = Math.atan2(ey - p.y, ex - p.x) + r.range(-0.5, 0.5), far = r.range(40, 160); s.move(t, t + d, ex, ey, ex + Math.cos(th) * far, ey + Math.sin(th) * far, E.OutCubic); }
        s.fade(t, t + d, p.opacity, 0);
      } else s.fade(e0, b, p.opacity, 0);
      s.color(tIn, tIn, pickColor(ctx, p, null, i));
      if (p.additive) s.additive();
    }
  },
};

export const ringSet = {
  id: 'ringSet', name: 'Turning Rings', category: 'Background & ambience', icon: '◎', accent: '#9fb8ff', scope: 'range',
  description: 'Rings inside each other that turn against each other, in a steady glide or in steps on the beat. They can also tumble as if seen in depth.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    select('texture', 'Ring', OUTLINES, 'ring-gap3'),
    num('rings', 'Rings', 1, 8, 1, 3),
    num('x', 'Centre X', -107, 747, 1, 320, 'Position'),
    num('y', 'Centre Y', 0, 480, 1, 240, 'Position'),
    num('inner', 'Smallest (px across)', 10, 1200, 5, 140, 'Position'),
    num('outer', 'Largest (px across)', 10, 1600, 5, 380, 'Position', { showIf: (p) => p.rings > 1 }),
    bool('against', 'Every other ring turns the other way', true, 'Motion'),
    bool('steps', 'Turns in steps', false, 'Motion'),
    num('speed', 'Speed (degrees per second)', -360, 360, 1, 18, 'Motion', { showIf: (p) => !p.steps }),
    num('stepDeg', 'A step is (degrees)', -180, 180, 1, 30, 'Motion', { showIf: (p) => p.steps }),
    num('stepBeats', 'A step every (beats)', 0.25, 16, 0.25, 1, 'Motion', { showIf: (p) => p.steps }),
    num('stepTime', 'A step takes (ms)', 0, 1000, 10, 180, 'Motion', { showIf: (p) => p.steps }),
    num('tumble', 'Tumbles in depth: one turn-over every (beats, 0 = off)', 0, 64, 0.25, 0, 'Motion'),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.7),
    additive(true),
    ...colorParams('#ffffff', 'fixed'),
    ...fadeParams(500, 500),
  ],
  presets: [
    { name: 'Broken rings', values: {} },
    { name: 'Dial', values: { texture: 'ring-gap6', rings: 4, steps: true, stepDeg: 30, inner: 120, outer: 420, opacity: 0.55 } },
    { name: 'Gyroscope', values: { texture: 'ring-thin', rings: 2, inner: 200, outer: 260, tumble: 4, speed: 30 } },
    { name: 'Hex nest', values: { texture: 'hex-o', rings: 5, inner: 80, outer: 520, speed: 8, opacity: 0.4 } },
  ],
  generate(ctx, p) {
    const n = Math.round(p.rings), a = ctx.start, b = ctx.end, bl = ctx.map.beatLengthAt(a);
    const [fi, fo] = fitDurations(b - a, p.fadeIn, p.fadeOut);
    const stepsAt = p.steps ? beatTimes(ctx, p.stepBeats).slice(1) : [];
    for (let k = 0; k < n; k++) {
      const d = n > 1 ? p.inner + ((p.outer - p.inner) * k) / (n - 1) : p.inner, sc = fit(ctx, p.texture, d);
      const dir = p.against && k % 2 ? -1 : 1;
      const s = ctx.sprite(ctx.tex(p.texture), { x: p.x, y: p.y });
      s.fade(a, a + fi, 0, p.opacity); s.fade(b - fo, b, p.opacity, 0);
      if (p.tumble > 0) {
        const P = Math.max(120, p.tumble * bl), t0 = a - (P * k) / n;
        s.loop(t0, Math.ceil((b - t0) / P), (l) => { l.vec(0, P / 2, sc, sc, sc * 0.03, sc, E.InOutSine); l.vec(P / 2, P, sc * 0.03, sc, sc, sc, E.InOutSine); });
      } else s.scale(a, a, sc);
      if (p.steps) {
        let cur = 0;
        s.rotate(a, a, 0);
        for (const t of stepsAt) { const nxt = cur + dir * rad(p.stepDeg); s.rotate(t, Math.min(b, t + p.stepTime), cur, nxt, E.OutCubic); cur = nxt; }
      } else s.rotate(a, b, 0, dir * rad((p.speed * (b - a)) / 1000));
      s.color(a, a, pickColor(ctx, p, null, k));
      if (p.additive) s.additive();
    }
  },
};

export const slitFlash = {
  id: 'slitFlash', name: 'Slit Flash', category: 'Transitions', icon: '―', accent: '#ffffff', scope: 'point',
  description: 'A hairline of light is drawn across the screen, then snaps open into a full flash and fades.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  length: (p) => p.draw + p.hold + p.open + p.fade,
  params: [
    select('orient', 'Line runs', [['h', 'Sideways'], ['v', 'Up and down']], 'h'),
    select('from', 'Drawn from', [['edges', 'Both edges to the middle'], ['middle', 'The middle outwards']], 'edges'),
    num('at', 'Where (% of the screen)', 0, 100, 1, 50),
    num('thick', 'Line thickness (px)', 1, 40, 0.5, 2),
    num('draw', 'Drawing the line (ms)', 0, 4000, 10, 350, 'Timing'),
    num('hold', 'Line holds (ms)', 0, 4000, 10, 80, 'Timing'),
    num('open', 'Opening (ms)', 10, 2000, 10, 110, 'Timing'),
    num('fade', 'Flash fades (ms)', 0, 5000, 10, 600, 'Timing'),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 1),
    { key: 'color', label: 'Colour', type: 'color', default: '#ffffff', group: 'Colour' },
    additive(true),
    ...repeatParams(),
  ],
  presets: [
    { name: 'Slit flash', values: {} },
    { name: 'Curtain of light', values: { orient: 'v', from: 'middle', draw: 200, open: 260, fade: 900 } },
    { name: 'Dark blink', values: { color: '#000000', additive: false, draw: 150, hold: 0, open: 90, fade: 300, thick: 3 } },
  ],
  generate(ctx, p) {
    const h = p.orient !== 'v', half = h ? 427 : 240, full = h ? 484 : 860;
    const pos = h ? (480 * p.at) / 100 : SB.left + (854 * p.at) / 100;
    repeatTimes(ctx, p).forEach((t) => {
      const t1 = t + p.draw, t2 = t1 + p.hold, t3 = t2 + p.open, t4 = t3 + p.fade;
      for (const side of [0, 1]) {
        const edge = p.from === 'edges';
        const origin = h ? ((side === 0) === edge ? 'CentreLeft' : 'CentreRight') : ((side === 0) === edge ? 'TopCentre' : 'BottomCentre');
        const along = edge ? (side === 0 ? (h ? SB.left : 0) : (h ? SB.right : 480)) : (h ? 320 : 240);
        const s = ctx.sprite(ctx.tex('pixel'), { origin, x: h ? along : pos, y: h ? pos : along });
        const v = (len, th) => (h ? [len, th] : [th, len]);
        s._add('V', t, t1, v(0, p.thick), v(half + 1, p.thick), E.InOutQuad);
        s._add('V', t2, t3, v(half + 1, p.thick), v(half + 1, full * 2), E.InExpo);
        s.fade(t, t, p.opacity); s.fade(t3, t4, p.opacity, 0, E.OutQuad);
        s.color(t, t, p.color);
        if (p.additive) s.additive();
      }
    });
  },
};

export const shapeCurtain = {
  id: 'shapeCurtain', name: 'Shape Curtain', category: 'Transitions', icon: '▚', accent: '#ff9ec7', scope: 'point',
  description: 'A swarm of shapes rushes in from one side and covers the screen, a cut can hide behind it, then the shapes go one by one.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  length: (p) => p.stagger + p.rush + p.hold + p.clear,
  params: [
    select('texture', 'Shape', FILLED, 'square'),
    num('count', 'Shapes', 10, 600, 5, 160),
    num('sizeMin', 'Smallest (px)', 4, 400, 1, 70),
    num('sizeMax', 'Largest (px)', 4, 600, 1, 150),
    select('side', 'Comes from', [['left', 'The left'], ['right', 'The right'], ['top', 'Above'], ['bottom', 'Below'], ['all', 'All sides']], 'left'),
    num('stagger', 'Arrivals spread over (ms)', 0, 4000, 10, 350, 'Timing'),
    num('rush', 'A shape takes (ms)', 30, 3000, 10, 260, 'Timing'),
    num('hold', 'Screen stays covered (ms)', 0, 4000, 10, 120, 'Timing'),
    num('clear', 'Clearing takes (ms)', 50, 8000, 10, 1100, 'Timing'),
    select('leave', 'They leave by', [['fade', 'Fading'], ['shrink', 'Shrinking'], ['on', 'Rushing on']], 'fade', 'Timing'),
    num('spin', 'Tumble on the way (± degrees)', 0, 720, 5, 120),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 1),
    additive(false),
    ...colorParams('#ffffff', 'random', ['#ff9ec7', '#ffd166', '#9fd8ff', '#ffffff']),
  ],
  presets: [
    { name: 'Confetti curtain', values: {} },
    { name: 'Black tiles', values: { colorMode: 'fixed', color: '#000000', spin: 0, sizeMin: 110, sizeMax: 180, count: 110, leave: 'shrink' } },
    { name: 'Petal rush', values: { texture: 'heart', side: 'right', count: 220, sizeMin: 40, sizeMax: 110, leave: 'on', palette: ['#ffc2d9', '#ff8fb8', '#ffffff'] } },
    { name: 'From all sides', values: { texture: 'disc', side: 'all', count: 140, spin: 0, stagger: 500, colorMode: 'fixed', color: '#ffffff', leave: 'shrink' } },
  ],
  generate(ctx, p) {
    const r = ctx.rng, n = Math.round(p.count), t = ctx.start;
    const cols = Math.max(1, Math.ceil(Math.sqrt((n * 854) / 480))), rows = Math.ceil(n / cols), cw = 854 / cols, ch = 480 / rows;
    const tex = ctx.tex(p.texture), tw = ctx.texSize(p.texture).w;
    const cover = t + p.stagger + p.rush + p.hold;
    for (let i = 0; i < n; i++) {
      const tx = SB.left + ((i % cols) + 0.5) * cw + r.range(-cw, cw) * 0.3, ty = (Math.floor(i / cols) + 0.5) * ch + r.range(-ch, ch) * 0.3;
      const size = r.range(Math.min(p.sizeMin, p.sizeMax), Math.max(p.sizeMin, p.sizeMax)), sc = Math.max(size, Math.max(cw, ch) * 1.25) / tw;
      const side = p.side === 'all' ? r.pick(['left', 'right', 'top', 'bottom']) : p.side;
      const far = size + r.range(20, 260);
      const [x0, y0] = side === 'left' ? [SB.left - far, ty + r.range(-80, 80)] : side === 'right' ? [SB.right + far, ty + r.range(-80, 80)]
        : side === 'top' ? [tx + r.range(-80, 80), -far] : [tx + r.range(-80, 80), 480 + far];
      const ta = t + r() * p.stagger, tb = ta + p.rush;
      const s = ctx.sprite(tex, { x: x0, y: y0 });
      s.move(ta, tb, x0, y0, tx, ty, E.OutQuart);
      const rot = rad(r.range(-p.spin, p.spin));
      if (p.spin) s.rotate(ta, tb, rot, rad(r.range(-20, 20)), E.OutQuart);
      s.fade(ta, ta, p.opacity);
      const tc = cover + r() * p.clear * 0.6, td = tc + p.clear * 0.4;
      if (p.leave === 'shrink') { s.scale(ta, ta, sc); s.scale(tc, td, sc, 0, E.InBack); s.fade(td, td, p.opacity, 0); }
      else if (p.leave === 'on') { s.scale(ta, ta, sc); s.move(tc, td, tx, ty, tx + (tx - x0), ty + (ty - y0), E.InQuart); s.fade(td, td, p.opacity, 0); }
      else { s.scale(ta, ta, sc); s.fade(tc, td, p.opacity, 0); }
      s.color(ta, ta, pickColor(ctx, p, null, i));
      if (p.additive) s.additive();
    }
  },
};

export const shapeBloom = {
  id: 'shapeBloom', name: 'Shape Bloom', category: 'Transitions', icon: '●', accent: '#ffd166', scope: 'point',
  description: 'A filled shape grows from a point until it covers the whole screen, then fades: a wipe that starts anywhere.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  length: (p) => p.grow + p.hold + p.fade,
  params: [
    select('texture', 'Shape', [['disc', 'Disc'], ['diamond', 'Diamond'], ['hex', 'Hexagon'], ['square', 'Square'], ['star', 'Star'], ['heart', 'Heart']], 'disc'),
    num('x', 'X', -107, 747, 1, 320, 'Position'),
    num('y', 'Y', 0, 480, 1, 240, 'Position'),
    num('turn', 'Turns while it grows (degrees)', -360, 360, 5, 0),
    num('grow', 'Growing (ms)', 30, 5000, 10, 500, 'Timing'),
    easing('ease', 'Growth easing', E.InQuad),
    num('hold', 'Covered for (ms)', 0, 5000, 10, 0, 'Timing'),
    num('fade', 'Fades (ms)', 0, 5000, 10, 500, 'Timing'),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 1),
    { key: 'color', label: 'Colour', type: 'color', default: '#ffffff', group: 'Colour' },
    additive(false),
    ...repeatParams(),
  ],
  presets: [
    { name: 'White bloom', values: {} },
    { name: 'Ink drop', values: { color: '#000000', grow: 700, ease: E.OutQuad, hold: 150, fade: 700 } },
    { name: 'Diamond open', values: { texture: 'diamond', turn: 90, grow: 600, ease: E.InOutCubic, color: '#ffd166' } },
  ],
  generate(ctx, p) {
    const tw = ctx.texSize(p.texture).w;
    const reach = Math.max(...[[SB.left, 0], [SB.right, 0], [SB.left, 480], [SB.right, 480]].map(([cx, cy]) => Math.hypot(cx - p.x, cy - p.y)));
    const need = { disc: 2.1, hex: 2.5, square: 3, diamond: 4.1, star: 5.6, heart: 5 }[p.texture] || 3;
    repeatTimes(ctx, p).forEach((t) => {
      const t1 = t + p.grow, t2 = t1 + p.hold, t3 = t2 + p.fade;
      const s = ctx.sprite(ctx.tex(p.texture), { x: p.x, y: p.y });
      s.scale(t, t1, 0, (reach * need) / tw, p.ease);
      if (p.turn) s.rotate(t, t1, -rad(p.turn), 0, p.ease);
      s.fade(t, t, p.opacity); s.fade(t2, t3, p.opacity, 0);
      s.color(t, t, p.color);
      if (p.additive) s.additive();
    });
  },
};

export const lightning = {
  id: 'lightning', name: 'Lightning', category: 'Transitions', icon: 'ϟ', accent: '#dff1ff', scope: 'point',
  description: 'A jagged bolt drawn from thin lines, with branches. It flickers and fades; every strike looks different.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  length: (p) => p.flickers * 70 + p.fade,
  params: [
    num('x', 'Starts at X', -107, 747, 1, 300, 'Position'),
    num('y', 'Starts at Y', 0, 480, 1, 0, 'Position'),
    num('endX', 'Ends at X', -107, 747, 1, 360, 'Position'),
    num('endY', 'Ends at Y', 0, 480, 1, 480, 'Position'),
    num('wander', 'Each strike lands this far off (± px)', 0, 400, 5, 0, 'Position', { help: 'With "Times" above 1: every strike is moved sideways by a random amount.' }),
    num('segments', 'Pieces', 3, 40, 1, 14),
    num('jag', 'Jaggedness (px)', 0, 150, 1, 34),
    num('branches', 'Branches', 0, 8, 1, 3),
    num('thick', 'Thickness (px)', 0.5, 20, 0.5, 2.5),
    bool('halo', 'Soft light around it', true),
    num('flash', 'Screen flash (0 = none)', 0, 1, 0.05, 0.2),
    num('flickers', 'Flickers', 0, 8, 1, 2, 'Timing'),
    num('fade', 'Fades (ms)', 30, 3000, 10, 380, 'Timing'),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 1),
    { key: 'color', label: 'Colour', type: 'color', default: '#e6f4ff', group: 'Colour' },
    additive(true),
    ...repeatParams(),
  ],
  presets: [
    { name: 'Bolt', values: {} },
    { name: 'Storm', values: { repeat: 4, repeatBeats: 2, wander: 260, branches: 4 } },
    { name: 'Crack across', values: { x: -107, y: 200, endX: 747, endY: 280, segments: 22, jag: 26, branches: 5, flash: 0, halo: false, color: '#ffffff', additive: false } },
  ],
  generate(ctx, p) {
    const r = ctx.rng;
    repeatTimes(ctx, p).forEach((t, n) => {
      const off = p.wander && n ? r.range(-p.wander, p.wander) : 0;
      const tEnd = t + p.flickers * 70, tGone = tEnd + p.fade;
      const piece = (x0, y0, x1, y1, th, op) => {
        const s = ctx.sprite(ctx.tex('pixel'), { origin: 'CentreLeft', x: x0, y: y0 });
        s.rotate(t, t, Math.atan2(y1 - y0, x1 - x0));
        s.vec(t, t, Math.hypot(x1 - x0, y1 - y0) + th * 0.5, th);
        for (let f = 0; f < p.flickers; f++) s.fade(t + f * 70, t + f * 70 + 45, op, op * 0.15);
        s.fade(tEnd, tGone, op, 0, E.OutQuad);
        s.color(t, t, p.color);
        if (p.additive) s.additive();
      };
      const chain = (ax, ay, bx, by, n2, jag, th, op) => {
        const len = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / len, ny = (bx - ax) / len, pts = [[ax, ay]];
        for (let i = 1; i <= n2; i++) { const u = i / n2, j = i === n2 ? 0 : r.range(-jag, jag); pts.push([ax + (bx - ax) * u + nx * j, ay + (by - ay) * u + ny * j]); }
        for (let i = 0; i < n2; i++) {
          piece(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], th, op);
          if (p.halo) piece(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], th * 6, op * 0.18);
        }
        return pts;
      };
      const main = chain(p.x + off, p.y, p.endX + off, p.endY, Math.round(p.segments), p.jag, p.thick, p.opacity);
      for (let b = 0; b < p.branches; b++) {
        const from = main[1 + Math.floor(r() * Math.max(1, main.length - 3))];
        const ang = Math.atan2(p.endY - p.y, p.endX - p.x) + r.pick([-1, 1]) * r.range(0.4, 0.9), L = Math.hypot(p.endX - p.x, p.endY - p.y) * r.range(0.15, 0.35);
        chain(from[0], from[1], from[0] + Math.cos(ang) * L, from[1] + Math.sin(ang) * L, 3 + Math.floor(r() * 3), p.jag * 0.5, Math.max(0.5, p.thick * 0.55), p.opacity * 0.6);
      }
      if (p.flash > 0) {
        const s = ctx.sprite(ctx.tex('pixel'), { x: 320, y: 240 });
        s.vec(t, t, 860, 484); s.fade(t, tGone, p.flash, 0, E.OutQuad); s.color(t, t, p.color); s.additive();
      }
    });
  },
};

export const lensFlare = {
  id: 'lensFlare', name: 'Lens Flare', category: 'Background & ambience', icon: '✹', accent: '#fff1d6', scope: 'range',
  description: 'A light with its row of soft reflections across the picture, as a camera lens would show it. Made from soft circles; it can drift and flicker on the beat.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  params: [
    num('x', 'Light X', -107, 747, 1, 110, 'Position'),
    num('y', 'Light Y', 0, 480, 1, 80, 'Position'),
    num('drift', 'Light drifts sideways (px)', -400, 400, 5, 60, 'Position'),
    num('size', 'Size of the light (px)', 20, 800, 5, 220),
    bool('rays', 'Star rays on the light', true),
    num('ghosts', 'Reflections', 0, 12, 1, 5),
    num('spread', 'Reflections reach (1 = to the opposite side)', 0.2, 2, 0.05, 1),
    num('flickerBeats', 'Flickers every (beats, 0 = off)', 0, 16, 0.25, 0, 'Motion'),
    num('flicker', 'Flicker strength', 0, 1, 0.05, 0.4, 'Motion', { showIf: (p) => p.flickerBeats > 0 }),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.55),
    ...colorParams('#fff1d6', 'fixed', ['#fff1d6', '#ffd0a8', '#bfe3ff']),
    ...fadeParams(800, 800),
  ],
  presets: [
    { name: 'Sun in the corner', values: {} },
    { name: 'Cool flare', values: { x: 600, y: 60, drift: -80, colorMode: 'cycle', palette: ['#dff1ff', '#9fc8ff', '#c9b6ff'], ghosts: 7 } },
    { name: 'Beat sparkle', values: { x: 320, y: 120, drift: 0, size: 160, ghosts: 3, flickerBeats: 1, flicker: 0.6 } },
  ],
  generate(ctx, p) {
    const r = ctx.rng, a = ctx.start, b = ctx.end, [fi, fo] = fitDurations(b - a, p.fadeIn, p.fadeOut);
    const beats = p.flickerBeats > 0 ? beatTimes(ctx, p.flickerBeats, a + fi, b - fo) : [];
    const gap = p.flickerBeats * ctx.map.beatLengthAt(a);
    const add = (name, k, px, op, i) => {
      const at = (lx) => [lx + (320 - lx) * 2 * k, p.y + (240 - p.y) * 2 * k];
      const [x0, y0] = at(p.x - p.drift / 2), [x1, y1] = at(p.x + p.drift / 2);
      const s = ctx.sprite(ctx.tex(name), { x: x0, y: y0 });
      if (p.drift) s.move(a, b, x0, y0, x1, y1, E.InOutSine);
      s.scale(a, a, fit(ctx, name, px));
      s.fade(a, a + fi, 0, op);
      for (const t of beats) s.fade(t, Math.min(b - fo, t + gap * 0.7), Math.min(1, op * (1 + p.flicker)), op, E.OutQuad);
      s.fade(b - fo, b, op, 0);
      s.color(a, a, pickColor(ctx, p, null, i));
      s.additive();
    };
    add('glow', 0, p.size, p.opacity, 0);
    add('glow-core', 0, p.size * 0.45, p.opacity, 0);
    if (p.rays) add('star4', 0, p.size * 1.7, p.opacity * 0.7, 0);
    const n = Math.round(p.ghosts), kinds = ['bokeh', 'ring-glow', 'soft-dot', 'glow', 'bokeh'];
    for (let i = 1; i <= n; i++) add(kinds[i % kinds.length], (0.15 + (i / n) * 0.85) * p.spread, p.size * r.range(0.12, 0.55), p.opacity * r.range(0.25, 0.5), i);
  },
};

export const passingLines = {
  id: 'passingLines', name: 'Passing Lines', category: 'Background & ambience', icon: '╪', accent: '#cfe8ff', scope: 'range',
  description: 'Thin lines keep appearing, slide a little and thin out again: sideways, upright or both. Shorter ones grow in from the edges like bands of light.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    select('axis', 'Lines run', [['h', 'Sideways'], ['v', 'Up and down'], ['both', 'Both']], 'both'),
    num('perBeat', 'New lines per beat', 0.25, 16, 0.25, 2, 'Motion'),
    num('life', 'A line lasts (ms)', 80, 8000, 10, 900, 'Timing'),
    num('thick', 'Thickness (px)', 0.5, 120, 0.5, 2),
    num('reach', 'Length (% of the screen; under 100 = grows in from an edge)', 5, 100, 1, 100),
    num('travel', 'Slides while shown (px)', 0, 400, 1, 50, 'Motion'),
    num('tilt', 'Tilted by up to (± degrees)', 0, 45, 0.5, 0),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.45),
    additive(true),
    ...colorParams('#ffffff', 'fixed'),
  ],
  presets: [
    { name: 'Grid lines', values: {} },
    { name: 'Light bands', values: { axis: 'h', reach: 45, thick: 26, tilt: 6, travel: 0, life: 1800, perBeat: 1, opacity: 0.18 } },
    { name: 'Scan lines', values: { axis: 'h', thick: 1, perBeat: 6, life: 500, travel: 120, opacity: 0.35 } },
    { name: 'Rain of columns', values: { axis: 'v', reach: 60, thick: 3, perBeat: 4, life: 700, travel: 0, colorMode: 'random', palette: ['#66ccff', '#b388ff', '#ffffff'] } },
  ],
  generate(ctx, p) {
    const r = ctx.rng, gap = Math.max(15, ctx.map.beatLengthAt(ctx.start) / p.perBeat);
    let i = 0;
    for (let t0 = ctx.start; t0 + p.life <= ctx.end + 1 && i < 4000; t0 += gap, i++) {
      const t = Math.round(t0 + r.range(0, gap * 0.6)), t1 = Math.min(ctx.end, t + p.life), tm = t + (t1 - t) * 0.3;
      const horiz = p.axis === 'h' || (p.axis === 'both' && r.chance(0.5));
      const long = horiz ? 860 : 484, len = (long * p.reach) / 100, pos = horiz ? r.range(0, 480) : r.range(SB.left, SB.right);
      const dir = r.pick([-1, 1]), side = r.chance(0.5), tilt = (r.range(-p.tilt, p.tilt) * Math.PI) / 180;
      const full = p.reach >= 100;
      const origin = full ? 'Centre' : horiz ? (side ? 'CentreLeft' : 'CentreRight') : (side ? 'TopCentre' : 'BottomCentre');
      const along = full ? (horiz ? 320 : 240) : horiz ? (side ? SB.left : SB.right) : (side ? 0 : 480);
      const s = ctx.sprite(ctx.tex('pixel'), { origin, x: horiz ? along : pos, y: horiz ? pos : along });
      const v = (l, th) => (horiz ? [l, th] : [th, l]);
      if (full) { s._add('V', t, tm, v(long * 1.2, 0), v(long * 1.2, p.thick), E.OutQuad); s._add('V', tm, t1, v(long * 1.2, p.thick), v(long * 1.2, 0), E.InQuad); }
      else { s._add('V', t, tm, v(0, p.thick), v(len, p.thick), E.OutCubic); s._add('V', tm, t1, v(len, p.thick), v(len, p.thick * 0.3)); }
      if (p.travel) { if (horiz) s.moveY(t, t1, pos, pos + dir * p.travel); else s.moveX(t, t1, pos, pos + dir * p.travel); }
      if (tilt) s.rotate(t, t, tilt);
      s.fade(t, tm, 0, p.opacity); s.fade(tm, t1, p.opacity, 0, E.InQuad);
      s.color(t, t, pickColor(ctx, p, null, i));
      if (p.additive) s.additive();
    }
  },
};

export const needles = {
  id: 'needles', name: 'Needle Crackle', category: 'Background & ambience', icon: '✳', accent: '#ffffff', scope: 'range',
  description: 'Thin lines snap out from around a point in random directions and fade where they stand: static, sparks, a crackling core.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    num('x', 'Centre X', -107, 747, 1, 320, 'Position'),
    num('y', 'Centre Y', 0, 480, 1, 240, 'Position'),
    num('inner', 'Starts this far from the centre (px)', 0, 400, 1, 70, 'Position'),
    num('lenMin', 'Shortest (px)', 2, 600, 1, 30),
    num('lenMax', 'Longest (px)', 2, 900, 1, 150),
    num('thick', 'Thickness (px)', 0.5, 12, 0.5, 1.5),
    num('perBeat', 'Needles per beat', 0.5, 32, 0.5, 8, 'Motion'),
    num('snap', 'Snaps out in (ms)', 0, 500, 5, 60, 'Timing'),
    num('fade', 'Fades in (ms)', 20, 4000, 10, 380, 'Timing'),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.8),
    additive(true),
    ...colorParams('#ffffff', 'fixed'),
  ],
  presets: [
    { name: 'Crackle', values: {} },
    { name: 'Sun spikes', values: { inner: 110, lenMin: 60, lenMax: 260, perBeat: 4, fade: 900, thick: 2.5, color: '#ffd166' } },
    { name: 'Static', values: { inner: 0, lenMin: 8, lenMax: 60, perBeat: 16, fade: 160, snap: 0 } },
  ],
  generate(ctx, p) {
    const r = ctx.rng, gap = Math.max(10, ctx.map.beatLengthAt(ctx.start) / p.perBeat);
    let i = 0;
    for (let t = ctx.start; t + p.snap < ctx.end && i < 6000; t += gap, i++) {
      const a = r.range(0, Math.PI * 2), L = r.range(Math.min(p.lenMin, p.lenMax), Math.max(p.lenMin, p.lenMax)), t0 = Math.round(t), t1 = t0 + p.snap;
      const s = ctx.sprite(ctx.tex('pixel'), { origin: 'CentreLeft', x: p.x + Math.cos(a) * p.inner, y: p.y + Math.sin(a) * p.inner });
      s.rotate(t0, t0, a);
      s.vec(t0, t1, 0, p.thick, L, p.thick, E.OutQuad);
      s.fade(t0, t0, p.opacity); s.fade(t1, Math.min(ctx.end + p.fade, t1 + p.fade), p.opacity, 0, E.OutQuad);
      s.color(t0, t0, pickColor(ctx, p, null, i));
      if (p.additive) s.additive();
    }
  },
};

const MOTE_TEX = [['soft-dot', 'Soft dot'], ['dot', 'Hard dot'], ['glow', 'Glow'], ['star4', 'Sparkle'], ['square', 'Square'], ['diamond', 'Diamond'], ['ring-thin', 'Ring'], ['tri', 'Shard']];
export const motes = {
  id: 'motes', name: 'Dust & Motes', category: 'Background & ambience', icon: '⁖', accent: '#e8f0ff', scope: 'range',
  description: 'Very many small specks at little cost: dust that drifts and blinks, specks that leave a line, or a slow swirl round a point. Each speck repeats its own short loop.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    select('mode', 'Kind', [['drift', 'Dust: drifts and blinks'], ['line', 'Leaves a line'], ['swirl', 'Swirls round a point']], 'drift'),
    num('count', 'Specks', 5, 3000, 5, 200, 'Look', { help: 'Each speck costs 3 to 9 commands. Above 1000 keep an eye on the command count at the bottom right.' }),
    select('texture', 'Speck', MOTE_TEX, 'soft-dot'),
    num('sizeMin', 'Smallest (px)', 0.5, 80, 0.5, 3),
    num('sizeMax', 'Largest (px)', 0.5, 120, 0.5, 10),
    num('life', 'One round (beats)', 0.5, 64, 0.5, 6, 'Motion'),
    num('lifeVar', 'Rounds differ by (%)', 0, 90, 5, 40, 'Motion'),
    num('dist', 'Travels (px)', 0, 600, 1, 70, 'Motion', { showIf: (p) => p.mode !== 'swirl' }),
    num('blinks', 'Blinks per round', 1, 8, 1, 2, 'Motion', { showIf: (p) => p.mode === 'drift' }),
    num('x', 'X', -107, 747, 1, 320, 'Position', { showIf: (p) => p.mode !== 'drift' }),
    num('y', 'Y', 0, 480, 1, 300, 'Position', { showIf: (p) => p.mode !== 'drift' }),
    num('length', 'Length of the line (px)', 10, 1200, 5, 860, 'Position', { showIf: (p) => p.mode === 'line' }),
    num('angle', 'Line turned (degrees)', -180, 180, 1, 0, 'Position', { showIf: (p) => p.mode === 'line' }),
    select('leave', 'Specks leave', [['up', 'To one side'], ['down', 'To the other side'], ['both', 'To both sides']], 'both', 'Motion', { showIf: (p) => p.mode === 'line' }),
    num('rMin', 'Nearest (px from the point)', 0, 800, 1, 40, 'Position', { showIf: (p) => p.mode === 'swirl' }),
    num('rMax', 'Furthest (px)', 0, 1000, 1, 300, 'Position', { showIf: (p) => p.mode === 'swirl' }),
    select('way', 'Direction', [['cw', 'Clockwise'], ['ccw', 'Anticlockwise'], ['both', 'Both']], 'cw', 'Motion', { showIf: (p) => p.mode === 'swirl' }),
    num('shrink', 'Shrinks away and returns every (beats, 0 = off)', 0, 32, 0.25, 0, 'Motion', { showIf: (p) => p.mode === 'swirl' }),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.9),
    additive(true),
    ...colorParams('#ffffff', 'fixed'),
    ...fadeParams(800, 800),
  ],
  presets: [
    { name: 'Blinking dust', values: {} },
    { name: 'Thick dust', values: { count: 900, sizeMin: 2, sizeMax: 5, dist: 40, blinks: 3, opacity: 0.8 } },
    { name: 'Rising from a line', values: { mode: 'line', leave: 'up', count: 120, y: 400, dist: 160, life: 4 } },
    { name: 'Horizon sparks', values: { mode: 'line', leave: 'both', count: 160, y: 240, dist: 110, life: 3, texture: 'star4', sizeMin: 4, sizeMax: 12, colorMode: 'cycle', palette: ['#66ccff', '#ff9ec7'] } },
    { name: 'Slow swirl', values: { mode: 'swirl', count: 160, y: 240, life: 16 } },
    { name: 'Glass shards', values: { mode: 'swirl', texture: 'tri', count: 60, y: 240, life: 24, way: 'both', sizeMin: 8, sizeMax: 26, shrink: 4, additive: false, opacity: 0.55, colorMode: 'fixed', color: '#8ab8ff', colorVar: 0.35 } },
  ],
  generate(ctx, p) {
    const r = ctx.rng, a = ctx.start, b = ctx.end, bl = ctx.map.beatLengthAt(a), n = Math.round(p.count);
    const [fi, fo] = fitDurations(b - a, p.fadeIn, p.fadeOut), tex = ctx.tex(p.texture), tw = ctx.texSize(p.texture).w;
    const la = rad(p.angle);
    for (let i = 0; i < n; i++) {
      const P = Math.max(120, p.life * bl * (1 + r.range(-p.lifeVar, p.lifeVar) / 100)), sc = r.range(Math.min(p.sizeMin, p.sizeMax), Math.max(p.sizeMin, p.sizeMax)) / tw;
      const op = p.opacity * r.range(0.5, 1), col = pickColor(ctx, p, null, i);
      if (p.mode === 'swirl') {
        const R = r.range(Math.min(p.rMin, p.rMax), Math.max(p.rMin, p.rMax)), dir = p.way === 'both' ? r.pick([-1, 1]) : p.way === 'ccw' ? -1 : 1;
        const s = ctx.sprite(tex, { x: p.x + R, y: p.y }), Q = P / 4, t0 = a - r() * P, cx = p.x, cy = p.y, d = dir * R;
        s.loop(t0, Math.ceil((b - t0) / P), (l) => {
          l.moveX(0, Q, cx + R, cx, E.InSine); l.moveY(0, Q, cy, cy + d, E.OutSine);
          l.moveX(Q, Q * 2, cx, cx - R, E.OutSine); l.moveY(Q, Q * 2, cy + d, cy, E.InSine);
          l.moveX(Q * 2, Q * 3, cx - R, cx, E.InSine); l.moveY(Q * 2, Q * 3, cy, cy - d, E.OutSine);
          l.moveX(Q * 3, P, cx, cx + R, E.OutSine); l.moveY(Q * 3, P, cy - d, cy, E.InSine);
        });
        if (p.shrink > 0) {
          const S = Math.max(100, p.shrink * bl * r.range(0.7, 1.3)), s0 = a - r() * S;
          s.loop(s0, Math.ceil((b - s0) / S), (l) => { l.scale(0, S / 2, sc, 0, E.InOutSine); l.scale(S / 2, S, 0, sc, E.InOutSine); });
        } else s.scale(a, a, sc);
        s.fade(a, a + fi, 0, op); s.fade(b - fo, b, op, 0);
        s.color(a, a, col);
        if (p.additive) s.additive();
        continue;
      }
      let x0, y0, ang;
      if (p.mode === 'line') {
        const u = r.range(-0.5, 0.5), sideways = p.leave === 'both' ? r.pick([-1, 1]) : p.leave === 'down' ? 1 : -1;
        x0 = p.x + Math.cos(la) * p.length * u; y0 = p.y + Math.sin(la) * p.length * u;
        ang = la + (Math.PI / 2) * sideways + r.range(-0.25, 0.25);
      } else { x0 = r.range(SB.left, SB.right); y0 = r.range(0, 480); ang = r.range(0, Math.PI * 2); }
      const d = p.dist * r.range(0.5, 1.2), x1 = x0 + Math.cos(ang) * d, y1 = y0 + Math.sin(ang) * d;
      const t0 = a + r() * P, k = Math.floor((b - t0) / P);
      if (k < 1) continue;
      const s = ctx.sprite(tex, { x: x0, y: y0 });
      const blinks = p.mode === 'drift' ? Math.round(p.blinks) : 1, part = P / blinks;
      s.loop(t0, k, (l) => {
        if (d > 0.5) l.move(0, P, x0, y0, x1, y1, p.mode === 'line' ? E.OutQuad : E.Linear);
        for (let j = 0; j < blinks; j++) { l.fade(j * part, j * part + part * 0.4, 0, op, E.OutQuad); l.fade(j * part + part * 0.4, (j + 1) * part, op, 0, E.InQuad); }
      });
      s.scale(t0, t0, sc);
      s.color(t0, t0, col);
      if (p.additive) s.additive();
    }
  },
};

export const beatPop = {
  id: 'beatPop', name: 'Shapes on the Beat', category: 'Background & ambience', icon: '◈', accent: '#ffb86b', scope: 'range',
  description: 'On every beat (or on notes) a shape appears, grows or closes in, turns and fades: rings, a contracting disc, a line that shoots out, squares at random places.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    select('texture', 'Shape', [...OUTLINES, ...FILLED, ['line', 'Line']], 'ring-thin'),
    select('place', 'Where', [['fixed', 'One place'], ['random', 'Random places'], ['row', 'Spread along a row']], 'fixed', 'Position'),
    num('x', 'X', -107, 747, 1, 320, 'Position', { showIf: (p) => p.place !== 'random' }),
    num('y', 'Y', 0, 480, 1, 240, 'Position', { showIf: (p) => p.place !== 'random' }),
    num('rowLen', 'Row length (px)', 20, 1200, 5, 700, 'Position', { showIf: (p) => p.place === 'row' }),
    num('count', 'Shapes each time', 1, 12, 1, 1),
    select('on', 'Appears on', TRIGGERS, 'beat', 'Motion'),
    num('every', 'Every (beats)', 0.25, 16, 0.25, 1, 'Motion', { showIf: (p) => p.on === 'beat' }),
    num('from', 'Starts at (px)', 0, 1600, 1, 60),
    num('to', 'Ends at (px)', 0, 1600, 1, 300),
    num('thick', 'Line thickness (px)', 0.5, 60, 0.5, 4, 'Look', { showIf: (p) => p.texture === 'line' }),
    num('angle', 'Turned (degrees)', -180, 180, 1, 0),
    num('angleVar', 'Each one turned differently (± degrees)', 0, 180, 1, 0),
    num('turn', 'Turns while shown (degrees)', -720, 720, 5, 0, 'Motion'),
    num('life', 'Lasts (ms)', 40, 8000, 10, 600, 'Timing'),
    easing('ease', 'Easing', E.OutCubic),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.7),
    additive(true),
    ...colorParams('#ffffff', 'fixed'),
  ],
  presets: [
    { name: 'Beat rings', values: {} },
    { name: 'Contracting disc', values: { texture: 'disc', from: 520, to: 120, opacity: 0.3, life: 500, ease: E.OutQuad } },
    { name: 'Line ticks', values: { texture: 'line', x: 320, y: 440, from: 40, to: 520, thick: 3, life: 450 } },
    { name: 'Random squares', values: { texture: 'square-o', place: 'random', from: 30, to: 140, angleVar: 45, turn: 90, life: 1200, every: 0.5, opacity: 0.5 } },
    { name: 'Hex row', values: { texture: 'hex-o', place: 'row', count: 5, from: 110, to: 60, life: 400, ease: E.OutBack, y: 420 } },
  ],
  generate(ctx, p) {
    const r = ctx.rng, line = p.texture === 'line', name = line ? 'pixel' : p.texture, tw = line ? 1 : ctx.texSize(name).w, n = Math.round(p.count);
    let i = 0;
    for (const t of triggerTimes(ctx, p.on, p.every)) {
      if (t >= ctx.end) break;
      for (let c = 0; c < n; c++, i++) {
        const u = n > 1 ? c / (n - 1) - 0.5 : 0;
        const x = p.place === 'random' ? r.range(SB.left + 40, SB.right - 40) : p.place === 'row' ? p.x + u * p.rowLen : p.x;
        const y = p.place === 'random' ? r.range(40, 440) : p.y;
        const t1 = t + p.life, a0 = rad(p.angle + (p.angleVar ? r.range(-p.angleVar, p.angleVar) : 0));
        const s = ctx.sprite(ctx.tex(name), { x, y });
        if (line) s.vec(t, t1, p.from, p.thick, p.to, p.thick * 0.15, p.ease); else s.scale(t, t1, p.from / tw, p.to / tw, p.ease);
        if (p.turn) s.rotate(t, t1, a0, a0 + rad(p.turn), p.ease); else if (a0) s.rotate(t, t, a0);
        s.fade(t, t1, p.opacity, 0, E.InQuad);
        s.color(t, t, pickColor(ctx, p, null, i));
        if (p.additive) s.additive();
      }
    }
  },
};

export const blownAway = {
  id: 'blownAway', name: 'Blown Away', category: 'Hit effects', icon: '༄', accent: '#bfe3ff', scope: 'objects',
  description: 'Small shapes are born on the note and carried off by a wind: all in one direction, shrinking and changing colour on the way.',
  defaultLayer: 'Foreground', defaultOutput: 'diff',
  params: [
    ...targetParams(),
    select('texture', 'Shape', FILLED, 'disc'),
    num('count', 'Pieces per note', 1, 20, 1, 3),
    num('size', 'Size (px)', 2, 200, 1, 14),
    num('wind', 'Wind blows towards (degrees, 0 = right, -90 = up)', -180, 180, 1, -25),
    num('spread', 'Spread (± degrees)', 0, 180, 1, 22),
    num('dist', 'Carried (px)', 0, 900, 5, 150),
    num('scatter', 'Born this far around the note (px)', 0, 120, 1, 10),
    bool('shrink', 'Shrinks away', true),
    num('life', 'Lasts (ms)', 60, 5000, 10, 700, 'Timing'),
    easing('ease', 'Easing', E.InQuad),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.9),
    additive(false),
    ...colorParams('#ffffff', 'combo'),
    bool('turns', 'Turns into another colour', false, 'Colour'),
    { key: 'endColor', label: 'Ends as', type: 'color', default: '#66ccff', group: 'Colour', showIf: (p) => p.turns },
  ],
  presets: [
    { name: 'Carried off', values: {} },
    { name: 'Embers', values: { texture: 'soft-dot', count: 5, size: 10, wind: -80, spread: 35, dist: 200, life: 1100, additive: true, colorMode: 'fixed', color: '#ffd166', turns: true, endColor: '#ff5d5d' } },
    { name: 'Petals in the wind', values: { texture: 'heart', count: 2, size: 18, wind: 15, dist: 260, life: 1400, shrink: false, colorMode: 'fixed', color: '#ffc2d9' } },
  ],
  generate(ctx, p) {
    const r = ctx.rng, tex = ctx.tex(p.texture), sc0 = fit(ctx, p.texture, p.size), end = hexToRgb(p.endColor).map(Math.round);
    hitPoints(ctx, p).forEach((h, i) => {
      for (let c = 0; c < p.count; c++) {
        const ang = rad(p.wind + r.range(-p.spread, p.spread)), d = p.dist * r.range(0.55, 1.2), t0 = h.time, t1 = t0 + p.life * r.range(0.7, 1.1);
        const x = h.x + r.range(-p.scatter, p.scatter), y = h.y + r.range(-p.scatter, p.scatter), sc = sc0 * r.range(0.6, 1.2);
        const s = ctx.sprite(tex, { x, y });
        s.move(t0, t1, x, y, x + Math.cos(ang) * d, y + Math.sin(ang) * d, p.ease);
        if (p.shrink) s.scale(t0, t1, sc, 0, E.InQuad); else s.scale(t0, t0, sc);
        s.fade(t0, t1, p.opacity, 0, E.InQuad);
        const col = pickColor(ctx, p, h, i);
        if (p.turns) s._add('C', t0, t1, col, end); else s.color(t0, t0, col);
        if (p.additive) s.additive();
      }
    });
  },
};

export default [shapeRow, panel, stripeSteps, dotFigure, ringSet, beatPop, motes, passingLines, needles, lensFlare, herald, blownAway, slitFlash, shapeCurtain, shapeBloom, lightning];
