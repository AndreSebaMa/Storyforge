import { E, EASING_OPTIONS, ease } from '../easing.js';
import { colorParams, fadeParams, pickColor, opt, SB, fitDurations, customImageParam, shapeOrImage, pictureFor, lined, lineParam, clearParams, insideCircle, bounceLegs } from './common.js';
import { edgeSprites } from './hit.js';
import { spectrum } from '../audio.js';
import { lerp, hexToRgb } from '../util.js';

const num = (key, label, min, max, step, def, group = 'Look', extra = {}) => ({ key, label, type: 'number', min, max, step, default: def, group, ...extra });
const easing = (key, label, def, group = 'Timing') => ({ key, label, type: 'easing', default: def, group, options: EASING_OPTIONS });
const bool = (key, label, def, group = 'Look', extra = {}) => ({ key, label, type: 'bool', default: def, group, ...extra });

const fadeCurveParam = () => ({ key: 'fadeCurve', label: 'Fade style', type: 'select', group: 'Timing', default: 'soft',
  options: opt([['soft', 'Soft'], ['even', 'Even (linear)'], ['late', 'Late: holds, then snaps']]) });
const fadeEases = (p) => (p.fadeCurve === 'late' ? [E.InExpo, E.InExpo] : p.evenFade || p.fadeCurve === 'even' ? [E.Linear, E.Linear] : [E.OutQuad, E.InQuad]);

function rangeFade(s, ctx, p, opacity) {
  const [fi, fo] = fitDurations(ctx.end - ctx.start, p.fadeIn || 0, p.fadeOut || 0);
  const [ein, eout] = fadeEases(p);
  if (fi > 0) s.fade(ctx.start, ctx.start + fi, 0, opacity, ein); else s.fade(ctx.start, ctx.start, opacity);
  if (fo > 0) s.fade(ctx.end - fo, ctx.end, opacity, 0, eout); else s.fade(ctx.end, ctx.end, opacity);
}

