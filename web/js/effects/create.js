import { E, ease } from '../easing.js';
import { opt } from './common.js';
import { rng } from '../util.js';
import { getCreation, creations, characterOptions, poseOptions, poseFrames, sourceFrames } from '../creations.js';

const num = (key, label, min, max, step, def, group, extra = {}) => ({ key, label, type: 'number', min, max, step, default: def, group, ...extra });
const bool = (key, label, def, group, extra = {}) => ({ key, label, type: 'bool', default: def, group, ...extra });
const STEP = 200;

async function pictureOf(ctx, image, frameMs) {
  if (/\.(gif|webp)$/i.test(image)) return (await ctx.gifFrames?.(image)) || null;
  const m = /^(.*?)(\d+)(\.[a-z0-9]+)$/i.exec(image);
  if (m) {
    let n = 0, first = null;
    for (; n < 200; n++) { const im = await ctx.loadMapImage(m[1] + n + m[3]); if (!im) break; first ||= im; }
    if (n >= 2) return { path: m[1] + m[3], frames: n, w: first.w, h: first.h, delay: frameMs };
  }
  const im = await ctx.loadMapImage(image);
  return im ? { path: image, frames: 1, w: im.w, h: im.h, delay: frameMs } : null;
}
async function artOf(ctx, p) {
  const own = p.image ? await pictureOf(ctx, p.image, p.frameMs) : null;
  if (!own) return null;
  return { go: own, rest: p.restImage && p.move === 'wander' ? await pictureOf(ctx, p.restImage, p.frameMs) : null };
}

