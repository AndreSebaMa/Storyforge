import { E, EASING_OPTIONS } from '../easing.js';
import { targetParams, colorParams, hitPoints, pickColor, opt, sliderPositionAt, SB, customImageParam, shapeOrImage, rideSlider, lined, lineParam, aimParams, bounceLegs, pictureFor } from './common.js';
import { sliderPath } from '../osu.js';

export function edgeSprites(ctx, style, t, size = 180) {
  const out = [];
  if (style === 'full') out.push(ctx.sprite(ctx.tex('pixel'), { x: 320, y: 240 }).vec(t, t, 860, 480));
  if (style === 'edges') {
    out.push(ctx.sprite(ctx.tex('grad-h'), { origin: 'CentreLeft', x: SB.left, y: 240 }).vec(t, t, size / 256, 482 / 4));
    out.push(ctx.sprite(ctx.tex('grad-h'), { origin: 'CentreLeft', x: SB.right, y: 240 }).vec(t, t, size / 256, 482 / 4).rotate(t, t, Math.PI));
  }
  if (style === 'bottom' || style === 'frame') out.push(ctx.sprite(ctx.tex('grad-v'), { origin: 'BottomCentre', x: 320, y: 480 }).vec(t, t, 860 / 4, size / 256));
  if (style === 'frame') out.push(ctx.sprite(ctx.tex('grad-v'), { origin: 'BottomCentre', x: 320, y: 0 }).vec(t, t, 860 / 4, size / 256).rotate(t, t, Math.PI));
  return out;
}

const num = (key, label, min, max, step, def, group = 'Look', extra = {}) => ({ key, label, type: 'number', min, max, step, default: def, group, ...extra });
const easing = (key, label, def, group = 'Timing') => ({ key, label, type: 'easing', default: def, group, options: EASING_OPTIONS });
const additive = (def = true) => ({ key: 'additive', label: 'Additive (glowy) blending', type: 'bool', default: def, group: 'Look' });

const GLOW_TEX = opt([['glow', 'Soft glow'], ['glow-core', 'Bright core'], ['bokeh', 'Bokeh disc'], ['star4', 'Sparkle'], ['flare', 'Lens flare'], ['ring-glow', 'Halo ring']]);
const PARTICLE_TEX = opt([['soft-dot', 'Soft dot'], ['dot', 'Hard dot'], ['glow', 'Glow'], ['star4', 'Sparkle'], ['star', 'Star'], ['square', 'Square'], ['diamond', 'Diamond'], ['bokeh', 'Bokeh'], ['heart', 'Heart'], ['heart-o', 'Heart outline'], ['ring-thin', 'Ring'], ['circle-o', 'Circle outline'], ['square-o', 'Square outline'], ['hex-o', 'Hexagon outline'], ['tri-o', 'Triangle outline']]);