export const background = {
  id: 'background', name: 'Background', category: 'Background & ambience', icon: '▣', accent: '#8ab8ff', scope: 'range',
  description: "Show the map background (or any image) with dim, blur, slow zoom and beat pulse. Also hides osu!'s default background.",
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    { key: 'image', label: 'Image', type: 'image', default: '', group: 'Image', help: 'Leave on "Map background" to use the beatmap background.' },
    num('dim', 'Dim', 0, 0.95, 0.05, 0.3, 'Image'),
    num('blur', 'Blur (px)', 0, 40, 1, 0, 'Image'),
    num('cutR', 'Only a circle of the picture (radius px, 0 = all of it)', 0, 400, 1, 0, 'Image', { help: 'Just this round piece of the picture is shown. Lay it over the full picture and treat or animate it on its own: brighter, in colour, pulsing.' }),
    num('cutX', 'Circle X', -107, 747, 1, 320, 'Image', { showIf: (p) => p.cutR > 0 }),
    num('cutY', 'Circle Y', 0, 480, 1, 240, 'Image', { showIf: (p) => p.cutR > 0 }),
    num('cutSoft', 'Soft edge (px)', 0, 200, 1, 4, 'Image', { showIf: (p) => p.cutR > 0 }),
    num('grey', 'Black & white', 0, 1, 0.05, 0, 'Image', { help: '1 = fully black & white, made from the same picture. Lay it over the colour picture and fade or pulse it.' }),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 1, 'Image'),
    { key: 'opPulse', label: 'Comes and goes', type: 'select', group: 'Image', default: 'none',
      options: opt([['none', 'No, it stays'], ['pulse', 'Appears on the beat, fades away'], ['breathe', 'Fades in and out smoothly']]),
      help: 'For a blurred or black & white copy laid over the picture: the picture pulses between the two looks.' },
    num('opBeats', 'Every (beats)', 0.5, 64, 0.5, 4, 'Image', { showIf: (p) => p.opPulse && p.opPulse !== 'none' }),
    num('opMin', 'Lowest opacity', 0, 1, 0.05, 0, 'Image', { showIf: (p) => p.opPulse && p.opPulse !== 'none' }),
    bool('hideDefault', "Black wherever this effect is not (hides osu!'s own background for the whole map)", false, 'Image'),
    num('zoomFrom', 'Zoom at start', 0.8, 2, 0.01, 1.0, 'Motion'),
    num('zoomTo', 'Zoom at end', 0.8, 2, 0.01, 1.06, 'Motion'),
    easing('zoomEase', 'Zoom easing', E.InOutSine, 'Motion'),
    num('pan', 'Horizontal pan (px)', -200, 200, 1, 0, 'Motion'),
    num('pulse', 'Beat pulse (zoom bump)', 0, 0.1, 0.005, 0, 'Motion'),
    num('pulseEvery', 'Pulse every N beats', 1, 8, 1, 1, 'Motion'),
    { key: 'shake', label: 'Shake on', type: 'select', group: 'Motion', default: 'none',
      options: opt([['none', 'Nothing'], ['finish', 'Finish hitsounds'], ['clap', 'Clap hitsounds']]) },
    num('shakeAmount', 'Shake strength (px)', 1, 30, 1, 7, 'Motion', { showIf: (p) => p.shake !== 'none' }),
    { key: 'enter', label: 'Entrance', type: 'select', group: 'Motion', default: 'none', options: opt([['none', 'None'], ['zoomspin', 'Zoom & turn in']]) },
    num('enterMs', 'Entrance length (ms)', 100, 5000, 10, 1000, 'Motion', { showIf: (p) => p.enter !== 'none' }),
    num('enterTurn', 'Entrance turn (degrees)', -30, 30, 0.5, -4, 'Motion', { showIf: (p) => p.enter !== 'none' }),
    num('enterZoom', 'Entrance starts at (×)', 1, 3, 0.005, 1.3, 'Motion', { showIf: (p) => p.enter !== 'none' }),
    num('breathe', 'Breathing zoom', 0, 0.2, 0.005, 0, 'Motion', { help: 'The picture slowly swells and settles back, over and over.' }),
    num('breatheBeats', 'Breath length (beats)', 1, 32, 1, 4, 'Motion', { showIf: (p) => p.breathe > 0 }),
    bool('breatheDeep', 'Every second breath deeper, in two steps', false, 'Motion', { showIf: (p) => p.breathe > 0 }),
    num('jitter', 'Jitter (px)', 0, 30, 0.5, 0, 'Motion', { help: 'Constant nervous shaking, good on a blurred copy laid over the picture.' }),
    num('jitterMs', 'Jitter step (ms)', 30, 500, 10, 100, 'Motion', { showIf: (p) => p.jitter > 0 }),
    num('wander', 'Wander (px)', 0, 60, 1, 0, 'Motion', { help: 'Glides to a new random spot every few beats, like a hand-held camera.' }),
    num('wanderBeats', 'Wander every (beats)', 1, 32, 1, 4, 'Motion', { showIf: (p) => p.wander > 0 }),
    { key: 'tintMode', label: 'Colour tint', type: 'select', group: 'Colour', default: 'none',
      options: opt([['none', 'None'], ['fixed', 'One colour'], ['breathe', 'Breathe between two colours'], ['pulse', 'Pulse on the beat']]) },
    { key: 'tint', label: 'Tint', type: 'color', default: '#ffffff', group: 'Colour', showIf: (p) => p.tintMode !== 'none' },
    { key: 'tintTo', label: 'Second tint', type: 'color', default: '#8fb0ff', group: 'Colour', showIf: (p) => p.tintMode === 'breathe' || p.tintMode === 'pulse' },
    num('tintBeats', 'Every (beats)', 0.5, 64, 0.5, 12, 'Colour', { showIf: (p) => p.tintMode === 'breathe' || p.tintMode === 'pulse' }),
    ...fadeParams(800, 800).map((d) => ({ ...d, max: 60000 })),
    bool('evenFade', 'Even (linear) fades', false, 'Timing', { help: 'Best for crossfading between two pictures, e.g. black & white into colour.' }),
    fadeCurveParam(),
  ],
  presets: [
    { name: 'Slow zoom', values: {} },
    { name: 'Picture swap', values: { dim: 0, zoomFrom: 1, zoomTo: 1, fadeIn: 80, fadeOut: 80, evenFade: true } },
    { name: 'Slow crossfade', values: { dim: 0, zoomFrom: 1, zoomTo: 1, fadeIn: 12000, fadeOut: 0, evenFade: true } },
    { name: 'Impact shake', values: { shake: 'finish', shakeAmount: 8, zoomTo: 1.03 } },
    { name: 'Dim & still', values: { dim: 0.55, zoomFrom: 1, zoomTo: 1 } },
    { name: 'Dreamy blur', values: { blur: 14, dim: 0.35, zoomFrom: 1.05, zoomTo: 1.12 } },
    { name: 'Beat pulse', values: { pulse: 0.025, zoomTo: 1.02 } },
    { name: 'Ken Burns pan', values: { zoomFrom: 1.15, zoomTo: 1.15, pan: 90 } },
    { name: 'Still picture', values: { dim: 0, zoomFrom: 1, zoomTo: 1, fadeIn: 0, fadeOut: 0 } },
    { name: 'Breathing', values: { dim: 0, zoomFrom: 1, zoomTo: 1, breathe: 0.03, breatheBeats: 4, fadeIn: 0, fadeOut: 0 } },
    { name: 'Spin-in & breathe', values: { dim: 0, zoomFrom: 1, zoomTo: 1, enter: 'zoomspin', breathe: 0.03, breatheBeats: 4, breatheDeep: true, fadeIn: 0, fadeOut: 0 } },
    { name: 'Nervous overlay', values: { dim: 0, opacity: 0.7, zoomFrom: 1.015, zoomTo: 1.015, jitter: 6, jitterMs: 90, fadeIn: 0, fadeOut: 0, hideDefault: false } },
    { name: 'Hand-held', values: { dim: 0, zoomFrom: 1, zoomTo: 1, wander: 15, wanderBeats: 4, fadeIn: 0, fadeOut: 0 } },
    { name: 'Round cut-out', values: { cutR: 90, cutSoft: 6, dim: 0, zoomFrom: 1, zoomTo: 1, fadeIn: 0, fadeOut: 0, hideDefault: false } },
    { name: 'Black & white', values: { grey: 1, dim: 0, zoomFrom: 1, zoomTo: 1, fadeIn: 0, fadeOut: 0, hideDefault: false } },
    { name: 'Grey to colour', values: { grey: 1, dim: 0, zoomFrom: 1, zoomTo: 1, fadeIn: 0, fadeOut: 60000, evenFade: true, hideDefault: false } },
    { name: 'Colour to grey', values: { grey: 1, dim: 0, zoomFrom: 1, zoomTo: 1, fadeIn: 60000, fadeOut: 0, evenFade: true, hideDefault: false } },
    { name: 'Grey pulse', values: { grey: 1, dim: 0, zoomFrom: 1, zoomTo: 1, opPulse: 'pulse', opBeats: 4, fadeIn: 0, fadeOut: 0, hideDefault: false } },
    { name: 'Blur pulse', values: { blur: 12, dim: 0, zoomFrom: 1.02, zoomTo: 1.02, opPulse: 'pulse', opBeats: 4, fadeIn: 0, fadeOut: 0, hideDefault: false } },
    { name: 'Blur breathing', values: { blur: 12, dim: 0, zoomFrom: 1.02, zoomTo: 1.02, opPulse: 'breathe', opBeats: 8, fadeIn: 0, fadeOut: 0, hideDefault: false } },
    { name: 'Dim pulse', values: { dim: 0, zoomFrom: 1, zoomTo: 1, tintMode: 'pulse', tint: '#6e6e6e', tintTo: '#ffffff', tintBeats: 4, fadeIn: 0, fadeOut: 0 } },
    { name: 'Always moving', values: { dim: 0.15, zoomFrom: 1.04, zoomTo: 1.04, wander: 10, wanderBeats: 8, fadeIn: 0, fadeOut: 0 } },
    { name: 'Colour breathing', values: { dim: 0, zoomFrom: 1, zoomTo: 1, tintMode: 'breathe', tint: '#8fb8ff', tintTo: '#6f8cff', tintBeats: 8, fadeIn: 0, fadeOut: 0 } },
  ],
  async generate(ctx, p) {
    const img = p.image || ctx.map.events.background?.file;
    if (!img) return;
    const src = await ctx.loadMapImage(img);
    if (!src) return;
    let path = img, w = src.w, h = src.h;
    if (p.grey > 0 || p.cutR > 0) {
      const made = await ctx.treatedImage(img, { blur: p.blur, grey: p.grey, cut: p.cutR > 0 ? { x: p.cutX ?? 320, y: p.cutY ?? 240, r: p.cutR, soft: p.cutSoft ?? 0 } : null });
      if (made) { path = made; const e = ctx.asset(path); w = e.w; h = e.h; }
    } else if (p.blur > 0) {
      path = await ctx.blurredImage(img, p.blur);
      const e = ctx.asset(path); w = e.w; h = e.h;
    }
    // osu! hides its own background when a storyboard uses that file: show a copy instead.
    if (!p.hideDefault && path === img && img.toLowerCase() === (ctx.map.events.background?.file || '').toLowerCase()) path = (await ctx.ownCopy?.(img)) || path;
    const k = Math.max(SB.width / w, SB.height / h) * (p.shake !== 'none' ? 1 + (p.shakeAmount * 2.5) / 480 : 1);
    const s = ctx.sprite(path, { x: 320, y: 240 });
    const { start, end } = ctx;
    const beat = ctx.map.beatLengthAt(start);
    if (p.opPulse && p.opPulse !== 'none') {
      const per = Math.max(60, (p.opBeats || 4) * beat), lo = Math.min(p.opMin || 0, p.opacity), n = Math.max(1, Math.floor((end - start) / per));
      if (p.opPulse === 'pulse') s.loop(start, n, (l) => l.fade(0, per, p.opacity, lo, E.OutSine));
      else s.loop(start, n, (l) => { l.fade(0, per / 2, lo, p.opacity, E.InOutSine); l.fade(per / 2, per, p.opacity, lo, E.InOutSine); });
      if (start + n * per < end) s.fade(start + n * per, end, lo, lo);
    } else rangeFade(s, ctx, p, p.opacity);
    const grey = Math.round(255 * (1 - p.dim));
    const tinted = p.tintMode && p.tintMode !== 'none';
    if (tinted) {
      const mix = (hex) => hexToRgb(hex).map((v) => Math.round(v * (1 - p.dim)));
      const A = mix(p.tint), B = mix(p.tintTo || p.tint), per = Math.max(60, (p.tintBeats || 4) * beat);
      if (p.tintMode === 'breathe') {
        let t = start, k = 0;
        for (; t < end - 1; t += per, k++) s.color(t, Math.min(end, t + (per * 2) / 3), k % 2 ? B : A, k % 2 ? A : B, E.InOutSine);
      } else if (p.tintMode === 'pulse') {
        s.color(start, start, A);
        s.loop(start, Math.max(1, Math.floor((end - start) / per)), (l) => l.color(0, per, B, A, E.OutSine));
      } else s.color(start, start, A);
    } else if (grey < 255 || p.kiaiBright) s.color(start, start, [grey, grey, grey]);
    if (p.kiaiBright && !tinted) {
      const bright = Math.min(255, grey + 70);
      for (const kz of ctx.map.kiai) {
        if (kz.end <= start || kz.start >= end) continue;
        const a = Math.max(start, kz.start), b = Math.min(end, kz.end);
        s.color(a, Math.min(b, a + 250), [grey, grey, grey], [bright, bright, bright]);
        if (b < end) s.color(b, Math.min(end, b + 400), [bright, bright, bright], [grey, grey, grey]);
      }
    }
    const zoomAt = (t) => lerp(p.zoomFrom, p.zoomTo, (t - start) / Math.max(1, end - start));
    const zs = p.enter === 'zoomspin' ? Math.min(end, start + p.enterMs) : start;
    if (zs > start) {
      s.scale(start, zs, k * p.zoomFrom * (p.enterZoom ?? 1.45), k * p.zoomFrom, E.OutExpo);
      if (p.enterTurn) s.rotate(start, Math.min(end, start + p.enterMs * 2), (p.enterTurn * Math.PI) / 180, 0, E.OutExpo);
    }
    if (p.breathe > 0) {
      const z = k * p.zoomFrom, per = Math.max(60, p.breatheBeats * beat);
      const z1 = z * (1 + p.breathe), z2 = z * (1 + p.breathe * 2);
      const cycle = p.breatheDeep ? [[1, z, z1], [1, z1, z], [0.5, z, z1], [0.5, z1, z2], [1, z2, z]] : [[1, z, z1], [1, z1, z]];
      let t = zs;
      for (let i = 0; t < end - 1; i++) {
        const [len, a, b] = cycle[i % cycle.length];
        if (t + len * per <= end + 1) s.scale(t, t + len * per, a, b, b > a ? E.OutSine : E.OutExpo);
        t += len * per;
      }
    } else if (zs > start) {
      if (zs < end && p.zoomFrom !== p.zoomTo) s.scale(zs, end, k * p.zoomFrom, k * p.zoomTo, p.zoomEase);
    } else if (p.pulse > 0) {
      let beats = ctx.map.beats(start, end, 1).filter((b) => Math.round(b.beat) % p.pulseEvery === 0);
      if (p.kiaiPulseOnly) beats = beats.filter((b) => ctx.map.isKiai(b.time));
      let t = start, z = zoomAt(start);
      for (let i = 0; i < beats.length; i++) {
        const b = beats[i].time;
        if (b > t) s.scale(t, b, k * z, k * zoomAt(b));
        const next = i + 1 < beats.length ? Math.min(beats[i + 1].time, end) : end;
        s.scale(b, next, k * zoomAt(b) * (1 + p.pulse), k * zoomAt(next), E.OutCubic);
        t = next; z = zoomAt(next);
      }
      if (t < end) s.scale(t, end, k * zoomAt(t), k * p.zoomTo);
    } else if (p.zoomFrom !== p.zoomTo) s.scale(start, end, k * p.zoomFrom, k * p.zoomTo, p.zoomEase);
    else s.scale(start, start, k * p.zoomFrom);
    let hits = [];
    if (p.shake === 'finish' || p.shake === 'clap') {
      const bit = p.shake === 'finish' ? 4 : 8;
      hits = ctx.objects.filter((o) => ((o.kind === 'slider' && o.edgeSounds?.length ? o.edgeSounds[0] | o.hitSound : o.hitSound) & bit)).map((o) => o.time);
    } else if (p.shake === 'kiai') hits = ctx.map.beats(start, end, 1).filter((b) => b.downbeat && ctx.map.isKiai(b.time)).map((b) => b.time);
    hits = hits.filter((t) => t >= start && t <= end - 170).sort((a, b) => a - b).filter((t, i, arr) => i === 0 || t - arr[i - 1] >= 170);
    const baseX = (t) => 320 + (p.pan ? lerp(-p.pan / 2, p.pan / 2, ease(E.InOutSine, (t - start) / Math.max(1, end - start))) : 0);
    if (p.jitter > 0) {
      const r = ctx.rng, step = Math.max(30, p.jitterMs);
      let px = 320, py = 240;
      for (let t = start; t < end - 1; t += step) {
        const home = r() < 0.14;
        const nx = home ? 320 : 320 + r.range(-p.jitter, p.jitter), ny = home ? 240 : 240 + r.range(-p.jitter, p.jitter) * 0.93;
        s.move(t, Math.min(end, t + step), px, py, nx, ny);
        px = nx; py = ny;
      }
    } else if (p.wander > 0) {
      const r = ctx.rng, per = Math.max(100, p.wanderBeats * beat);
      let px = 320, py = 240;
      for (let t = start; t < end - 1; t += per) {
        const a = r() * Math.PI * 2, d = p.wander * r.range(0.6, 1);
        const nx = 320 + Math.cos(a) * d, ny = 240 + Math.sin(a) * d;
        s.move(t, Math.min(end, t + per), px, py, nx, ny, E.OutExpo);
        px = nx; py = ny;
      }
    } else if (hits.length) {
      const r = ctx.rng, a = p.shakeAmount;
      let t = start;
      for (const h of hits) {
        if (h > t) s.move(t, h, baseX(t), 240, baseX(h), 240);
        const o1 = [r.range(-a, a), r.range(-a, a)], o2 = [-o1[0] * 0.55, -o1[1] * 0.55];
        s.move(h, h + 45, baseX(h), 240, baseX(h) + o1[0], 240 + o1[1], E.OutQuad);
        s.move(h + 45, h + 100, baseX(h) + o1[0], 240 + o1[1], baseX(h) + o2[0], 240 + o2[1], E.InOutQuad);
        s.move(h + 100, h + 170, baseX(h) + o2[0], 240 + o2[1], baseX(h + 170), 240, E.OutQuad);
        t = h + 170;
      }
      if (t < end) s.move(t, end, baseX(t), 240, baseX(end), 240);
    } else if (p.pan) s.move(start, end, 320 - p.pan / 2, 240, 320 + p.pan / 2, 240, E.InOutSine);
    const bgFile = ctx.map.events.background?.file;
    if (p.hideDefault && bgFile && path.toLowerCase() !== bgFile.toLowerCase()) {
      ctx.sprite(bgFile, { x: 320, y: 240 }).fade(start, start, 0);
    }
  },
};