export const character = {
  id: 'character', retired: true, name: 'Character (older kind)', category: 'Create', icon: '✿', accent: '#ff9ec7', scope: 'range',
  description: 'A picture from the map folder that wanders, bobs and moves with the beat. Newer: bring the picture into the Create tab and use My Character.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    { key: 'image', label: 'Picture (or one of its frames)', type: 'image', default: '', none: 'Not chosen yet', group: 'Art', gif: true,
      help: 'A see-through .png, or an animated .gif or .webp (the app turns it into frames). For an animation made of single pictures, name them name0.png, name1.png, name2.png ... (starting at 0) and pick any one of them.' },
    { key: 'restImage', label: 'Picture while it rests', type: 'image', default: '', none: 'The same as while moving', group: 'Art', gif: true, showIf: (p) => p.move === 'wander',
      help: 'For example a sitting or sleeping pose: it is shown whenever the character stops between two moves.' },
    num('restHeight', 'Height while resting (px, 0 = same scale)', 0, 480, 1, 0, 'Art', { showIf: (p) => p.move === 'wander' && !!p.restImage, help: '0 keeps the resting picture at the same scale as the moving one, which is right when both come from the same set.' }),
    num('frameMs', 'Time per frame (ms)', 20, 2000, 5, 110, 'Art', { help: 'For art made of numbered frames. An animated .gif keeps its own speed.' }),
    num('height', 'Height on screen (px)', 6, 480, 1, 60, 'Art'),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 1, 'Art'),
    { key: 'tint', label: 'Tint', type: 'color', default: '#ffffff', group: 'Art' },
    bool('additive', 'Additive (glowy) blending', false, 'Art'),

    { key: 'move', label: 'What it does', type: 'select', group: 'Movement', default: 'wander', options: opt([['wander', 'Wanders around inside a circle'], ['stay', 'Stays where it is']]) },
    num('x', 'Home X', -107, 747, 1, 320, 'Movement'),
    num('y', 'Home Y', 0, 480, 1, 240, 'Movement'),
    num('area', 'Circle radius (px)', 0, 500, 1, 50, 'Movement', { showIf: (p) => p.move === 'wander', help: 'It never leaves this circle around its home.' }),
    num('speed', 'Speed (px/s)', 1, 400, 1, 14, 'Movement', { showIf: (p) => p.move === 'wander' }),
    num('rest', 'Rests between moves (ms)', 0, 10000, 50, 700, 'Movement', { showIf: (p) => p.move === 'wander' }),
    bool('face', 'Turns to face the way it goes', false, 'Movement', { showIf: (p) => p.move === 'wander', help: 'For art that looks to the right as drawn: it is mirrored while moving left.' }),
    num('tilt', 'Leans into the movement (degrees)', 0, 45, 1, 8, 'Movement', { showIf: (p) => p.move === 'wander' }),
    num('bob', 'Bobs up and down (px)', 0, 40, 0.5, 3, 'Movement'),
    num('bobMs', 'One bob takes (ms)', 300, 8000, 50, 2400, 'Movement', { showIf: (p) => p.bob > 0 }),

    num('squash', 'Squash on the beat', 0, 0.5, 0.01, 0, 'Reactions', { help: 'It gets a little wider and shorter on the beat and springs back.' }),
    { key: 'squashEvery', label: 'Every', type: 'select', group: 'Reactions', default: '2', showIf: (p) => p.squash > 0, options: opt([['1', '1 beat'], ['2', '2 beats'], ['4', 'Every bar (4)']]) },

    num('fadeIn', 'Fade in (ms)', 0, 5000, 50, 800, 'Timing'),
    num('fadeOut', 'Fade out (ms)', 0, 5000, 50, 800, 'Timing'),
  ],
  presets: [
    { name: 'Wandering', values: { height: 70, speed: 18, bob: 2, face: true, squash: 0.04 } },
    { name: 'In the corner', values: { move: 'stay', x: 610, y: 395, height: 120, bob: 4, squash: 0.06, squashEvery: '1' } },
  ],
  async generate(ctx, p) {
    const S0 = ctx.start, S1 = ctx.end;
    if (S1 - S0 < 300) return;
    const art = await artOf(ctx, p);
    if (!art) return;
    const r = ctx.rng, k = p.height / art.go.h;

    const legs = [];
    let px = p.x, py = p.y;
    if (p.move === 'wander' && p.area > 0) {
      const spot = () => { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * p.area; return [p.x + Math.cos(a) * d, p.y + Math.sin(a) * d]; };
      [px, py] = spot();
      for (let t = S0 + r.range(0, p.rest); t < S1;) {
        const [nx, ny] = spot(), dist = Math.hypot(nx - px, ny - py);
        if (dist < 4) continue;
        const dur = Math.max(400, (dist / p.speed) * 1000);
        legs.push({ t0: t, t1: t + dur, x0: px, y0: py, x1: nx, y1: ny, lean: ((nx - px) / dist) * (p.tilt || 0) * Math.PI / 180 });
        px = nx; py = ny; t += dur + p.rest * r.range(0.5, 1.5);
      }
    }
    const at = (t) => {
      let x = legs.length ? legs[0].x0 : p.x, y = legs.length ? legs[0].y0 : p.y;
      for (const l of legs) {
        if (t < l.t0) break;
        const u = ease(E.InOutSine, Math.min(1, (t - l.t0) / (l.t1 - l.t0)));
        x = l.x0 + (l.x1 - l.x0) * u; y = l.y0 + (l.y1 - l.y0) * u;
      }
      if (p.bob > 0) y += Math.sin(((t - S0) / p.bobMs) * Math.PI * 2) * p.bob;
      return [x, y];
    };

    const turning = p.face && legs.length > 0;
    const kRest = art.rest ? (p.restHeight > 0 ? p.restHeight / art.rest.h : k) : k;
    const sprites = [];
    const add = (a, scale, flip) => {
      const s = ctx.sprite(a.path, { x: at(S0)[0], y: at(S0)[1] });
      if (flip) s.flipH();
      if (a.frames > 1) s.animate(a.frames, a.delay);
      sprites.push({ s, k: scale });
      return sprites.length - 1;
    };
    const GO = [add(art.go, k, false)]; GO[1] = turning ? add(art.go, k, true) : GO[0];
    const REST = art.rest && legs.length ? [add(art.rest, kRest, false)] : GO.slice();
    if (art.rest && legs.length) REST[1] = turning ? add(art.rest, kRest, true) : REST[0];
    const [fi, fo] = [Math.min(p.fadeIn, (S1 - S0) / 2), Math.min(p.fadeOut, (S1 - S0) / 2)];
    for (const { s } of sprites) {
      s.color(S0, S0, p.tint);
      if (p.additive) s.additive();
      const moving = legs.length > 0 || p.bob > 0;
      if (!moving) continue;
      let [ax, ay] = at(S0);
      for (let t = S0; t < S1; t += STEP) {
        const tb = Math.min(S1, t + STEP), [bx, by] = at(tb);
        if (legs.length) s.moveX(t, tb, ax, bx);
        s.moveY(t, tb, ay, by);
        ax = bx; ay = by;
      }
      for (const l of legs) {
        if (!p.tilt || l.t0 >= S1) break;
        const d = Math.min(700, (l.t1 - l.t0) / 2);
        s.rotate(l.t0, l.t0 + d, 0, l.lean, E.InOutSine);
        s.rotate(l.t1 - d, l.t1, l.lean, 0, E.InOutSine);
      }
    }
    const beats = p.squash > 0 ? ctx.map.beats(S0, S1, 1).filter((b) => Math.round(b.beat) % parseInt(p.squashEvery || '2', 10) === 0) : [];
    for (const { s, k: sk } of sprites) {
      if (!beats.length) { s.scale(S0, S0, sk); continue; }
      s.vec(S0, S0, sk, sk);
      beats.forEach((b, i) => {
        const next = Math.min(S1, beats[i + 1]?.time ?? S1, b.time + ctx.map.beatLengthAt(b.time) * 1.5);
        if (next - b.time > 40) s.vec(b.time, next, sk * (1 + p.squash), sk * (1 - p.squash), sk, sk, E.OutQuad);
      });
    }
    const op = p.opacity;
    let side = legs.length && legs[0].x1 < legs[0].x0 ? 1 : 0;
    const changes = [];
    for (const l of legs) {
      if (Math.abs(l.x1 - l.x0) >= 3) side = l.x1 < l.x0 ? 1 : 0;
      changes.push([l.t0, GO[side]], [l.t1, REST[side]]);
    }
    let cur = legs.length ? (legs[0].t0 <= S0 + fi + 10 ? GO : REST)[legs[0].x1 < legs[0].x0 ? 1 : 0] : GO[0];
    sprites.forEach(({ s }, i) => { if (i === cur) { if (fi >= 1) s.fade(S0, S0 + fi, 0, op, E.OutQuad); else s.fade(S0, S0, op); } else s.fade(S0, S0, 0); });
    const SWAP = 120;
    for (const [t, want] of changes) {
      if (want === cur || t < S0 + fi + 10 || t + SWAP > S1 - fo - 10) continue;
      sprites[cur].s.fade(t, t + SWAP, op, 0); sprites[want].s.fade(t, t + SWAP, 0, op);
      cur = want;
    }
    if (fo >= 1) sprites[cur].s.fade(S1 - fo, S1, op, 0, E.InQuad);
  },
};

