import { E, EASING_OPTIONS } from '../easing.js';
import { colorParams, pickColor, opt, customImageParam, shapeOrImage, playPath, lineParam } from './common.js';
import { lerp } from '../util.js';

const num = (key, label, min, max, step, def, group = 'Look', extra = {}) => ({ key, label, type: 'number', min, max, step, default: def, group, ...extra });
const bool = (key, label, def, group = 'Look', extra = {}) => ({ key, label, type: 'bool', default: def, group, ...extra });
const DOT_TEX = opt([['soft-dot', 'Soft dot'], ['dot', 'Hard dot'], ['glow', 'Glow'], ['star4', 'Sparkle'], ['star', 'Star'], ['bokeh', 'Bokeh disc'], ['diamond', 'Diamond'], ['heart', 'Heart']]);
const texParam = (def) => ({ key: 'texture', label: 'Shape', type: 'select', options: DOT_TEX, default: def, group: 'Look', showIf: (p) => !p.image });
const xy = () => [num('x', 'Centre X', -107, 747, 1, 320, 'Position'), num('y', 'Centre Y', 0, 480, 1, 240, 'Position')];

function window_(s, a, b, op, fi = 0, fo = 0) {
  s.fade(a, a + fi, 0, op);
  if (fo > 0) s.fade(b - fo, b, op, 0); else s.fade(b, b, 0);
}

export const orbit = {
  id: 'orbit', name: 'Star Rings', category: 'Background & ambience', icon: '◌', accent: '#9fb8ff', scope: 'range',
  description: 'Rings of stars circling a centre, seen at an angle.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    ...xy(),
    num('rings', 'Rings', 1, 12, 1, 3, 'Rings'),
    num('rIn', 'Inner radius (px)', 10, 800, 5, 120, 'Rings'),
    num('rOut', 'Outer radius (px)', 10, 800, 5, 300, 'Rings'),
    num('flatIn', 'Inner roundness', 0.01, 1, 0.01, 0.35, 'Rings', { help: '1 = a full circle, small = seen almost edge-on.' }),
    num('flatOut', 'Outer roundness', 0.01, 1, 0.01, 0.35, 'Rings'),
    num('perIn', 'Stars on the inner ring', 1, 60, 1, 10, 'Rings'),
    num('perOut', 'Stars on the outer ring', 1, 60, 1, 18, 'Rings'),
    num('periodIn', 'Inner lap (s)', 2, 120, 1, 30, 'Motion'),
    num('periodOut', 'Outer lap (s)', 2, 120, 1, 30, 'Motion'),
    bool('reverse', 'Other way round', false, 'Motion'),
    num('spin', 'Star spin (deg/s)', 0, 180, 1, 6, 'Motion'),
    texParam('star4'), ...customImageParam(),
    num('sizeIn', 'Inner star size', 0.01, 2, 0.01, 0.2),
    num('sizeOut', 'Outer star size', 0.01, 2, 0.01, 0.2),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 1),
    bool('additive', 'Additive (glowy) blending', true),
    ...colorParams('#ffffff', 'fixed'),
    num('fadeIn', 'Fade in (ms)', 0, 5000, 50, 0, 'Timing'),
    num('fadeOut', 'Fade out (ms)', 0, 5000, 50, 0, 'Timing'),
  ],
  presets: [
    { name: 'Tilted rings', values: {} },
    { name: 'Flat rings', values: { rings: 4, rIn: 70, rOut: 220, flatIn: 1, flatOut: 1, perIn: 8, perOut: 20, periodIn: 40, periodOut: 40 } },
    { name: 'Wide swirl', values: { rings: 6, rIn: 80, rOut: 520, flatIn: 0.18, flatOut: 0.4, perIn: 10, perOut: 30, periodIn: 20, periodOut: 60, sizeIn: 0.1, sizeOut: 0.3 } },
    { name: 'Single ring', values: { rings: 1, rIn: 210, rOut: 210, flatIn: 0.25, flatOut: 0.25, perIn: 22, perOut: 22, periodIn: 18, periodOut: 18, sizeIn: 0.22, sizeOut: 0.22, spin: 30 } },
  ],
  async generate(ctx, p) {
    const S0 = ctx.start, S1 = ctx.end;
    if (S1 - S0 < 100) return;
    const tex = await shapeOrImage(ctx, p);
    let idx = 0;
    for (let j = 0; j < p.rings; j++) {
      const u = p.rings > 1 ? j / (p.rings - 1) : 0;
      const rx = lerp(p.rIn, p.rOut, u), ry = rx * lerp(p.flatIn, p.flatOut, u);
      const per = Math.round(lerp(p.periodIn, p.periodOut, u) * 1000), n = Math.max(1, Math.round(lerp(p.perIn, p.perOut, u)));
      const size = lerp(p.sizeIn, p.sizeOut, u), dir = p.reverse ? -1 : 1;
      for (let i = 0; i < n; i++, idx++) {
        const L0 = Math.round(S0 - per + (i * per) / n);
        const s = ctx.sprite(tex, { x: p.x, y: p.y });
        s.loop(L0, Math.ceil((S1 - L0) / per), (l) => {
          l.moveX(0, per / 4, p.x, p.x + dir * rx, E.OutSine);
          l.moveX(per / 4, (per * 3) / 4, p.x + dir * rx, p.x - dir * rx, E.InOutSine);
          l.moveX((per * 3) / 4, per, p.x - dir * rx, p.x, E.InSine);
          l.moveY(0, per / 2, p.y - ry, p.y + ry, E.InOutSine);
          l.moveY(per / 2, per, p.y + ry, p.y - ry, E.InOutSine);
        });
        s.scale(L0, L0, size);
        if (p.spin) s.rotate(L0, S1, 0, (((S1 - L0) / 1000) * p.spin * Math.PI) / 180);
        s.color(L0, L0, pickColor(ctx, p, null, idx));
        window_(s, S0, S1, p.opacity, p.fadeIn, p.fadeOut);
        if (p.additive) s.additive();
      }
    }
  },
};