const PARTICLE_TEX = opt([['soft-dot', 'Soft dot'], ['dot', 'Hard dot'], ['glow', 'Glow'], ['bokeh', 'Bokeh disc'], ['star4', 'Sparkle'], ['petal', 'Petal'], ['leaf', 'Leaf'], ['cloud', 'Mist'], ['square', 'Square'], ['diamond', 'Diamond'], ['heart', 'Heart'], ['heart-o', 'Heart outline'], ['ring-thin', 'Ring'], ['circle-o', 'Circle outline'], ['square-o', 'Square outline'], ['hex-o', 'Hexagon outline'], ['tri-o', 'Triangle outline']]);

export const particles = {
  id: 'particles', name: 'Floating Particles', category: 'Background & ambience', icon: '❄', accent: '#c9e7ff', scope: 'range',
  description: 'Ambient particles: snow, rising embers, bokeh, fireflies, twinkling stars, mist.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    { key: 'mode', label: 'Motion', type: 'select', group: 'Motion', default: 'up',
      options: opt([['up', 'Rise up'], ['down', 'Fall down'], ['left', 'Drift left'], ['right', 'Drift right'], ['drift', 'Wander randomly'], ['twinkle', 'Stay & twinkle'], ['riseFade', 'Rise from the floor & burn out'], ['bounce', 'Bounce around']]), help: 'Bounce around: they fly in straight lines and bounce off the edges of the screen, and off the circle below if you keep one clear (or inside it).' },
    { key: 'bounceFrom', label: 'They start', type: 'select', group: 'Motion', default: 'anywhere', showIf: (p) => p.mode === 'bounce', options: opt([['anywhere', 'Anywhere'], ['middle', 'From the middle']]), help: 'From the middle: each one sets off from the middle of the circle (or of the screen), one after another.' },
    num('bounceLife', 'Each one lives (seconds, 0 = the whole time)', 0, 60, 0.5, 0, 'Motion', { showIf: (p) => p.mode === 'bounce', help: 'After this long it fades away and a new one sets off.' }),
    num('bounceKeep', 'Bounciness (% of the speed kept at each bounce)', 10, 100, 5, 100, 'Motion', { showIf: (p) => p.mode === 'bounce', help: '100 = they never slow down. Lower = every bounce takes some speed away until they come to rest.' }),
    num('count', 'Count (density)', 1, 600, 1, 30, 'Motion', { help: 'Above 300 it gets heavy: keep an eye on the command count at the bottom right.' }),
    { key: 'region', label: 'Where', type: 'select', group: 'Motion', default: 'all', options: opt([['all', 'Whole screen'], ['left', 'Left half only'], ['right', 'Right half only']]), help: 'For pictures with two sides: different particles on each.' },
    num('regionEdge', 'Halves meet at (X)', -107, 747, 1, 320, 'Motion', { showIf: (p) => p.region && p.region !== 'all' }),
    num('reach', 'How high they get (px)', 40, 600, 5, 440, 'Motion', { showIf: (p) => p.mode === 'riseFade' }),
    bool('beatStep', 'Move in steps on the beat', false, 'Motion', { showIf: (p) => ['up', 'down', 'left', 'right'].includes(p.mode) }),
    bool('beatFlash', 'Light up on each step', false, 'Motion', { showIf: (p) => p.beatStep && ['up', 'down', 'left', 'right'].includes(p.mode), help: 'Every particle flares on the beat and sinks back to its own brightness.' }),
    bool('depth', 'Bigger ones move faster (depth)', false, 'Motion', { showIf: (p) => ['up', 'down', 'left', 'right'].includes(p.mode), help: 'Small particles lag behind like distant dust.' }),
    num('speed', 'Speed (px/s)', 2, 600, 1, 40, 'Motion'),
    num('sway', 'Sway (px)', 0, 120, 1, 15, 'Motion'),
    num('swayPeriod', 'Sway period (ms)', 500, 8000, 100, 2600, 'Motion'),
    num('spin', 'Spin (deg/s)', 0, 360, 5, 0, 'Motion'),
    bool('flutter', 'Flutter (3D flip)', false, 'Motion'),
    { key: 'texture', label: 'Particle', type: 'select', options: PARTICLE_TEX, default: 'soft-dot', group: 'Look', showIf: (p) => !p.image },
    ...customImageParam(),
    num('sizeMin', 'Size min', 0.02, 3, 0.01, 0.06),
    num('sizeMax', 'Size max', 0.02, 4, 0.01, 0.16),
    num('sizeDrift', 'Size change in flight', 0, 0.9, 0.05, 0, 'Look', { help: 'Each particle grows or shrinks a little on its way across.' }),
    bool('prefill', 'Already on screen at the start', true, 'Motion', { help: 'Off: the screen starts empty and the particles stream in from the edge.', showIf: (p) => p.mode !== 'twinkle' && p.mode !== 'drift' && p.mode !== 'bounce' }),
    num('edgeFade', 'Fade at the edges (%)', 0, 50, 1, 25, 'Look', { help: 'How much of each flight is spent fading in and out. 0 = particles simply fly in from off-screen.' }),
    ...clearParams('Motion', (p) => p.mode !== 'riseFade' && !p.beatStep),
    bool('clearInside', 'Only inside the circle instead', false, 'Motion', { showIf: (p) => p.clear > 0 && !p.beatStep && ['up', 'down', 'twinkle', 'bounce'].includes(p.mode), help: 'The other way round: the particles live inside the circle and never leave it.' }),
    num('opacityMin', 'Opacity min', 0.02, 1, 0.02, 0.3),
    num('opacityMax', 'Opacity max', 0.02, 1, 0.02, 0.8),
    bool('additive', 'Additive (glowy) blending', true),
    ...colorParams('#ffffff', 'fixed'),
    ...fadeParams(1000, 1000),
  ],
  presets: [
    { name: 'Rising dust', values: {} },
    { name: 'Snow', values: { mode: 'down', speed: 45, sway: 25, count: 60, sizeMin: 0.05, sizeMax: 0.14, additive: false, texture: 'soft-dot', opacityMin: 0.5, opacityMax: 0.95 } },
    { name: 'Embers', values: { mode: 'up', speed: 70, sway: 20, count: 40, texture: 'glow', sizeMin: 0.05, sizeMax: 0.12, colorMode: 'random', palette: ['#ff8c42', '#ffb347', '#ff5e3a'] } },
    { name: 'Bokeh', values: { mode: 'drift', speed: 14, count: 18, texture: 'bokeh', sizeMin: 0.3, sizeMax: 0.9, opacityMin: 0.08, opacityMax: 0.25, colorMode: 'random', palette: ['#ff9ec7', '#9fd8ff', '#fff2a8', '#c7a6ff'] } },
    { name: 'Fireflies', values: { mode: 'drift', speed: 25, count: 25, texture: 'glow', sizeMin: 0.06, sizeMax: 0.12, color: '#d8ff7a', opacityMin: 0.4, opacityMax: 1 } },
    { name: 'Starfield', values: { mode: 'twinkle', count: 70, texture: 'star4', sizeMin: 0.05, sizeMax: 0.16, opacityMin: 0.2, opacityMax: 1 } },
    { name: 'Low mist', values: { mode: 'right', speed: 12, count: 10, texture: 'cloud', sizeMin: 1.2, sizeMax: 2.4, opacityMin: 0.08, opacityMax: 0.2, sway: 0, additive: false } },
    { name: 'Sakura', values: { mode: 'down', texture: 'petal', count: 35, speed: 55, sway: 35, spin: 90, flutter: true, sizeMin: 0.16, sizeMax: 0.3, opacityMin: 0.7, opacityMax: 1, additive: false, colorMode: 'random', palette: ['#ffc4dd', '#ffb0d0', '#ffe3ef'] } },
    { name: 'Autumn leaves', values: { mode: 'down', texture: 'leaf', count: 22, speed: 65, sway: 45, spin: 120, flutter: true, sizeMin: 0.2, sizeMax: 0.38, opacityMin: 0.8, opacityMax: 1, additive: false, colorMode: 'random', palette: ['#e76f51', '#f4a261', '#e9c46a', '#c8553d'] } },
    { name: 'Confetti rain', values: { mode: 'down', texture: 'square', count: 50, speed: 120, sway: 20, spin: 200, flutter: true, sizeMin: 0.08, sizeMax: 0.14, opacityMin: 0.9, opacityMax: 1, additive: false, colorMode: 'random', palette: ['#ff5e8a', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff'] } },
    { name: 'Star embers', values: { mode: 'riseFade', count: 180, speed: 110, reach: 440, texture: 'star4', sizeMin: 0.05, sizeMax: 0.18, opacityMin: 1, opacityMax: 1, fadeIn: 0, fadeOut: 0 } },
    { name: 'Bokeh steps', values: { mode: 'up', beatStep: true, prefill: false, count: 40, speed: 150, sway: 0, spin: 60, texture: 'bokeh', sizeMin: 0.12, sizeMax: 0.6, opacityMin: 0.1, opacityMax: 0.22, edgeFade: 0, fadeIn: 0, fadeOut: 0 } },
    { name: 'Beat lanterns', values: { mode: 'up', beatStep: true, beatFlash: true, depth: true, prefill: false, count: 36, speed: 130, sway: 0, texture: 'glow', sizeMin: 0.06, sizeMax: 0.55, opacityMin: 0.05, opacityMax: 0.45, edgeFade: 0, color: '#ffe2a8', fadeIn: 0, fadeOut: 300 } },
    { name: 'Bouncing hearts', values: { mode: 'bounce', texture: 'heart', count: 10, speed: 70, sizeMin: 0.14, sizeMax: 0.26, opacityMin: 0.8, opacityMax: 1, additive: false, color: '#ff7aa8' } },
    { name: 'Caught in a bubble', values: { mode: 'bounce', clear: 90, clearInside: true, bounceFrom: 'middle', bounceLife: 6, bounceKeep: 85, texture: 'soft-dot', count: 8, speed: 45, sizeMin: 0.1, sizeMax: 0.2, opacityMin: 0.7, opacityMax: 1 } },
    { name: 'Kiai streamers', values: { mode: 'up', texture: 'soft-dot', count: 22, speed: 300, sway: 0, spin: 30, sizeMin: 0.28, sizeMax: 0.5, sizeDrift: 0.2, edgeFade: 8, prefill: false, opacityMin: 1, opacityMax: 1, color: '#ff7ab8', fadeIn: 0, fadeOut: 150 } },
  ],
  async generate(ctx, p) {
    const r = ctx.rng;
    const S0 = ctx.start, S1 = ctx.end;
    if (S1 - S0 < 100) return;
    const tex = await shapeOrImage(ctx, p);
    const edge = (p.edgeFade ?? 25) / 100;
    const m = 60 * Math.max(1, p.sizeMax);
    const half = p.region === 'left' || p.region === 'right', cut = p.regionEdge ?? 320;
    const L = p.region === 'right' ? cut : SB.left - m, R = p.region === 'left' ? cut : SB.right + m, T = -m, B = 480 + m;
    const VL = p.region === 'right' ? cut : SB.left, VR = p.region === 'left' ? cut : SB.right;
    const sizeMax = Math.max(p.sizeMin, p.sizeMax), opMax = Math.max(p.opacityMin, p.opacityMax);
    const burn = p.mode === 'riseFade';
    const burnLife = Math.max(200, ((p.reach || 440) / p.speed) * 1000);
    const bounce = p.mode === 'bounce', bounceLife = bounce && p.bounceLife > 0 ? p.bounceLife * 1000 : 0;
    const texRad = (() => { const a = ctx.asset(ctx.tex(p.texture)); return a ? Math.max(a.w, a.h) * 0.4 : 26; })();
    const stream = burn || (p.prefill === false && p.mode !== 'twinkle' && p.mode !== 'drift' && !bounce);
    const travel = burn ? burnLife : ((p.mode === 'left' || p.mode === 'right' ? R - L : B - T) / p.speed) * 1000;
    const beatLen = ctx.map.beatLengthAt(S0);
    for (let i = 0; i < p.count; i++) {
      const A0 = bounceLife ? Math.round(S0 + (i / p.count) * bounceLife) : stream ? Math.round(S0 + (i / p.count) * travel) : S0;
      if (A0 > S1 - 100 || (burn && A0 + burnLife > S1)) continue;
      const size = r.range(p.sizeMin, sizeMax), op = r.range(p.opacityMin, opMax);
      let px = r.range(VL, VR), py = r.range(0, 480);
      const clearR = p.clear > 0 && !burn ? p.clear + 30 * size + (p.mode === 'up' || p.mode === 'down' ? p.sway : 0) : 0;
      const cX = p.clearX ?? 320, cY = p.clearY ?? 240;
      const inside = !!clearR && p.clearInside && !p.beatStep && ['up', 'down', 'twinkle'].includes(p.mode), innerR = Math.max(4, p.clear - 30 * size);
      if (inside && p.mode === 'twinkle') { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * innerR; px = cX + Math.cos(a) * d; py = cY + Math.sin(a) * d; }
      else if (clearR && p.mode === 'twinkle') for (let k = 0; k < 40 && Math.hypot(px - cX, py - cY) < clearR; k++) { px = r.range(VL, VR); py = r.range(0, 480); }
      const sp = ctx.sprite(tex, { x: px, y: py });
      if (p.flutter) {
        const per = Math.round(r.range(700, 1500));
        const lo = size * r.range(0.1, 0.3);
        sp.loop(A0, Math.ceil((S1 - A0) / per), (l) => {
          l.vec(0, per / 2, size, size, lo, size, E.InOutSine);
          l.vec(per / 2, per, lo, size, size, size, E.InOutSine);
        });
      } else if (!burn && (!(p.sizeDrift > 0) || p.mode === 'twinkle' || bounce)) sp.scale(A0, A0, size);
      const drifting = p.sizeDrift > 0 && !p.flutter && p.mode !== 'twinkle';
      sp.color(A0, A0, pickColor(ctx, p, null, i));
      if (p.additive) sp.additive();

      if (p.mode === 'twinkle') {
        let t = S0 + r.range(0, 400);
        const fi = Math.max(50, p.fadeIn * r.range(0.5, 1));
        sp.fade(S0, t + fi, 0, op, E.OutQuad);
        t += fi;
        let hi = true;
        const stop = S1 - Math.max(50, p.fadeOut);
        while (t < stop) {
          const per = r.range(500, 1700) * 40 / Math.max(5, p.speed);
          const t1 = Math.min(stop, t + per);
          sp.fade(t, t1, hi ? op : op * 0.15, hi ? op * 0.15 : op, E.InOutSine);
          hi = !hi; t = t1;
        }
        sp.fade(Math.max(t, stop), S1, hi ? op : op * 0.15, 0);
        if (p.spin) sp.rotate(S0, S1, 0, (S1 - S0) / 1000 * p.spin * Math.PI / 180);
        continue;
      }

      if (bounce) {
        const rad = texRad * size, mid = p.bounceFrom === 'middle';
        const circle = p.clear > 0 ? { x: cX, y: cY, inside: !!p.clearInside, r: p.clearInside ? Math.max(4, p.clear - rad) : p.clear + rad } : null;
        const box = circle?.inside ? null : [VL + rad, rad, VR - rad, 480 - rad];
        for (let t = A0; t < S1 - 100;) {
          const e = bounceLife ? Math.min(S1, Math.round(t + bounceLife * r.range(0.8, 1.2))) : S1;
          const a = r() * Math.PI * 2, v = p.speed * r.range(0.7, 1.3);
          let x = circle ? cX : (VL + VR) / 2, y = circle ? cY : 240;
          if (mid) { if (circle && !circle.inside) { x += Math.cos(a) * (circle.r + 1); y += Math.sin(a) * (circle.r + 1); } }
          else if (circle?.inside) { const b = r() * Math.PI * 2, d = Math.sqrt(r()) * circle.r; x = cX + Math.cos(b) * d; y = cY + Math.sin(b) * d; }
          else for (let k = 0; k < 40; k++) { x = r.range(box[0], box[2]); y = r.range(box[1], box[3]); if (!circle || Math.hypot(x - cX, y - cY) > circle.r + 2) break; }
          for (const g of bounceLegs({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: t, t1: e, box, circle, keep: (p.bounceKeep ?? 100) / 100 })) {
            const ta = Math.round(g.t0), tb = Math.round(g.t1);
            if (tb > ta) sp.move(ta, tb, g.x0, g.y0, g.x1, g.y1);
          }
          const len = e - t;
          const [fi, fo] = fitDurations(len, t === S0 ? Math.max(p.fadeIn, 50) : Math.min(700, len * Math.max(edge, 0.05)), e >= S1 ? Math.max(p.fadeOut, 50) : Math.min(700, len * Math.max(edge, 0.05)));
          sp.fade(t, t + fi, 0, op, E.OutQuad); sp.fade(e - fo, e, op, 0, E.InQuad);
          if (p.spin) { const r0 = r() * 6.28; sp.rotate(t, e, r0, r0 + len / 1000 * p.spin * Math.PI / 180 * r.sign()); }
          if (!bounceLife) break;
          t = e + Math.round(r.range(0, 300));
        }
        continue;
      }
      let t = A0, first = !stream;
      if (burn) {
        if (!p.spin) sp.rotate(A0, A0, r.range(-1.6, 1.6));
        for (; t + burnLife <= S1; t += burnLife + r.range(0, 60)) {
          const x0 = r.range(L, R), y0 = 485, e = t + burnLife;
          sp.move(t, e, x0, y0, x0 + r.range(-80, 80), y0 - p.reach * r.range(0.26, 1), E.OutSine);
          sp.fade(t, e, op, 0, E.InExpo);
          sp.scale(t, e, size * r.range(0.3, 1), 0, E.InSine);
          if (p.spin) { const r0 = r() * 6.28; sp.rotate(t, e, r0, r0 + (burnLife / 1000) * p.spin * Math.PI / 180 * r.sign()); }
        }
        continue;
      }
      const stepped = p.beatStep && ['up', 'down', 'left', 'right'].includes(p.mode);
      if (stepped) t = ctx.map.snap(t, 2);
      while (t < S1 - 50) {
        let x0, y0, x1, y1, ease = E.Linear;
        switch (p.mode) {
          case 'down': x0 = r.range(L, R); y0 = T; x1 = x0 + r.range(-40, 40) * (half ? 0.3 : 1); y1 = B; break;
          case 'left': x0 = R; y0 = r.range(0, 480); x1 = L; y1 = y0 + r.range(-30, 30); break;
          case 'right': x0 = L; y0 = r.range(0, 480); x1 = R; y1 = y0 + r.range(-30, 30); break;
          case 'drift': {
            x0 = r.range(VL, VR); y0 = r.range(0, 480);
            const a = r() * Math.PI * 2, d = p.speed * r.range(3, 7);
            x1 = x0 + Math.cos(a) * d; y1 = y0 + Math.sin(a) * d; ease = E.InOutSine;
            for (let k = 0; clearR && k < 40 && insideCircle(x0, y0, x1, y1, cX, cY, clearR); k++) {
              x0 = r.range(VL, VR); y0 = r.range(0, 480);
              const a2 = r() * Math.PI * 2; x1 = x0 + Math.cos(a2) * d; y1 = y0 + Math.sin(a2) * d;
            }
            break;
          }
          default: x0 = r.range(L, R); y0 = B; x1 = x0 + r.range(-40, 40); y1 = T;
        }
        if (inside) {
          x0 = x1 = cX + r.range(-innerR, innerR);
          y0 = cY + (p.mode === 'down' ? -1 : 1) * (p.clear + 8); y1 = cY - (p.mode === 'down' ? -1 : 1) * (p.clear + 8);
        }
        let life = p.mode === 'drift' ? r.range(3000, 7000) : (Math.hypot(x1 - x0, y1 - y0) / (p.speed * (p.depth && sizeMax > p.sizeMin ? lerp(0.45, 1.55, (size - p.sizeMin) / (sizeMax - p.sizeMin)) : r.range(0.7, 1.3)))) * 1000;
        if (first) {
          const u = r();
          x0 = lerp(x0, x1, u); y0 = lerp(y0, y1, u);
          life *= 1 - u;
          if (life < 300) life = 300;
        }
        let end = t + life;
        if (end > S1) {
          const u = (S1 - t) / life;
          x1 = lerp(x0, x1, u); y1 = lerp(y0, y1, u); end = S1;
        }
        if (stepped) end = Math.min(S1, t + Math.max(1, Math.round((end - t) / beatLen)) * beatLen);
        const len = end - t;
        if (stepped) {
          const n = Math.max(1, Math.round(len / beatLen));
          for (let k = 0; k < n; k++) {
            const ta = t + (len * k) / n, tb = t + (len * (k + 1)) / n;
            sp.moveY(ta, tb, lerp(y0, y1, k / n), lerp(y0, y1, (k + 1) / n), E.Out);
            if (x0 !== x1) sp.moveX(ta, tb, lerp(x0, x1, k / n), lerp(x0, x1, (k + 1) / n), E.Out);
            if (p.beatFlash) sp.fade(ta, tb, Math.min(1, op + 0.55), k === n - 1 && end >= S1 ? 0 : op, E.Out);
          }
          if (x0 === x1) sp.moveX(t, t, x0);
        } else sp.moveY(t, end, y0, y1, ease);
        if (stepped) { } else if (p.sway > 0 && !inside && (p.mode === 'up' || p.mode === 'down')) {
          const half = p.swayPeriod / 2;
          let ts = t, dir = r.sign(), xs = x0;
          const n = Math.max(1, Math.round(len / half));
          for (let k = 0; k < n; k++) {
            const te = k === n - 1 ? end : ts + len / n;
            const xe = lerp(x0, x1, (te - t) / len) + dir * p.sway * (k === n - 1 ? 0 : 1);
            sp.moveX(ts, te, xs, xe, E.InOutSine);
            ts = te; xs = xe; dir = -dir;
          }
        } else sp.moveX(t, end, x0, x1, ease);
        const edgeIn = first ? Math.max(p.fadeIn, 50) : Math.min(700, len * edge);
        const edgeOut = end >= S1 ? Math.max(p.fadeOut, 50) : Math.min(700, len * edge);
        const gap = inside ? insideCircle(x0, y0, x1, y1, cX, cY, innerR) || [0, 0] : clearR && !stepped && p.mode !== 'drift' ? insideCircle(x0, y0, x1, y1, cX, cY, clearR) : null;
        if (stepped && p.beatFlash) sp.fade(end, end, 0);
        else if (gap) {
          const soft = Math.min(500, (22 / p.speed) * 1000), ta = t + gap[0] * len, tb = t + gap[1] * len;
          const shown = (inside ? [[ta, tb]] : [[t, ta], [tb, end]]).filter(([a, b]) => b - a > 60);
          if (!shown.length) sp.fade(t, t, 0);
          for (const [a, b] of shown) {
            const [fi, fo] = fitDurations(b - a, a === t ? edgeIn : soft, b === end ? edgeOut : soft);
            if (fi >= 1) sp.fade(a, a + fi, 0, op, E.OutQuad); else sp.fade(a, a, op);
            if (fo >= 1) sp.fade(b - fo, b, op, 0, E.InQuad); else sp.fade(b, b, 0);
          }
        } else {
          const [fi, fo] = fitDurations(len, edgeIn, edgeOut);
          if (fi >= 1) sp.fade(t, t + fi, 0, op, E.OutQuad); else sp.fade(t, t, op);
          if (fo >= 1) sp.fade(end - fo, end, op, 0, E.InQuad); else sp.fade(end, end, 0);
        }
        if (drifting) sp.scale(t, end, size * r.range(1 - p.sizeDrift, 1 + p.sizeDrift), size * r.range(1 - p.sizeDrift, 1 + p.sizeDrift));
        if (p.spin) { const r0 = r() * 6.28; sp.rotate(t, end, r0, r0 + len / 1000 * p.spin * Math.PI / 180 * r.sign()); }
        first = false;
        t = end + r.range(0, 400);
        if (stepped) t = ctx.map.snap(t, 2);
      }
    }
  },
};

export const beatPulse = {
  id: 'beatPulse', name: 'Beat Pulse', category: 'Background & ambience', icon: '♥', accent: '#ff7aa8', scope: 'range',
  description: 'Edges, glows or rings pulse in time with the beat (follows the timing points).',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  params: [
    { key: 'style', label: 'Style', type: 'select', group: 'Look', default: 'edges',
      options: opt([['edges', 'Side edges'], ['bottom', 'Bottom glow'], ['frame', 'Top + bottom'], ['full', 'Full screen'], ['spot', 'Centre glow'], ['ring', 'Expanding ring'], ['tunnel', 'Square tunnel']]) },
    { key: 'every', label: 'Pulse every', type: 'select', group: 'Rhythm', default: '1', options: opt([['0.5', '½ beat'], ['1', '1 beat'], ['2', '2 beats'], ['4', 'Every bar (4)'], ['8', '2 bars']]) },
    num('offset', 'Offset (beats)', 0, 7, 1, 0, 'Rhythm'),
    bool('accent', 'Stronger on downbeats', true, 'Rhythm'),
    num('intensity', 'Intensity', 0.05, 1, 0.05, 0.45),
    num('size', 'Size', 40, 400, 5, 170),
    lineParam((p) => p.style === 'ring' || p.style === 'tunnel'),
    num('decay', 'Decay (fraction of gap)', 0.1, 1, 0.05, 0.85, 'Rhythm'),
    bool('additive', 'Additive (glowy) blending', true),
    ...colorParams('#ffffff', 'fixed'),
  ],
  presets: [
    { name: 'Edge pulse', values: {} },
    { name: 'Heartbeat', values: { style: 'full', intensity: 0.12, every: '1' } },
    { name: 'Bass floor', values: { style: 'bottom', every: '1', intensity: 0.6, color: '#ff4d6d' } },
    { name: 'Ring per bar', values: { style: 'ring', every: '4', intensity: 0.7, size: 260 } },
    { name: 'Tunnel', values: { style: 'tunnel', every: '1', intensity: 0.5, size: 120 } },
    { name: 'Colour cycle', values: { style: 'edges', colorMode: 'cycle', palette: ['#ff66aa', '#66ccff', '#b388ff', '#ffd166'] } },
  ],
  generate(ctx, p) {
    const every = parseFloat(p.every);
    let beats = ctx.map.beats(ctx.start, ctx.end, every < 1 ? 2 : 1)
      .filter((b) => (every < 1 ? true : Math.round(b.beat - p.offset) % every === 0 && b.beat >= p.offset));
    if (p.kiaiOnly) beats = beats.filter((b) => ctx.map.isKiai(b.time));
    if (!beats.length) return;
    const val = (b) => Math.min(1, p.intensity * (p.accent ? (b.downbeat ? 1.4 : 0.75) : 1));
    if (p.style === 'ring' || p.style === 'tunnel') {
      const tunnel = p.style === 'tunnel';
      beats.forEach((b, i) => {
        const gap = (beats[i + 1]?.time ?? b.time + ctx.map.beatLengthAt(b.time) * every) - b.time;
        const s = ctx.sprite(ctx.tex(lined(tunnel ? 'square-o' : 'ring-thin', p.lineX)), { x: 320, y: 240 });
        const t1 = b.time + Math.max(150, gap * p.decay * (tunnel ? 3 : 2));
        s.scale(b.time, t1, tunnel ? 0.05 : 0.25, (p.size / 100) * (tunnel ? 4 : 1), tunnel ? E.InQuad : E.OutCirc);
        if (tunnel) s.rotate(b.time, t1, 0, (i % 2 ? 1 : -1) * Math.PI / 4, E.Linear);
        s.fade(b.time, t1, val(b), 0, tunnel ? E.InQuart : E.InQuad);
        s.color(b.time, b.time, pickColor(ctx, p, null, i));
        if (p.additive) s.additive();
      });
      return;
    }
    const t0 = beats[0].time;
    const parts = p.style === 'spot'
      ? [ctx.sprite(ctx.tex('glow'), { x: 320, y: 240 }).scale(t0, t0, p.size / 25)]
      : edgeSprites(ctx, p.style, t0, p.size);
    const fixed = p.colorMode === 'fixed' && !p.colorVar;
    for (const s of parts) {
      if (fixed) s.color(t0, t0, pickColor(ctx, p, null, 0));
      if (p.additive) s.additive();
    }
    beats.forEach((b, i) => {
      const next = beats[i + 1]?.time ?? b.time + ctx.map.beatLengthAt(b.time) * every;
      const t1 = b.time + Math.max(60, (next - b.time) * p.decay);
      const c = fixed ? null : pickColor(ctx, p, null, i);
      for (const s of parts) {
        s.fade(b.time, Math.min(t1, next), val(b) * (p.style === 'full' ? 0.6 : 1), 0, E.OutQuad);
        if (c) s.color(b.time, b.time, c);
      }
    });
  },
};

export const vignette = {
  id: 'vignette', name: 'Vignette', category: 'Background & ambience', icon: '◉', accent: '#888', scope: 'range',
  description: 'Darkens the edges of the screen for a cinematic look.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  params: [
    num('opacity', 'Strength', 0.05, 1, 0.05, 0.75),
    num('size', 'Spread', 0.8, 2, 0.05, 1),
    { key: 'color', label: 'Colour', type: 'color', default: '#000000', group: 'Look' },
    ...fadeParams(1000, 1000),
  ],
  presets: [{ name: 'Cinematic', values: {} }, { name: 'Heavy', values: { opacity: 1, size: 0.9 } }, { name: 'Deep red', values: { color: '#3a0010', opacity: 0.9 } }],
  generate(ctx, p) {
    const s = ctx.sprite(ctx.tex('vignette'), { x: 320, y: 240 });
    s.vec(ctx.start, ctx.start, 860 / 427 * p.size, 482 / 240 * p.size);
    s.color(ctx.start, ctx.start, hexToRgb(p.color));
    rangeFade(s, ctx, p, p.opacity);
  },
};

export const colorWash = {
  id: 'colorWash', name: 'Colour Wash', category: 'Background & ambience', icon: '▤', accent: '#7f5af0', scope: 'range',
  description: 'Tints the scene with a solid colour or gradient - set the mood for a section.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  params: [
    { key: 'style', label: 'Shape', type: 'select', group: 'Look', default: 'bottom',
      options: opt([['solid', 'Solid'], ['bottom', 'Gradient from bottom'], ['top', 'Gradient from top'], ['left', 'Gradient from left'], ['right', 'Gradient from right']]) },
    num('opacity', 'Opacity', 0.02, 1, 0.02, 0.4),
    num('size', 'Gradient size (px)', 60, 600, 10, 260),
    { key: 'color', label: 'Colour', type: 'color', default: '#5b2bff', group: 'Look' },
    { key: 'color2', label: 'Shift to colour', type: 'color', default: '#ff3d7f', group: 'Look' },
    bool('shift', 'Slowly shift colour', false),
    bool('additive', 'Additive (light) blending', true),
    ...fadeParams(800, 800),
  ],
  presets: [
    { name: 'Neon floor', values: {} },
    { name: 'Night tint', values: { style: 'solid', color: '#0a1a4a', opacity: 0.35, additive: false } },
    { name: 'Sunset sky', values: { style: 'top', color: '#ff7a3d', color2: '#b83dff', shift: true, opacity: 0.45, size: 340 } },
    { name: 'Dimmed screen', values: { style: 'solid', color: '#000000', opacity: 0.6, additive: false } },
  ],
  generate(ctx, p) {
    const { start, end } = ctx;
    let s;
    switch (p.style) {
      case 'solid': s = ctx.sprite(ctx.tex('pixel'), { x: 320, y: 240 }).vec(start, start, 860, 482); break;
      case 'top': s = ctx.sprite(ctx.tex('grad-v'), { origin: 'BottomCentre', x: 320, y: 0 }).vec(start, start, 860 / 4, p.size / 256).rotate(start, start, Math.PI); break;
      case 'left': s = ctx.sprite(ctx.tex('grad-h'), { origin: 'CentreLeft', x: SB.left, y: 240 }).vec(start, start, p.size / 256, 482 / 4); break;
      case 'right': s = ctx.sprite(ctx.tex('grad-h'), { origin: 'CentreLeft', x: SB.right, y: 240 }).vec(start, start, p.size / 256, 482 / 4).rotate(start, start, Math.PI); break;
      default: s = ctx.sprite(ctx.tex('grad-v'), { origin: 'BottomCentre', x: 320, y: 480 }).vec(start, start, 860 / 4, p.size / 256);
    }
    if (p.shift) s.color(start, end, p.color, p.color2, E.InOutSine); else s.color(start, start, p.color);
    if (p.additive) s.additive();
    rangeFade(s, ctx, p, p.opacity);
  },
};

