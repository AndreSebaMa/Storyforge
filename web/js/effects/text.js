import { E, EASING_OPTIONS } from '../easing.js';
import { opt, fitDurations } from './common.js';
import { hexToRgb } from '../util.js';

const num = (key, label, min, max, step, def, group, extra = {}) => ({ key, label, type: 'number', min, max, step, default: def, group, ...extra });
const easing = (key, label, def, group) => ({ key, label, type: 'easing', default: def, group, options: EASING_OPTIONS });
const bool = (key, label, def, group, extra = {}) => ({ key, label, type: 'bool', default: def, group, ...extra });
const color = (key, label, def, group, extra = {}) => ({ key, label, type: 'color', default: def, group, ...extra });

const IN_ANIMS = opt([['none', 'Appear instantly'], ['fade', 'Fade'], ['rise', 'Rise up'], ['drop', 'Drop down'], ['slideL', 'Slide from left'], ['slideR', 'Slide from right'], ['sides', 'Each letter from its own side'],
  ['pop', 'Pop (bouncy)'], ['zoom', 'Zoom in from big'], ['typewriter', 'Typewriter'], ['scatter', 'Assemble from scatter'], ['spin', 'Spin in'], ['blur', 'Glow focus'], ['fanL', 'Unfold from the left'], ['fanR', 'Unfold from the right']]);
const OUT_ANIMS = opt([['none', 'Disappear instantly'], ['fade', 'Fade'], ['rise', 'Float up'], ['drop', 'Fall down'], ['slideL', 'Slide left'], ['slideR', 'Slide right'],
  ['shrink', 'Shrink'], ['zoom', 'Grow & fade'], ['scatter', 'Scatter away'], ['spin', 'Spin out'], ['typewriter', 'Erase letter by letter'], ['fanL', 'Fold away to the left'], ['fanR', 'Fold away to the right']]);
const IDLE = opt([['none', 'Nothing'], ['wave', 'Wave'], ['float', 'Float'], ['pulse', 'Pulse on beat'], ['shake', 'Shake'], ['glitch', 'Glitch'], ['karaoke', 'Karaoke fill'], ['singpop', 'Pop as it is sung'], ['apart', 'Drift apart']]);

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const CJK_TAIL = /[ゃゅょぁぃぅぇぉっゎャュョァィゥェォッヮー]/;

export function paceUnits(text) {
  const chars = [], words = [];
  let inWord = false, prevCjk = false;
  for (const ch of Array.from(String(text || '').replace(/\r/g, ''))) {
    if (!ch.trim()) { inWord = false; prevCjk = false; continue; }
    const cjk = CJK.test(ch);
    if (!inWord || (cjk && !CJK_TAIL.test(ch)) || (prevCjk && /[\p{L}\p{N}]/u.test(ch) && !cjk)) words.push(chars.length);
    inWord = true; prevCjk = cjk;
    chars.push(ch);
  }
  return { chars, words };
}
export function evenPace(text, span) {
  const { chars, words } = paceUnits(text);
  return words.map((c) => ({ c, t: Math.round((c / Math.max(1, chars.length)) * span) }));
}
export function validPace(p, text, n, dur) {
  const m = p.pace;
  if (!Array.isArray(m) || m.length < 2 || p.paceText !== text || m[0].c !== 0) return null;
  for (let k = 1; k < m.length; k++) if (!(m[k].c > m[k - 1].c) || !(m[k].t >= m[k - 1].t) || m[k].c >= n) return null;
  const f = dur > 0 && p.paceDur > 0 ? dur / p.paceDur : 1;
  return f === 1 ? m : m.map((q) => ({ c: q.c, t: q.t * f }));
}
export function paceTimes(marks, n, span) {
  const out = new Array(n);
  marks.forEach((m, k) => {
    const c1 = marks[k + 1]?.c ?? n, t0 = Math.min(m.t, span), t1 = Math.min(marks[k + 1]?.t ?? span, span);
    for (let i = m.c; i < c1; i++) out[i] = t0 + ((i - m.c) / (c1 - m.c)) * (t1 - t0);
  });
  return out;
}

export function fillTemplate(text, map) {
  const md = map?.metadata || {};
  return String(text || '')
    .replace(/\{artist\}/gi, md.Artist || '').replace(/\{title\}/gi, md.Title || '')
    .replace(/\{artistUnicode\}/gi, md.ArtistUnicode || md.Artist || '').replace(/\{titleUnicode\}/gi, md.TitleUnicode || md.Title || '')
    .replace(/\{(creator|mapper)\}/gi, md.Creator || '').replace(/\{version\}/gi, md.Version || '').replace(/\{source\}/gi, md.Source || '');
}