export const hitGlow = {
  id: 'hitGlow', name: 'Hit Glow', category: 'Hit effects', icon: '✦', accent: '#ff66aa', scope: 'objects',
  description: 'A soft glow blooms on each note when it is hit. The classic hit effect.',
  defaultLayer: 'Foreground', defaultOutput: 'diff',
  params: [
    ...targetParams(),
    { key: 'texture', label: 'Shape', type: 'select', options: GLOW_TEX, default: 'glow', group: 'Look', showIf: (p) => !p.image },
    ...customImageParam(),
    num('size', 'Size', 0.05, 5, 0.05, 1.1),
    num('grow', 'Grow / shrink to (×)', 0.05, 4, 0.05, 1.5, 'Look', { help: 'Above 1 the glow blooms outward, below 1 it shrinks into the note.' }),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.85),
    num('spin', 'Spin (degrees)', -360, 360, 5, 0),
    num('randomRot', 'Random rotation', 0, 180, 5, 0),
    additive(),
    { key: 'hold', label: 'Hold on sliders & spinners', type: 'bool', default: false, group: 'Look',
      help: 'The glow rides along the slider (or sits on the spinner) for as long as it lasts, then fades.' },
    num('duration', 'Duration (ms)', 80, 3000, 10, 550, 'Timing'),
    num('attack', 'Pre-glow (ms)', 0, 400, 10, 0, 'Timing', { help: 'Fade in slightly before the note instead of popping on the hit.' }),
    easing('ease', 'Scale easing', E.OutQuad),
    easing('fadeEase', 'Fade easing', E.OutQuad),
    ...colorParams('#ffffff', 'combo'),
  ],
  presets: [
    { name: 'Soft bloom', values: { texture: 'glow', size: 1.1, grow: 1.5, opacity: 0.85, duration: 550, colorMode: 'combo' } },
    { name: 'Bright pop', values: { texture: 'glow-core', size: 0.8, grow: 2.2, opacity: 1, duration: 380, ease: E.OutExpo, colorMode: 'fixed', color: '#ffffff' } },
    { name: 'Sparkle', values: { texture: 'star4', size: 0.9, grow: 1.4, opacity: 1, duration: 450, spin: 90, randomRot: 45, colorMode: 'fixed', color: '#fff3b0' } },
    { name: 'Rainbow', values: { texture: 'glow', size: 1.2, grow: 1.8, colorMode: 'rainbow', duration: 650 } },
    { name: 'Lens flare', values: { texture: 'flare', size: 0.7, grow: 1.3, opacity: 0.9, duration: 500, colorMode: 'fixed', color: '#9fd8ff' } },
    { name: 'Afterglow trail', values: { texture: 'glow', size: 1.7, grow: 1.15, opacity: 0.65, duration: 1500, ease: E.OutQuad, fadeEase: E.InQuad, hold: true, colorMode: 'combo' } },
    { name: 'Hit lighting', values: { texture: 'glow', size: 3, grow: 0.2, opacity: 1, duration: 200, ease: E.In, fadeEase: E.In, hold: true, colorMode: 'combo' } },
  ],
  generate(ctx, p) {
    return p.image ? shapeOrImage(ctx, p).then((tex) => this.build(ctx, p, tex)) : this.build(ctx, p, ctx.tex(p.texture));
  },
  build(ctx, p, tex) {
    hitPoints(ctx, p).forEach((h, i) => {
      const o = h.obj;
      const held = p.hold && h.kind === 'head' && o && o.endTime > o.time && (o.kind === 'spinner' || (o.kind === 'slider' && o.spanDuration));
      const s = ctx.sprite(tex, { x: h.x, y: h.y });
      const t0 = held ? o.time : h.time, t1 = (held ? o.endTime : t0) + p.duration;
      if (held && o.kind === 'slider' && p.position === 'note' && !p.jitter) rideSlider(ctx, s, o);
      if (p.attack > 0) s.fade(t0 - p.attack, t0, 0, p.opacity, E.InQuad);
      s.fade(t0, t1, p.opacity, 0, p.fadeEase);
      s.scale(t0, t1, p.size, p.size * p.grow, p.ease);
      const r0 = p.randomRot ? ctx.rng.range(-p.randomRot, p.randomRot) * Math.PI / 180 : 0;
      if (p.spin || r0) s.rotate(t0, t1, r0, r0 + (p.spin * Math.PI) / 180, E.OutQuad);
      s.color(t0 - (p.attack || 0), t0 - (p.attack || 0), pickColor(ctx, p, h, i));
      if (p.additive) s.additive();
    });
  },
};

export const ringBurst = {
  id: 'ringBurst', name: 'Ring Burst', category: 'Hit effects', icon: '◎', accent: '#66ccff', scope: 'objects',
  description: 'Shockwave rings expand outward from each note.',
  defaultLayer: 'Foreground', defaultOutput: 'diff',
  params: [
    ...targetParams(),
    { key: 'ride', label: 'On a slider: travels along it', type: 'bool', default: false, group: 'Targets', showIf: (p) => p.position === 'note', help: 'It follows the slider from its head to its end and lasts at least that long.' },
    { key: 'texture', label: 'Ring style', type: 'select', options: opt([['ring', 'Solid'], ['ring-thin', 'Thin'], ['ring-glow', 'Glowing'], ['circle-o', 'Outline']]), default: 'ring-thin', group: 'Look', showIf: (p) => !p.image },
    lineParam((p) => p.texture !== 'ring-glow'),
    ...customImageParam(),
    num('from', 'Start size', 0, 2, 0.02, 0.3),
    num('to', 'End size', 0.1, 4, 0.05, 0.85),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.9),
    num('flatten', 'Flatten (1 = round)', 0.05, 1, 0.05, 1, 'Look', { help: 'Below 1 the ring is squashed into an oval, like a ripple on water seen from the side.' }),
    num('rings', 'Rings per hit', 1, 4, 1, 1),
    num('ringDelay', 'Delay between rings (ms)', 20, 400, 10, 90, 'Timing'),
    additive(),
    num('duration', 'Duration (ms)', 80, 3000, 10, 500, 'Timing'),
    easing('ease', 'Expand easing', E.OutCirc),
    ...colorParams('#ffffff', 'fixed'),
  ],
  presets: [
    { name: 'Clean shockwave', values: { texture: 'ring-thin', from: 0.3, to: 0.85, duration: 500 } },
    { name: 'Hairline ring', values: { texture: 'ring-thin', lineX: 0.15, from: 0.3, to: 0.9, duration: 500 } },
    { name: 'Double ring', values: { texture: 'ring-thin', rings: 2, ringDelay: 90, to: 1.0, duration: 600 } },
    { name: 'Glow halo', values: { texture: 'ring-glow', from: 0.4, to: 1.2, opacity: 0.8, colorMode: 'combo' } },
    { name: 'Big boom', values: { texture: 'ring', from: 0.2, to: 2.6, duration: 900, ease: E.OutExpo, opacity: 0.7 } },
    { name: 'Water ripple', values: { texture: 'ring-thin', flatten: 0.3, from: 0.05, to: 1.3, rings: 2, ringDelay: 180, duration: 1000, ease: E.OutCubic, opacity: 0.8, color: '#cfe8ff' } },
  ],
  async generate(ctx, p) {
    const tex = p.image ? await shapeOrImage(ctx, p) : ctx.tex(lined(p.texture, p.lineX));
    hitPoints(ctx, p).forEach((h, i) => {
      const c = pickColor(ctx, p, h, i);
      for (let k = 0; k < p.rings; k++) {
        const t0 = h.time + k * p.ringDelay, o = h.obj;
        let t1 = t0 + p.duration;
        const s = ctx.sprite(tex, { x: h.x, y: h.y });
        if (p.ride && h.kind === 'head' && o?.kind === 'slider' && p.position === 'note' && !p.jitter) {
          rideSlider(ctx, s, o); t1 = Math.max(t1, o.endTime + k * p.ringDelay);
          if (t0 > o.time) s.fade(o.time, o.time, 0);
        }
        const to = p.to * (1 - k * 0.12), f = p.flatten ?? 1;
        if (f < 1) s.vec(t0, t1, p.from, p.from * f, to, to * f, p.ease); else s.scale(t0, t1, p.from, to, p.ease);
        s.fade(t0, t1, p.opacity * (1 - k * 0.2), 0, E.InQuad);
        s.color(t0, t0, c);
        if (p.additive) s.additive();
      }
    });
  },
};