export const dotSphere = {
  id: 'dotSphere', name: 'Dot Globe', category: 'Background & ambience', icon: '◍', accent: '#ffffff', scope: 'range',
  description: 'A globe made of dots that keeps turning.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    ...xy(),
    num('radius', 'Radius (px)', 20, 400, 1, 100, 'Position'),
    num('rings', 'Rings (top to bottom)', 3, 40, 1, 11, 'Sphere'),
    num('perRing', 'Dots per ring', 2, 60, 2, 14, 'Sphere'),
    num('turn', 'Half a turn takes (s)', 1, 60, 0.05, 10, 'Sphere'),
    num('tilt', 'Tilt (px)', -100, 100, 1, 10, 'Sphere', { help: 'How far the dots dip (or rise) on their way across: tips the globe towards or away from you.' }),
    texParam('dot'), ...customImageParam(),
    num('size', 'Dot size', 0.01, 2, 0.005, 0.36),
    num('pulseTo', 'Shrinks to (on the beat)', 0.005, 2, 0.005, 0.2, 'Look', { showIf: (p) => p.pulseBeats > 0 }),
    num('pulseBeats', 'Pulse every (beats, 0 = off)', 0, 32, 0.5, 0, 'Look'),
    { key: 'pulseEase', label: 'Pulse easing', type: 'easing', default: E.OutSine, group: 'Look', options: EASING_OPTIONS, showIf: (p) => p.pulseBeats > 0 },
    bool('bold', 'Bold dots (drawn twice)', false, 'Look', { help: 'Soft-edged dots get visibly stronger when drawn twice.' }),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 1),
    bool('additive', 'Additive (glowy) blending', false),
    ...colorParams('#ffffff', 'fixed'),
  ],
  presets: [
    { name: 'Turning globe', values: {} },
    { name: 'Beat globe', values: { pulseBeats: 1, bold: true } },
    { name: 'Combo colours', values: { colorMode: 'combo', rings: 9, perRing: 12, size: 0.5 } },
    { name: 'Soft orb', values: { additive: true, texture: 'glow', size: 0.25, rings: 13, perRing: 16, pulseBeats: 4, pulseTo: 0.12 } },
  ],
  async generate(ctx, p) {
    const S0 = ctx.start, S1 = ctx.end;
    if (S1 - S0 < 100) return;
    const tex = await shapeOrImage(ctx, p);
    const per = Math.max(500, Math.round(p.turn * 1000)), R = p.radius;
    const beat = ctx.map.beatLengthAt(S0), pb = p.pulseBeats > 0 ? Math.max(60, Math.round(p.pulseBeats * beat)) : 0;
    const half = Math.max(1, Math.floor(p.perRing / 2));
    let idx = 0;
    for (let k = 1; k <= p.rings; k++) {
      const lat = (k * Math.PI) / (p.rings + 1);
      const hw = R * Math.sin(lat), y0 = p.y - R * Math.cos(lat), dip = p.tilt * Math.sin(lat);
      for (let i = 0; i < half * 2; i++, idx++) {
        const dir = i % 2 ? -1 : 1;
        const L0 = Math.round(S0 - per + (Math.floor(i / 2) * per) / half);
        for (let copy = 0; copy < (p.bold ? 2 : 1); copy++) {
        const s = ctx.sprite(tex, { x: p.x, y: p.y });
        s.loop(L0, Math.ceil((S1 - L0) / per), (l) => {
          l.moveX(0, per, p.x - dir * hw, p.x + dir * hw, E.InOutSine);
          l.moveY(0, per / 2, y0, y0 + dip, E.OutSine);
          l.moveY(per / 2, per, y0 + dip, y0, E.InSine);
        });
        if (pb) s.loop(S0, Math.ceil((S1 - S0) / pb), (l) => l.scale(0, pb, p.size, p.pulseTo, p.pulseEase ?? E.OutSine));
        else s.scale(L0, L0, p.size);
        s.color(L0, L0, pickColor(ctx, p, null, idx));
        window_(s, S0, S1, p.opacity);
        if (p.additive) s.additive();
        }
      }
    }
  },
};