export const lightRays = {
  id: 'lightRays', name: 'Light Rays', category: 'Background & ambience', icon: '☀', accent: '#ffd166', scope: 'range',
  description: 'Slowly rotating god-rays shining from a point. Beautiful behind calm sections.',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    num('x', 'Source X', -107, 747, 1, 320, 'Position'),
    num('y', 'Source Y', -200, 480, 1, -20, 'Position'),
    num('size', 'Size', 0.1, 4, 0.01, 2.2),
    num('speed', 'Rotation (deg/s)', -30, 30, 0.5, 3),
    num('opacity', 'Opacity', 0.02, 1, 0.02, 0.35),
    bool('twin', 'Second counter-rotating layer', true),
    bool('beatFlicker', 'Flicker on beats', false),
    ...colorParams('#fff1c9', 'fixed'),
    ...fadeParams(1500, 1500),
  ],
  presets: [
    { name: 'Heavenly', values: {} },
    { name: 'Centre burst', values: { y: 240, size: 2.6, speed: 6, opacity: 0.25 } },
    { name: 'Cold dawn', values: { color: '#9fd8ff', opacity: 0.3 } },
    { name: 'Disco', values: { y: 240, speed: 20, colorMode: 'rainbow', beatFlicker: true } },
  ],
  generate(ctx, p) {
    const { start, end } = ctx;
    const layers = p.twin ? [1, -0.6] : [1];
    layers.forEach((dir, i) => {
      const s = ctx.sprite(ctx.tex('sunrays'), { x: p.x, y: p.y });
      s.scale(start, start, p.size * (i ? 0.85 : 1));
      const r0 = i * 0.7;
      s.rotate(start, end, r0, r0 + dir * p.speed * (end - start) / 1000 * Math.PI / 180);
      s.color(start, start, pickColor(ctx, p, null, i * 3));
      s.additive();
      const op = p.opacity * (i ? 0.6 : 1);
      if (p.beatFlicker) {
        const beats = ctx.map.beats(start + p.fadeIn, end - p.fadeOut, 1);
        s.fade(start, start + p.fadeIn, 0, op);
        beats.forEach((b, k) => {
          const next = beats[k + 1]?.time ?? end - p.fadeOut;
          s.fade(b.time, next, Math.min(1, op * 1.8), op, E.OutQuad);
        });
        s.fade(end - p.fadeOut, end, op, 0);
      } else rangeFade(s, ctx, p, op);
    });
  },
};