export const particleBurst = {
  id: 'particleBurst', name: 'Particle Burst', category: 'Hit effects', icon: '✺', accent: '#ffb347', scope: 'objects',
  description: 'Particles explode outward from each note. Control count, spread and gravity.',
  defaultLayer: 'Foreground', defaultOutput: 'diff',
  params: [
    ...targetParams(),
    { key: 'texture', label: 'Particle', type: 'select', options: PARTICLE_TEX, default: 'soft-dot', group: 'Look', showIf: (p) => !p.image },
    ...customImageParam(),
    num('count', 'Particles per hit', 1, 60, 1, 10),
    num('sizeMin', 'Size min', 0.01, 2, 0.01, 0.15),
    num('sizeMax', 'Size max', 0.01, 3, 0.01, 0.35),
    num('distMin', 'Distance min (px)', 0, 400, 5, 30),
    num('distMax', 'Distance max (px)', 5, 600, 5, 90),
    { key: 'spread', label: 'Direction', type: 'select', group: 'Look', default: 'all',
      options: opt([['all', 'All around'], ['up', 'Upwards fountain'], ['down', 'Downwards'], ['out', 'Away from centre'], ['ring', 'Even ring'], ['toward', 'Towards a point']]) },
    ...aimParams((p) => p.spread === 'toward'),
    { key: 'bounce', label: 'Bounce off the circle round the point', type: 'bool', default: false, group: 'Look', showIf: (p) => p.spread === 'toward' && p.aimStop > 0, help: 'Instead of stopping there, each particle hits the circle and is thrown back.' },
    num('bounceKeep', 'Bounciness (% of the speed kept)', 10, 100, 5, 60, 'Look', { showIf: (p) => p.spread === 'toward' && p.aimStop > 0 && p.bounce }),
    num('gravity', 'Gravity (px)', -200, 400, 5, 0),
    num('spin', 'Spin (degrees)', 0, 720, 10, 0),
    { key: 'shrink', label: 'Shrink while fading', type: 'bool', default: true, group: 'Look' },
    { key: 'vanish', label: 'Shrink to nothing, no fade', type: 'bool', default: false, group: 'Look', showIf: (p) => p.shrink },
    num('opacity', 'Opacity', 0.05, 1, 0.05, 1),
    additive(),
    num('duration', 'Lifetime (ms)', 100, 4000, 10, 700, 'Timing'),
    num('lifeVar', 'Lifetime variation', 0, 0.9, 0.05, 0.3, 'Timing'),
    easing('ease', 'Motion easing', E.OutExpo),
    ...colorParams('#ffffff', 'combo'),
  ],
  presets: [
    { name: 'Spark spray', values: { texture: 'soft-dot', count: 10, distMax: 90, duration: 700 } },
    { name: 'Confetti', values: { texture: 'square', count: 14, sizeMin: 0.08, sizeMax: 0.16, distMax: 120, gravity: 120, spin: 540, shrink: false, additive: false, colorMode: 'random', palette: ['#ff5e8a', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff'], duration: 1100 } },
    { name: 'Fountain', values: { texture: 'soft-dot', count: 12, spread: 'up', distMin: 60, distMax: 160, gravity: 220, duration: 1000, ease: E.OutCirc } },
    { name: 'Star shower', values: { texture: 'star4', count: 6, sizeMin: 0.2, sizeMax: 0.45, spin: 180, distMax: 110, colorMode: 'fixed', color: '#fff2a8' } },
    { name: 'Ring of light', values: { texture: 'glow', spread: 'ring', count: 12, distMin: 70, distMax: 70, sizeMin: 0.25, sizeMax: 0.25, lifeVar: 0, duration: 600 } },
    { name: 'Drawn to the centre', values: { texture: 'soft-dot', spread: 'toward', aimStop: 80, count: 5, distMin: 60, distMax: 600, sizeMin: 0.06, sizeMax: 0.14, duration: 900, lifeVar: 0.4, ease: E.OutCubic, opacity: 0.8 } },
    { name: 'Thrown back', values: { texture: 'heart', spread: 'toward', aimStop: 90, bounce: true, count: 2, distMin: 260, distMax: 520, sizeMin: 0.12, sizeMax: 0.2, duration: 1300, lifeVar: 0.2, shrink: false, additive: false, colorMode: 'fixed', color: '#ff7aa8' } },
    { name: 'Stardust', values: { texture: 'star4', count: 20, distMin: 10, distMax: 140, sizeMin: 0.03, sizeMax: 0.18, lifeVar: 0, duration: 1100, vanish: true, colorMode: 'fixed', color: '#ffffff' } },
  ],
  generate(ctx, p) {
    return p.image ? shapeOrImage(ctx, p).then((tex) => this.build(ctx, p, tex)) : this.build(ctx, p, ctx.tex(p.texture));
  },
  build(ctx, p, tex) {
    const r = ctx.rng;
    const sMax = Math.max(p.sizeMin, p.sizeMax), dMax = Math.max(p.distMin, p.distMax);
    hitPoints(ctx, p).forEach((h, i) => {
      const base = pickColor(ctx, p, h, i);
      for (let k = 0; k < p.count; k++) {
        let a;
        switch (p.spread) {
          case 'up': a = -Math.PI / 2 + r.range(-0.6, 0.6); break;
          case 'down': a = Math.PI / 2 + r.range(-0.6, 0.6); break;
          case 'out': a = Math.atan2(h.y - SB.cy, h.x - SB.cx) + r.range(-0.7, 0.7); break;
          case 'ring': a = (k / p.count) * Math.PI * 2; break;
          case 'toward': a = Math.atan2(p.aimY - h.y, p.aimX - h.x) + r.range(-0.18, 0.18); break;
          default: a = r() * Math.PI * 2;
        }
        let d = r.range(p.distMin, dMax);
        const life = p.duration * (1 - r() * p.lifeVar);
        const t0 = h.time, t1 = t0 + life;
        const legs = p.spread === 'toward' && p.bounce && p.aimStop > 0 && Math.hypot(p.aimX - h.x, p.aimY - h.y) > p.aimStop
          ? bounceLegs({ x: h.x, y: h.y, vx: Math.cos(a) * d, vy: Math.sin(a) * d, t0: 0, t1: 1000, circle: { x: p.aimX, y: p.aimY, r: p.aimStop }, keep: (p.bounceKeep ?? 60) / 100 }) : [];
        if (p.spread === 'toward' && legs.length < 2) d = Math.min(d, Math.max(0, Math.hypot(p.aimX - h.x, p.aimY - h.y) - p.aimStop));
        const ex = h.x + Math.cos(a) * d, ey = h.y + Math.sin(a) * d;
        const s = ctx.sprite(tex, { x: h.x, y: h.y });
        if (legs.length > 1) {
          const [g1, g2] = legs, tm = Math.round(t0 + life * Math.min(0.6, Math.max(0.2, (g1.t1 / 1000) * 1.2)));
          s.move(t0, tm, g1.x0, g1.y0, g1.x1, g1.y1);
          s.move(tm, t1, g2.x0, g2.y0, g2.x1, g2.y1, E.OutQuad);
        } else {
        s.moveX(t0, t1, h.x, ex, p.ease);
        if (p.gravity) {
          const tm = t0 + life * 0.35;
          s.moveY(t0, tm, h.y, h.y + (ey - h.y) * 0.8, E.OutQuad);
          s.moveY(tm, t1, h.y + (ey - h.y) * 0.8, ey + p.gravity, E.InQuad);
        } else s.moveY(t0, t1, h.y, ey, p.ease);
        }
        const size = r.range(p.sizeMin, sMax);
        const gone = p.shrink && p.vanish;
        s.scale(t0, gone ? t0 + life * 1.5 : t1, size, gone ? 0 : p.shrink ? size * 0.2 : size, gone ? E.Linear : E.InQuad);
        if (gone) { if (p.opacity < 1) s.fade(t0, t0, p.opacity); } else s.fade(t0, t1, p.opacity, 0, E.InQuad);
        if (p.spin) { const r0 = r() * Math.PI * 2; s.rotate(t0, t1, r0, r0 + r.sign() * p.spin * Math.PI / 180, E.OutQuad); }
        s.color(t0, t0, p.colorMode === 'random' ? pickColor(ctx, p, h, k) : base);
        if (p.additive) s.additive();
      }
    });
  },
};

export const sparkles = {
  id: 'sparkles', name: 'Twinkle Sparkles', category: 'Hit effects', icon: '✧', accent: '#fff2a8', scope: 'objects',
  description: 'Little stars twinkle around each note, slightly delayed for a magical feel.',
  defaultLayer: 'Foreground', defaultOutput: 'diff',
  params: [
    ...targetParams(),
    { key: 'texture', label: 'Sparkle', type: 'select', options: opt([['star4', '4-point sparkle'], ['star', 'Star'], ['diamond', 'Diamond'], ['glow-core', 'Glint']]), default: 'star4', group: 'Look', showIf: (p) => !p.image },
    ...customImageParam(),
    num('count', 'Sparkles per hit', 1, 10, 1, 3),
    num('radius', 'Spread radius (px)', 0, 200, 5, 50),
    num('size', 'Size', 0.05, 2, 0.05, 0.35),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 1),
    num('spin', 'Spin (degrees)', 0, 360, 5, 90),
    additive(),
    num('duration', 'Twinkle length (ms)', 100, 2000, 10, 500, 'Timing'),
    num('delay', 'Random delay (ms)', 0, 800, 10, 200, 'Timing'),
    ...colorParams('#fff6c8', 'fixed'),
  ],
  presets: [
    { name: 'Fairy dust', values: {} },
    { name: 'Gold glints', values: { texture: 'glow-core', count: 4, size: 0.25, colorMode: 'fixed', color: '#ffd166' } },
    { name: 'Cosmic', values: { count: 5, radius: 90, colorMode: 'random', palette: ['#b388ff', '#66ccff', '#ffffff'] } },
  ],
  async generate(ctx, p) {
    const r = ctx.rng;
    const tex = p.image ? await shapeOrImage(ctx, p) : ctx.tex(p.texture);
    hitPoints(ctx, p).forEach((h, i) => {
      for (let k = 0; k < p.count; k++) {
        const ang = r() * Math.PI * 2, d = Math.sqrt(r()) * p.radius;
        const x = h.x + Math.cos(ang) * d, y = h.y + Math.sin(ang) * d;
        const t0 = h.time + r() * p.delay, tm = t0 + p.duration * 0.4, t1 = t0 + p.duration;
        const size = p.size * r.range(0.6, 1.2);
        const s = ctx.sprite(tex, { x, y });
        s.scale(t0, tm, 0, size, E.OutBack);
        s.scale(tm, t1, size, 0, E.InQuad);
        s.fade(t0, t1, p.opacity, p.opacity * 0.6);
        const r0 = r() * Math.PI;
        if (p.spin) s.rotate(t0, t1, r0, r0 + p.spin * Math.PI / 180, E.OutQuad);
        s.color(t0, t0, pickColor(ctx, p, h, i * 7 + k));
        if (p.additive) s.additive();
      }
    });
  },
};

export const lightPillar = {
  id: 'lightPillar', name: 'Light Pillar', category: 'Hit effects', icon: '┃', accent: '#9fd8ff', scope: 'objects',
  description: 'A beam of light shoots through the screen at the note position.',
  defaultLayer: 'Foreground', defaultOutput: 'diff',
  params: [
    ...targetParams({ filter: 'all' }),
    { key: 'ride', label: 'On a slider: travels along it', type: 'bool', default: false, group: 'Targets', showIf: (p) => p.position === 'note', help: 'It follows the slider from its head to its end and lasts at least that long.' },
    { key: 'direction', label: 'Direction', type: 'select', group: 'Look', default: 'vertical', options: opt([['vertical', 'Vertical'], ['horizontal', 'Horizontal'], ['cross', 'Cross'], ['diagonal', 'Diagonal X'], ['slash', 'One slanted line'], ['edges', 'From the top and bottom edges'], ['toward', 'A line towards a point']]) },
    ...aimParams((p) => p.direction === 'toward'),
    num('angle', 'Slant (deg from upright)', -85, 85, 1, 35, 'Look', { showIf: (p) => p.direction === 'slash' }),
    { key: 'slashAlt', label: 'Every other one leans the other way', type: 'bool', default: false, group: 'Look', showIf: (p) => p.direction === 'slash' },
    num('reach', 'Reaches in (px)', 20, 240, 5, 140, 'Look', { showIf: (p) => p.direction === 'edges' }),
    num('width', 'Width (px)', 4, 300, 2, 60),
    num('edge', 'Edge hardness (0 = soft glow)', 0, 1, 0.05, 0, 'Look', { help: 'Above 0 the beam is an even bar: low values feather it widely, 1 is a crisp bar exactly as wide as Width.' }),
    { key: 'anim', label: 'Animation', type: 'select', group: 'Look', default: 'shrink', options: opt([['shrink', 'Burst then thin out'], ['expand', 'Widen and fade'], ['flash', 'Flash'], ['sweep', 'Drawn along its length']]) },
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.7),
    additive(),
    num('duration', 'Duration (ms)', 80, 3000, 10, 450, 'Timing'),
    easing('ease', 'Easing', E.OutQuad),
    ...colorParams('#bfe6ff', 'fixed'),
  ],
  presets: [
    { name: 'Light beam', values: {} },
    { name: 'Laser', values: { width: 14, anim: 'flash', duration: 250, opacity: 1, colorMode: 'combo' } },
    { name: 'Cross flash', values: { direction: 'cross', width: 40, duration: 380 } },
    { name: 'Edge bars', values: { direction: 'edges', width: 26, reach: 150, opacity: 0.8, duration: 1400, ease: E.OutExpo, colorMode: 'combo' } },
    { name: 'Blade slash', values: { direction: 'slash', angle: 35, width: 8, anim: 'sweep', opacity: 0.6, duration: 420, color: '#ffffff' } },
    { name: 'Reaching line', values: { direction: 'toward', aimStop: 80, width: 6, edge: 0.6, anim: 'sweep', opacity: 0.5, duration: 600, color: '#ffffff' } },
    { name: 'Wide aurora', values: { width: 220, anim: 'expand', opacity: 0.35, duration: 900, colorMode: 'random', palette: ['#7ef0c5', '#8ab8ff', '#d39bff'] } },
  ],
  generate(ctx, p) {
    const tex = ctx.tex(p.edge > 0 ? 'beam-edge-' + Math.max(1, Math.round(p.edge * 20)) : 'beam');
    const tw = 48, th = 512;
    hitPoints(ctx, p).forEach((h, i) => {
      const c = pickColor(ctx, p, h, i);
      if (p.direction === 'edges') {
        for (const top of [true, false]) {
          const s = ctx.sprite(tex, { origin: top ? 'TopCentre' : 'BottomCentre', x: h.x, y: top ? 0 : 480 });
          const t0 = h.time, t1 = t0 + p.duration, tm = t0 + p.duration * 0.3, w = p.width / tw, ly = p.reach / th;
          s.vec(t0, tm, w, 0, w, ly, p.ease); s.vec(tm, t1, w, ly, w * 0.5, 0, E.InQuad);
          s.fade(tm, t1, p.opacity, 0, E.InQuad);
          s.color(t0, t0, c);
          if (p.additive) s.additive();
        }
        return;
      }
      if (p.direction === 'toward') {
        const dx = p.aimX - h.x, dy = p.aimY - h.y, L = Math.hypot(dx, dy) - p.aimStop;
        if (L < 4) return;
        const s = ctx.sprite(tex, { origin: 'TopCentre', x: h.x, y: h.y });
        const t0 = h.time, t1 = t0 + p.duration, w = p.width / tw, ly = L / th;
        s.rotate(t0, t0, Math.atan2(-dx, dy));
        if (p.anim === 'sweep') {
          const td = t0 + Math.min(140, p.duration * 0.3);
          s.vec(t0, td, w, 0, w, ly, E.OutQuad); s.vec(td, t1, w, ly, w * 0.3, ly, p.ease);
          s.fade(td, t1, p.opacity, 0, E.InQuad);
        } else {
          if (p.anim === 'shrink') s.vec(t0, t1, w * 1.4, ly, w * 0.1, ly, p.ease);
          else if (p.anim === 'expand') s.vec(t0, t1, w * 0.3, ly, w * 1.6, ly, p.ease);
          else s.vec(t0, t0, w, ly);
          s.fade(t0, t1, p.opacity, 0, p.anim === 'flash' ? E.InQuad : E.OutQuad);
        }
        s.color(t0, t0, c);
        if (p.additive) s.additive();
        return;
      }
      const slash = p.direction === 'slash' ? (p.angle * Math.PI / 180) * (p.slashAlt && i % 2 ? -1 : 1) : 0;
      const angles = p.direction === 'slash' ? [slash] : p.direction === 'vertical' ? [0] : p.direction === 'horizontal' ? [Math.PI / 2] : p.direction === 'cross' ? [0, Math.PI / 2] : [Math.PI / 4, -Math.PI / 4];
      for (const ang of angles) {
        const len = p.direction === 'slash' ? 1150 : ang === 0 ? 480 * 1.15 : 980;
        const t0 = h.time;
        let t1 = t0 + p.duration;
        const w = p.width / tw, ly = len / th;
        if (p.anim === 'sweep') {
          const s = ctx.sprite(tex, { origin: 'TopCentre', x: h.x + Math.sin(ang) * len / 2, y: (ang === 0 && p.direction !== 'slash' ? 240 : h.y) - Math.cos(ang) * len / 2 });
          const td = t0 + Math.min(140, p.duration * 0.3);
          if (ang) s.rotate(t0, t0, ang);
          s.vec(t0, td, w, 0, w, ly, E.OutQuad); s.vec(td, t1, w, ly, w * 0.3, ly, p.ease);
          s.fade(td, t1, p.opacity, 0, E.InQuad);
          s.color(t0, t0, c);
          if (p.additive) s.additive();
          continue;
        }
        const s = ctx.sprite(tex, { x: h.x, y: ang === 0 && p.direction !== 'slash' ? 240 : h.y });
        const o = h.obj;
        if (p.ride && h.kind === 'head' && o?.kind === 'slider' && p.position === 'note' && !p.jitter) {
          const upright = ang === 0 && p.direction !== 'slash';
          rideSlider(ctx, upright ? { move: (a, b, x1, y1, x2) => s.moveX(a, b, x1, x2) } : s, o);
          t1 = Math.max(t1, o.endTime);
        }
        if (ang) s.rotate(t0, t0, ang);
        if (p.anim === 'shrink') s.vec(t0, t1, w * 1.4, ly, w * 0.1, ly, p.ease);
        else if (p.anim === 'expand') s.vec(t0, t1, w * 0.3, ly, w * 1.6, ly, p.ease);
        else s.vec(t0, t0, w, ly);
        s.fade(t0, t1, p.opacity, 0, p.anim === 'flash' ? E.InQuad : E.OutQuad);
        s.color(t0, t0, c);
        if (p.additive) s.additive();
      }
    });
  },
};

export const shapePop = {
  id: 'shapePop', name: 'Shape Pop', category: 'Hit effects', icon: '◇', accent: '#b388ff', scope: 'objects',
  description: 'Geometric outlines spin and scale out from each note. Great for electronic songs.',
  defaultLayer: 'Foreground', defaultOutput: 'diff',
  params: [
    ...targetParams(),
    { key: 'shape', label: 'Shape', type: 'select', group: 'Look', default: 'square-o',
      options: opt([['square-o', 'Square'], ['tri-o', 'Triangle'], ['hex-o', 'Hexagon'], ['circle-o', 'Circle'], ['diamond', 'Solid diamond'], ['square', 'Solid square'], ['star', 'Solid star']]) },
    { key: 'randomShape', label: 'Random shape per hit', type: 'bool', default: false, group: 'Look' },
    lineParam((p) => p.randomShape || /-o$/.test(p.shape)),
    num('from', 'Start size', 0, 3, 0.05, 0.4),
    num('to', 'End size', 0, 4, 0.05, 1.1),
    num('rotation', 'Rotation (degrees)', -720, 720, 5, 90),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.85),
    additive(false),
    num('duration', 'Duration (ms)', 80, 3000, 10, 550, 'Timing'),
    easing('ease', 'Easing', E.OutCubic),
    ...colorParams('#ffffff', 'combo'),
  ],
  presets: [
    { name: 'Spinning square', values: {} },
    { name: 'Hex pulse', values: { shape: 'hex-o', rotation: 30, from: 0.3, to: 1.4, ease: E.OutExpo } },
    { name: 'Geo chaos', values: { randomShape: true, rotation: 180, colorMode: 'random', palette: ['#ff66aa', '#66ccff', '#ffd166', '#ffffff'] } },
    { name: 'Tiny diamonds', values: { shape: 'diamond', from: 0.5, to: 0, rotation: 0, duration: 400, ease: E.InBack } },
  ],
  generate(ctx, p) {
    const shapes = ['square-o', 'tri-o', 'hex-o', 'circle-o', 'diamond'];
    hitPoints(ctx, p).forEach((h, i) => {
      const shape = p.randomShape ? ctx.rng.pick(shapes) : p.shape;
      const s = ctx.sprite(ctx.tex(lined(shape, p.lineX)), { x: h.x, y: h.y });
      const t0 = h.time, t1 = t0 + p.duration;
      s.scale(t0, t1, p.from, p.to, p.ease);
      s.fade(t0, t1, p.opacity, 0, E.InQuad);
      const r0 = ctx.rng.range(-0.3, 0.3);
      if (p.rotation) s.rotate(t0, t1, r0, r0 + p.rotation * Math.PI / 180, p.ease);
      s.color(t0, t0, pickColor(ctx, p, h, i));
      if (p.additive) s.additive();
    });
  },
};