export const lyrics = {
  id: 'lyrics', name: 'Lyrics / Text', category: 'Text & lyrics', icon: '♪', accent: '#ff66aa', scope: 'range',
  description: 'Animated lyrics or any text. Letter-by-letter animation, glow, outline, shadow, karaoke fill. Use the Lyric Timer to tap-time a whole song.',
  defaultLayer: 'Foreground', defaultOutput: 'osb',
  params: [
    { key: 'text', label: 'Text', type: 'text', multiline: true, default: 'Your lyrics here', group: 'Text',
      placeholder: 'Type text. {title} {artist} {creator} also work',
      help: 'New line = new row. Templates: {artist} {title} {artistUnicode} {titleUnicode} {creator} {version}' },
    { key: 'font', label: 'Font', type: 'font', default: 'Montserrat', group: 'Text' },
    { key: 'weight', label: 'Weight', type: 'select', default: '600', group: 'Text', options: opt([['300', 'Light'], ['400', 'Regular'], ['600', 'Semi-bold'], ['700', 'Bold'], ['900', 'Black']]) },
    bool('italic', 'Italic', false, 'Text'),
    num('size', 'Size', 6, 140, 1, 26, 'Text'),
    num('letterSpacing', 'Letter spacing', -10, 40, 0.5, 1, 'Text'),
    { key: 'mode', label: 'Animate', type: 'select', default: 'letters', group: 'Text', options: opt([['letters', 'Letter by letter'], ['line', 'Whole line (lighter)']]) },
    { key: 'align', label: 'Align', type: 'select', default: 'centre', group: 'Position', options: opt([['left', 'Left'], ['centre', 'Centre'], ['right', 'Right']]) },
    num('x', 'X', -107, 747, 1, 320, 'Position'),
    num('y', 'Y', 0, 480, 1, 400, 'Position'),
    num('lineHeight', 'Line height', 0.6, 3, 0.05, 1.15, 'Position'),
    num('angle', 'Turned (degrees)', -180, 180, 1, 0, 'Position', { showIf: (p) => !(p.mode === 'letters' && p.curve && p.curve !== 'none'), help: 'The whole text turned round its middle, clockwise. In the picture: drag the round handle above the box.' }),
    { key: 'curve', label: 'Along a circle', type: 'select', default: 'none', group: 'Position', showIf: (p) => p.mode === 'letters',
      options: opt([['none', 'No, a straight line'], ['over', 'Yes, arching over it'], ['under', 'Yes, hanging under it']]),
      help: 'The letters stand on a circle, each turned to follow it. "Arching over" reads best above the circle\'s middle, "hanging under" below it. X and Y are not used then.' },
    num('curveX', 'Circle X', -107, 747, 1, 320, 'Position', { showIf: (p) => p.mode === 'letters' && p.curve !== 'none' }),
    num('curveY', 'Circle Y', 0, 480, 1, 240, 'Position', { showIf: (p) => p.mode === 'letters' && p.curve !== 'none' }),
    num('curveR', 'Circle radius (px)', 20, 600, 1, 120, 'Position', { showIf: (p) => p.mode === 'letters' && p.curve !== 'none' }),
    num('curveAt', 'Middle of the line at (degrees, 0 = straight above / below)', -180, 180, 1, 0, 'Position', { showIf: (p) => p.mode === 'letters' && p.curve !== 'none', help: 'Turns the whole line round the circle, clockwise.' }),
    num('curveTurn', 'Travels round while shown (degrees)', -360, 360, 1, 0, 'Position', { showIf: (p) => p.mode === 'letters' && p.curve !== 'none', help: 'The line keeps moving round the circle, clockwise (negative: the other way). Replaces the gliding and the moving kinds of "While shown".' }),

    color('color', 'Text colour', '#ffffff', 'Style'),
    num('opacity', 'Opacity', 0.05, 1, 0.05, 1, 'Style'),
    bool('glow', 'Glow', false, 'Style'),
    color('glowColor', 'Glow colour', '#ffffff', 'Style', { showIf: (p) => p.glow }),
    num('glowSize', 'Glow size', 2, 40, 1, 10, 'Style', { showIf: (p) => p.glow }),
    num('glowOpacity', 'Glow opacity', 0.05, 1, 0.05, 0.75, 'Style', { showIf: (p) => p.glow }),
    bool('outline', 'Outline', false, 'Style'),
    color('outlineColor', 'Outline colour', '#000000', 'Style', { showIf: (p) => p.outline }),
    num('outlineWidth', 'Outline width', 0.5, 8, 0.5, 2, 'Style', { showIf: (p) => p.outline }),
    bool('shadow', 'Drop shadow', true, 'Style'),
    num('shadowOpacity', 'Shadow opacity', 0.05, 1, 0.05, 0.5, 'Style', { showIf: (p) => p.shadow }),
    num('shadowOffset', 'Shadow offset', 0, 10, 0.5, 2, 'Style', { showIf: (p) => p.shadow }),
    bool('blots', 'Soft dots behind the text', false, 'Style', { help: 'A few round blots drift behind the line, so it reads on any picture.' }),
    num('blotCount', 'Dots', 1, 30, 1, 8, 'Style', { showIf: (p) => p.blots }),
    color('blotColor', 'Dot colour', '#000000', 'Style', { showIf: (p) => p.blots }),
    num('blotSize', 'Dot size (px)', 6, 160, 1, 48, 'Style', { showIf: (p) => p.blots }),
    num('blotOpacity', 'Dot opacity', 0.05, 1, 0.05, 0.55, 'Style', { showIf: (p) => p.blots }),
    bool('rgbSplit', 'RGB split', false, 'Style'),
    num('splitOffset', 'Split offset', 0.5, 8, 0.5, 1.5, 'Style', { showIf: (p) => p.rgbSplit }),
    { key: 'accent', label: 'Accent lines', type: 'select', default: 'none', group: 'Style', options: opt([['none', 'None'], ['underline', 'Underline'], ['sides', 'Lines on both sides'], ['frame', 'Over & under']]) },
    color('accentColor', 'Accent colour', '#ffffff', 'Style', { showIf: (p) => p.accent !== 'none' }),

    { key: 'inAnim', label: 'Entrance', type: 'select', default: 'rise', group: 'Entrance', options: IN_ANIMS },
    num('inDur', 'Duration (ms)', 0, 3000, 10, 450, 'Entrance'),
    { key: 'reveal', label: 'Letters appear', type: 'select', default: 'start', group: 'Entrance', showIf: (p) => p.mode === 'letters',
      options: opt([['start', 'One after another at the start'], ['sung', 'As they are sung']]),
      help: '"As they are sung" follows the singing pace of the line (set it with the word strip).' },
    num('stagger', 'Letter delay (ms)', 0, 400, 5, 40, 'Entrance', { showIf: (p) => p.mode === 'letters' && p.reveal !== 'sung' }),
    { key: 'order', label: 'Letter order', type: 'select', default: 'ltr', group: 'Entrance', options: opt([['ltr', 'Left → right'], ['rtl', 'Right → left'], ['centre', 'Centre out'], ['random', 'Random']]), showIf: (p) => p.mode === 'letters' },
    num('distance', 'Travel distance (px)', 0, 600, 1, 18, 'Entrance'),
    num('echo', 'Echo copies behind each letter', 0, 6, 1, 0, 'Entrance', { help: 'Faint copies follow the letter in, a moment behind. For entrances that move (rise, drop, slide, own side, scatter).' }),
    num('echoGap', 'Echo delay (ms)', 10, 300, 5, 50, 'Entrance', { showIf: (p) => p.echo > 0 }),
    bool('arriveTint', 'Arrive in another colour', false, 'Entrance', { help: 'The letters come in tinted and turn into the text colour as they land.' }),
    color('arriveColor', 'Arriving colour', '#ffb060', 'Entrance', { showIf: (p) => p.arriveTint }),
    easing('inEase', 'Easing', E.OutCubic, 'Entrance'),

    { key: 'idle', label: 'While shown', type: 'select', default: 'none', group: 'While shown', options: IDLE },
    num('idleAmp', 'Amount', 0, 30, 0.5, 4, 'While shown', { showIf: (p) => ['wave', 'float', 'pulse', 'shake', 'glitch', 'singpop', 'apart'].includes(p.idle), help: 'For "Drift apart": how far the letters wander (each its own amount).' }),
    { key: 'apartDir', label: 'Drifting', type: 'select', default: 'up', group: 'While shown', showIf: (p) => p.idle === 'apart', options: opt([['up', 'Upward'], ['down', 'Downward'], ['out', 'Every way']]) },
    num('glide', 'Glide sideways while shown (px)', -300, 300, 5, 0, 'While shown', { showIf: (p) => !['shake', 'glitch'].includes(p.idle), help: 'The whole line slides slowly while it is on screen. Negative = to the left.' }),
    num('moveX', 'Moves sideways while shown (px)', -900, 900, 1, 0, 'While shown', { showIf: (p) => !['shake', 'glitch'].includes(p.idle), help: 'From where it stands to this far away, over the time it is shown. In the picture: drag the arrow handle of the box to where the text should end up.' }),
    num('moveY', 'Moves down while shown (px)', -600, 600, 1, 0, 'While shown', { showIf: (p) => !['shake', 'glitch'].includes(p.idle), help: 'Negative = up.' }),
    easing('moveEase', 'Movement easing', E.Linear, 'While shown'),
    num('idlePeriod', 'Cycle length (ms)', 150, 5000, 50, 1400, 'While shown', { showIf: (p) => ['wave', 'float', 'shake', 'glitch'].includes(p.idle) }),
    color('karaokeColor', 'Fill colour', '#ff66aa', 'While shown', { showIf: (p) => p.idle === 'karaoke' }),

    { key: 'outAnim', label: 'Exit', type: 'select', default: 'fade', group: 'Exit', options: OUT_ANIMS },
    num('outDur', 'Duration (ms)', 0, 3000, 10, 350, 'Exit'),
    num('outStagger', 'Letter delay (ms)', 0, 400, 5, 20, 'Exit', { showIf: (p) => p.mode === 'letters' }),
    easing('outEase', 'Easing', E.InCubic, 'Exit'),
  ],
  presets: [
    { name: 'Letter rise', values: {} },
    { name: 'Clean fade', values: { mode: 'line', inAnim: 'fade', outAnim: 'fade', glow: false, shadow: true, inDur: 300, outDur: 300 } },
    { name: 'Typewriter', values: { font: 'Consolas', weight: '400', inAnim: 'typewriter', stagger: 55, outAnim: 'fade', glow: true, shadow: false, glowColor: '#66ccff', glowOpacity: 0.5 } },
    { name: 'Bouncy pop', values: { inAnim: 'pop', inDur: 500, stagger: 35, inEase: E.OutBack, outAnim: 'shrink', outEase: E.InBack, weight: '700' } },
    { name: 'Sing-along', values: { reveal: 'sung', inAnim: 'rise', inDur: 260, distance: 10, idle: 'singpop', idleAmp: 6 } },
    { name: 'Karaoke', values: { inAnim: 'fade', inDur: 250, stagger: 10, idle: 'karaoke', karaokeColor: '#ff66aa', glow: true, shadow: false, glowColor: '#ff66aa', color: '#dddddd' } },
    { name: 'Ink dots', values: { weight: '400', size: 22, letterSpacing: 8, inAnim: 'fade', inDur: 120, stagger: 40, glow: false, shadow: true, shadowOffset: 2, blots: true, outAnim: 'fade', outDur: 120, outStagger: 0 } },
    { name: 'Wavy', values: { inAnim: 'rise', idle: 'wave', idleAmp: 3, idlePeriod: 1200, glow: true, shadow: false, glowColor: '#66ccff' } },
    { name: 'Scatter', values: { inAnim: 'scatter', distance: 70, inDur: 800, stagger: 15, order: 'random', outAnim: 'scatter', outDur: 600, outStagger: 8 } },
    { name: 'Neon sign', values: { font: 'Montserrat', weight: '300', inAnim: 'blur', inDur: 700, stagger: 30, glow: true, shadow: false, glowColor: '#00f5d4', glowSize: 14, glowOpacity: 0.9, idle: 'pulse', idleAmp: 3 } },
    { name: 'Glitch', values: { font: 'Orbitron', weight: '700', inAnim: 'typewriter', stagger: 30, glow: false, rgbSplit: true, splitOffset: 1.5, idle: 'glitch', idleAmp: 5, idlePeriod: 900, outAnim: 'typewriter', outStagger: 15 } },
    { name: 'Unfold & glide', values: { inAnim: 'fanL', inDur: 220, stagger: 0, distance: 90, inEase: E.OutCubic, glide: 70, outAnim: 'fanR', outDur: 220, outStagger: 0, outEase: E.InCubic, glow: false, outline: true, outlineColor: '#1b1b2b' } },
    { name: 'Rising embers', values: { inAnim: 'scatter', distance: 240, inDur: 360, stagger: 0, order: 'random', inEase: E.InQuad, arriveTint: true, arriveColor: '#ffb060', idle: 'apart', idleAmp: 18, apartDir: 'up', outAnim: 'fade', outDur: 400, outStagger: 0, glow: true, shadow: false, glowColor: '#ff9a4a' } },
    { name: 'Round the circle', values: { curve: 'over', curveR: 120, curveTurn: 25, inAnim: 'fade', inDur: 300, stagger: 25, outAnim: 'fade', outDur: 350, outStagger: 15 } },
    { name: 'Hype word', values: { text: 'GO!', size: 72, weight: '900', y: 240, inAnim: 'zoom', inDur: 300, stagger: 30, inEase: E.OutExpo, idle: 'shake', idleAmp: 2, idlePeriod: 150, outAnim: 'zoom', outDur: 250 } },
  ],

  async generate(ctx, p) {
    const text = fillTemplate(p.text, ctx.map).replace(/\r/g, '');
    const rows = text.split('\n');
    if (!text.trim()) return;
    const style = { font: p.font, weight: p.weight, italic: p.italic, size: p.size, letterSpacing: p.letterSpacing, glowSize: p.glowSize, outlineWidth: p.outlineWidth };
    await ctx.ensureFont(style, text);
    const r = ctx.rng;

    const units = [];
    let lineH = 0, minX = Infinity, maxX = -Infinity;
    const lays = rows.map((row) => ctx.layoutLine(row, style));
    lineH = (lays[0]?.height || p.size) * p.lineHeight;
    rows.forEach((row, ri) => {
      const lay = lays[ri];
      const y = p.y + (ri - (rows.length - 1) / 2) * lineH;
      const x0 = p.align === 'left' ? p.x : p.align === 'right' ? p.x - lay.width : p.x - lay.width / 2;
      if (row.trim()) { minX = Math.min(minX, x0); maxX = Math.max(maxX, x0 + lay.width); }
      if (p.mode === 'line') { if (row.trim()) units.push({ text: row, x: x0 + lay.width / 2, y }); }
      else lay.chars.forEach((c) => { if (c.ch.trim()) units.push({ text: c.ch, x: x0 + c.cx, y }); });
    });
    const n = units.length;
    if (!n) return;
    const curvedText = p.mode === 'letters' && p.curve && p.curve !== 'none';
    const ang = curvedText ? 0 : ((p.angle || 0) * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    const turned = (x, y) => (ang ? { x: p.x + (x - p.x) * ca - (y - p.y) * sa, y: p.y + (x - p.x) * sa + (y - p.y) * ca } : { x, y });
    for (const u of units) { u.ux = u.x; if (ang) { Object.assign(u, turned(u.x, u.y)); u.rot = ang; } }

    const idx = units.map((_, i) => i);
    if (p.mode === 'letters') {
      if (p.order === 'rtl') idx.reverse();
      if (p.order === 'centre') idx.sort((a, b) => Math.abs(units[a].ux - (minX + maxX) / 2) - Math.abs(units[b].ux - (minX + maxX) / 2));
      if (p.order === 'random') idx.sort(() => r() - 0.5);
    }
    const rank = new Array(n); idx.forEach((u, k) => { rank[u] = k; });
    const letters = p.mode === 'letters';
    const curved = letters && p.curve && p.curve !== 'none';
    const dir = p.curve === 'under' ? -1 : 1;
    const onCircle = (th, rad) => ({ x: p.curveX + Math.sin(th) * rad, y: p.curveY - Math.cos(th) * rad });
    const turn = curved ? ((p.curveTurn || 0) * Math.PI) / 180 : 0;
    if (curved) {
      const mid = p.align === 'left' ? minX : p.align === 'right' ? maxX : (minX + maxX) / 2;
      for (const u of units) {
        u.rad = Math.max(8, p.curveR - dir * (u.y - p.y));
        u.th = (p.curve === 'under' ? Math.PI : 0) + ((p.curveAt || 0) * Math.PI) / 180 + (dir * (u.ux - mid)) / u.rad;
        u.rot = u.th - (p.curve === 'under' ? Math.PI : 0);
        Object.assign(u, onCircle(u.th, u.rad));
      }
    }
    const total = ctx.end - ctx.start;
    let inStag = letters ? p.stagger : 0, outStag = letters ? p.outStagger : 0;
    let inDur = p.inAnim === 'none' || p.inAnim === 'typewriter' ? 0 : p.inDur;
    let outDur = p.outAnim === 'none' || p.outAnim === 'typewriter' ? 0 : p.outDur;
    const inSpan = inDur + (n - 1) * inStag, outSpan = outAnimNone(p) ? 0 : outDur + (n - 1) * outStag;
    if (inSpan + outSpan > total * 0.95) {
      const k = (total * 0.95) / Math.max(1, inSpan + outSpan);
      inStag *= k; outStag *= k; inDur *= k; outDur *= k;
    }
    const outSpan2 = outAnimNone(p) ? 0 : outDur + (n - 1) * outStag;
    const marks = letters ? validPace(p, p.text, n, total) : null;
    const sungSpan = Math.max(1, total - outSpan2);
    const sung = letters ? paceTimes(marks || [{ c: 0, t: 0 }], n, sungSpan) : null;
    const bySung = letters && p.reveal === 'sung';

    const layers = [];
    if (p.shadow) layers.push({ kind: 'fill', color: [0, 0, 0], op: p.shadowOpacity, dx: p.shadowOffset, dy: p.shadowOffset });
    if (p.outline) layers.push({ kind: 'outline', color: hexToRgb(p.outlineColor), op: 1 });
    if (p.glow) layers.push({ kind: 'glow', color: hexToRgb(p.glowColor), op: p.glowOpacity, add: true });
    if (p.rgbSplit) {
      layers.push({ kind: 'fill', color: [255, 40, 90], op: 0.8, add: true, dx: -p.splitOffset, split: true });
      layers.push({ kind: 'fill', color: [40, 210, 255], op: 0.8, add: true, dx: p.splitOffset, split: true });
    }
    layers.push({ kind: 'fill', color: hexToRgb(p.color), op: 1, main: true });

    const beats = p.idle === 'pulse' ? ctx.map.beats(ctx.start, ctx.end, 1) : [];
    const canMove = !turn && !['shake', 'glitch'].includes(p.idle);
    const mvx = canMove ? (p.glide || 0) + (p.moveX || 0) : 0, mvy = canMove ? (p.moveY || 0) : 0;
    if (isFinite(minX)) {
      ctx.meta = {
        box: curved ? null : { cx: (minX + maxX) / 2, px: p.x, cy: p.y, w: maxX - minX, h: rows.length * lineH, size: p.size },
        move: { x: mvx, y: mvy, a: ctx.start + inDur + ((n - 1) * inStag) / 2, b: ctx.end - outSpan2 + ((n - 1) * outStag) / 2, ease: p.moveEase || 0 },
      };
    }

    if (p.blots && isFinite(minX) && !curved) {
      const tw = ctx.texSize('dot').w, halfH = (rows.length * lineH) / 2;
      const count = Math.round(p.blotCount), out = Math.max(60, Math.min(outDur || 120, total / 3));
      for (let b = 0; b < count; b++) {
        const t0 = Math.min(ctx.end - out - 1, ctx.start + 60 + b * 30);
        const { x, y } = turned(r.range(minX, maxX), p.y + r.range(-halfH - 6, halfH + 6));
        const sc = (p.blotSize * r.range(0.45, 1.25)) / tw, op = p.blotOpacity * r.range(0.8, 1.2);
        const s = ctx.sprite(ctx.tex('dot'), { x, y });
        s.color(t0, t0, p.blotColor);
        s.fade(t0, t0 + 100, 0, Math.min(1, op));
        s.scale(t0, t0 + 100, 0, sc);
        s.move(t0, ctx.end, x, y, x + mvx + r.range(-9, 9), y + mvy + r.range(-9, 9));
        s.fade(ctx.end - out, ctx.end, Math.min(1, op), 0);
      }
    }

    units.forEach((u, i) => {
      const o = rank[i];
      const tIn = bySung ? Math.max(ctx.start, ctx.start + sung[i] - inDur * 0.6) : ctx.start + o * inStag;
      const inEnd = tIn + inDur;
      const tOut = outAnimNone(p) ? ctx.end : ctx.end - outSpan2 + o * outStag;
      const tOutEnd = tOut + outDur;
      const rnd = { ax: r.range(-1, 1), ay: r.range(-1, 1), rot: r.range(-1, 1), rot2: r.range(-1, 1), bx: r.range(-1, 1), by: r.range(-1, 1) };
      const karaokeT = marks || bySung ? Math.max(bySung ? tIn : inEnd, ctx.start + sung[i])
        : Math.max(inEnd, ctx.start + inSpan * 0.6 + ((letters ? i : 0) / Math.max(1, n)) * (tOut - ctx.start - inSpan * 0.6));
      const glitches = [];
      if (p.idle === 'glitch') {
        let t = inEnd + r.range(0.1, 1) * p.idlePeriod;
        while (t + 130 < tOut) {
          glitches.push({ t, dx: r.range(-1, 1), flicker: r.chance(0.5) });
          t += r.range(0.35, 1.6) * p.idlePeriod;
        }
      }

      for (const L of layers) {
        const img = ctx.textImage(u.text, style, L.kind);
        const S = img.scale;
        const X = u.x + (L.dx || 0), Y = u.y + (L.dy || 0);
        const op = L.op * p.opacity;
        const s = ctx.sprite(img.path, { x: X, y: Y });
        if (L.main && p.arriveTint && inDur > 0) s.color(tIn, inEnd, hexToRgb(p.arriveColor), L.color, E.InQuad); else s.color(tIn, tIn, L.color);
        if (L.add) s.additive();
        const d = p.distance;
        let Xe = X, Ye = Y;
        let usedScale = false;
        const R0 = u.rot || 0;
        let Re = R0;
        if (R0 && p.inAnim !== 'spin' && p.inAnim !== 'scatter') s.rotate(tIn, tIn, R0);

        switch (p.inAnim) {
          case 'none': case 'typewriter': s.fade(tIn, tIn, op); break;
          case 'pop':
            s.fade(tIn, tIn + inDur * 0.3, 0, op); s.scale(tIn, inEnd, 0, S, p.inEase); usedScale = true; break;
          case 'zoom':
            s.fade(tIn, inEnd, 0, op, E.OutQuad); s.scale(tIn, inEnd, S * 2.4, S, p.inEase); usedScale = true; break;
          case 'spin':
            s.fade(tIn, inEnd, 0, op, E.OutQuad); s.scale(tIn, inEnd, 0, S, p.inEase); s.rotate(tIn, inEnd, R0 - Math.PI * (0.6 + 0.4 * rnd.rot), R0, p.inEase); usedScale = true; break;
          case 'blur':
            if (L.kind === 'glow') { s.fade(tIn, tIn + inDur * 0.5, 0, Math.min(1, op * 1.6), E.OutQuad); s.fade(tIn + inDur * 0.5, inEnd, Math.min(1, op * 1.6), op); }
            else s.fade(tIn + inDur * 0.35, inEnd, 0, op, E.OutQuad);
            s.scale(tIn, inEnd, S * 1.25, S, p.inEase); usedScale = true; break;
          default:
            s.fade(tIn, inEnd, 0, op, p.inAnim === 'fade' ? p.inEase : E.OutQuad);
        }
        if (p.inAnim === 'rise') s.moveY(tIn, inEnd, Y + d, Y, p.inEase);
        if (p.inAnim === 'drop') s.moveY(tIn, inEnd, Y - d, Y, p.inEase);
        if (p.inAnim === 'slideL') s.moveX(tIn, inEnd, X - d * 2, X, p.inEase);
        if (p.inAnim === 'slideR') s.moveX(tIn, inEnd, X + d * 2, X, p.inEase);
        if (p.inAnim === 'fanL' || p.inAnim === 'fanR') s.moveX(tIn, inEnd, (p.inAnim === 'fanL' ? minX - d * 2 : maxX + d * 2) + (L.dx || 0), X, p.inEase);
        if (p.inAnim === 'scatter') {
          s.moveX(tIn, inEnd, X + rnd.ax * d * 2, X, p.inEase);
          s.moveY(tIn, inEnd, Y + rnd.ay * d * 1.5, Y, p.inEase);
          s.rotate(tIn, inEnd, R0 + rnd.rot * 1.5, R0, p.inEase);
        }
        const side = Math.floor((rnd.ax + 1) * 2) % 4;
        if (p.inAnim === 'sides') { if (side < 2) s.moveX(tIn, inEnd, X + (side ? d : -d) * 1.6, X, p.inEase); else s.moveY(tIn, inEnd, Y + (side === 3 ? d : -d) * 1.6, Y, p.inEase); }
        if (p.echo > 0 && L.main && inDur > 0) {
          const from = { rise: [X, Y + d], drop: [X, Y - d], slideL: [X - d * 2, Y], slideR: [X + d * 2, Y], scatter: [X + rnd.ax * d * 2, Y + rnd.ay * d * 1.5],
            sides: side < 2 ? [X + (side ? d : -d) * 1.6, Y] : [X, Y + (side === 3 ? d : -d) * 1.6] }[p.inAnim];
          if (from) for (let c = 1; c <= p.echo; c++) {
            const dl = c * p.echoGap, eo = op * 0.45 * (1 - c / (p.echo + 1));
            const es = ctx.sprite(img.path, { x: X, y: Y });
            es.move(tIn + dl, inEnd + dl, from[0], from[1], X, Y, p.inEase);
            es.scale(tIn + dl, tIn + dl, S);
            if (R0) es.rotate(tIn + dl, tIn + dl, R0);
            es.fade(tIn + dl, tIn + dl + inDur * 0.5, 0, eo, E.OutQuad); es.fade(inEnd + dl, inEnd + dl + 160, eo, 0);
            es.color(tIn + dl, tIn + dl, L.color);
            if (L.add) es.additive();
          }
        }
        if (!usedScale) s.scale(tIn, tIn, S);

        const a = inEnd, b = tOut;
        const glide = mvx;
        const still = !!turn;
        const waving = p.idle === 'wave' || p.idle === 'float';
        const mEase = p.moveEase || 0;
        if (b - a > 80 && turn) {
          const steps = Math.max(1, Math.ceil(Math.abs(p.curveTurn) / 5));
          let px = X, py = Y;
          for (let k = 1; k <= steps; k++) {
            const q = onCircle(u.th + (turn * k) / steps, u.rad), ta = a + ((b - a) * (k - 1)) / steps, tb = a + ((b - a) * k) / steps;
            const nx = q.x + (L.dx || 0), ny = q.y + (L.dy || 0);
            s.moveX(ta, tb, px, nx); s.moveY(ta, tb, py, ny);
            px = nx; py = ny;
          }
          Xe = px; Ye = py; Re = R0 + turn;
          s.rotate(a, b, R0, Re);
        } else if (b - a > 80 && p.idle === 'apart') {
          const far = p.idleAmp * 5 * (0.35 + 0.65 * Math.abs(rnd.by));
          const way = p.apartDir === 'out' ? rnd.bx * Math.PI : (p.apartDir === 'down' ? Math.PI / 2 : -Math.PI / 2) + rnd.bx * 0.35;
          Xe = X + Math.cos(way) * far + glide; Ye = Y + Math.sin(way) * far + mvy;
          s.moveX(a, b, X, Xe, E.InQuad); s.moveY(a, b, Y, Ye, E.InQuad);
          if (L.main || L.kind === 'outline') { Re = R0 + rnd.rot * 0.25; s.rotate(a, b, R0, Re, E.InQuad); }
        } else if (b - a > 80 && (glide || mvy)) {
          Xe = X + glide; Ye = Y + mvy;
          if (glide) s.moveX(a, b, X, Xe, mEase);
          if (mvy && !waving) s.moveY(a, b, Y, Ye, mEase);
        }
        if (b - a > 80) {
          if (still && ['wave', 'float', 'shake', 'glitch'].includes(p.idle)) { }
          else if (waving) {
            const phase = p.idle === 'wave' ? (o * 90) % p.idlePeriod : 0;
            oscillate(s, 'moveY', a, b, Y, p.idleAmp, p.idlePeriod, phase, mvy);
          } else if (p.idle === 'shake') {
            let t = a; const step = Math.max(30, p.idlePeriod / 2);
            let px = X, py = Y;
            while (t + step < b) {
              const nx = X + r.range(-1, 1) * p.idleAmp, ny = Y + r.range(-1, 1) * p.idleAmp;
              s.moveX(t, t + step, px, nx); s.moveY(t, t + step, py, ny);
              px = nx; py = ny; t += step;
            }
            s.moveX(t, b, px, X); s.moveY(t, b, py, Y);
          } else if (p.idle === 'pulse') {
            const k = 1 + p.idleAmp / 40;
            const bs = beats.filter((bt) => bt.time >= a && bt.time < b);
            bs.forEach((bt, j) => {
              const nx = Math.min(b, bs[j + 1]?.time ?? b, bt.time + ctx.map.beatLengthAt(bt.time) * 0.9);
              s.scale(bt.time, nx, S * k, S, E.OutQuad);
              if (L.kind === 'glow') s.fade(bt.time, nx, Math.min(1, op * 1.5), op, E.OutQuad);
            });
          } else if (p.idle === 'glitch') {
            const amp = p.idleAmp * (L.split ? 2.2 : 1);
            for (const g of glitches) {
              s.moveX(g.t, g.t + 50, X, X + g.dx * amp, E.OutQuad);
              s.moveX(g.t + 50, g.t + 120, X + g.dx * amp, X);
              if (g.flicker && L.main) { s.fade(g.t, g.t + 40, op, op * 0.25); s.fade(g.t + 40, g.t + 120, op * 0.25, op); }
            }
          } else if (p.idle === 'singpop' && letters) {
            const k = 1 + p.idleAmp / 20, t = Math.max(a, ctx.start + sung[i]), up = Math.min(b, t + 70), dn = Math.min(b, t + 330);
            if (dn > up) { s.scale(t, up, S, S * k, E.OutQuad); s.scale(up, dn, S * k, S, E.OutQuad); }
            if (L.kind === 'glow' && dn > t) s.fade(t, dn, Math.min(1, op * 1.7), op, E.OutQuad);
          } else if (p.idle === 'karaoke' && L.main) {
            s.color(karaokeT, karaokeT + 120, L.color, hexToRgb(p.karaokeColor));
          } else if (p.idle === 'karaoke' && L.kind === 'glow') {
            const fe = Math.min(b, karaokeT + 400);
            if (fe > karaokeT) s.fade(karaokeT, fe, Math.min(1, op * 1.6), op, E.OutQuad);
          }
        }

        const lastOp = op;
        switch (p.outAnim) {
          case 'none': s.fade(ctx.end, ctx.end, lastOp); break;
          case 'typewriter': s.fade(tOut, tOut, 0); break;
          case 'shrink': s.fade(tOut, tOutEnd, lastOp, 0, E.InQuad); s.scale(tOut, tOutEnd, S, 0, p.outEase); break;
          case 'zoom': s.fade(tOut, tOutEnd, lastOp, 0, E.OutQuad); s.scale(tOut, tOutEnd, S, S * 2, p.outEase); break;
          case 'spin': s.fade(tOut, tOutEnd, lastOp, 0, E.InQuad); s.scale(tOut, tOutEnd, S, 0, p.outEase); s.rotate(tOut, tOutEnd, Re, Re + Math.PI * (0.6 + 0.4 * rnd.rot2), p.outEase); break;
          default: s.fade(tOut, tOutEnd, lastOp, 0, p.outAnim === 'fade' ? p.outEase : E.InQuad);
        }
        if (p.outAnim === 'rise') s.moveY(tOut, tOutEnd, Ye, Ye - d, p.outEase);
        if (p.outAnim === 'drop') s.moveY(tOut, tOutEnd, Ye, Ye + d * 1.5, p.outEase);
        if (p.outAnim === 'slideL') s.moveX(tOut, tOutEnd, Xe, Xe - d * 2, p.outEase);
        if (p.outAnim === 'slideR') s.moveX(tOut, tOutEnd, Xe, Xe + d * 2, p.outEase);
        if (p.outAnim === 'fanL' || p.outAnim === 'fanR') s.moveX(tOut, tOutEnd, Xe, (p.outAnim === 'fanL' ? minX - d * 2 : maxX + d * 2) + glide + (L.dx || 0), p.outEase);
        if (p.outAnim === 'scatter') {
          s.moveX(tOut, tOutEnd, Xe, Xe + rnd.bx * d * 2.5, p.outEase);
          s.moveY(tOut, tOutEnd, Ye, Ye + rnd.by * d * 2, p.outEase);
          s.rotate(tOut, tOutEnd, Re, Re + rnd.rot2 * 2, p.outEase);
        }
      }
    });

    if (p.accent !== 'none' && isFinite(minX) && !curved) {
      const w = maxX - minX, cx = (minX + maxX) / 2;
      const halfH = (rows.length * lineH) / 2 + 6;
      const cy = p.y;
      const a0 = ctx.start, a1 = ctx.start + Math.max(300, inSpan);
      const b0 = ctx.end - Math.max(250, outSpan2), b1 = ctx.end;
      const line = (x0, y0, origin, len) => {
        const { x, y } = turned(x0, y0);
        const s = ctx.sprite(ctx.tex('pixel'), { origin, x, y });
        if (ang) s.rotate(a0, a0, ang);
        if ((mvx || mvy) && b0 > a1) s.move(a1, b0, x, y, x + mvx, y + mvy, p.moveEase || 0);
        s.color(a0, a0, p.accentColor);
        s.vec(a0, a1, 0, 1.5, len, 1.5, E.OutCubic);
        s.vec(b0, b1, len, 1.5, 0, 1.5, E.InCubic);
        s.fade(a0, a0, 0.9 * p.opacity);
      };
      if (p.accent === 'underline' || p.accent === 'frame') line(p.align === 'left' ? minX : p.align === 'right' ? maxX : cx, cy + halfH, p.align === 'left' ? 'CentreLeft' : p.align === 'right' ? 'CentreRight' : 'Centre', w + 10);
      if (p.accent === 'frame') line(cx, cy - halfH, 'Centre', w + 10);
      if (p.accent === 'sides') {
        line(minX - 16, cy, 'CentreRight', 70);
        line(maxX + 16, cy, 'CentreLeft', 70);
      }
    }
  },
};

function outAnimNone(p) { return p.outAnim === 'none'; }

function oscillate(s, method, a, b, base, amp, period, phase, drift = 0) {
  const mid = (t) => base + (drift * (t - a)) / Math.max(1, b - a);
  if (amp <= 0 || a + phase + period / 2 > b) { if (drift) s[method](a, b, base, base + drift); return; }
  let t = a + phase;
  const q = period / 4, h = period / 2;
  if (drift && phase > 0) s[method](a, t, base, mid(t));
  let cur = mid(t + q) - amp;
  s[method](t, t + q, mid(t), cur, E.OutSine);
  t += q;
  let sign = 1;
  while (t + h + q <= b) {
    const nxt = mid(t + h) + sign * amp;
    s[method](t, t + h, cur, nxt, E.InOutSine);
    cur = nxt; sign = -sign; t += h;
  }
  s[method](t, b, cur, base + drift, E.InSine);
}

export const titleCard = {
  ...lyrics,
  id: 'titleCard', name: 'Song Info / Title', icon: '❖', accent: '#ffd166',
  description: 'The title, the artist, the credits. {title} {artist} {creator} {version} fill themselves in from the map.',
  params: lyrics.params.map((d) => (d.key === 'text' ? { ...d, default: '{artist}\n{title}', placeholder: '{title} {artist} {creator} {version}, or any text' } : d)),
  presets: [
    { name: 'Song info card', values: { text: '{artist}\n{title}', size: 22, y: 380, align: 'left', x: -60, inAnim: 'slideL', distance: 30, inDur: 700, stagger: 20, accent: 'underline', accentColor: '#ff66aa', glow: false, shadow: true } },
    { name: 'Cinematic title', values: { text: '{title}', size: 40, weight: '300', letterSpacing: 9, y: 240, inAnim: 'fade', inDur: 1200, stagger: 60, order: 'centre', glow: true, shadow: false, glowOpacity: 0.4, glowColor: '#ffffff', accent: 'sides', outAnim: 'fade', outDur: 900, outStagger: 0 } },
    { name: 'Map credits', values: { text: '{title}\nmapped by {creator}', size: 15, weight: '400', align: 'right', x: 735, y: 448, lineHeight: 1.3, inAnim: 'fade', inDur: 700, stagger: 8, glow: false, shadow: true, outAnim: 'fade', outDur: 700, outStagger: 0 } },
  ],
};
const WAS_LYRICS = titleCard.presets.map((p) => p.name);
export function migrateText(inst) {
  if (inst.effect === 'lyrics' && WAS_LYRICS.includes(inst.preset) && /\{(title|artist|creator|mapper|version|source)/i.test(inst.params?.text || '')) inst.effect = 'titleCard';
  return inst;
}

export default [lyrics, titleCard];