export const spectrumBars = {
  id: 'spectrum', name: 'Audio Spectrum', category: 'Background & ambience', icon: '▮', accent: '#06d6a0', scope: 'range',
  description: 'Bars that dance to the actual audio frequencies (analysed from the song file).',
  defaultLayer: 'Background', defaultOutput: 'osb',
  params: [
    { key: 'style', label: 'Style', type: 'select', group: 'Look', default: 'bars', options: opt([['bars', 'Bars up'], ['mirror', 'Mirrored (up & down)'], ['down', 'Hanging from top'], ['dots', 'Dots that jump']]) },
    num('bars', 'Bar count', 8, 96, 1, 40, 'Look'),
    num('width', 'Total width (px)', 100, 854, 2, 620, 'Position'),
    num('x', 'Centre X', -107, 747, 1, 320, 'Position'),
    num('y', 'Baseline Y', 0, 480, 1, 470, 'Position'),
    num('gap', 'Gap (fraction)', 0, 0.8, 0.05, 0.3),
    num('height', 'Max height (px)', 10, 400, 5, 120),
    num('minH', 'Min height (px)', 0, 20, 0.5, 2),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 0.6),
    num('fps', 'Updates per second', 5, 60, 1, 24, 'Analysis'),
    num('minFreq', 'Lowest freq (Hz)', 20, 1000, 10, 50, 'Analysis'),
    num('maxFreq', 'Highest freq (Hz)', 2000, 20000, 500, 12000, 'Analysis'),
    num('smooth', 'Smoothing', 0, 0.9, 0.05, 0.45, 'Analysis'),
    num('threshold', 'Optimise (px)', 0, 10, 0.5, 1.5, 'Analysis', { help: 'Skips changes smaller than this - fewer commands, smaller .osb.' }),
    bool('additive', 'Additive (glowy) blending', false),
    ...colorParams('#ffffff', 'fixed', ['#66ccff', '#b388ff', '#ff66aa']),
    bool('ripple', 'A second colour runs along the bars', false, 'Colour'),
    { key: 'rippleColor', label: 'Second colour', type: 'color', default: '#ff66aa', group: 'Colour', showIf: (p) => p.ripple },
    num('rippleBeats', 'One colour cycle (beats)', 0.25, 32, 0.25, 2, 'Colour', { showIf: (p) => p.ripple }),
    num('rippleShift', 'Delay per bar (% of a cycle)', -50, 50, 0.5, 4, 'Colour', { showIf: (p) => p.ripple, help: '0 = all bars change together; more = the colour travels along the row.' }),
    ...fadeParams(600, 600),
  ],
  presets: [
    { name: 'Classic bars', values: {} },
    { name: 'Neon gradient', values: { colorMode: 'cycle', palette: ['#00f5d4', '#9b5de5', '#f15bb5'], additive: true, opacity: 0.8 } },
    { name: 'Mirrored centre', values: { style: 'mirror', y: 240, height: 90, bars: 48, opacity: 0.35 } },
    { name: 'Thin & many', values: { bars: 80, gap: 0.45, width: 854, height: 80 } },
    { name: 'Jumping dots', values: { style: 'dots', bars: 32, gap: 0.5, height: 90, y: 300, opacity: 0.8 } },
    { name: 'Colour ripple', values: { ripple: true, color: '#66ccff', rippleColor: '#ff66aa', additive: true, opacity: 0.75 } },
  ],
  async generate(ctx, p) {
    const audio = await ctx.audio();
    if (!audio) return;
    const { start, end } = ctx;
    const step = 1000 / p.fps;
    const times = [];
    for (let t = start; t <= end; t += step) times.push(Math.round(t));
    const frames = spectrum(audio, times, { bars: p.bars, minFreq: p.minFreq, maxFreq: p.maxFreq, log: true });
    const bw = p.width / p.bars;
    const w = bw * (1 - p.gap);
    const origin = p.style === 'mirror' ? 'Centre' : p.style === 'down' ? 'TopCentre' : 'BottomCentre';
    const pal = p.colorMode === 'cycle' || p.colorMode === 'random' ? p.palette.map(hexToRgb) : null;
    for (let b = 0; b < p.bars; b++) {
      const x = p.x - p.width / 2 + bw * (b + 0.5);
      const dots = p.style === 'dots';
      const s = dots ? ctx.sprite(ctx.tex('dot'), { x, y: p.y }) : ctx.sprite(ctx.tex('pixel'), { origin, x, y: p.y });
      let col;
      if (pal && pal.length > 1) {
        const f = b / (p.bars - 1) * (pal.length - 1), k = Math.min(pal.length - 2, Math.floor(f));
        col = pal[k].map((v, j) => lerp(v, pal[k + 1][j], f - k));
      } else col = pickColor(ctx, p, null, b);
      const c1 = col.map(Math.round);
      if (p.ripple) {
        const P = Math.max(80, p.rippleBeats * ctx.map.beatLengthAt(start)), c2 = hexToRgb(p.rippleColor).map(Math.round);
        const t0 = start + ((((b * p.rippleShift) / 100) % 1) + 1) % 1 * P;
        s.loop(t0, Math.ceil((end - t0) / P), (l) => { l._add('C', 0, P / 2, c1, c2); l._add('C', P / 2, P, c2, c1); });
      } else s.color(start, start, c1);
      if (p.additive) s.additive();
      let prev = 0;
      const keys = frames.map((v, k) => {
        prev = prev * p.smooth + v[b] * (1 - p.smooth);
        return [times[k], p.minH + prev * p.height];
      });
      const kept = [keys[0]];
      for (let k = 1; k < keys.length - 1; k++) {
        const a = kept[kept.length - 1], c = keys[k + 1];
        const est = a[1] + (c[1] - a[1]) * (keys[k][0] - a[0]) / (c[0] - a[0]);
        if (Math.abs(est - keys[k][1]) > p.threshold) kept.push(keys[k]);
      }
      kept.push(keys[keys.length - 1]);
      if (dots) { s.scale(start, start, w / 32); for (let k = 0; k < kept.length - 1; k++) s.moveY(kept[k][0], kept[k + 1][0], p.y - kept[k][1], p.y - kept[k + 1][1]); }
      else for (let k = 0; k < kept.length - 1; k++) s.vec(kept[k][0], kept[k + 1][0], w, kept[k][1], w, kept[k + 1][1]);
      rangeFade(s, ctx, p, p.opacity);
    }
  },
};