export const hitFlash = {
  id: 'hitFlash', name: 'Screen Flash on Notes', category: 'Hit effects', icon: '⚡', accent: '#ffe066', scope: 'objects',
  description: 'The screen (or its edges) flashes on accented notes. Defaults to notes with a finish hitsound.',
  defaultLayer: 'Foreground', defaultOutput: 'diff',
  params: [
    ...targetParams({ filter: 'finish' }).filter((x) => !['position', 'posX', 'posY', 'jitter', 'sliderEnds'].includes(x.key)),
    { key: 'style', label: 'Style', type: 'select', group: 'Look', default: 'full', options: opt([['full', 'Full screen'], ['edges', 'Side edges'], ['bottom', 'Bottom glow'], ['frame', 'Top + bottom'], ['picture', 'The background picture, lit up']]) },
    num('intensity', 'Intensity', 0.05, 1, 0.05, 0.35),
    additive(),
    num('duration', 'Duration (ms)', 50, 2000, 10, 400, 'Timing'),
    easing('ease', 'Fade easing', E.OutQuad),
    ...colorParams('#ffffff', 'fixed'),
  ],
  presets: [
    { name: 'White flash', values: {} },
    { name: 'Edge glow', values: { style: 'edges', intensity: 0.7, colorMode: 'combo', filter: 'all' } },
    { name: 'Bass bottom', values: { style: 'bottom', intensity: 0.6, filter: 'finish', color: '#ff4d6d' } },
    { name: 'Picture flash', values: { style: 'picture', intensity: 0.45, filter: 'all', colorMode: 'combo', duration: 350 } },
  ],
  async generate(ctx, p) {
    const hits = hitPoints(ctx, { ...p, position: 'note', jitter: 0, sliderEnds: false });
    if (!hits.length) return;
    let parts;
    if (p.style === 'picture') {
      const img = ctx.map.events.background?.file, src = img && (await ctx.loadMapImage(img));
      if (!src) return;
      parts = [ctx.sprite(await pictureFor(ctx, img), { x: 320, y: 240 }).scale(hits[0].time, hits[0].time, Math.max(854 / src.w, 480 / src.h))];
    } else parts = edgeSprites(ctx, p.style, hits[0].time);
    const fixed = p.colorMode === 'fixed' && !p.colorVar;
    for (const s of parts) {
      if (fixed) s.color(hits[0].time, hits[0].time, pickColor(ctx, p, hits[0], 0));
      if (p.additive) s.additive();
    }
    hits.forEach((h, i) => {
      const next = hits[i + 1] ? hits[i + 1].time : Infinity;
      const t1 = Math.min(h.time + p.duration, next);
      const c = fixed ? null : pickColor(ctx, p, h, i);
      for (const s of parts) {
        s.fade(h.time, t1, p.intensity, t1 < h.time + p.duration ? p.intensity * (1 - (t1 - h.time) / p.duration) : 0, p.ease);
        if (c) s.color(h.time, h.time, c);
      }
    });
  },
};