const NO_CHAR = [['', '(nothing in the Create tab yet)']], NO_POSE = [['', '(the whole picture)']], SAME_POSE = [['', '(the same pose)']];
const orElse = (list, none) => (list.length ? list : none);
const drifts = (q) => q.move === 'drift' && q.area > 0;
const walks = (q) => q.move === 'wander' || q.move === 'walk';

function walkLegs(q, a, z, from) {
  const legs = [], speed = Math.max(1, q.speed || 40);
  let [px, py] = from || [q.x, q.y];
  if (q.move === 'walk') {
    const nx = q.toX ?? q.x, ny = q.toY ?? q.y, dist = Math.hypot(nx - px, ny - py);
    if (dist >= 1) legs.push({ t0: a, t1: Math.min(z, a + Math.max(200, (dist / speed) * 1000)), x0: px, y0: py, x1: nx, y1: ny });
    return legs;
  }
  if (!(q.area > 0)) return legs;
  const r = rng(104729 + Math.round(q.path || 1) * 31 + Math.round(a)), rest = Math.max(0, q.rest ?? 900);
  const spot = () => { const an = r() * Math.PI * 2, d = Math.sqrt(r()) * q.area; return [q.x + Math.cos(an) * d, q.y + Math.sin(an) * d]; };
  for (let t = a + r.range(0, rest * 0.5), guard = 0; t < z && guard < 2000; guard++) {
    const [nx, ny] = spot(), dist = Math.hypot(nx - px, ny - py);
    if (dist < 6) continue;
    const dur = Math.max(300, (dist / speed) * 1000);
    legs.push({ t0: t, t1: t + dur, x0: px, y0: py, x1: nx, y1: ny });
    px = nx; py = ny; t += dur + rest * r.range(0.6, 1.4);
  }
  return legs;
}
function driftPath(p, S0, S1, blocks) {
  const r = rng(7919 + Math.round(p.path || 0) * 31), ph = [r(), r(), r(), r()].map((v) => v * Math.PI * 2), W = Math.PI * 2;
  const loop = (u) => [0.65 * Math.sin(u * W + ph[0]) + 0.35 * Math.sin(u * W * 2.3 + ph[1]), 0.65 * Math.sin(u * W * 0.8 + ph[2]) + 0.35 * Math.sin(u * W * 1.9 + ph[3])];
  const same = (q) => (q.character || '') === (p.character || '') && Math.round(q.path || 1) === Math.round(p.path || 1);
  const chain = (blocks || []).filter((b) => same(b.params) && b.end <= S0 + 1 && b.end > b.start).sort((a, b) => a.start - b.start);
  let u0 = 0, last = null, lastEnd = -Infinity;
  const path = (q, a, z, from) => {
    if (walks(q)) {
      const legs = walkLegs(q, a, z, from), home = from || [q.x, q.y];
      const at = (t) => {
        let x = home[0], y = home[1];
        for (const l of legs) {
          if (t < l.t0) break;
          const u = ease(E.InOutSine, Math.min(1, (t - l.t0) / (l.t1 - l.t0)));
          x = l.x0 + (l.x1 - l.x0) * u; y = l.y0 + (l.y1 - l.y0) * u;
        }
        return [x, y];
      };
      at.legs = legs;
      return at;
    }
    const start = u0, per = Math.max(2, q.period) * 1000, glide = Math.min(1800, z - a);
    const own = (t) => {
      if (q.move === 'hold' && from) return from;
      if (!drifts(q)) return [q.x, q.y];
      const [fx, fy] = loop(start + (t - a) / per);
      return [q.x + q.area * 0.7 * fx, q.y + q.area * 0.7 * fy];
    };
    if (drifts(q)) u0 += (z - a) / per;
    if (!from || q.move === 'hold') return own;
    return (t) => {
      const k = Math.min(1, Math.max(0, (t - a) / glide)), e = k * k * (3 - 2 * k), [x, y] = own(t);
      return [from[0] + (x - from[0]) * e, from[1] + (y - from[1]) * e];
    };
  };
  for (const b of chain) {
    const at = path(b.params, b.start, b.end, b.start - lastEnd < 80 ? last : null);
    last = at(b.end); lastEnd = b.end;
  }
  return path(p, S0, S1, S0 - lastEnd < 80 ? last : null);
}