export const letterbox = {
  id: 'letterbox', name: 'Letterbox Bars', category: 'Background & ambience', icon: '▬', accent: '#444', scope: 'range',
  description: 'Cinematic black bars slide in from the top and bottom.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  params: [
    num('size', 'Bar height (px)', 10, 242, 1, 55, 'Look', { help: '241 closes the screen completely, like a curtain.' }),
    num('opacity', 'Opacity', 0.1, 1, 0.05, 1),
    { key: 'color', label: 'Colour', type: 'color', default: '#000000', group: 'Look' },
    num('inDur', 'Slide in (ms)', 0, 6000, 10, 800, 'Timing'),
    num('outDur', 'Slide out (ms)', 0, 6000, 10, 800, 'Timing'),
    easing('ease', 'Easing', E.InOutCubic),
  ],
  presets: [{ name: 'Cinematic', values: {} }, { name: 'Thin', values: { size: 30 } }, { name: 'Dramatic', values: { size: 110, inDur: 1600 } },
    { name: 'Curtain opens', values: { size: 241, inDur: 0, outDur: 2400, ease: E.OutExpo } }, { name: 'Curtain closes', values: { size: 241, inDur: 1200, outDur: 0, ease: E.InExpo } }],
  generate(ctx, p) {
    const { start, end } = ctx;
    const [ti, to] = fitDurations(end - start, p.inDur, p.outDur);
    for (const top of [true, false]) {
      const s = ctx.sprite(ctx.tex('pixel'), { origin: top ? 'TopCentre' : 'BottomCentre', x: 320, y: top ? 0 : 480 });
      s.vec(start, start + ti, 860, 0, 860, p.size, p.ease);
      if (to > 0) s.vec(end - to, end, 860, p.size, 860, 0, p.ease); else s.vec(end, end, 860, p.size);
      s.color(start, start, p.color);
      s.fade(start, start, p.opacity);
    }
  },
};

