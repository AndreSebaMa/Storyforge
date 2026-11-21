import hit from './hit.js';
import ambient from './ambient.js';
import atmosphere from './atmosphere.js';
import transitions from './transitions.js';
import text from './text.js';
import stage from './stage.js';
import create from './create.js';
import shapes from './shapes.js';
import { shapeOrImage, lined } from './common.js';
import { TEXTURES } from '../assets.js';
import { isMine } from '../creations.js';

const of = (list, cat) => list.filter((e) => e.category === cat);
const ALL = [...text, ...hit, ...of(stage, 'Hit effects'), ...of(shapes, 'Hit effects'), ...ambient, ...atmosphere, ...of(shapes, 'Background & ambience'), ...stage.filter((e) => e.category !== 'Hit effects'), ...transitions, ...of(shapes, 'Transitions'), ...create];
export const TRAVEL_KEYS = ['moveX', 'moveY', 'moveEase'];
const OWN_IMAGE = { shapePop: 'shape', herald: 'texture', blownAway: 'texture', shapeRow: 'texture', dotFigure: 'texture', ringSet: 'texture',
  beatPop: 'texture', motes: 'texture', shapeCurtain: 'texture', shapeBloom: 'texture', frameBurst: 'texture' };
for (const eff of ALL) {
  const key = OWN_IMAGE[eff.id], at = eff.params.findIndex((d) => d.key === key);
  if (!key || at < 0 || eff.params.some((d) => d.key === 'image')) continue;
  const def = eff.params[at];
  eff.params.splice(at + 1, 0, { key: 'image', label: 'Own picture', type: 'image', default: '', none: 'None (the shape above)', group: def.group, showIf: def.showIf,
    help: 'Your own picture instead of the built-in shape, shown as large as that shape: one from the Create tab, from the map folder, or a file you import.' });
  const shapes = (def.options || []).map(([v]) => v), generate = eff.generate;
  eff.generate = async function (ctx, p) {
    if (!p.image) return generate.call(this, ctx, p);
    const q = { ...p, imageFit: true };
    if (!TEXTURES.includes(q[key])) q[key] = 'square';
    const path = await shapeOrImage(ctx, q, key), tex = ctx.tex;
    const names = new Set(shapes.flatMap((n) => [n, lined(n, p.lineX)]));
    if (path !== tex(lined(q[key], q.lineX))) ctx.tex = (name) => (names.has(name) ? path : tex(name));
    return generate.call(this, ctx, q);
  };
}
for (const eff of ALL) {
  const at = eff.params.findIndex((d) => d.type === 'image');
  if (at < 0 || eff.params.some((d) => d.key === 'syncAnim')) continue;
  const def = eff.params[at];
  eff.params.splice(at + 1, 0, { key: 'syncAnim', label: 'Animation in step with its other copies', type: 'bool', default: false, group: def.group,
    showIf: (p) => isMine(p[def.key]) && (!def.showIf || def.showIf(p)), help: 'Every copy with this switched on shows the same frame at the same time, whenever it comes in.' });
}
export const pictureUses = () => EFFECTS.map((e) => ({ id: e.id, name: e.name, category: e.category, key: e.params.find((d) => d.type === 'image')?.key }))
  .filter((u) => u.key || u.id === 'actor');

export const EFFECTS = ALL.filter((e) => !e.retired);
export const EFFECT_MAP = Object.fromEntries(ALL.map((e) => [e.id, e]));

export function drawOrder(instances) {
  return [...instances.filter((i) => i.effect === 'background'), ...instances.filter((i) => i.effect !== 'background')];
}
export function setUserPresets(mine) {
  for (const eff of ALL) {
    const built = (eff.presets || []).filter((p) => !p.mine);
    const own = (mine?.[eff.id] || []).filter((p) => p?.name && p.values && !built.some((b) => b.name === p.name)).map((p) => ({ name: p.name, values: p.values, mine: true }));
    if (eff.presets || own.length) eff.presets = [...built, ...own];
  }
}
export const CATEGORIES =['Text & lyrics', 'Hit effects', 'Background & ambience', 'Transitions', 'Create'];


export const KIAI_KEYS = ['kiaiOnly', 'kiaiPulseOnly', 'kiaiBright'];
export const followsKiai = (inst) => KIAI_KEYS.some((k) => inst.params?.[k] === true);

export function defaultParams(effect, presetName) {
  const p = {};
  for (const d of effect.params) p[d.key] = Array.isArray(d.default) ? d.default.slice() : d.default;
  const preset = presetName && effect.presets?.find((x) => x.name === presetName);
  if (preset) Object.assign(p, structuredClone(preset.values));
  for (const k of KIAI_KEYS) delete p[k];
  return p;
}

export function normalizeParams(effect, params) {
  const p = defaultParams(effect);
  Object.assign(p, params || {});
  for (const k of KIAI_KEYS) if (p[k] !== true) delete p[k];
  for (const k of TRAVEL_KEYS) if (k in p && !effect.params.some((d) => d.key === k)) delete p[k];
  if (params?.image && params.imageFit === undefined && 'imageFit' in p) p.imageFit = false;
  if ('lineX' in p && params?.lineX === undefined && params?.line > 0) {
    const normal = effect.id === 'ringBurst' || params.texture === 'ring-thin' || params.texture === 'ring' || params.style === 'ring' ? (params.texture === 'ring' ? 20 : 10) : 7;
    p.lineX = Math.max(0.05, Math.min(3, Math.round(params.line / normal * 20) / 20));
  }
  if ('lineX' in p) delete p.line;
  return p;
}