export const spinShape = {
  id: 'spinShape', name: 'Stepping Shape', category: 'Background & ambience', icon: '◇', accent: '#ffffff', scope: 'range',
  description: 'An outlined shape that turns a notch every few beats, trailed by fading echoes.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    ...xy(),
    { key: 'texture', label: 'Shape', type: 'select', group: 'Look', default: 'hex-o', showIf: (p) => !p.image,
      options: opt([['square-o', 'Square'], ['tri-o', 'Triangle'], ['hex-o', 'Hexagon'], ['circle-o', 'Circle'], ['ring-thin', 'Thin ring'], ['star', 'Star']]) },
    lineParam(),
    ...customImageParam(),
    num('size', 'Size', 0.05, 6, 0.05, 1.2),
    num('endSize', 'Size at the end (0 = stays the same)', 0, 6, 0.01, 0, 'Look', { help: 'The shape slowly grows or tightens to this size over the whole range.' }),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.45),
    num('echoes', 'Echoes', 1, 12, 1, 3),
    num('echoDelay', 'Echo delay (ms)', 0, 500, 5, 70),
    num('echoFall', 'Each echo fainter by', 0, 0.5, 0.01, 0.1),
    bool('additive', 'Additive (glowy) blending', true),
    num('spinIn', 'Spin-in (ms)', 0, 5000, 10, 600, 'Motion'),
    num('spinTurns', 'Spin-in turns', 0, 5, 0.25, 0.5, 'Motion'),
    num('stepDeg', 'Turn each step (degrees)', -360, 360, 5, 60, 'Motion'),
    num('stepBeats', 'A step every (beats)', 0.5, 32, 0.5, 2, 'Motion'),
    num('fadeOut', 'Fade out (ms)', 0, 5000, 5, 500, 'Timing'),
    { key: 'color', label: 'Colour', type: 'color', default: '#ffffff', group: 'Look' },
  ],
  presets: [{ name: 'Hex steps', values: {} }, { name: 'Triangle turns', values: { texture: 'tri-o', stepDeg: 120, stepBeats: 4, echoes: 2 } }, { name: 'Star ticks', values: { texture: 'star', stepDeg: 36, stepBeats: 1, echoes: 2, size: 0.9, spinIn: 0 } }, { name: 'Single outline', values: { echoes: 1, opacity: 0.8 } }],
  async generate(ctx, p) {
    const S0 = ctx.start, S1 = ctx.end;
    if (S1 - S0 < 100) return;
    const tex = await shapeOrImage(ctx, p);
    const step = Math.max(60, p.stepBeats * ctx.map.beatLengthAt(S0));
    const rad = (d) => (d * Math.PI) / 180;
    for (let e = 0; e < p.echoes; e++) {
      const t0 = S0 + e * p.echoDelay, op = Math.max(0.03, p.opacity - e * p.echoFall);
      const s = ctx.sprite(tex, { x: p.x, y: p.y });
      const base = rad(p.spinTurns * 360);
      if (p.spinIn > 0) {
        s.scale(t0, t0 + p.spinIn, 0, p.size, E.OutExpo);
        s.rotate(t0, t0 + p.spinIn, 0, base, E.OutExpo);
      } else if (!(p.endSize > 0)) s.scale(t0, t0, p.size);
      if (p.endSize > 0 && S1 > t0 + p.spinIn) s.scale(t0 + p.spinIn, S1, p.size, p.endSize, E.InOutSine);
      let i = 0;
      for (let t = t0 + Math.max(step, p.spinIn); t < S1 - 1; t += step, i++) s.rotate(t, Math.min(S1, t + step), base + rad(p.stepDeg) * i, base + rad(p.stepDeg) * (i + 1), E.OutExpo);
      const fo = Math.min(p.fadeOut, S1 - t0);
      s.fade(S1 - fo, S1, op, 0, E.OutExpo);
      s.color(t0, t0, p.color);
      if (p.additive) s.additive();
    }
  },
};