export const imageShow = {
  id: 'image', name: 'Image / Logo', category: 'Background & ambience', icon: '🖼', accent: '#f4a261', scope: 'range',
  description: 'Show any image from the map folder (logo, character art...) with entrance/exit animations.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  params: [
    { key: 'image', label: 'Image', type: 'image', default: '', group: 'Image' },
    num('x', 'X', -107, 747, 1, 320, 'Position'),
    num('y', 'Y', 0, 480, 1, 240, 'Position'),
    num('scale', 'Scale', 0.02, 4, 0.01, 0.5, 'Position'),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 1, 'Image'),
    { key: 'inAnim', label: 'Entrance', type: 'select', group: 'Animation', default: 'zoomin', options: opt([['fade', 'Fade'], ['zoomin', 'Zoom in'], ['zoomout', 'Zoom out (from big)'], ['up', 'Slide up'], ['down', 'Slide down'], ['left', 'Slide from right'], ['pop', 'Pop'], ['spin', 'Spin in'], ['fold', 'Unfold from a sliver']]) },
    { key: 'outAnim', label: 'Exit', type: 'select', group: 'Animation', default: 'fade', options: opt([['fade', 'Fade'], ['zoomout', 'Zoom out'], ['zoomin', 'Grow & fade'], ['down', 'Slide down'], ['left', 'Slide left'], ['fold', 'Fold away'], ['spin', 'Spin away']]) },
    num('inDur', 'Entrance (ms)', 0, 4000, 50, 700, 'Animation'),
    num('outDur', 'Exit (ms)', 0, 4000, 50, 600, 'Animation'),
    num('slideDist', 'Slide distance (px)', 0, 300, 1, 60, 'Animation'),
    num('driftY', 'Sink while shown (px)', -200, 200, 1, 0, 'Animation', { help: 'Keeps gliding down (or up, negative) the whole time it is shown.' }),
    num('rotate', 'Turn while shown (degrees)', -360, 360, 0.5, 0, 'Animation'),
    num('tickDeg', 'Tick: turn per step (degrees, 0 = off)', -180, 180, 1, 0, 'Animation', { help: 'The picture jumps round a notch at a time, like the hand of a clock.' }),
    num('tickBeats', 'A step every (beats)', 0.25, 32, 0.25, 1, 'Animation', { showIf: (p) => p.tickDeg !== 0 }),
    { key: 'pivot', label: 'Turns around', type: 'select', group: 'Animation', default: 'Centre', options: opt([['Centre', 'Its centre'], ['BottomCentre', 'Its bottom edge'], ['TopCentre', 'Its top edge'], ['CentreLeft', 'Its left edge']]) },
    { ...fadeCurveParam(), group: 'Animation' },
    num('float', 'Float (px)', 0, 40, 1, 0, 'Animation'),
    num('drift', 'Slow zoom while shown', -0.3, 0.3, 0.01, 0.03, 'Animation'),
    bool('additive', 'Additive (glowy) blending', false, 'Image'),
    { key: 'tint', label: 'Tint', type: 'color', default: '#ffffff', group: 'Image' },
    bool('mirror', 'Mirrored', false, 'Image'),
    num('pulseBeats', 'Flashes a colour: every (beats, 0 = off)', 0, 16, 0.25, 0, 'Colour pulse'),
    { key: 'pulseColor', label: 'Flash colour', type: 'color', default: '#ff7ab8', group: 'Colour pulse', showIf: (p) => p.pulseBeats > 0 },
    num('pulseTime', 'Back to its tint in (ms)', 20, 3000, 10, 300, 'Colour pulse', { showIf: (p) => p.pulseBeats > 0 }),
  ],
  presets: [{ name: 'Logo zoom', values: {} }, { name: 'Pop in', values: { inAnim: 'pop', inDur: 450 } }, { name: 'Floating art', values: { inAnim: 'up', float: 8, drift: 0 } },
    { name: 'Credit line', values: { inAnim: 'down', outAnim: 'down', inDur: 600, outDur: 400, slideDist: 30, driftY: 12, drift: 0, scale: 0.45, fadeCurve: 'late' } },
    { name: 'Still overlay', values: { inAnim: 'fade', outAnim: 'fade', inDur: 0, outDur: 0, drift: 0 } }],
  async generate(ctx, p) {
    const img = p.image || ctx.map.events.background?.file;
    if (!img) return;
    const src = await ctx.loadMapImage(img);
    if (!src) return;
    const { start, end } = ctx;
    const [ti, to] = fitDurations(end - start, p.inDur, p.outDur);
    const a = start + ti, b = end - to;
    const s = ctx.sprite(await pictureFor(ctx, img), { x: p.x, y: p.y, ...(p.pivot && p.pivot !== 'Centre' ? { origin: p.pivot } : {}) });
    const S = p.scale, S2 = p.scale * (1 + p.drift);
    if (p.pulseBeats > 0) {
      const gap = Math.max(40, p.pulseBeats * ctx.map.beatLengthAt(start)), c1 = hexToRgb(p.pulseColor).map(Math.round), c0 = hexToRgb(p.tint).map(Math.round);
      for (let t = start; t < end - 1; t += gap) s._add('C', t, Math.min(t + p.pulseTime, t + gap, end), c1, c0, E.OutQuad);
    } else s.color(start, start, p.tint);
    if (p.additive) s.additive();
    if (p.mirror) s.flipH();
    if (p.inAnim === 'fold' && ti > 0) s.vec(start, a, 0.02, 1, 1, 1, E.OutCubic);
    if (p.outAnim === 'fold' && to > 0) s.vec(b, end, 1, 1, 0.02, 1, E.InCubic);
    if (p.outAnim === 'spin' && to > 0 && !p.tickDeg && !p.rotate) s.rotate(b, end, 0, Math.PI, E.InCubic);
    const [ein, eout] = fadeEases(p), late = p.fadeCurve === 'late';
    s.fade(start, a, p.inAnim === 'pop' ? p.opacity : 0, p.opacity, ein);
    s.fade(b, end, p.opacity, 0, eout);
    const sIn = { zoomin: S * 0.6, zoomout: S * 1.6, pop: 0, spin: 0 }[p.inAnim] ?? S;
    const sOut = { zoomout: S2 * 0.6, zoomin: S2 * 1.4, spin: 0 }[p.outAnim] ?? S2;
    s.scale(start, a, sIn, S, p.inAnim === 'pop' ? E.OutBack : E.OutCubic);
    s.scale(a, b, S, S2, E.InOutSine);
    s.scale(b, end, S2, sOut, E.InCubic);
    if (p.inAnim === 'spin') s.rotate(start, a, -Math.PI, 0, E.OutCubic);
    else if (p.tickDeg) {
      const step = Math.max(40, p.tickBeats * ctx.map.beatLengthAt(start)), d = (p.tickDeg * Math.PI) / 180, snap = Math.min(step, 140);
      let k = 0;
      for (let t = start; t < end - 1; t += step, k++) s.rotate(t, Math.min(end, t + snap), d * k, d * (k + 1), E.OutBack);
    } else if (p.rotate) s.rotate(start, end, 0, (p.rotate * Math.PI) / 180);
    const D = p.slideDist ?? 60, sink = p.float > 0 ? 0 : p.driftY || 0;
    const y0 = p.inAnim === 'up' ? p.y + D : p.inAnim === 'down' ? p.y - D : p.y;
    const x0 = p.inAnim === 'left' ? p.x + D * 2 : p.x;
    const y1 = p.outAnim === 'down' ? p.y + sink + D : p.y + sink;
    const x1 = p.outAnim === 'left' ? p.x - D * 2 : p.x;
    s.moveX(start, a, x0, p.x, E.OutCubic);
    s.moveX(b, end, p.x, x1, E.InCubic);
    s.moveY(start, a, y0, p.y, late ? E.InExpo : E.OutCubic);
    if (sink) s.moveY(a, b, p.y, p.y + sink, E.OutSine);
    if (p.float > 0) {
      const per = ctx.map.beatLengthAt(a) * 4;
      let t = a, up = true;
      while (t + per / 2 < b) {
        s.moveY(t, t + per / 2, up ? p.y : p.y - p.float, up ? p.y - p.float : p.y, E.InOutSine);
        t += per / 2; up = !up;
      }
      s.moveY(t, b, up ? p.y : p.y - p.float, p.y, E.InOutSine);
    }
    s.moveY(b, end, p.y + sink, y1, late ? E.InExpo : E.InCubic);
  },
};

export default [background, particles, beatPulse, lightRays, spectrumBars, colorWash, vignette, letterbox, imageShow];