export const sliderGlow = {
  id: 'sliderGlow', name: 'Slider Comet', category: 'Hit effects', icon: '☄', accent: '#7ef0c5', scope: 'objects',
  description: 'A glowing orb rides along every slider, leaving a fading trail behind it.',
  defaultLayer: 'Foreground', defaultOutput: 'diff',
  params: [
    num('size', 'Orb size', 0.1, 3, 0.05, 0.7),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.9),
    { key: 'texture', label: 'Orb', type: 'select', options: GLOW_TEX, default: 'glow-core', group: 'Look', showIf: (p) => !p.image },
    ...customImageParam(),
    { key: 'trail', label: 'Leave a trail', type: 'bool', default: true, group: 'Trail' },
    num('trailEvery', 'Trail spacing (ms)', 15, 200, 5, 40, 'Trail'),
    num('trailLife', 'Trail lifetime (ms)', 100, 2000, 10, 450, 'Trail'),
    num('trailSize', 'Trail size', 0.05, 2, 0.05, 0.35, 'Trail'),
    num('trailDrift', 'Trail drift (px)', 0, 60, 1, 8, 'Trail'),
    additive(),
    num('fadeOut', 'Fade after end (ms)', 0, 1000, 10, 200, 'Timing'),
    ...colorParams('#ffffff', 'combo'),
  ],
  presets: [
    { name: 'Comet', values: {} },
    { name: 'Orb only', values: { trail: false, size: 0.9 } },
    { name: 'Stardust trail', values: { texture: 'star4', trailEvery: 30, trailSize: 0.3, trailDrift: 18, colorMode: 'fixed', color: '#fff2a8' } },
  ],
  async generate(ctx, p) {
    const r = ctx.rng;
    const tex = p.image ? await shapeOrImage(ctx, p) : ctx.tex(p.texture);
    let i = 0;
    for (const o of ctx.objects) {
      if (o.kind !== 'slider' || !o.spanDuration) continue;
      const c = pickColor(ctx, p, { obj: o }, i++);
      const s = ctx.sprite(tex);
      rideSlider(ctx, s, o);
      s.fade(o.time, o.time + 60, 0, p.opacity);
      s.fade(o.endTime, o.endTime + p.fadeOut, p.opacity, 0);
      s.scale(o.endTime, o.endTime + p.fadeOut, p.size, p.size * 1.6, E.OutQuad);
      s.scale(o.time, o.time, p.size);
      s.color(o.time, o.time, c);
      if (p.additive) s.additive();
      if (p.trail) {
        for (let t = o.time; t < o.endTime; t += p.trailEvery) {
          const pos = sliderPositionAt(o, t);
          const at = ctx.pf(pos.x, pos.y);
          const tr = ctx.sprite(ctx.tex('soft-dot'), { x: at.x, y: at.y });
          const a = r() * Math.PI * 2;
          tr.move(t, t + p.trailLife, at.x, at.y, at.x + Math.cos(a) * p.trailDrift, at.y + Math.sin(a) * p.trailDrift, E.OutQuad);
          tr.scale(t, t + p.trailLife, p.trailSize, 0, E.InQuad);
          tr.fade(t, t + p.trailLife, p.opacity * 0.8, 0);
          tr.color(t, t, c);
          if (p.additive) tr.additive();
        }
      }
    }
  },
};

export default [hitGlow, ringBurst, particleBurst, sparkles, lightPillar, shapePop, hitFlash, sliderGlow];