export const actor = {
  id: 'actor', name: 'My Character', category: 'Create', icon: '☻', accent: '#ffb86b', scope: 'range',
  description: 'A picture you brought into the Create tab, as a character on the stage: it drifts, walks about, walks to a point or stands, and can move with the beat. Put one block per pose on the timeline: sitting here, getting up there, walking after that.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  label(p) {
    const who = getCreation(p.character) || creations()[0], pose = who?.poses.find((x) => x.id === p.pose) || who?.poses[0];
    return who ? (pose ? `${who.name} · ${pose.name}` : who.name) : 'My Character (nothing in the Create tab yet)';
  },
  params: [
    { key: 'character', label: 'Character', type: 'select', group: 'Character', default: '', options: () => orElse(characterOptions(), NO_CHAR),
      help: 'Characters are made in the Create tab (top of the window).' },
    { key: 'pose', label: 'Pose', type: 'select', group: 'Character', default: '', options: (p) => orElse(poseOptions(p.character || creations()[0]?.id), NO_POSE),
      help: 'A pose that plays once starts when this block starts and then holds its last frame until the block ends. Without any pose the whole picture is shown.' },
    num('height', 'Height on screen (px)', 6, 480, 1, 70, 'Character', { help: 'Of the whole picture, empty space around the figure included.' }),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 1, 'Character'),
    bool('flip', 'Mirrored', false, 'Character'),
    bool('syncAnim', 'Animation in step with its other copies', false, 'Character', { help: 'Every copy with this switched on shows the same frame at the same time, whenever it comes in.' }),
    { key: 'tint', label: 'Tint', type: 'color', default: '#ffffff', group: 'Character' },

    { key: 'move', label: 'What it does', type: 'select', group: 'Movement', default: 'drift', options: opt([['drift', 'Drifts around inside a circle'], ['wander', 'Walks from spot to spot, resting in between'], ['walk', 'Walks to a point and stays there'], ['stay', 'Stays at its home'], ['hold', 'Stays where the block before left it']]) },
    num('x', 'Home X', -107, 747, 1, 320, 'Movement', { showIf: (p) => p.move !== 'hold', help: 'A walk starts where the block before left it; without one, here.' }),
    num('y', 'Home Y', 0, 480, 1, 240, 'Movement', { showIf: (p) => p.move !== 'hold' }),
    num('toX', 'Walks to X', -160, 800, 1, 440, 'Movement', { showIf: (p) => p.move === 'walk', help: 'A point outside the screen (below -107 or above 747) lets it walk off.' }),
    num('toY', 'Walks to Y', -60, 540, 1, 240, 'Movement', { showIf: (p) => p.move === 'walk' }),
    num('area', 'Circle radius (px)', 0, 500, 1, 35, 'Movement', { showIf: (p) => p.move === 'drift' || p.move === 'wander' }),
    num('period', 'One round takes about (s)', 2, 120, 1, 16, 'Movement', { showIf: (p) => p.move === 'drift' }),
    num('speed', 'Walking speed (px/s)', 2, 600, 1, 40, 'Movement', { showIf: walks }),
    num('rest', 'Rests between walks (ms)', 0, 20000, 50, 900, 'Movement', { showIf: (p) => p.move === 'wander' }),
    { key: 'restPose', label: 'Pose while it is not walking', type: 'select', group: 'Movement', default: '', showIf: walks, options: (p) => [...SAME_POSE, ...poseOptions(p.character || creations()[0]?.id)],
      help: 'For example: the pose above is a walk, this one is standing or sitting. It is shown between two walks and after it has arrived.' },
    bool('face', 'Turns to face the way it walks', true, 'Movement', { showIf: walks, help: 'For art that looks to the right as drawn: it is mirrored while going left. If yours looks to the left, switch on Mirrored as well.' }),
    num('path', 'Path number', 1, 99, 1, 1, 'Movement', { help: 'Blocks of the same character with the same path number carry on where the one before stopped, so one pose hands over to the next without a jump, even when the speed or the circle changes. Give a second copy of the character another number.' }),

    num('bob', 'Bobs up and down (px)', 0, 40, 0.5, 0, 'Reactions'),
    num('bobMs', 'One bob takes (ms)', 300, 8000, 50, 2400, 'Reactions', { showIf: (p) => p.bob > 0 }),
    num('squash', 'Squash on the beat', 0, 0.5, 0.01, 0, 'Reactions', { help: 'It gets a little wider and shorter on the beat and springs back.' }),
    { key: 'squashEvery', label: 'Every', type: 'select', group: 'Reactions', default: '1', showIf: (p) => p.squash > 0, options: opt([['1', '1 beat'], ['2', '2 beats'], ['4', 'Every bar (4)']]) },

    num('fadeIn', 'Fade in (ms)', 0, 5000, 50, 0, 'Timing', { help: 'Leave at 0 where this block takes over from another pose.' }),
    num('fadeOut', 'Fade out (ms)', 0, 5000, 50, 0, 'Timing'),
  ],
  presets: [
    { name: 'Drifting', values: {} },
    { name: 'Walking about', values: { move: 'wander', area: 120 } },
    { name: 'Walks to a point', values: { move: 'walk' } },
    { name: 'Standing still', values: { move: 'stay' } },
    { name: 'Moving with the beat', values: { move: 'stay', squash: 0.08, bob: 2 } },
  ],
  async generate(ctx, p) {
    const S0 = ctx.start, S1 = ctx.end;
    if (S1 - S0 < 20) return;
    const who = getCreation(p.character) || creations()[0] || null;
    if (!who) return;
    const poseOf = (id) => who.poses.find((x) => x.id === id) || null;
    const lookOf = async (pose) => {
      if (pose) return poseFrames(who, pose);
      const src = who.sources?.[0], s = src ? await sourceFrames(who, src) : null;
      return s ? poseFrames(who, { frames: s.frames.map((_, i) => [src, i]), play: 'loop', ms: 0 }) : null;
    };
    const look = await lookOf(poseOf(p.pose) || who.poses[0] || null);
    if (!look) return;
    const k = p.height / look.frames[0].h, base = driftPath(p, S0, S1, ctx.siblings), legs = base.legs || [];
    const bob = p.bob > 0 ? (t) => Math.sin((t / Math.max(300, p.bobMs)) * Math.PI * 2) * p.bob : null;
    const at = bob ? (t) => { const [x, y] = base(t); return [x, y + bob(t)]; } : base;
    const [x00, y00] = at(S0);
    let moving = false;
    for (let t = S0; t <= S1 && !moving; t += STEP) { const [x, y] = at(Math.min(t, S1)); moving = Math.abs(x - x00) > 0.05 || Math.abs(y - y00) > 0.05; }
    const fi = Math.min(p.fadeIn, (S1 - S0) / 2), fo = Math.min(p.fadeOut, (S1 - S0) / 2), op = p.opacity;
    const env = (t) => op * Math.min(1, fi > 0 ? (t - S0) / fi : 1, fo > 0 ? (S1 - t) / fo : 1);
    const beats = p.squash > 0 ? ctx.map.beats(S0, S1, 1).filter((b) => Math.round(b.beat) % parseInt(p.squashEvery || '1', 10) === 0) : [];
    const size = (s, a, b) => {
      const mine = beats.filter((bt) => bt.time >= a - 1 && bt.time < b - 40);
      if (!mine.length) { s.scale(a, a, k); return; }
      s.vec(a, a, k, k);
      mine.forEach((bt, i) => {
        const next = Math.min(b, mine[i + 1]?.time ?? b, bt.time + ctx.map.beatLengthAt(bt.time) * 1.5);
        if (next - bt.time > 40) s.vec(bt.time, next, k * (1 + p.squash), k * (1 - p.squash), k, k, E.OutQuad);
      });
    };
    const follow = (s, a, b) => {
      if (!moving) return;
      let ta = a, [ax, ay] = at(a), placed = false;
      while (ta < b) {
        const tb = Math.min(b, (Math.floor(ta / STEP) + 1) * STEP), [bx, by] = at(tb);
        if (!legs.length || Math.abs(bx - ax) > 0.02 || Math.abs(by - ay) > 0.02) { s.moveX(ta, tb, ax, bx); s.moveY(ta, tb, ay, by); placed = true; }
        else if (!placed) { s.moveX(ta, ta, ax); s.moveY(ta, ta, ay); placed = true; }
        ta = tb; ax = bx; ay = by;
      }
    };
    const put = (path, a, b, anim, mirrored, during = [[a, b]]) => {
      const [x0, y0] = at(during[0][0]), s = ctx.sprite(path, { x: x0, y: y0 });
      if (anim) s.animate(anim.frames, anim.delay);
      if (mirrored) s.flipH();
      size(s, a, b); s.color(a, a, p.tint);
      for (const [from, to] of during) follow(s, from, to);
      return s;
    };
    const fadeWith = (s, a, b) => {
      const cuts = [a, ...[S0 + fi, S1 - fo].filter((t) => t > a + 1 && t < b - 1), b];
      for (let i = 0; i + 1 < cuts.length; i++) s.fade(cuts[i], cuts[i + 1], Math.max(0, env(cuts[i])), Math.max(0, env(cuts[i + 1])));
    };
    const still = (l) => l.loop || l.frames.length === 1;

    if (!still(look)) {
      let t = S0;
      look.frames.forEach((f, i) => {
        if (t >= S1) return;
        const b = i === look.frames.length - 1 ? S1 : Math.min(S1, t + f.ms);
        fadeWith(put(f.path, t, b, null, p.flip), t, b);
        t = b;
      });
      return;
    }
    const pathOf = (l) => (l.anim ? l.anim.path : l.frames[0].path);
    if (!legs.length) { fadeWith(put(pathOf(look), S0, S1, look.anim, p.flip), S0, S1); return; }

    let rest = p.restPose && p.restPose !== (poseOf(p.pose) || who.poses[0])?.id ? await lookOf(poseOf(p.restPose)) : null;
    if (rest && !still(rest)) rest = { ...rest, anim: null };
    const kinds = [];
    const add = (l, mirrored) => { kinds.push({ l, mirrored }); return kinds.length - 1; };
    const GO = [add(look, p.flip)]; GO[1] = p.face ? add(look, !p.flip) : GO[0];
    const REST = rest ? [add(rest, p.flip)] : GO.slice();
    if (rest) REST[1] = p.face ? add(rest, !p.flip) : REST[0];
    let side = legs[0].x1 < legs[0].x0 ? 1 : 0;
    const changes = [];
    for (const l of legs) {
      if (Math.abs(l.x1 - l.x0) >= 3) side = l.x1 < l.x0 ? 1 : 0;
      changes.push([l.t0, GO[side]], [l.t1, REST[side]]);
    }
    let cur = (legs[0].t0 <= S0 + 10 ? GO : REST)[legs[0].x1 < legs[0].x0 ? 1 : 0], since = S0;
    const shown = kinds.map(() => []);
    for (const [t, want] of changes) {
      if (t >= S1 - 1) break;
      if (want === cur) continue;
      if (t <= since + 1) { cur = want; continue; }
      shown[cur].push([since, t]); cur = want; since = t;
    }
    shown[cur].push([since, S1]);
    kinds.forEach(({ l, mirrored }, i) => {
      if (!shown[i].length) return;
      const from = shown[i][0][0], to = shown[i][shown[i].length - 1][1];
      const s = put(pathOf(l), from, to, l.anim, mirrored, shown[i]);
      shown[i].forEach(([a, b], n) => {
        fadeWith(s, a, b);
        if (shown[i][n + 1]) s.fade(b, shown[i][n + 1][0], 0);
      });
    });
  },
};

export default [character, actor];