export const spotlight = {
  id: 'spotlight', name: 'Spotlight', category: 'Hit effects', icon: '◉', accent: '#222', scope: 'range',
  description: 'Everything goes dark except a round spot that travels from note to note, along the sliders, exactly where the player is.',
  defaultLayer: 'Background', defaultOutput: 'diff',
  params: [
    num('radius', 'Spot radius (px)', 20, 400, 1, 120),
    num('opacity', 'Darkness', 0.05, 1, 0.05, 1),
    { key: 'color', label: 'Colour', type: 'color', default: '#000000', group: 'Look' },
    { key: 'image', label: 'Own image', type: 'image', default: '', none: 'None (built-in)', group: 'Look', help: 'A large picture with a see-through hole in its centre.' },
    num('holePx', 'Hole radius in that image (px)', 1, 1000, 0.5, 32, 'Look', { showIf: (p) => !!p.image }),
    num('closeMs', 'Closes in over (ms)', 0, 5000, 5, 600, 'Timing'),
    num('closeFrom', 'Starts this much wider (×)', 1, 10, 0.1, 3, 'Timing', { showIf: (p) => p.closeMs > 0 }),
    num('endMs', 'Shrinks shut over (ms)', 0, 5000, 5, 500, 'Timing'),
    num('endTo', 'Down to (×)', 0.05, 1, 0.05, 0.3, 'Timing', { showIf: (p) => p.endMs > 0 }),
  ],
  presets: [{ name: 'Follow the notes', values: {} }, { name: 'Tight & dim', values: { radius: 70, opacity: 0.85 } }, { name: 'Wide soft spot', values: { radius: 200, opacity: 0.7, closeMs: 1200 } }],
  async generate(ctx, p) {
    const S0 = ctx.start, S1 = ctx.end;
    if (S1 - S0 < 100) return;
    let tex = ctx.tex('spot'), hole = 10;
    if (p.image && (await ctx.loadMapImage(p.image))) { tex = p.image; hole = p.holePx; }
    const k = p.radius / hole;
    const path = playPath(ctx);
    const first = path.at(S0);
    const s = ctx.sprite(tex, { x: first.x, y: first.y });
    const knots = path.knots(S0, S1);
    for (let i = 0; i < knots.length - 1; i++) {
      const a = path.at(knots[i]), b = path.at(knots[i + 1]);
      s.move(knots[i], knots[i + 1], a.x, a.y, b.x, b.y);
    }
    const c0 = Math.min(p.closeMs, (S1 - S0) / 2), c1 = Math.min(p.endMs, (S1 - S0) / 2);
    if (c0 > 0) s.scale(S0, S0 + c0, k * p.closeFrom, k, E.OutSine); else s.scale(S0, S0, k);
    if (c1 > 0) s.scale(S1 - c1, S1, k, k * p.endTo, E.InSine);
    s.color(S0, S0, p.color);
    s.fade(S0, S0, p.opacity); s.fade(S1, S1, p.opacity, 0);
  },
};

export const pathTrail = {
  id: 'pathTrail', name: 'Path Trail', category: 'Hit effects', icon: '〰', accent: '#ff3b5c', scope: 'range',
  description: 'A ribbon of light drawn along the path the player follows, from note to note and along the sliders.',
  defaultLayer: 'Background', defaultOutput: 'diff',
  params: [
    texParam('glow'), ...customImageParam(),
    num('size', 'Size', 0.05, 4, 0.05, 0.65),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 1),
    bool('additive', 'Additive (glowy) blending', true),
    { key: 'where', label: 'Drawn', type: 'select', group: 'Look', default: 'sliders', options: opt([['sliders', 'Along the sliders only'], ['path', 'The whole way, also between notes']]) },
    num('every', 'A dab every (ms)', 5, 300, 1, 16, 'Timing'),
    num('fadeIn', 'Appears over (ms)', 0, 1000, 10, 100, 'Timing'),
    num('hold', 'Stays (ms)', 0, 5000, 10, 240, 'Timing'),
    num('fadeOut', 'Fades over (ms)', 0, 5000, 10, 600, 'Timing'),
    ...colorParams('#ff3b5c', 'fixed'),
  ],
  presets: [{ name: 'Red ribbon', values: {} }, { name: 'Combo ribbon', values: { colorMode: 'combo' } }, { name: 'Fine white line', values: { where: 'path', size: 0.3, every: 12, hold: 100, fadeOut: 400, color: '#ffffff' } }],
  async generate(ctx, p) {
    const S0 = ctx.start, S1 = ctx.end;
    const tex = await shapeOrImage(ctx, p);
    const path = playPath(ctx);
    const objs = ctx.map.objects;
    const times = [];
    if (p.where === 'path') for (let t = S0; t <= S1; t += p.every) times.push(Math.round(t));
    else for (const o of objs) {
      if (o.kind !== 'slider' || o.endTime < S0 || o.time > S1) continue;
      for (let t = o.time; t <= o.endTime; t += p.every) if (t >= S0 - 1 && t <= S1 + 1) times.push(Math.round(t));
    }
    let i = 0;
    for (const tt of times) {
      i++;
      const q = path.at(tt);
      const s = ctx.sprite(tex, { x: q.x, y: q.y });
      const a = tt - p.fadeIn, h = tt + p.hold, e = h + p.fadeOut;
      if (p.fadeIn > 0) s.fade(a, tt, 0, p.opacity); else s.fade(tt, tt, p.opacity);
      if (p.fadeOut > 0) s.fade(h, e, p.opacity, 0); else s.fade(h, h, p.opacity, 0);
      s.scale(tt, tt, p.size);
      const obj = p.colorMode === 'combo' ? objs.filter((o) => o.time <= tt).at(-1) : null;
      s.color(a, a, pickColor(ctx, p, { obj }, i));
      if (p.additive) s.additive();
    }
  },
};

export default [orbit, dotSphere, spinShape, spotlight, pathTrail];
