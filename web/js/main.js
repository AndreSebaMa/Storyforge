import { el, fmtTime, parseTime, parseOsuTimestamp, uid, debounce, fmtCount, clamp, hashStr } from './util.js';
import { parseOsu, resolveTimestamp } from './osu.js';
import * as A from './assets.js';
import { serialize, stats, LAYERS } from './sb.js';
import { pictureUses, EFFECTS, EFFECT_MAP, CATEGORIES, defaultParams, normalizeParams, drawOrder, setUserPresets, KIAI_KEYS, TRAVEL_KEYS, followsKiai } from './effects/index.js';
import { makeContext, fitOwnImage } from './effects/common.js';
import { fillTemplate, paceUnits, evenPace, validPace, migrateText } from './effects/text.js';
import { loadAudioData, waveformPeaks } from './audio.js';
import { parseStoryboard } from './osbImport.js';
import { PreviewGrid } from './preview.js';
import { StageEdit } from './stageEdit.js';
import { openMenu } from './menu.js';
import { Timeline } from './timeline.js';
import { control } from './controls.js';
import { modal, modalOpen, openMapPicker, openSettings, openLyricTimer } from './modals.js';
import { initSkin } from './skin.js';
import { setCreations, creationsVersion, creations, getCreation, mineOptions, isMine as isMinePicture } from './creations.js';
import { FREQUENT } from './frequent.js';
import { initCreateTab } from './createTab.js';

const $ = (id) => document.getElementById(id);

const api = {
  async get(path) {
    const r = await fetch(path);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  },
  async post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SBKit': '1' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { busy: !!j.busy });
    return j;
  },
};
window.addEventListener('error', (e) => api.post('/api/log', { msg: `${e.message} @ ${e.filename}:${e.lineno}` }).catch(() => {}));
window.addEventListener('unhandledrejection', (e) => api.post('/api/log', { msg: `unhandled: ${e.reason?.stack || e.reason}` }).catch(() => {}));

const DEFAULT_PREFS = {
  notes: true, bg: true, safe: false, loop: false, follow: false, accum: false, existing: true, snap: 4, volume: 0.6, speed: 1,
  autoWrite: false, recent: [], lyricDrafts: {}, leftW: null, rightW: null, bottomH: null,
};
const S = {
  server: {}, prefs: { ...DEFAULT_PREFS },
  folder: null, mapset: null, maps: {}, refDiff: null, map: null, audioUrl: null,
  project: { version: 1, instances: [] },
  selection: null, selectedId: null,
  gen: new Map(), time: 0, playing: false, duration: 60000, dirty: true,
  tosu: { connected: false }, fonts: [], captureNext: 'start', previewLoop: null,
  existing: { osb: [], diffs: {} }, waveform: null,
  clientId: Math.random().toString(36).slice(2), osu: { running: false }, lastInstId: null,
};
let mapVersion = 0;
const loadMap = (text) => {
  if (!/osu file format v\d+/.test(text.slice(0, 300)) || !text.includes('[HitObjects]')) throw new Error('not a complete .osu file');
  return Object.assign(parseOsu(text), { loadedAt: ++mapVersion });
};
async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.text();
}
window.sbk = { S };
const SB_READ = new URLSearchParams(location.search).has('raw') ? { skipPrefix: '\u0000' } : undefined;

const audio = $('audio');
let audioOk = false, clock = { start: 0, base: 0 };
const preview = new PreviewGrid($('stageCells'));
const renderer = preview.cells[0].renderer;
const timeline = new Timeline($('timeline'), {
  get map() { return S.map; },
  get duration() { return S.duration; },
  get time() { return S.time; },
  get selection() { return S.selection; },
  get instances() { return zOrder(S.project.instances.filter(visibleInPreview)); },
  get selectedId() { return S.selectedId; },
  get pickedIds() { return pickedIds(); },
  get sections() { return timelineSections(); },
  get bookmarks() { return allBookmarks(); },
  get waveform() { return S.waveform; },
  get highlightTimes() { const i = selectedInstance(); return i?.objectTimes?.length ? new Set(i.objectTimes) : null; },
  effectOf: (inst) => EFFECT_MAP[inst.effect],
  isOver: (inst) => effectiveLayer(inst) === 'Overlay',
  snap: (t, noSnap) => (noSnap ? Math.round(t) : snapTime(t)),
  onSeek: (t) => seek(t),
  onSelect: (sel, final) => setSelection(sel ? (sel.clear ? null : { ...sel, source: 'timeline' }) : S.selection, !final),
  onPickInstance: (id, e) => {
    const inst = S.project.instances.find((i) => i.id === id);
    if (inst && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      const key = members(inst)[0].id;
      const cur = selectedInstance();
      if (!C.pick.size && cur && cur.id !== id) C.pick.add(members(cur)[0].id);
      const fromId = C.pickLast && C.pick.has(C.pickLast) ? C.pickLast : cur?.id;
      const from = e.shiftKey && inst.effect === 'lyrics' ? S.project.instances.find((i) => i.id === fromId && i.effect === 'lyrics' && i.id !== id) : null;
      if (from) {
        const a = Math.min(from.start, inst.start), b = Math.max(from.start, inst.start);
        for (const i of S.project.instances) if (i.effect === 'lyrics' && i.start >= a && i.start <= b) C.pick.add(members(i)[0].id);
      } else if (C.pick.has(key)) C.pick.delete(key); else C.pick.add(key);
      C.pickLast = key;
      return renderCFx();
    }
    if (C.pick.size) { C.pick.clear(); renderCFx(); }
    C.pickLast = null;
    if (id !== S.selectedId) selectInstance(id, { fromTimeline: true });
  },
  onGroupDone: () => { commit(); renderCFx(); },
  onRestack: (inst, where) => restackTo(inst, where),
  onMenu: (m) => (m.inst ? instMenu(m.inst, m.x, m.y) : timelineMenu(m)),
  onFocusInstance: (inst) => { seek(inst.start); },
  onInstanceChange: (inst, { start, end }, done) => {
    inst.start = start; inst.end = end; syncEnd(inst);
    scheduleGen(inst);
    if (done) { commit(); renderCFx(); }
  },
});

function toast(msg, kind = 'info', { action, ms = 3500 } = {}) {
  const t = el('div', { class: `toast ${kind}` }, msg);
  if (action) t.append(el('button', { class: 'mini-btn', onclick: () => { action.fn(); t.remove(); } }, action.label));
  $('toasts').append(t);
  setTimeout(() => t.remove(), action ? ms * 2.5 : ms);
  if (kind === 'bad') api.post('/api/log', { msg: 'toast: ' + msg }).catch(() => {});
}
function appendAll(arr, items) { for (let i = 0; i < items.length; i++) arr.push(items[i]); return arr; }
const fileUrl = (p) => `/api/file?folder=${encodeURIComponent(S.folder)}&path=${encodeURIComponent(p)}`;
A.setFileUrlResolver(fileUrl);
const mapFor = (inst) => S.maps[inst.diff] || S.map;
const selectedInstance = () => S.project.instances.find((i) => i.id === S.selectedId) || null;
const visibleInPreview = (inst) => inst.output !== 'diff' || !inst.diff || inst.diff === S.refDiff;
const snapTime = (t) => (!S.map || !+S.prefs.snap ? Math.round(t) : S.map.snap(t, +S.prefs.snap));
function zOrder(list) {
  const at = new Map(drawOrder(S.project.instances).map((i, k) => [i, k]));
  const key = (i) => (LAYER_RANK[effectiveLayer(i)] ?? 1) * 4 + (inDiffFile(i) ? (liftedInst(i) ? 0 : 1) : 2);
  return [...list].sort((a, b) => key(a) - key(b) || at.get(a) - at.get(b));
}
const TEXT_FX = new Set(['lyrics', 'titleCard']);
const stageEdit = new StageEdit($('stage'), {
  active: () => !!S.map && preview.count === 1 && !PV.hover && !locked(),
  cellRect: () => preview.cells[0].el.getBoundingClientRect(),
  time: () => S.time,
  target: () => selectedInstance(),
  meta: (inst) => S.gen.get(inst.id)?.meta,
  effectOf: (inst) => EFFECT_MAP[inst.effect],
  textInsts: () => S.project.instances.filter((i) => TEXT_FX.has(i.effect) && isWritten(i) && visibleInPreview(i)),
  onEdit: (inst, changes, { done, alt, dx, dy }) => {
    const set = (i, k, v) => {
      const d = EFFECT_MAP[i.effect].params.find((x) => x.key === k);
      if (!d) return;
      i.params[k] = d.type === 'number' ? clamp(v, d.min, d.max) : v;
      if (i.effect === 'lyrics') i.own = [...new Set([...(i.own || []), k])];
    };
    for (const [k, v] of Object.entries(changes)) set(inst, k, v);
    const placeKeys = (i) => { const s = stageEdit.shape(i, i.start); return s ? [s.xk, s.yk] : TEXT_FX.has(i.effect) ? ['x', 'y'] : null; };
    const together = !alt && C.pick.size > 1 && C.pick.has(members(inst)[0].id);
    const others = alt && inst.effect === 'lyrics' ? S.project.instances.filter((i) => i.effect === 'lyrics' && i.id !== inst.id)
      : together ? S.project.instances.filter((i) => i.id !== inst.id && C.pick.has(members(i)[0].id) && placeKeys(i)) : [];
    for (const o of others) {
      const [xk, yk] = placeKeys(o) || ['x', 'y'];
      if (dx) set(o, xk, o.params[xk] + dx);
      if (dy) set(o, yk, o.params[yk] + dy);
      if (together && (dx || dy)) scheduleGen(o, 30);
    }
    scheduleGen(inst, done ? 0 : 30);
    if (done) { for (const o of others) scheduleGen(o, 0); commit(); renderCFx(); }
    S.dirty = true;
  },
});
const diffName = (file) => S.maps[file]?.metadata.Version || file;
const savePrefs = debounce(() => api.post('/api/settings', { prefs: S.prefs }).catch(() => {}), 600);

function autoLabel(inst) {
  const eff = EFFECT_MAP[inst.effect];
  if (inst.effect === 'lyrics' || inst.effect === 'titleCard') {
    const line = fillTemplate(inst.params.text, mapFor(inst)).split('\n').find((l) => l.trim()) || '';
    if (line) return `“${line.trim().slice(0, 48)}”`;
    if (inst.effect === 'lyrics') return '(no words yet)';
  }
  const own = eff.label?.(inst.params);
  if (own) return own;
  return inst.preset ? `${eff.name} · ${inst.preset}` : eff.name;
}
function refreshLabel(inst) { if (inst.autoLabel !== false) inst.label = autoLabel(inst); }

function syncEnd(inst) {
  const eff = EFFECT_MAP[inst.effect];
  if (eff?.scope === 'point') inst.end = inst.start + Math.max(50, eff.length ? eff.length(inst.params) : 1000);
}

const castId = (inst) => inst.params.character || creations()[0]?.id || '';
function castOnMap() {
  const n = new Map();
  for (const i of S.project.instances) if (i.effect === 'actor') n.set(castId(i), (n.get(castId(i)) || 0) + 1);
  return [...n].filter(([id]) => getCreation(id)).map(([id, count]) => ({ id, name: getCreation(id).name, count }));
}
function samePose(name, poses) {
  const a = name.trim().toLowerCase();
  let best = poses.find((p) => p.name.trim().toLowerCase() === a), len = 3;
  if (best) return best;
  for (const p of poses) {
    const b = p.name.trim().toLowerCase();
    let n = 0;
    while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
    if (n > len) { best = p; len = n; }
  }
  return best || null;
}
function recast(from, to) {
  const a = getCreation(from), b = getCreation(to), missing = new Set();
  let blocks = 0;
  for (const i of S.project.instances) {
    if (i.effect !== 'actor' || castId(i) !== from || !b) continue;
    const was = a?.poses.find((p) => p.id === i.params.pose) || a?.poses[0];
    const now = was && samePose(was.name, b.poses);
    if (was && !now) missing.add(was.name);
    i.params.character = to; i.params.pose = now ? now.id : '';
    refreshLabel(i); blocks++;
  }
  if (blocks) commit();
  return { blocks, missing: [...missing] };
}

function useMine(effectId, value, name) {
  const eff = EFFECT_MAP[effectId];
  if (!eff) return null;
  const values = defaultParams(eff, eff.presets?.find((p) => !p.mine)?.name);
  if (effectId === 'actor') { const [, id, pose] = value.split(':'); values.character = id; values.pose = pose || ''; }
  else {
    values[eff.params.find((d) => d.type === 'image').key] = value;
    if ('imageFit' in values) values.imageFit = true;
  }
  for (const k of OWN_KEYS) delete values[k];
  const list = ((S.prefs.myPresets ||= {})[eff.id] ||= []);
  let preset = String(name || 'My picture').slice(0, 60);
  if (eff.presets?.some((p) => p.name === preset && !p.mine)) preset += ' (mine)';
  const old = list.findIndex((p) => p.name === preset);
  if (old >= 0) list[old] = { name: preset, values }; else list.push({ name: preset, values });
  C.openCat = eff.category; C.openFx = eff.id; S.prefs.cCat = C.openCat;
  $('libSearch').value = '';
  myPresetsChanged();
  requestAnimationFrame(() => {
    const chip = [...$('libList').querySelectorAll('.chip.mine')].find((x) => x.textContent.replace('✕', '').trim() === preset);
    if (chip) { chip.scrollIntoView({ block: 'center' }); chip.classList.add('fresh'); setTimeout(() => chip.classList.remove('fresh'), 6000); }
  });
  return { preset, effect: eff.name, category: eff.category };
}

const ACTOR_PATH_KEYS = ['character', 'path', 'move', 'x', 'y', 'area', 'period', 'toX', 'toY', 'speed', 'rest'];
const usesMine = (inst) => Object.values(inst.params || {}).some(isMinePicture);
const actorBlocks = () => S.project.instances.filter((i) => i.effect === 'actor' && i.enabled !== false)
  .map((i) => ({ start: i.start, end: i.end, params: Object.fromEntries(ACTOR_PATH_KEYS.map((k) => [k, i.params[k]])) }));
function genKey(inst) {
  const m = mapFor(inst);
  return JSON.stringify([inst.effect, inst.start, inst.end, inst.seed, inst.layer, inst.params, inst.objectTimes, inst.diff, m?.loadedAt, inst.effect === 'actor' ? [creationsVersion(), actorBlocks()] : usesMine(inst) ? creationsVersion() : 0]);
}
function generate(inst) {
  const eff = EFFECT_MAP[inst.effect];
  const map = mapFor(inst);
  if (!eff || !map) return Promise.resolve();
  const key = genKey(inst);
  const cur = S.gen.get(inst.id);
  if (cur && cur.key === key && cur.promise) return cur.promise;
  const token = (cur?.token || 0) + 1;
  const entry = { ...(cur || {}), key, token, pending: true };
  S.gen.set(inst.id, entry);
  entry.promise = runGenerate(inst, eff, map, key, token);
  return entry.promise;
}
async function runGenerate(inst, eff, map, key, token) {
  const targets = inst.objectTimes?.length
    ? (() => { const set = new Set(inst.objectTimes); return map.objects.filter((o) => set.has(o.time)); })()
    : map.objectsInRange(inst.start, inst.end);
  const ctx = makeContext(map, inst, targets, { audio: () => (S.audioUrl ? loadAudioData(S.audioUrl).catch(() => null) : null), siblings: inst.effect === 'actor' ? actorBlocks() : null });
  let error = null;
  try {
    await eff.generate(ctx, inst.params);
    fitOwnImage(ctx);
  } catch (e) {
    console.error(e);
    error = e.message || String(e);
  }
  const g = S.gen.get(inst.id);
  if (!g || g.token !== token) return;
  const sprites = ctx.sprites.map((s) => s.finalize()).filter((s) => isFinite(s.start));
  Object.assign(g, { sprites, stats: stats(sprites), error, pending: false, warning: null, meta: ctx.meta || null });
  if (!error && !sprites.length && eff.scope === 'objects') g.warning = 'No notes matched - select notes or change "Trigger on".';
  if (!error && !sprites.length && inst.params.kiaiOnly && !map.kiai.some((k) => k.end > inst.start && k.start < inst.end)) g.warning = 'Nothing to show: this effect was saved to follow kiai time, and there is none here. Open it and press "Show it over its whole length".';
}
const genTimers = new Map();
function scheduleGen(inst, delay = 40) {
  clearTimeout(genTimers.get(inst.id));
  genTimers.set(inst.id, setTimeout(async () => {
    await generate(inst);
    rebuildScene();
    updateCFx();
    renderStats();
  }, delay));
}
async function genAll() {
  await Promise.all(S.project.instances.map((i) => generate(i)));
  rebuildScene(); updateCFx(); renderStats();
}
// A storyboard made on another PC has no project here: shown as existing.
const wroteHere = () => !!(S.project.exportedHash || S.mapset?.touched);
const ownInMap = () => S.project.instances.length > 0 && wroteHere();
const sbRead = () => (SB_READ || (ownInMap() ? undefined : { skipPrefix: '\u0000' }));
async function reloadExisting() {
  S.ownInMap = ownInMap();
  S.existing.diffs = {};
  try { if (S.mapset?.osb?.length) S.existing.osb = parseStoryboard(await fetchText(fileUrl(S.mapset.osb[0])), sbRead()); } catch { /* keep what was read before */ }
  rebuildScene();
}
function madeElsewhere() {
  if (wroteHere()) return 0;
  return [...S.existing.osb, ...Object.values(S.existing.diffs).flat()].filter((x) => A.isOurs(x.path)).length;
}
function existingSprites() {
  if (!S.prefs.existing) return [];
  const ex = S.existing;
  if (S.refDiff && !ex.diffs[S.refDiff] && S.maps[S.refDiff]) {
    try { ex.diffs[S.refDiff] = parseStoryboard(S.maps[S.refDiff].raw, sbRead()); } catch { ex.diffs[S.refDiff] = []; }
  }
  return [...ex.osb, ...(ex.diffs[S.refDiff] || [])];
}
const inDiffFile = (inst) => inst.output === 'diff' && !!S.maps[inst.diff];
const liftedInst = (inst) => inDiffFile(inst) && inst.layer === 'Background';
const effectiveLayer = (inst) => (liftedInst(inst) ? 'Foreground' : inst.layer);
const liftCache = new WeakMap();
function liftSprite(sp) {
  if (sp.layer !== 'Background') return sp;
  let w = liftCache.get(sp);
  if (!w) { w = Object.create(sp, { layer: { value: 'Foreground' } }); liftCache.set(sp, w); }
  return w;
}
const COVERING = new Set(['letterbox', 'fadeColor', 'barWipe', 'irisWipe', 'tileWipe', 'splitScreen', 'background']);
function coveredBy(inst) {
  if (!inDiffFile(inst) || !isWritten(inst)) return [];
  const order = drawOrder(S.project.instances), at = order.indexOf(inst), layer = effectiveLayer(inst);
  return order.filter((p, k) => k < at && COVERING.has(p.effect) && !inDiffFile(p) && isWritten(p) && p.layer === layer && p.start < inst.end && (p.end ?? p.start) > inst.start);
}
function baseSprites() {
  existingSprites();
  const keep = dropOurs();
  return { osb: S.prefs.existing ? S.existing.osb.filter(keep) : [], diff: S.prefs.existing ? (S.existing.diffs[S.refDiff] || []).filter(keep) : [] };
}
function dropOurs() {
  const mine = new Set(), minePaths = new Set();
  for (const inst of S.project.instances) {
    for (const s of S.gen.get(inst.id)?.sprites || []) {
      if (A.isOurs(s.path)) continue;
      minePaths.add(s.path.toLowerCase()); mine.add(s.toLines().join('\n'));
    }
  }
  return (s) => !(mine.size && minePaths.has(s.path.toLowerCase()) && mine.has(s.toLines().join('\n')));
}
function rebuildScene() {
  pvScenes();
  S.dirty = true;
}

const hist = { stack: [], idx: -1 };
function snapshot() {
  const s = JSON.stringify(S.project.instances);
  if (hist.stack[hist.idx] === s) return;
  hist.stack = hist.stack.slice(0, hist.idx + 1);
  hist.stack.push(s);
  if (hist.stack.length > 150) hist.stack.shift();
  hist.idx = hist.stack.length - 1;
}
function restore(s) {
  S.project.instances = JSON.parse(s);
  if (!selectedInstance()) S.selectedId = null;
  genAll(); renderAll(); saveSoon();
}
function undo() { if (hist.idx > 0) { hist.idx--; restore(hist.stack[hist.idx]); } }
function redo() { if (hist.idx < hist.stack.length - 1) { hist.idx++; restore(hist.stack[hist.idx]); } }
const EXTRA_KEYS = ['pace', 'paceText', 'paceDur'];
const GONE = new Set(['countIn']);
function unknownParts(instances) {
  const out = new Set();
  for (const i of instances) {
    const eff = EFFECT_MAP[i.effect];
    if (!eff) { if (!GONE.has(i.effect)) out.add(i.effect); continue; }
    const keys = new Set(eff.params.map((d) => d.key));
    for (const k of Object.keys(i.params || {})) {
      if (keys.has(k) || EXTRA_KEYS.includes(k) || KIAI_KEYS.includes(k) || TRAVEL_KEYS.includes(k)) continue;
      if (k === 'line' && keys.has('lineX')) continue;
      out.add(`${eff.name}: ${k}`);
    }
  }
  return [...out];
}
const locked = () => S.locked?.length > 0;
const saveSoon = debounce(() => {
  if (!S.folder || locked() || S.switching) return;
  S.project.refDiff = S.refDiff;
  api.post('/api/project', { folder: S.folder, project: S.project, client: S.clientId }).catch((e) => toast('Could not save project: ' + e.message, 'bad'));
}, 700);
function commit() {
  if (ownInMap() !== S.ownInMap) reloadExisting();
  snapshot(); saveSoon(); updateCFx(); renderStats(); updateExportDot(); S.dirty = true;
  for (const i of S.project.instances) if (i.effect === 'actor') { const g = S.gen.get(i.id); if (g && g.key && g.key !== genKey(i)) scheduleGen(i, 60); }
  if (S.prefs.autoWrite && !locked()) liveWriteSoon();
}
const liveWriteSoon = debounce(() => { if (S.map) exportStoryboard({ quiet: true }); }, 900);
const projectHash = () => hashStr(JSON.stringify(S.project.instances));
function updateExportDot() {
  const behind = !!S.map && (S.project.instances.length > 0 || wroteHere()) && !(projectHash() === S.project.exportedHash && !S.mapDiffers);
  $('exportDot').classList.toggle('hidden', !behind);
  const btn = $('btnExport');
  if (btn.disabled) return;
  btn.classList.toggle('behind', behind);
  btn.firstChild.textContent = behind ? 'Write (not in the map)' : 'Write';
}

let openToken = 0;
async function openMap(folder, preferDiff = null) {
  const token = ++openToken;
  try {
    pause();
    saveSoon.flush();
    const ms = await api.get(`/api/mapset?folder=${encodeURIComponent(folder)}`);
    const maps = {};
    await Promise.all(ms.diffs.map(async (d) => {
      const url = `/api/file?folder=${encodeURIComponent(folder)}&path=${encodeURIComponent(d.file)}`;
      try { maps[d.file] = loadMap(await fetchText(url)); } catch (e) { console.warn('skipped', d.file, e); }
    }));
    if (token !== openToken) return;
    if (!Object.keys(maps).length) throw new Error('no readable difficulty in this folder');
    ms.diffs = ms.diffs.filter((d) => maps[d.file]);
    S.folder = folder; S.mapset = ms; S.maps = maps;
    A.clearMapImages();
    api.post('/api/watch', { folder }).catch(() => {});
    const proj = await api.get(`/api/project?folder=${encodeURIComponent(folder)}`);
    if (token !== openToken) return;
    S.project = proj && Array.isArray(proj.instances) ? proj : { version: 1, instances: [] };
    refreshVersions();
    const inSync = hashStr(JSON.stringify(S.project.instances)) === S.project.exportedHash;
    S.project.instances.forEach(migrateText); S.project.instances.forEach(dropAlt);
    for (const i of S.project.instances) for (const k of KIAI_KEYS) if (i.params && k in i.params) { const on = i.params[k] === true; delete i.params[k]; if (on) i.params[k] = true; }
    S.locked = unknownParts(S.project.instances); S.mapDiffers = false; S.mapExtra = 0; S.ownInMap = ownInMap();
    for (const inst of S.project.instances) {
      const eff = EFFECT_MAP[inst.effect];
      if (eff) inst.params = normalizeParams(eff, inst.params);
      if (inst.params?.sliderEnds === true && (inst.params.filter === 'all' || inst.params.filter === 'sliders')) { inst.params.filter = inst.params.filter === 'all' ? 'allends' : 'sliderboth'; inst.params.sliderEnds = false; }
      if (!inst.diff || !S.maps[inst.diff]) inst.diff = null;
    }
    S.project.instances = S.project.instances.filter((i) => EFFECT_MAP[i.effect]);
    const files = Object.keys(S.maps);
    const tosuFile = S.tosu.connected && S.tosu.folder === folder ? S.tosu.file : null;
    S.refDiff = [preferDiff, tosuFile, S.project.refDiff].find((f) => f && S.maps[f])
      || files.sort((a, b) => S.maps[b].objects.length - S.maps[a].objects.length)[0];
    for (const inst of S.project.instances) if (!inst.diff) inst.diff = S.refDiff;
    if (inSync && !S.locked.length) S.project.exportedHash = projectHash();
    S.gen.clear(); S.selection = null; S.selectedId = null;
    S.existing = { osb: [], diffs: {} }; S.waveform = null;
    hist.stack = []; hist.idx = -1; snapshot();
    setRefDiff(S.refDiff, true);
    loadExtras(folder, ms);
    $('stageEmpty').classList.add('hidden');
    const md = S.map.metadata;
    $('btnMap').querySelector('.map-title').textContent = `${md.Artist} - ${md.Title}`;
    C.pick.clear(); C.openInst = null; C.secOpen = {};
    timeline.fit();
    seek(0);
    renderAll();
    await genAll();
    checkBanner();
    updateExportDot();
    if (token === openToken && S.prefs.autoWrite && S.project.instances.length && !locked()) exportStoryboard({ quiet: true });
    else if (token === openToken) checkWritten();
  } catch (e) {
    console.error(e);
    toast('Could not open map: ' + e.message, 'bad');
  }
}

async function loadExtras(folder, ms) {
  if (ms.osb?.length) {
    try {
      const txt = await fetchText(fileUrl(ms.osb[0]));
      if (S.folder !== folder) return;
      S.existing.osb = parseStoryboard(txt, sbRead());
    } catch (e) { console.warn('could not read existing storyboard', e); }
  }
  existingSprites();
  const n = S.existing.osb.length + (S.existing.diffs[S.refDiff]?.length || 0);
  $('optExistingWrap').classList.toggle('hidden', !n);
  if (n) rebuildScene();
  if (S.audioUrl) {
    try {
      const a = await loadAudioData(S.audioUrl);
      if (S.folder !== folder) return;
      S.waveform = waveformPeaks(a, 10);
      S.dirty = true;
    } catch { }
  }
}

function setRefDiff(file, initial = false) {
  S.refDiff = file;
  S.map = S.maps[file];
  preview.setMap(S.map);
  const sel = $('diffSelect');
  sel.innerHTML = '';
  for (const f of Object.keys(S.maps)) sel.append(el('option', { value: f }, `${diffName(f)} (${S.maps[f].objects.length} notes)`));
  sel.value = file;
  const af = S.map.general.AudioFilename;
  const url = af ? fileUrl(af) : null;
  if (url !== S.audioUrl) {
    S.audioUrl = url; audioOk = false;
    audio.src = url || '';
    if (url) audio.load();
  }
  S.duration = Math.max(S.map.lastTime + 3000, (isFinite(audio.duration) ? audio.duration * 1000 : 0));
  if (!initial) { rebuildScene(); renderAll(); saveSoon(); }
}
audio.addEventListener('loadedmetadata', () => {
  audioOk = true;
  if (S.map) S.duration = Math.max(S.map.lastTime + 3000, audio.duration * 1000);
  $('timeLen').textContent = fmtTime(S.duration);
  timeline.draw();
});
audio.addEventListener('error', () => { audioOk = false; if (S.audioUrl) toast('Audio could not be played in the browser - preview runs silently.', 'bad'); });

function checkBanner() {
  const b = $('banner');
  b.innerHTML = '';
  b.classList.add('hidden');
  if (!S.map) return;
  if (locked()) {
    b.classList.remove('hidden');
    b.title = S.locked.join('\n');
    b.append(el('span', {}, `⚠ This storyboard was made with a newer Storyforge: ${S.locked.length} thing${S.locked.length > 1 ? 's' : ''} in it this copy does not know (${S.locked.slice(0, 3).join(', ')}${S.locked.length > 3 ? ', …' : ''}). Nothing is saved or written from here.`),
      el('div', { class: 'spacer' }),
      el('button', { class: 'mini-btn', onclick: () => { S.locked = []; checkBanner(); toast('Unlocked: this copy now saves and writes this storyboard', 'info'); } }, 'Use this copy anyway'));
    return;
  }
  const off = Object.entries(S.maps).filter(([, m]) => m.general.WidescreenStoryboard !== '1').map(([f]) => f);
  if (off.length) {
    b.classList.remove('hidden');
    b.append(el('span', {}, `⚠ Widescreen storyboard is off in ${off.length} difficult${off.length > 1 ? 'ies' : 'y'} - anything outside the 4:3 area will be cut off in osu!.`),
      el('div', { class: 'spacer' }),
      el('button', { class: 'mini-btn', onclick: async () => {
        try {
          const r = await api.post('/api/widescreen', { folder: S.folder });
          toast(`Widescreen on in ${r.changed.length} difficult${r.changed.length === 1 ? 'y' : 'ies'}. In osu!: Ctrl+L`, 'ok');
          for (const f of Object.keys(S.maps)) S.maps[f].general.WidescreenStoryboard = '1';
          checkBanner();
        } catch (e) { toast(e.message, 'bad'); }
      } }, 'Enable in all difficulties'));
  }
}

function now() {
  if (!S.playing) return S.time;
  if (audioOk && !audio.paused) return audio.currentTime * 1000;
  return clock.base + (performance.now() - clock.start) * (+S.prefs.speed || 1);
}
function play(withSound = true) {
  if (!S.map) return;
  pvHoverEnd(true);
  S.playing = true;
  if (!S.previewLoop && S.time >= S.duration - 50) S.time = 0;
  if (audioOk && withSound) {
    audio.currentTime = S.time / 1000;
    audio.playbackRate = +S.prefs.speed || 1;
    audio.volume = +S.prefs.volume;
    audio.play().catch(() => { clock = { start: performance.now(), base: S.time }; });
  } else {
    if (!audio.paused) { S.time = audio.currentTime * 1000; audio.pause(); }
    clock = { start: performance.now(), base: S.time };
  }
  $('btnPlay').textContent = '❚❚';
}
function pause() {
  if (!S.playing) return;
  S.time = now();
  S.playing = false;
  audio.pause();
  S.previewLoop = null;
  $('btnPlay').textContent = '▶';
  S.dirty = true;
}
function loopInstance(inst) {
  S.previewLoop = { start: Math.max(0, inst.start - 500), end: Math.min(inst.end, inst.start + 12000) + 500 };
  seek(S.previewLoop.start);
  const lp = S.previewLoop;
  play();
  S.previewLoop = lp;
}
function seek(t) {
  S.time = clamp(t, 0, S.duration);
  if (S.playing) {
    if (audioOk && !audio.paused) audio.currentTime = S.time / 1000;
    else clock = { start: performance.now(), base: S.time };
  }
  timeline.ensureVisible(S.time);
  S.dirty = true;
}
let loopErrors = 0;
function loop() {
  try {
    frame();
  } catch (e) {
    if (loopErrors++ < 3) { console.error(e); api.post('/api/log', { msg: `render error: ${e.stack || e}` }).catch(() => {}); }
  }
  requestAnimationFrame(loop);
}
function frame() {
  if (S.playing) {
    S.time = now();
    const lp = S.previewLoop || (S.prefs.loop && S.selection && S.selection.end > S.selection.start ? S.selection : null);
    if (lp && S.time > lp.end) seek(lp.start);
    if (S.time >= S.duration) { pause(); S.time = S.duration; }
    timeline.ensureVisible(S.time);
  }
  lassoTick?.();
  stageEdit.update();
  const hov = PV.hover;
  if (hov) preview.render(hov.loop.start + ((performance.now() - hov.t0) % (hov.loop.end - hov.loop.start)));
  if (S.playing || S.dirty || (!hov && preview.dirty)) {
    if (!hov) preview.render(S.time);
    timeline.draw();
    $('timeNow').textContent = fmtTime(S.time);
    S.dirty = false;
  }
}
renderer.canvas.addEventListener('webglcontextlost', () => api.post('/api/log', { msg: 'WebGL context lost' }).catch(() => {}));

function setSelection(sel, quiet = false) {
  S.selection = sel;
  C.focus = sel ? 'sel' : 'fx';
  preview.setSelected(new Set(sel?.objectTimes || []));
  renderSelbar();
  if (!quiet) { renderSelChips(); if (C.lyricsOpen && C.lyrStyleOpen) renderCFx(); }
  S.dirty = true;
}
function selectionObjects() {
  if (!S.selection || !S.map) return [];
  if (S.selection.objectTimes) return S.selection.objectTimes;
  return S.map.objectsInRange(S.selection.start, S.selection.end).map((o) => o.time);
}
function renderSelbar() {
  const s = S.selection;
  $('selStart').value = s?.start != null ? fmtTime(s.start) : '';
  $('selEnd').value = s?.end != null && s.end > s.start ? fmtTime(s.end) : '';
  const info = $('selInfo');
  info.innerHTML = '';
  $('btnSelClear').classList.toggle('hidden', !s);
  $('btnSelKeep').classList.toggle('hidden', !keepable(s));
  if (!s) { info.append('No selection'); return; }
  const n = selectionObjects().length;
  info.append(el('b', {}, `${n} note${n === 1 ? '' : 's'}`),
    s.end > s.start ? ` · ${((s.end - s.start) / 1000).toFixed(2)}s` : s.objectTimes ? '' : ' · start only');
  if (S.captureNext === 'end' && s.source === 'clipboard' && !s.objectTimes) info.append(' · copy again for the end');
}
const samePattern = (p, s) => (p.objectTimes && s.objectTimes ? p.objectTimes.join(',') === s.objectTimes.join(',') : !p.objectTimes && !s.objectTimes && p.start === s.start && p.end === s.end);
const fixedPicks = () => [
  ...S.map.kiai.map((k, i) => [`Kiai ${S.map.kiai.length > 1 ? i + 1 : ''}`.trim(), k.start, k.end]),
  ['Whole song', 0, Math.round(S.duration)],
];
function keepable(s) {
  if (!s || !S.map || !(s.objectTimes ? s.objectTimes.length : s.end > s.start)) return false;
  if (!s.objectTimes && fixedPicks().some(([, a, b]) => a === s.start && b === s.end)) return false;
  return !(S.project.patterns || []).some((p) => samePattern(p, s));
}
function keepSelection() {
  if (!keepable(S.selection)) return !!S.selection;
  rememberPattern(S.selection); renderSelbar(); renderSelChips();
  $('selChips').querySelector('.chip.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  flashSelection();
  return true;
}
function renderSelChips() {
  const root = $('selChips');
  root.innerHTML = '';
  if (!S.map) return;
  const s = S.selection;
  for (const [label, a, b] of fixedPicks()) {
    root.append(el('button', {
      class: 'chip' + (s && !s.objectTimes && s.start === a && s.end === b ? ' active' : ''),
      onclick: () => setSelection({ start: a, end: b, objectTimes: null, source: 'manual' }),
    }, label));
  }
  const pats = [...(S.project.patterns || [])].sort((a, b) => a.start - b.start);
  for (const pt of pats) {
    const n = pt.objectTimes?.length;
    root.append(el('span', { class: 'chip pat' + (s && samePattern(pt, s) ? ' active' : ''), 
      onclick: () => { setSelection({ start: pt.start, end: pt.end, objectTimes: pt.objectTimes?.slice() || null, source: 'pattern' }); timeline.ensureVisible(pt.start); },
      ondblclick: () => seek(pt.start) },
      n ? `${fmtShort(pt.start)} · ${n}♪` : `${fmtShort(pt.start)}–${fmtShort(pt.end)}`,
      el('button', { class: 'pat-x', onclick: (e) => {
        e.stopPropagation();
        S.project.patterns = S.project.patterns.filter((x) => x.id !== pt.id); saveSoon(); renderSelbar(); renderSelChips();
      } }, '✕')));
  }
}
function flashSelection() {
  const bar = $('selbar');
  bar.classList.remove('flash'); void bar.offsetWidth; bar.classList.add('flash');
  setTimeout(() => bar.classList.remove('flash'), 900);
}
function handleClipboard(text) {
  $('pillClipboard').classList.remove('flash'); void $('pillClipboard').offsetWidth; $('pillClipboard').classList.add('flash');
  if (!S.map) return;
  const ts = parseOsuTimestamp(text);
  if (!ts) return;
  if (C.lyric) { C.lyric.capture(ts.time); return; }
  const objs = resolveTimestamp(S.map, ts);
  if (objs.length) {
    let times = objs.map((o) => o.time);
    const prev = S.selection?.objectTimes;
    if (S.prefs.accum && prev) times = [...new Set([...prev, ...times])].sort((a, b) => a - b);
    const all = S.map.objects.filter((o) => times.includes(o.time));
    setSelection({ start: all[0].time, end: Math.max(...all.map((o) => o.endTime)) || all[0].time, objectTimes: times, source: 'clipboard', label: text });
    if (times.length > 1) { rememberPattern(S.selection); renderSelbar(); renderSelChips(); }
    S.captureNext = 'start';
    flashSelection();
    if (!S.playing) seek(objs[0].time);
    toast(`${S.prefs.accum && prev ? times.length : objs.length} note${objs.length > 1 ? 's' : ''} picked`, 'ok', { ms: 2000 });
  } else if (ts.refs.length) {
    toast(`Those notes aren't in [${diffName(S.refDiff)}] - wrong difficulty selected?`, 'bad', { ms: 5000 });
  } else {
    const cur = S.selection && !S.selection.objectTimes ? S.selection : { start: ts.time, end: ts.time };
    if (S.captureNext === 'start') {
      setSelection({ start: ts.time, end: Math.max(ts.time, cur.end > ts.time ? cur.end : ts.time), objectTimes: null, source: 'clipboard' });
      S.captureNext = 'end';
      toast('Start set. Copy again for the end', 'info', { ms: 2500 });
    } else {
      const a = Math.min(cur.start, ts.time), b = Math.max(cur.start, ts.time);
      setSelection({ start: a, end: b, objectTimes: null, source: 'clipboard' });
      S.captureNext = 'start';
    }
    flashSelection();
    if (!S.playing) seek(ts.time);
  }
}

function defaultRange(eff) {
  const sel = S.selection;
  const beat = S.map.beatLengthAt(S.time);
  if (sel && sel.end > sel.start) return { start: sel.start, end: sel.end, objectTimes: eff.scope === 'objects' ? sel.objectTimes?.slice() || null : null };
  if (sel?.objectTimes?.length && eff.scope === 'objects') return { start: sel.start, end: Math.round(sel.start + beat), objectTimes: sel.objectTimes.slice() };
  const start = sel?.start ?? Math.round(S.time);
  return { start, end: Math.round(start + beat * 8), objectTimes: null };
}
function insertInst(inst) {
  const arr = S.project.instances;
  if (!['lyrics', 'titleCard', 'background'].includes(inst.effect)) {
    const at = arr.findIndex((x) => x.effect === 'lyrics');
    if (at >= 0) { arr.splice(at, 0, inst); return; }
  }
  if (inst.effect !== 'background') { arr.push(inst); return; }
  let i = 0;
  arr.forEach((x, k) => { if (x.effect === 'background') i = k + 1; });
  arr.splice(i, 0, inst);
}
function rememberPattern(sel) {
  if (!sel || !(sel.objectTimes ? sel.objectTimes.length : sel.end > sel.start)) return;
  const P = (S.project.patterns ||= []);
  if (P.some((p) => samePattern(p, sel))) return;
  P.push({ id: uid(), start: sel.start, end: sel.end, objectTimes: sel.objectTimes?.slice() || null });
  if (P.length > 24) P.shift();
  saveSoon();
}
function addInstance(effectId, presetName, overrides = {}) {
  const eff = EFFECT_MAP[effectId];
  if (!S.map) { toast('Choose a beatmap first', 'bad'); openMapPicker(app); return null; }
  const preset = presetName ?? eff.presets?.[0]?.name;
  if (!S.selection && !Object.keys(overrides).length) toast('No selection, so it was added at the playhead', 'info', { ms: 2200 });
  const range = defaultRange(eff);
  const multi = Object.keys(S.maps).length > 1;
  rememberRecent(effectId, preset);
  const inst = {
    id: uid(), effect: effectId, label: '', autoLabel: true, preset,
    ...range, layer: eff.defaultLayer, output: eff.defaultOutput === 'diff' && multi ? 'diff' : 'osb', diff: S.refDiff,
    seed: Math.floor(Math.random() * 1e6), enabled: true, params: defaultParams(eff, preset), ...overrides,
  };
  refreshLabel(inst);
  syncEnd(inst);
  insertInst(inst);
  if (inst.objectTimes?.length > 1 && !('objectTimes' in overrides) && S.selection?.objectTimes) { rememberPattern(S.selection); renderSelbar(); renderSelChips(); }
  S.selectedId = inst.id; C.openInst = inst.id;
  S.lastInstId = inst.id;
  commit();
  renderCFx();
  scheduleGen(inst, 0);
  if (!S.playing && (S.time < inst.start || S.time > inst.end)) seek(inst.start);
  return inst;
}
function addLyricLines(lines, styleParams, presetName) {
  const eff = EFFECT_MAP.lyrics;
  for (const l of lines) {
    const params = styleParams ? structuredClone(styleParams) : defaultParams(eff, presetName);
    params.text = l.text;
    const inst = { id: uid(), effect: 'lyrics', label: '', autoLabel: true, preset: presetName, start: l.start, end: l.end, objectTimes: null,
      layer: eff.defaultLayer, output: 'osb', diff: S.refDiff, seed: Math.floor(Math.random() * 1e6), enabled: true, params };
    refreshLabel(inst);
    S.project.instances.push(inst);
  }
  commit(); genAll(); renderAll();
  toast(`Added ${lines.length} lyric lines`, 'ok');
}
function selectInstance(id, { fromTimeline = false } = {}) {
  S.selectedId = id; C.openInst = id;
  if (id) S.lastInstId = id;
  renderCFx();
  const inst = selectedInstance();
  if (!inst) return;
  const row = $('cFxList').querySelector(`[data-row="${members(inst)[0].id}"]`);
  row?.scrollIntoView({ block: 'nearest' });
  if (!fromTimeline) {
    timeline.reveal(inst);
    if (!S.playing && (S.time < inst.start || S.time > inst.end)) seek(inst.start);
  }
}
function removeInstance(id) {
  const i = S.project.instances.findIndex((x) => x.id === id);
  if (i < 0) return;
  S.project.instances.splice(i, 1);
  S.gen.delete(id);
  if (S.selectedId === id) S.selectedId = null;
  if (C.openInst === id) C.openInst = null;
  rebuildScene(); commit(); renderCFx();
}
function duplicateInstance(id) {
  const src = S.project.instances.find((x) => x.id === id);
  if (!src) return;
  const copy = { ...structuredClone(src), id: uid(), label: src.autoLabel === false ? src.label + ' copy' : src.label };
  S.project.instances.splice(S.project.instances.indexOf(src) + 1, 0, copy);
  S.selectedId = copy.id; C.openInst = copy.id;
  commit(); scheduleGen(copy, 0); renderCFx();
}
function retarget(inst) {
  const sel = S.selection;
  if (!sel) return;
  const eff = EFFECT_MAP[inst.effect];
  inst.start = sel.start;
  if (sel.end > sel.start) inst.end = sel.end;
  inst.objectTimes = eff.scope === 'objects' ? sel.objectTimes?.slice() || null : null;
  inst.diff = S.refDiff;
  syncEnd(inst); scheduleGen(inst, 0); commit();
}

const MY_CAT = 'Presets';
const CAT_SUB = { 'Text & lyrics': 'Lyrics, song info, credits', 'Hit effects': 'On the notes you pick', 'Background & ambience': 'Over a part of the song', Transitions: 'At one moment: drops, fades, wipes' };
function rememberRecent(effectId, preset) {
  const key = `${effectId}|${preset || ''}`;
  S.prefs.recent = [key, ...(S.prefs.recent || []).filter((k) => k !== key)].slice(0, 6);
  savePrefs();
  if (!$('libSearch').value) renderLibrary();
}
const hasLyrics = () => S.project.instances.some((i) => i.effect === 'lyrics');
const hoverAttrs = (id, preset) => ({ 'data-fx': id, 'data-preset': preset || EFFECT_MAP[id].presets?.[0]?.name || '' });
const searchText = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function renderLibrary() {
  const q = searchText($('libSearch').value);
  const words = q ? q.split(' ') : [];
  const has = (text) => { const t = searchText(text); return words.every((w) => t.includes(w)); };
  const root = $('libList');
  const scroll = root.scrollTop, anchor = () => root.querySelector('.lib-cat')?.offsetTop ?? 0;
  const before = anchor();
  root.innerHTML = '';
  const recent = (S.prefs.recent || []).map((k) => k.split('|')).filter(([id, preset]) => EFFECT_MAP[id] && (!preset || EFFECT_MAP[id].presets?.some((p) => p.name === preset)));
  if (!q && recent.length) {
    root.append(el('div', { class: 'lib-label' }, 'Recent'));
    root.append(el('div', { class: 'recent' }, ...recent.map(([id, preset]) => el('button', {
      class: 'chip', ...hoverAttrs(id, preset), onclick: () => addFromUi(id, preset || undefined),
    }, preset || EFFECT_MAP[id].name))));
  }
  if (C.openCat === undefined) C.openCat = S.prefs.cCat === undefined ? 'Hit effects' : S.prefs.cCat;
  const matches = (e) => has(`${e.name} ${e.description} ${(e.presets || []).map((p) => p.name).join(' ')}`);
  const found = q ? EFFECTS.filter(matches).length : 0;
  const own = EFFECTS.flatMap((e) => (e.presets || []).filter((p) => p.mine && (!q || has(`${p.name} ${e.name}`))).map((p) => [e, p.name]));
  if (!q || own.length) {
    const open = !!q || C.openCat === MY_CAT;
    root.append(el('button', {
      class: 'lib-cat' + (open ? ' open' : ''),
      onclick: () => {
        if (q) return;
        C.openCat = open ? null : MY_CAT; C.openFx = null; S.prefs.cCat = C.openCat; savePrefs(); renderLibrary();
        showOpened('.lib-cat.open + .lib-cat-body', '.lib-cat.open');
      },
    }, el('span', { class: 'chev' }, open ? '▾' : '▸'),
      el('span', { class: 'grow' }, el('span', { class: 'nm' }, MY_CAT), el('span', { class: 'sub' }, 'The ones you saved')),
      own.length ? el('span', { class: 'cnt' }, String(own.length)) : null));
    if (open) {
      root.append(el('div', { class: 'lib-cat-body' }, el('div', { class: 'lib-fx open' }, el('div', { class: 'lib-fx-body' },
        own.length ? el('div', { class: 'chips' }, ...own.map(([e, name]) => el('span', { class: 'chip pat mine', ...hoverAttrs(e.id, name), onclick: () => addFromUi(e.id, name) },
          el('span', { class: 'ic', style: { color: e.accent } }, e.icon), el('span', { class: 'grow' }, name),
          el('button', { class: 'pat-x', onclick: (ev) => { ev.stopPropagation(); deleteMyPreset(e.id, name); } }, '✕'))))
          : el('div', { class: 'lib-desc' }, 'None yet. Open an effect on the right and press Save preset.')))));
    }
  }
  for (const cat of CATEGORIES) {
    const effects = EFFECTS.filter((e) => e.category === cat && (!q || matches(e)));
    if (!effects.length) continue;
    const open = !!q || C.openCat === cat;
    root.append(el('button', {
      class: 'lib-cat' + (open ? ' open' : ''),
      onclick: () => {
        if (q) return;
        C.openCat = open ? null : cat; C.openFx = !open && cat === 'Text & lyrics' ? 'lyrics' : null; S.prefs.cCat = C.openCat; savePrefs(); renderLibrary();
        showOpened('.lib-cat.open + .lib-cat-body', '.lib-cat.open');
      },
    }, el('span', { class: 'chev' }, open ? '▾' : '▸'),
      el('span', { class: 'grow' }, el('span', { class: 'nm' }, cat), el('span', { class: 'sub' }, CAT_SUB[cat] || '')),
      effects.length > 1 ? el('span', { class: 'cnt' }, String(effects.length)) : null));
    if (!open) continue;
    const list = el('div', { class: 'lib-cat-body' });
    for (const eff of effects) {
      let names = presetList(eff).map((p) => p.name);
      const hits = new Set(q ? names.filter((n) => has(`${eff.name} ${n}`)) : []);
      const marking = hits.size > 0 && hits.size < names.length;
      if (marking) names = [...names.filter((n) => hits.has(n)), ...names.filter((n) => !hits.has(n))];
      const mark = (n) => (marking ? (hits.has(n) ? ' hit' : ' faded') : '');
      const only = effects.length === 1 && !q;
      const expanded = only || C.openFx === eff.id || (!!q && (found <= 4 || marking));
      const row = el('div', { class: 'lib-fx' + (expanded ? ' open' : '') });
      if (!only) {
        row.append(el('button', { class: 'lib-fx-head', ...hoverAttrs(eff.id), onclick: () => { C.openFx = C.openFx === eff.id ? null : eff.id; renderLibrary(); showOpened('.lib-fx.open', '.lib-fx.open > .lib-fx-head'); } },
          el('span', { class: 'ic', style: { color: eff.accent } }, eff.icon), el('span', { class: 'nm' }, eff.name),
          el('span', { class: 'cnt' }, String(names.length || '')), el('span', { class: 'chev' }, expanded ? '▾' : '▸')));
      }
      if (expanded) {
        const chips = el('div', { class: 'chips' }, ...(names.length ? names : [null]).map((name) => (isMine(eff, name)
          ? el('span', { class: 'chip pat mine' + mark(name), ...hoverAttrs(eff.id, name), onclick: () => addFromUi(eff.id, name) }, el('span', { class: 'grow' }, name),
            el('button', { class: 'pat-x', onclick: (e) => { e.stopPropagation(); deleteMyPreset(eff.id, name); } }, '✕'))
          : el('button', {
            class: 'chip' + mark(name), ...hoverAttrs(eff.id, name), onclick: () => addFromUi(eff.id, name ?? undefined),
          }, name || 'Add'))));
        const body = el('div', { class: 'lib-fx-body' });
        if (eff.id === 'lyrics' && !q) body.append(...lyricsStart(chips, names.length));
        else body.append(el('div', { class: 'lib-desc' }, eff.description), chips);
        row.append(body);
      }
      list.append(row);
    }
    root.append(list);
  }
  if (q && !found && !own.length) root.append(el('div', { class: 'lib-desc', style: { padding: '14px 4px' } }, 'Nothing found.'));
  root.scrollTop = scroll + (q || !before ? 0 : anchor() - before);
  if (q) { const hit = root.querySelector('.chip.hit'); if (hit) { hit.closest('.lib-fx')?.scrollIntoView({ block: 'nearest' }); hit.scrollIntoView({ block: 'nearest' }); } else root.scrollTop = 0; }
}
function showOpened(bodySel, headSel) {
  const root = $('libList');
  root.querySelector(bodySel)?.scrollIntoView({ block: 'nearest' });
  root.querySelector(headSel)?.scrollIntoView({ block: 'nearest' });
}
function lyricsStart(chips, nStyles) {
  const big = (cls, title, sub, fn) => el('button', { class: 'lib-big ' + cls, onclick: fn }, el('b', {}, title), el('span', {}, sub));
  const timer = () => (S.map ? openLyricTimer(app) : toast('Choose a beatmap first', 'bad'));
  if (!hasLyrics()) {
    const one = el('details', { class: 'lib-more' }, el('summary', {}, `Single line (${nStyles})`), chips);
    one.open = !!C.lyrSingles;
    one.addEventListener('toggle', () => { C.lyrSingles = one.open; });
    return [
      el('div', { class: 'lib-step' }, 'Get lyrics'),
      big('primary', 'Find online', 'Looks this song up and brings the lines in, already timed', openLyricFinder),
      big('', 'Tap along', 'The song plays, you press Space where every line starts. With the text, or without: then you type the words in afterwards', timer),
      one,
    ];
  }
  return [
    el('div', { class: 'lib-step' }, 'Add line'),
    chips,
    el('div', { class: 'lib-step' }, 'Get lyrics'),
    el('div', { class: 'c-tools' },
      el('button', { class: 'c-tool', onclick: openLyricFinder }, 'Find online'),
      el('button', { class: 'c-tool', onclick: timer }, 'Tap along')),
  ];
}
function addFromUi(id, preset) {
  if (!S.map) { toast('Choose a beatmap first', 'bad'); return openMapPicker(app); }
  pvHoverEnd(true);
  PV.block = { ...mouse };
  const inst = addInstance(id, preset);
  if (inst) selectInstance(inst.id);
}

function renderStats() {
  let sp = 0, cm = 0;
  for (const inst of S.project.instances) {
    if (inst.enabled === false) continue;
    const g = S.gen.get(inst.id);
    if (g?.stats) { sp += g.stats.sprites; cm += g.stats.commands; }
  }
  $('projStats').textContent = S.project.instances.length ? `${S.project.instances.length} effects · ${fmtCount(sp)} sprites · ${fmtCount(cm)} cmds` : '';
}
function paramRow(inst, eff, def, rerender, onLabel) {
  return control(def, {
    value: inst.params[def.key], params: inst.params,
    images: S.mapset?.images || [], mine: def.type === 'image' ? mineOptions() : null,
    fonts: S.fonts,
    onUploadFont: uploadFont,
    onImportImage: importImage,
    onInput: (v) => {
      inst.params[def.key] = v; syncEnd(inst);
      if (def.key === 'text') { refreshLabel(inst); onLabel?.(); }
      scheduleGen(inst, def.type === 'text' ? 250 : 40);
    },
    onChange: (v) => {
      inst.params[def.key] = v; syncEnd(inst); refreshLabel(inst); scheduleGen(inst, 0);
      if (inst.effect === 'lyrics' && def.key !== 'text') inst.own = [...new Set([...(inst.own || []), def.key])];
      commit();
      if (def.type === 'select' || def.type === 'bool' || eff.scope === 'point') rerender();
    },
  });
}
function applyPreset(inst, eff, name) {
  const keepText = inst.params.text;
  const keepPace = [inst.params.pace, inst.params.paceText, inst.params.paceDur];
  const keepImage = eff.params.some((d) => d.key === 'imageFit') ? [inst.params.image, inst.params.imageFit] : null;
  inst.params = defaultParams(eff, name);
  if (keepImage?.[0]) [inst.params.image, inst.params.imageFit] = keepImage;
  if (keepPace[0]) [inst.params.pace, inst.params.paceText, inst.params.paceDur] = keepPace;
  if (inst.effect === 'lyrics') inst.own = ['*'];
  const p = eff.presets?.find((x) => x.name === name);
  if (keepText != null && keepText !== 'Your lyrics here' && !p?.values.text) inst.params.text = keepText;
  inst.preset = name;
  refreshLabel(inst);
  syncEnd(inst); scheduleGen(inst, 0); commit();
}
const OWN_KEYS = ['text', 'pace', 'paceText', 'paceDur'];
const presetList = (eff) => [...(eff.presets || []).filter((p) => p.mine), ...(eff.presets || []).filter((p) => !p.mine)];
const isMine = (eff, name) => !!eff.presets?.find((p) => p.name === name)?.mine;
const styleOf = (params) => JSON.stringify(Object.entries(params).filter(([k]) => !OWN_KEYS.includes(k)));
function myPresetsChanged() {
  setUserPresets(S.prefs.myPresets); savePrefs(); hoverCache.clear(); renderLibrary(); renderCFx();
}
function saveMyPreset(inst, name) {
  const eff = EFFECT_MAP[inst.effect];
  if (eff.presets?.some((p) => p.name === name && !p.mine)) { toast(`“${name}” is a built-in preset: use another name`, 'bad'); return false; }
  const values = structuredClone(inst.params);
  for (const k of OWN_KEYS) delete values[k];
  const list = ((S.prefs.myPresets ||= {})[eff.id] ||= []);
  const old = list.findIndex((p) => p.name === name);
  if (old >= 0) list[old] = { name, values }; else list.push({ name, values });
  inst.preset = name; refreshLabel(inst);
  myPresetsChanged(); commit();
  const others = S.project.instances.filter((i) => i !== inst && i.effect === inst.effect && i.preset === name && styleOf(i.params) !== styleOf(inst.params));
  toast(`Preset “${name}” saved`, 'ok', others.length ? { action: { label: `Update ${others.length} more using it`, fn: () => applyMyPreset(others, eff, name) } } : { ms: 2000 });
  return true;
}
async function applyMyPreset(list, eff, name) {
  for (const i of list) {
    const own = OWN_KEYS.filter((k) => k in i.params).map((k) => [k, i.params[k]]);
    i.params = defaultParams(eff, name);
    for (const [k, v] of own) i.params[k] = v;
    refreshLabel(i); syncEnd(i);
  }
  await Promise.all(list.map((i) => generate(i)));
  rebuildScene(); commit(); renderCFx();
  toast(`Updated ${list.length} effect${list.length > 1 ? 's' : ''}`, 'ok', { action: { label: 'Undo', fn: undo } });
}
function deleteMyPreset(effectId, name) {
  const all = (S.prefs.myPresets ||= {}), list = all[effectId] || [];
  const p = list.find((x) => x.name === name);
  if (!p) return;
  all[effectId] = list.filter((x) => x !== p);
  myPresetsChanged();
  toast(`Preset “${name}” deleted`, 'info', { action: { label: 'Undo', fn: () => { (S.prefs.myPresets[effectId] ||= []).push(p); myPresetsChanged(); } } });
}
function openSavePreset(inst) {
  const eff = EFFECT_MAP[inst.effect];
  const mine = (eff.presets || []).filter((p) => p.mine).map((p) => p.name);
  const inp = el('input', { type: 'text', value: isMine(eff, inst.preset) ? inst.preset : '', placeholder: 'Name', maxlength: '40', style: { width: '100%' } });
  const btn = el('button', { class: 'primary-btn' }, 'Save');
  const name = () => inp.value.replace(/\|/g, ' ').trim();
  const sync = () => { btn.textContent = mine.includes(name()) ? 'Replace' : 'Save'; btn.disabled = !name(); };
  const go = () => { if (name() && saveMyPreset(inst, name())) m.close(); };
  inp.addEventListener('input', sync);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  btn.onclick = go;
  const m = modal(`Save preset · ${eff.name}`, el('div', {}, inp,
    mine.length ? el('div', { class: 'chips', style: { marginTop: '8px' } }, ...mine.map((n) => el('button', { class: 'chip mine', onclick: () => { inp.value = n; sync(); inp.focus(); } }, n))) : null), [btn]);
  sync();
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
}

function advancedRows(inst, eff, rerender) {
  const rows = [];
  const multi = Object.keys(S.maps).length > 1;
  const outSel = el('select', {},
    el('option', { value: 'osb' }, 'All difficulties (.osb)'),
    ...Object.keys(S.maps).map((f) => el('option', { value: 'diff:' + f }, `Only [${diffName(f)}]`)));
  outSel.value = inst.output === 'diff' ? 'diff:' + inst.diff : 'osb';
  outSel.addEventListener('change', () => {
    if (outSel.value === 'osb') inst.output = 'osb';
    else { inst.output = 'diff'; inst.diff = outSel.value.slice(5); }
    scheduleGen(inst, 0); rebuildScene(); commit(); rerender();
  });
  rows.push(el('div', { class: 'row' }, el('label', {}, 'Write to'), el('div', { class: 'ctl' }, outSel)));
  if (multi && inst.output === 'osb' && eff.scope === 'objects') {
    const dsel = el('select', {}, ...Object.keys(S.maps).map((f) => el('option', { value: f }, diffName(f))));
    dsel.value = inst.diff || S.refDiff;
    dsel.addEventListener('change', () => { inst.diff = dsel.value; scheduleGen(inst, 0); commit(); });
    rows.push(el('div', { class: 'row' }, el('label', {}, 'Notes from'), el('div', { class: 'ctl' }, dsel)));
  }
  const layerSel = el('select', {}, ...LAYERS.filter((l) => l !== 'Fail' && l !== 'Pass').map((l) => el('option', { value: l }, l)));
  layerSel.value = inst.layer;
  layerSel.addEventListener('change', () => { inst.layer = layerSel.value; scheduleGen(inst, 0); commit(); });
  const seedIn = el('input', { type: 'number', value: inst.seed, style: { width: '90px' } });
  seedIn.addEventListener('change', () => { inst.seed = +seedIn.value | 0; scheduleGen(inst, 0); commit(); });
  rows.push(
    el('div', { class: 'row' }, el('label', {}, 'Layer'), el('div', { class: 'ctl' }, layerSel)),
    el('div', { class: 'row' }, el('label', {}, 'Seed'), el('div', { class: 'ctl' }, seedIn)));
  return rows;
}

function nudgeable(inp, get, set) {
  inp.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const dir = e.key === 'ArrowUp' ? 1 : -1;
    const t = get();
    if (e.shiftKey || !S.map) set(Math.max(0, t + dir * 10));
    else { const div = +S.prefs.snap || 4; set(Math.max(0, S.map.snap(t + (dir * S.map.beatLengthAt(t)) / div, div))); }
  });
}

function renderAll() {
  renderSelbar(); renderSelChips(); renderHeader(); renderLibrary(); renderCFx(); renderStats();
  $('timeLen').textContent = fmtTime(S.duration); S.dirty = true;
}

const C = { openCat: undefined, openFx: null, openInst: null, more: false, groups: new Set(), lyric: null, tap: null, paceWord: null, pick: new Set(), secOpen: {}, dragEnd: 0 };
const ESSENTIAL = ['text', 'image', 'colorMode', 'color', 'palette'];
const fmtShort = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const cRange = (inst) => (EFFECT_MAP[inst.effect]?.scope === 'point' ? fmtShort(inst.start) : `${fmtShort(inst.start)}–${fmtShort(inst.end)}`);
function pickedIds() {
  const out = new Set();
  if (!C.pick.size) return out;
  for (const i of S.project.instances) if (C.pick.has(members(i)[0].id)) out.add(i.id);
  return out;
}
function renderHeader() {
  const following = !!S.osu.folder && S.osu.folder === S.folder;
  $('osuDot').className = 'dot' + (following ? ' live' : S.osu.running ? ' warn' : '');
}
function updateWriteButton() { $('btnExport').classList.toggle('hidden', !!S.prefs.autoWrite); }

function setupList() {
  const fxList = $('cFxList');
  let dragRow = null, dragging = false;
  const plainRows = () => [...fxList.querySelectorAll('.c-inst[data-row]')].filter((x) => !x.closest('.c-lyrics'));
  fxList.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.c-inst-head');
    if (!h || e.button !== 0 || e.target.closest('button') || h.closest('.c-lyrics')) return;
    dragRow = h.parentElement; dragging = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragRow) return;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.c-inst[data-row]');
    if (!over || over.closest('.c-lyrics') || (!dragging && over === dragRow)) return;
    dragging = true;
    const rowsEl = plainRows(), a = rowsEl.indexOf(dragRow), b = rowsEl.indexOf(over);
    if (a < 0 || b < 0) return;
    C.pick = new Set(rowsEl.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.dataset.row));
    for (const x of rowsEl) x.classList.toggle('picked', C.pick.has(x.dataset.row));
  });
  window.addEventListener('pointerup', () => {
    if (dragRow && dragging) { C.dragEnd = Date.now(); renderCFx(); }
    dragRow = null; dragging = false;
  });
}

function setupSplits() {
  const KEYS = { left: ['leftW', '--left-w'], right: ['rightW', '--right-w'], bottom: ['bottomH', '--bottom-h'] };
  const apply = () => {
    for (const [pref, prop] of Object.values(KEYS)) {
      if (S.prefs[pref]) document.documentElement.style.setProperty(prop, `${S.prefs[pref]}px`);
      else document.documentElement.style.removeProperty(prop);
    }
    S.dirty = true;
  };
  apply();
  for (const bar of document.querySelectorAll('.split')) {
    const which = bar.dataset.split;
    bar.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      bar.classList.add('drag');
      const move = (ev) => {
        if (which === 'left') S.prefs.leftW = Math.round(clamp(ev.clientX, 250, 560));
        if (which === 'right') S.prefs.rightW = Math.round(clamp(innerWidth - ev.clientX, 320, 720));
        if (which === 'bottom') S.prefs.bottomH = Math.round(clamp(innerHeight - ev.clientY - ($('statusbar')?.offsetHeight || 0), 150, innerHeight - 330));
        apply();
      };
      const up = () => {
        bar.classList.remove('drag');
        bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up);
        savePrefs();
      };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
    });
    bar.addEventListener('dblclick', () => { S.prefs[KEYS[which][0]] = null; apply(); savePrefs(); });
  }
}

let lassoTick = null;
function setupStagePicking() {
  const cells = $('stageCells'), lasso = $('lasso');
  let d = null;
  const onScreen = (r) => (p) => ({ x: r.left + p.x * r.width, y: r.top + p.y * r.height });
  const inBox = () => {
    const r = preview.cells[0].el.getBoundingClientRect(), px = onScreen(r);
    const x0 = Math.min(d.x, d.cx), x1 = Math.max(d.x, d.cx), y0 = Math.min(d.y, d.cy), y1 = Math.max(d.y, d.cy);
    return renderer.notesAt(S.time).filter((n) => {
      const m = n.r * r.width * 0.5;
      return [n, ...n.pts].some((p) => { const q = px(p); return q.x >= x0 - m && q.x <= x1 + m && q.y >= y0 - m && q.y <= y1 + m; });
    }).map((n) => n.o.time);
  };
  const collect = () => {
    if (!d?.moved) return;
    if (S.time !== d.t) { for (const t of d.cur) d.kept.add(t); d.t = S.time; }
    d.cur = inBox();
    const times = [...new Set([...d.base, ...d.kept, ...d.cur])];
    const key = times.join(',');
    if (key === d.key) return;
    d.key = key;
    const sel = timeline.notesSelection(times);
    setSelection(sel ? { ...sel, source: 'stage' } : null, true);
  };
  cells.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || preview.count !== 1 || PV.hover || !S.map) return;
    const add = e.ctrlKey || e.metaKey || e.shiftKey;
    d = { x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, moved: false, add, base: add ? S.selection?.objectTimes || [] : [], kept: new Set(), cur: [], t: S.time, key: null };
    lassoTick = collect;
    cells.setPointerCapture(e.pointerId);
  });
  cells.addEventListener('pointermove', (e) => {
    if (!d) return;
    d.cx = e.clientX; d.cy = e.clientY;
    if (Math.hypot(d.cx - d.x, d.cy - d.y) > 5) d.moved = true;
    if (!d.moved) return;
    const box = $('stage').getBoundingClientRect();
    lasso.classList.remove('hidden');
    lasso.style.left = `${Math.min(d.x, d.cx) - box.left}px`; lasso.style.top = `${Math.min(d.y, d.cy) - box.top}px`;
    lasso.style.width = `${Math.abs(d.cx - d.x)}px`; lasso.style.height = `${Math.abs(d.cy - d.y)}px`;
    collect();
  });
  const end = (e) => {
    if (!d) return;
    lasso.classList.add('hidden');
    lassoTick = null;
    if (e.type === 'pointercancel') { d = null; return; }
    if (d.moved) {
      d.cx = e.clientX; d.cy = e.clientY;
      collect();
      d = null;
      setSelection(S.selection);
      return;
    }
    const drag = d;
    d = null;
    const r = preview.cells[0].el.getBoundingClientRect(), px = onScreen(r);
    const hit = renderer.notesAt(S.time).find((n) => [n, ...n.pts].some((p) => { const q = px(p); return Math.hypot(q.x - e.clientX, q.y - e.clientY) <= n.r * r.width * 1.1; }));
    if (!hit) {
      const text = drag.add ? null : stageEdit.instAt(e.clientX, e.clientY);
      if (text && text.id !== S.selectedId) return selectInstance(text.id, { fromTimeline: true });
      if (S.selection && !drag.add) setSelection(null);
      return;
    }
    const t = hit.o.time;
    const sel = timeline.notesSelection(drag.add ? (drag.base.includes(t) ? drag.base.filter((x) => x !== t) : [...drag.base, t]) : [t]);
    setSelection(sel ? { ...sel, source: 'stage' } : null);
  };
  cells.addEventListener('pointerup', end);
  cells.addEventListener('pointercancel', end);
  $('stage').addEventListener('wheel', (e) => {
    if (!S.map || modalOpen()) return;
    e.preventDefault();
    const dir = Math.sign(e.deltaY || e.deltaX);
    if (!dir) return;
    const div = +S.prefs.snap || 4;
    seek(S.map.snap(S.time + (dir * (e.shiftKey ? 4 : 1) * S.map.beatLengthAt(S.time)) / div, div));
  }, { passive: false });
}

function openKeys() {
  const row = ([k, what]) => [el('span', { class: 'kbd' }, k), el('span', {}, what)];
  const list = (...rows) => el('div', { class: 'keys-list' }, ...rows.flatMap(row));
  modal('Keys', el('div', { class: 'keys' },
    el('div', { class: 'keys-cols' },
      list(['Space', 'Play / pause'], ['← →', 'One beat (Shift: four)'], ['Z / V', 'First / last note'], ['X', 'Play from the start'],
        ['Shift+Z / V', 'Select all before / after'], ['[ ]', 'Selection starts / ends here'], ['Esc', 'Deselect'],
        ['Ctrl+B', 'Bookmark (Shift: remove)'], ['Ctrl+← →', 'Previous / next bookmark']),
      list(['Ctrl+S', 'Write to the map'], ['Ctrl+Z / Y', 'Undo / redo'], ['Ctrl+C / X / V', 'Copy / cut / paste'], ['Ctrl+Shift+V', 'Paste settings only'],
        ['Ctrl+D', 'Duplicate'], ['Ctrl+H / J', 'Mirror ↔ / ↕'], ['Del', 'Delete'], ['R', 'Same effect again, on the selection'],
        ['Ctrl+Alt+R / Z', 'Repeat / undo while in osu!'])),
    el('p', {}, 'Select: drag over the timeline, or Shift+click the start and the end. Ctrl+drag moves or resizes the selection.'),
    el('p', {}, 'Bars: drag to move, edges to resize, up or down to put in front or behind. Alt: no snapping. Right-click: menu.'),
    el('p', {}, 'Timeline: wheel zooms, Ctrl+wheel scrolls.')));
}

const members = (inst) => (inst ? [inst] : []);
const isWritten = (inst) => inst.enabled !== false;
function dropAlt(inst) {
  if (inst.alt) inst.enabled = false;
  delete inst.alt; delete inst.group;
  return inst;
}
const LAYER_RANK = { Background: 0, Foreground: 1, Overlay: 2 };
function restack(inst, toFront) {
  const arr = S.project.instances;
  const others = arr.filter((i) => i !== inst && isWritten(i) && i.start < inst.end && i.end > inst.start);
  const mine = LAYER_RANK[inst.layer] ?? 1;
  const ranks = others.map((i) => LAYER_RANK[i.layer] ?? 1);
  const rank = toFront ? Math.max(mine, ...ranks) : Math.min(mine, ...ranks);
  inst.layer = Object.keys(LAYER_RANK).find((k) => LAYER_RANK[k] === rank);
  arr.splice(arr.indexOf(inst), 1);
  if (toFront) arr.push(inst);
  else {
    let at = 0;
    if (inst.effect !== 'background') for (let k = 0; k < arr.length; k++) if (arr[k].effect === 'background') at = k + 1;
    arr.splice(at, 0, inst);
  }
  scheduleGen(inst, 0); rebuildScene(); commit(); renderCFx();
}
function restackTo(inst, { over, below, above }) {
  const arr = S.project.instances;
  const pick = (ids) => ids.map((id) => arr.find((i) => i.id === id)).filter(Boolean);
  const B = pick(below), A = pick(above);
  if (inst.effect !== 'background' && A.some((i) => i.effect === 'background')) return toast('Nothing goes behind the background picture', 'info');
  if (inst.effect === 'background' && B.some((i) => i.effect !== 'background')) return toast('The background picture stays behind everything else', 'info');
  const rank = (i) => LAYER_RANK[effectiveLayer(i)] ?? 1;
  const changed = new Set();
  const setRank = (i, r) => { if (rank(i) !== r) { i.layer = Object.keys(LAYER_RANK).find((k) => LAYER_RANK[k] === r); changed.add(i); } };
  const was = rank(inst);
  const r = over ? 2 : B.some((i) => rank(i) === 1) ? 1 : A.some((i) => rank(i) === 0) ? 0 : Math.min(was, 1);
  setRank(inst, r);
  for (const a of A) if (rank(a) < r) setRank(a, r);
  const before = JSON.stringify(arr.map((i) => i.id));
  const same = (i) => rank(i) === r;
  const old = arr.indexOf(inst);
  arr.splice(old, 1);
  const lo = Math.max(-1, ...B.filter(same).map((i) => arr.indexOf(i)));
  const hi = Math.min(arr.length, ...A.filter(same).map((i) => arr.indexOf(i)));
  if (lo < hi) arr.splice(clamp(old, lo + 1, hi), 0, inst);
  else {
    const anchor = arr[lo];
    const up = A.filter(same).filter((i) => arr.indexOf(i) < lo).sort((p, q) => arr.indexOf(p) - arr.indexOf(q));
    for (const u of up) arr.splice(arr.indexOf(u), 1);
    arr.splice(arr.indexOf(anchor) + 1, 0, inst, ...up);
  }
  const moved = changed.size > 0 || JSON.stringify(arr.map((i) => i.id)) !== before;
  const stuck = rank(inst) !== r || B.some((b) => same(b) && inDiffFile(inst) && !inDiffFile(b)) || A.some((a) => same(a) && !inDiffFile(inst) && inDiffFile(a));
  if (stuck) toast('It cannot go there: on one layer osu! always draws what all difficulties share in front of what belongs to one difficulty. Change "Write to" of one of the two (More settings, Time & placement).', 'info', { ms: 6000 });
  else if (!moved) toast(B.length || A.length ? 'It is already drawn in that order' : 'Nothing shares that time with it, so the order makes no difference there', 'info', { ms: 2600 });
  if (!moved) return;
  for (const i of changed) scheduleGen(i, 0);
  rebuildScene(); commit(); renderCFx();
}

function instMenu(inst, x, y) {
  const eff = EFFECT_MAP[inst.effect], key = members(inst)[0].id;
  if (C.pick.size < 2 || !C.pick.has(key)) {
    C.pick.clear();
    if (S.selectedId !== inst.id) selectInstance(inst.id, { fromTimeline: true }); else renderCFx();
  }
  const many = C.pick.size > 1, rows = many ? pickedRows() : [];
  const on = many ? rows.some((r) => r.rep.enabled !== false) : inst.enabled !== false;
  const clip = readClip();
  const lines = S.project.instances.filter((i) => i.effect === 'lyrics');
  const name = String(inst.label || eff.name);
  openMenu(x, y, [
    '#' + (many ? `${rows.length} effects` : name.length > 44 ? name.slice(0, 43) + '\u2026' : name),
    ['Copy', 'Ctrl+C', () => copyEffects()],
    ['Cut', 'Ctrl+X', () => copyEffects(true)],
    !many && ['Duplicate', 'Ctrl+D', () => duplicateInstance(inst.id)],
    ['Paste settings', 'Ctrl+Shift+V', () => pasteSettings(), clip.some((c) => many || c.effect === inst.effect) ? null : 'off'],
    ['Mirror left \u2194 right', 'Ctrl+H', () => flipEffects('h')],
    ['Mirror top \u2194 bottom', 'Ctrl+J', () => flipEffects('v')],
    '-',
    [on ? 'Turn off' : 'Turn on', '', () => {
      for (const m of many ? rows.flatMap((r) => r.ms) : members(inst)) m.enabled = !on;
      rebuildScene(); commit(); renderCFx();
    }],
    !many && ['Bring to front', '', () => restack(inst, true)],
    !many && ['Send to back', '', () => restack(inst, false)],
    !many && ['Play it in a loop', '', () => loopInstance(inst)],
    !many && S.selection && ['Move it to the selection', '', () => { for (const m of members(inst)) retarget(m); renderCFx(); }],
    !many && ['Jump to its start', '', () => { seek(inst.start); timeline.reveal(inst); }],
    inst.effect === 'lyrics' && lines.length > 1 && ['Select all lyric lines', '', () => { C.pick = new Set(lines.map((i) => members(i)[0].id)); renderCFx(); }],
    '-',
    ['Delete', 'Del', () => (many ? deleteRows(pickedRows()) : deleteInst(inst.id)), 'danger'],
  ]);
}
function timelineMenu({ t, x, y }) {
  if (!S.map) return;
  const tt = Math.max(0, snapTime(t)), s = S.selection;
  const inSel = !!s && s.end > s.start && t >= s.start && t <= s.end;
  const sec = timelineSections().find((k) => t >= k.start && t < k.end);
  const clip = readClip();
  openMenu(x, y, [
    '#' + fmtTime(tt).slice(0, 9),
    [inSel ? 'Paste on the selection' : 'Paste here', 'Ctrl+V', () => pasteEffects(inSel ? {} : { at: tt }), clip.length ? null : 'off'],
    '-',
    ['Selection starts here', '', () => setSelection({ start: tt, end: s && s.end > tt ? s.end : tt, objectTimes: null, source: 'manual' })],
    ['Selection ends here', '', () => setSelection({ start: s && s.start < tt ? s.start : tt, end: tt, objectTimes: null, source: 'manual' })],
    sec && [`Select ${sec.name || 'this part'}`, '', () => setSelection({ start: sec.start, end: sec.end, objectTimes: null, source: 'timeline' })],
    s && ['Clear the selection', 'Esc', () => setSelection(null)],
    '-',
    ['Play from here', '', () => { seek(tt); play(); }],
    ['Bookmark here', 'Ctrl+B', () => addBookmark(tt)],
    ['Show the whole song', '', () => timeline.fit()],
  ]);
}
function stageMenu(e) {
  if (!S.map || PV.hover || e.target.closest?.('input, textarea, select, button')) return;
  e.preventDefault();
  const inst = (e.target.closest?.('.se-root') && selectedInstance()) || stageEdit.instAt(e.clientX, e.clientY);
  if (inst) return instMenu(inst, e.clientX, e.clientY);
  const s = S.selection, onSel = !!s && (s.end > s.start || !!s.objectTimes?.length);
  openMenu(e.clientX, e.clientY, [
    [onSel ? 'Paste on the selection' : 'Paste at the playhead', 'Ctrl+V', () => pasteEffects(), readClip().length ? null : 'off'],
    s && ['Clear the selection', 'Esc', () => setSelection(null)],
    '-',
    [S.playing ? 'Pause' : 'Play', 'Space', () => (S.playing ? pause() : play())],
  ]);
}
function listMenu(e) {
  if (e.target.closest('input, textarea, select, .c-inst-body')) return;
  const row = e.target.closest('.c-inst[data-row]'), lyr = e.target.closest('.c-lyrics > .c-inst-head');
  if (!row && !lyr) return;
  e.preventDefault();
  if (row) {
    const r = cfxRows().find((q) => q.ms[0].id === row.dataset.row);
    if (r) instMenu(r.ms.find((m) => m.id === C.openInst) || r.rep, e.clientX, e.clientY);
    return;
  }
  const lines = S.project.instances.filter((i) => i.effect === 'lyrics');
  const on = lines.some((i) => i.enabled !== false);
  openMenu(e.clientX, e.clientY, [
    `#${lines.length} lyric lines`,
    ['Select all lines', '', () => { C.pick = new Set(lines.map((i) => members(i)[0].id)); renderCFx(); }],
    ['Copy all lines', '', () => { C.pick = new Set(lines.map((i) => members(i)[0].id)); renderCFx(); copyEffects(); }],
    [on ? 'Turn all off' : 'Turn all on', '', () => { for (const i of lines) i.enabled = !on; rebuildScene(); commit(); renderCFx(); }],
  ]);
}
function deleteInst(id) {
  const inst = S.project.instances.find((i) => i.id === id);
  if (!inst) return;
  removeInstance(id);
  renderCFx();
  toast(`Deleted ${inst.label || EFFECT_MAP[inst.effect].name}`, 'info', { action: { label: 'Undo', fn: undo } });
}

function cfxRows() {
  return [...S.project.instances].sort((a, b) => a.start - b.start).map((i) => ({ rep: i, ms: [i] }));
}
function renderCFx() {
  const root = $('cFxList');
  const rows = cfxRows();
  if (C.openInst && !S.project.instances.some((i) => i.id === C.openInst)) C.openInst = null;
  root.innerHTML = '';
  root.dataset.ids = rows.map((r) => r.ms.map((m) => m.id).join('+')).join(',');
  if (C.hadLyrics !== hasLyrics()) { C.hadLyrics = hasLyrics(); renderLibrary(); }
  $('cCount').textContent = S.project.instances.length || '';
  if (!rows.length) {
    const kbd = (k) => el('span', { class: 'kbd' }, k);
    root.append(el('div', { class: 'c-empty' }, S.map ? 'No effects' : 'No beatmap'));
  }
  const lyr = rows.filter((r) => r.rep.effect === 'lyrics');
  const grouped = lyr.length > 1;
  const rest = rows.filter((r) => !(grouped && r.rep.effect === 'lyrics'));
  const have = new Set(rows.map((r) => r.ms[0].id));
  for (const id of [...C.pick]) if (!have.has(id)) C.pick.delete(id);
  const sig = `${[...C.pick].join()}|${S.selectedId || ''}`;
  if (sig !== C.fxSig) { C.fxSig = sig; if (sig !== '|') C.focus = 'fx'; }
  if (C.pick.size) root.append(cPickBar(rows.filter((r) => C.pick.has(r.ms[0].id))));
  const secs = fxSections();
  if (secs.length < 2) {
    if (grouped) root.append(cLyricsGroup(lyr));
    for (const r of rest) root.append(cInstItem(r));
  } else {
    const by = new Map();
    for (const r of rest) { const k = sectionOf(r.rep, secs); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
    if (by.has('whole')) root.append(cSection({ key: 'whole', name: 'Whole song' }, by.get('whole')));
    if (grouped) root.append(cLyricsGroup(lyr));
    for (const s of secs) if (by.has(s.key)) root.append(cSection(s, by.get(s.key)));
  }
  pvScenes(); S.dirty = true;
}
function fxSections() {
  const K = S.map?.kiai || [], secs = [];
  let prev = 0;
  K.forEach((k, i) => {
    const n = K.length > 1 ? ` ${i + 1}` : '';
    if (k.start > prev) secs.push({ key: 'b' + i, name: `Before Kiai${n}`, start: prev, end: k.start });
    secs.push({ key: 'k' + i, name: `Kiai${n}`, start: k.start, end: k.end, kiai: true });
    prev = k.end;
  });
  if (K.length) secs.push({ key: 'end', name: `After Kiai${K.length > 1 ? ` ${K.length}` : ''}`, start: prev, end: Math.max(prev + 1, Math.round(S.duration || 0)) });
  return secs;
}
function timelineSections() {
  const marks = allBookmarks().map((b) => b.t), end = Math.max(1, Math.round(S.duration || 0));
  if (!marks.length) return fxSections();
  const base = fxSections(), out = [];
  for (const sec of base.length ? base : [{ key: 'all', name: '', start: 0, end }]) {
    const cuts = sec.kiai ? [] : marks.filter((t) => t > sec.start + 1 && t < sec.end - 1);
    const parts = [sec.start, ...cuts].map((a, i) => ({ ...sec, key: sec.key + (i ? '.' + i : ''), name: '', start: a, end: cuts[i] ?? sec.end }));
    parts.reduce((m, x) => (x.end - x.start > m.end - m.start ? x : m)).name = sec.name;
    out.push(...parts);
  }
  return out;
}
function sectionOf(inst, secs) {
  if (S.duration && inst.end - inst.start >= S.duration * 0.5) return 'whole';
  return (secs.find((s) => inst.start >= s.start && inst.start < s.end) || secs[secs.length - 1])?.key ?? null;
}
function cSection(s, list) {
  const hasOpen = list.some((r) => r.ms.some((m) => m.id === C.openInst));
  const open = !!C.secOpen[s.key] || hasOpen;
  const head = el('div', { class: 'c-sec-head', onclick: () => {
    C.secOpen[s.key] = !open;
    if (open && hasOpen) { C.openInst = null; S.selectedId = null; }
    renderCFx();
  } },
    el('span', { class: 'nm' }, `${open ? '▾' : '▸'} ${s.name}`),
    el('span', { class: 'vers' }, String(list.length)),
    s.start != null ? el('span', { class: 'tm' }, `${fmtShort(s.start)}–${fmtShort(s.end)}`) : null,
    el('button', { class: 'mini-btn', onclick: (e) => {
      e.stopPropagation();
      const all = list.every((r) => C.pick.has(r.ms[0].id));
      for (const r of list) { if (all) C.pick.delete(r.ms[0].id); else C.pick.add(r.ms[0].id); }
      C.secOpen[s.key] = true; renderCFx();
    } }, 'Select'));
  const box = el('div', { class: 'c-sec' + (open ? ' open' : '') + (s.kiai ? ' kiai' : '') }, head);
  if (open) for (const r of list) box.append(cInstItem(r));
  return box;
}

function pickTargets() {
  const out = fxSections().map((s) => ({ label: `${s.name} (${fmtShort(s.start)})`, start: s.start, end: s.end, sec: s.key }));
  for (const pt of [...(S.project.patterns || [])].sort((a, b) => a.start - b.start)) out.push({ label: pt.objectTimes ? `Pattern ${fmtShort(pt.start)} · ${pt.objectTimes.length}♪` : `${fmtShort(pt.start)}–${fmtShort(pt.end)}`, start: pt.start, end: pt.end, objectTimes: pt.objectTimes || null });
  const s = S.selection;
  if (s && s.end > s.start) out.push({ label: 'What I have selected now', start: s.start, end: s.end, objectTimes: s.objectTimes || null });
  return out;
}
function mapInto(inst, src, tgt) {
  const eff = EFFECT_MAP[inst.effect];
  const near = (a, b) => Math.abs(a - b) <= 5;
  const dur = inst.end - inst.start;
  if (eff.scope === 'objects' && tgt.objectTimes) return { start: tgt.start, end: tgt.end, objectTimes: tgt.objectTimes.slice() };
  let s = null, e = null;
  if (near(inst.start, src.start)) s = tgt.start;
  else if (near(inst.start, src.end)) s = tgt.end;
  if (eff.scope !== 'point' && near(inst.end, src.end)) e = tgt.end;
  if (s == null && e != null) s = e - dur;
  if (s == null) s = tgt.start + (inst.start - src.start);
  if (e == null || e <= s) e = s + dur;
  return { start: Math.round(s), end: Math.round(e), objectTimes: null };
}
async function transferPicked(rows, tgt, move) {
  if (!rows.length) return;
  const secs = fxSections();
  const keys = new Set(rows.map((r) => sectionOf(r.rep, secs)));
  const one = tgt.sec && keys.size === 1 && secs.find((s) => s.key === [...keys][0]);
  const src = one || { start: Math.min(...rows.map((r) => r.rep.start)), end: Math.max(...rows.map((r) => r.rep.end)) };
  const made = [];
  for (const r of rows) {
    for (const m of move ? r.ms : [r.rep]) {
      const inst = move ? m : { ...structuredClone(m), id: uid() };
      Object.assign(inst, mapInto(m, src, tgt));
      inst.diff = S.refDiff;
      syncEnd(inst); refreshLabel(inst);
      if (!move) insertInst(inst);
      made.push(inst);
    }
  }
  C.pick.clear();
  if (tgt.sec) C.secOpen[tgt.sec] = true;
  await Promise.all(made.map((i) => generate(i)));
  rebuildScene(); commit(); renderCFx();
  toast(`${move ? 'Moved' : 'Copied'} ${rows.length} effect${rows.length > 1 ? 's' : ''} to ${tgt.label}`, 'ok', { action: { label: 'Undo', fn: undo } });
}
const CLIP_KEY = 'sbkit.clip';
let clipMem = [];
function writeClip(list) {
  clipMem = list;
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(list)); } catch { }
}
function readClip() {
  try { const c = JSON.parse(localStorage.getItem(CLIP_KEY)); if (Array.isArray(c)) clipMem = c; } catch { }
  return clipMem.filter((i) => EFFECT_MAP[i?.effect]).map(migrateText).map(dropAlt);
}
const pickedRows = () => cfxRows().filter((r) => C.pick.has(r.ms[0].id));
function copyTargets() {
  const ids = new Set(C.pick.size ? pickedRows().map((r) => r.rep.id) : S.selectedId ? [S.selectedId] : []);
  return S.project.instances.filter((i) => ids.has(i.id));
}
function deleteRows(rows) {
  if (!rows.length) return;
  const ids = new Set(rows.flatMap((r) => r.ms.map((m) => m.id)));
  S.project.instances = S.project.instances.filter((i) => !ids.has(i.id));
  for (const id of ids) S.gen.delete(id);
  if (ids.has(S.selectedId)) S.selectedId = null;
  if (ids.has(C.openInst)) C.openInst = null;
  C.pick.clear();
  rebuildScene(); commit(); renderCFx();
  toast(`Deleted ${rows.length} effect${rows.length > 1 ? 's' : ''}`, 'info', { action: { label: 'Undo', fn: undo } });
}
function copyEffects(cut = false) {
  const list = copyTargets();
  if (!list.length) return false;
  writeClip(list.map((i) => structuredClone(i)));
  if (!cut) toast(`Copied ${list.length > 1 ? list.length + ' effects' : list[0].label || EFFECT_MAP[list[0].effect].name}`, 'info', { ms: 1500 });
  else if (C.pick.size) deleteRows(pickedRows());
  else deleteInst(S.selectedId);
  return true;
}
function shiftedNotes(times, d) {
  const out = new Set();
  for (const t of times) { const o = S.map.objects.find((x) => Math.abs(x.time - (t + d)) <= 30); if (o) out.add(o.time); }
  return out.size ? [...out].sort((a, b) => a - b) : null;
}
async function pasteEffects({ at: where } = {}) {
  if (!S.map) return;
  const list = readClip();
  if (!list.length) return toast('Nothing copied', 'info', { ms: 1800 });
  const src = { start: Math.min(...list.map((i) => i.start)), end: Math.max(...list.map((i) => i.end)) };
  const s = S.selection, len = src.end - src.start;
  const onSel = where == null && !!s && (s.end > s.start || !!s.objectTimes?.length);
  const at = where ?? s?.start ?? Math.round(S.time);
  const tgt = onSel ? { start: s.start, end: s.end > s.start ? s.end : s.start + len, objectTimes: s.objectTimes?.slice() || null } : { start: at, end: at + len, objectTimes: null };
  const made = [];
  for (const m of list) {
    const eff = EFFECT_MAP[m.effect];
    const inst = { ...structuredClone(m), id: uid(), params: normalizeParams(eff, structuredClone(m.params)) };
    const pos = mapInto(m, src, tgt);
    if (eff.scope === 'objects' && m.objectTimes?.length && !pos.objectTimes) pos.objectTimes = shiftedNotes(m.objectTimes, pos.start - m.start);
    Object.assign(inst, pos);
    inst.diff = S.refDiff;
    if (inst.output === 'diff' && Object.keys(S.maps).length < 2) inst.output = 'osb';
    syncEnd(inst); refreshLabel(inst); insertInst(inst);
    made.push(inst);
  }
  await Promise.all(made.map((i) => generate(i)));
  const secs = fxSections();
  for (const i of made) { const k = sectionOf(i, secs); if (k) C.secOpen[k] = true; }
  rebuildScene(); commit();
  S.lastInstId = made[made.length - 1].id;
  if (made.length === 1) { C.pick.clear(); selectInstance(made[0].id, { fromTimeline: true }); timeline.reveal(made[0]); } else {
    S.selectedId = null; C.openInst = null;
    C.pick = new Set(made.map((i) => i.id));
    renderCFx(); timeline.ensureVisible(tgt.start);
  }
  toast(`Pasted ${made.length > 1 ? made.length + ' effects' : made[0].label}${onSel ? ' on the selection' : ''}`, 'ok', { ms: 1500 });
}
async function pasteSettings() {
  const src = readClip()[0];
  if (!src) return toast('Nothing copied', 'info', { ms: 1800 });
  const eff = EFFECT_MAP[src.effect];
  const ids = new Set(C.pick.size ? pickedRows().flatMap((r) => r.ms.map((m) => m.id)) : S.selectedId ? [S.selectedId] : []);
  const list = S.project.instances.filter((i) => ids.has(i.id) && i.effect === src.effect);
  if (!list.length) return toast(`Select a ${eff.name} effect to paste these settings on`, 'info');
  for (const i of list) {
    const own = OWN_KEYS.filter((k) => k in i.params).map((k) => [k, i.params[k]]);
    i.params = normalizeParams(eff, structuredClone(src.params));
    for (const [k, v] of own) i.params[k] = v;
    i.preset = src.preset; i.layer = src.layer;
    if (i.effect === 'lyrics') i.own = ['*'];
    refreshLabel(i); syncEnd(i);
  }
  await Promise.all(list.map((i) => generate(i)));
  rebuildScene(); commit(); renderCFx();
  toast(`Settings pasted on ${list.length} effect${list.length > 1 ? 's' : ''}`, 'ok', { ms: 1500 });
}
function cPickBar(rows) {
  const targets = pickTargets();
  const menu = (label, move) => {
    const s = el('select', { class: 'c-pick-sel' }, el('option', { value: '' }, label), ...targets.map((t, i) => el('option', { value: i }, t.label)));
    s.addEventListener('change', () => { if (s.value !== '') transferPicked(rows, targets[+s.value], move); });
    return s;
  };
  const anyOn = rows.some((r) => r.rep.enabled !== false);
  return el('div', { class: 'c-pickbar' },
    el('span', { class: 'grow' }, `${rows.length} selected`),
    menu('Copy to…', false), menu('Move to…', true),
    el('button', { class: 'mini-btn', onclick: () => {
      for (const r of rows) for (const m of r.ms) m.enabled = !anyOn;
      rebuildScene(); commit(); renderCFx();
    } }, anyOn ? 'Off' : 'On'),
    el('button', { class: 'mini-btn danger', onclick: () => deleteRows(rows) }, 'Delete'),
    el('button', { class: 'mini-btn', onclick: () => { C.pick.clear(); renderCFx(); } }, '✕'));
}
function parseShift(text) {
  const m = /^([+-])?\s*(?:(\d+):)?(\d+(?:[.,]\d+)?)\s*s?$/.exec(String(text).trim());
  if (!m) return null;
  const ms = Math.round(((+m[2] || 0) * 60 + parseFloat(m[3].replace(',', '.'))) * 1000);
  return m[1] === '-' ? -ms : ms;
}
async function shiftLyrics(list, d) {
  if (!d || !list.length) return;
  for (const m of list) { m.start += d; m.end += d; }
  await Promise.all(list.map((m) => generate(m)));
  rebuildScene(); commit(); renderCFx();
  const s = Math.abs(d) / 1000;
  toast(`Moved ${list.length} lyric lines ${s} s ${d > 0 ? 'later' : 'earlier'}`, 'ok', { action: { label: 'Undo', fn: undo } });
}
const lyricInKiai = (i) => (S.map?.kiai || []).some((k) => Math.min(i.end, k.end) - Math.max(i.start, k.start) >= 500);
function lyricScope(all) {
  const sc = C.lyrScope || 'all', s = S.selection;
  if (sc === 'kiai') return all.filter(lyricInKiai);
  if (sc === 'calm') return all.filter((i) => !lyricInKiai(i));
  if (sc === 'sel') return s ? all.filter((i) => i.start < Math.max(s.end, s.start + 1) && i.end > s.start) : [];
  return all;
}
let lyricsGenTimer = 0;
function lyricsApply(list, fn, final) {
  for (const i of list) { fn(i); refreshLabel(i); }
  clearTimeout(lyricsGenTimer);
  lyricsGenTimer = setTimeout(async () => { await Promise.all(list.map((i) => generate(i))); rebuildScene(); renderStats(); }, final ? 0 : 120);
  if (final) commit();
}
function lyricsStylePanel(all) {
  const eff = EFFECT_MAP.lyrics;
  const d = el('details', { class: 'c-lyrics-style' }, el('summary', {}, 'Style of many lines at once'));
  d.open = !!C.lyrStyleOpen;
  d.addEventListener('toggle', () => { C.lyrStyleOpen = d.open; });
  const target = lyricScope(all);
  const keep = C.lyrKeep !== false;
  const own = (i, key) => keep && (i.own || []).some((k) => k === key || k === '*');
  const nKiai = all.filter(lyricInKiai).length;
  const sel = el('select', {},
    el('option', { value: 'all' }, `All lines (${all.length})`),
    el('option', { value: 'kiai' }, `Lines in kiai (${nKiai})`),
    el('option', { value: 'calm' }, `Lines outside kiai (${all.length - nKiai})`),
    el('option', { value: 'sel' }, S.selection ? `Lines in my selection (${all.filter((i) => i.start < Math.max(S.selection.end, S.selection.start + 1) && i.end > S.selection.start).length})` : 'Lines in my selection (nothing selected)'));
  sel.value = C.lyrScope || 'all';
  sel.addEventListener('change', () => { C.lyrScope = sel.value; renderCFx(); });
  const cb = el('input', { type: 'checkbox' }); cb.checked = keep;
  cb.addEventListener('change', () => { C.lyrKeep = cb.checked; renderCFx(); });
  const nOwn = target.filter((i) => (i.own || []).length).length;
  d.append(
    el('div', { class: 'row' }, el('label', {}, 'Apply to'), el('div', { class: 'ctl' }, sel)),
    el('label', { class: 'toggle' }, cb,
      el('span', {}, `Leave what I changed on single lines${nOwn ? ` (${nOwn} line${nOwn > 1 ? 's' : ''})` : ''}`)));
  if (!target.length) { d.append(el('div', { class: 'dim small' }, 'No lyric lines there.')); return d; }
  const tmpl = target[0].params;
  d.append(el('div', { class: 'chips' }, ...eff.presets.map((p) => el('button', {
    class: 'chip' + (target.every((i) => i.preset === p.name) ? ' active' : ''), 
    onclick: () => {
      lyricsApply(target.filter((i) => !own(i, '*')), (i) => {
        const old = i.params, np = defaultParams(eff, p.name);
        np.text = old.text; np.pace = old.pace; np.paceText = old.paceText; np.paceDur = old.paceDur;
        if (keep) for (const k of i.own || []) if (k in old) np[k] = old[k];
        i.params = np; i.preset = p.name;
      }, true);
      renderCFx();
    },
  }, p.name))));
  const row = (def) => control(def, {
    value: tmpl[def.key], params: tmpl, images: S.mapset?.images || [], fonts: S.fonts, onUploadFont: uploadFont,
    onInput: (v) => lyricsApply(target.filter((i) => !own(i, def.key)), (i) => { i.params[def.key] = v; }, false),
    onChange: (v) => {
      lyricsApply(target.filter((i) => !own(i, def.key)), (i) => { i.params[def.key] = v; }, true);
      if (def.type === 'select' || def.type === 'bool') renderCFx();
    },
  });
  const groups = new Map();
  for (const def of eff.params) {
    if (def.key === 'text' || (def.showIf && !def.showIf(tmpl))) continue;
    if (ESSENTIAL.includes(def.key)) { d.append(row(def)); continue; }
    const g = def.group || 'Settings';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(def);
  }
  for (const [g, defs] of groups) {
    const f = el('details', { class: 'c-group' }, el('summary', {}, g), ...defs.map(row));
    f.open = C.groups.has('L:' + g);
    f.addEventListener('toggle', () => { if (f.open) C.groups.add('L:' + g); else C.groups.delete('L:' + g); });
    d.append(f);
  }
  return d;
}
function cLyricsGroup(rows) {
  const all = rows.flatMap((r) => r.ms);
  const eff = EFFECT_MAP.lyrics;
  const open = !!C.lyricsOpen || all.some((m) => m.id === C.openInst);
  const anyOn = rows.some((r) => r.rep.enabled !== false);
  const first = Math.min(...all.map((m) => m.start)), last = Math.max(...all.map((m) => m.end));
  const head = el('div', { class: 'c-inst-head', onclick: () => {
    C.lyricsOpen = !open;
    if (open && all.some((m) => m.id === C.openInst)) { C.openInst = null; S.selectedId = null; }
    renderCFx();
  } },
    el('button', { class: 'eye', onclick: (e) => {
      e.stopPropagation();
      for (const m of all) m.enabled = !anyOn;
      rebuildScene(); commit(); renderCFx();
    } }, anyOn ? '●' : '○'),
    el('span', { class: 'ic', style: { color: eff.accent } }, eff.icon),
    el('span', { class: 'nm' }, `${open ? '▾' : '▸'} Lyrics`),
    el('span', { class: 'vers' }, `${rows.length} lines`),
    el('span', { class: 'tm' }, `${fmtShort(first)}–${fmtShort(last)}`),
    el('button', { class: 'del', onclick: (e) => {
      e.stopPropagation();
      const ids = new Set(all.map((m) => m.id));
      S.project.instances = S.project.instances.filter((i) => !ids.has(i.id));
      for (const id of ids) S.gen.delete(id);
      if (ids.has(S.selectedId)) S.selectedId = null;
      rebuildScene(); commit(); renderCFx();
      toast(`Deleted ${rows.length} lyric lines`, 'info', { action: { label: 'Undo', fn: undo } });
    } }, '✕'));
  const item = el('div', { class: 'c-lyrics' + (open ? ' open' : '') + (anyOn ? '' : ' off'), 'data-lyrics': '1' }, head);
  if (!open) return item;
  const inp = el('input', { class: 'time-input', value: '', placeholder: '-40' });
  const apply = () => {
    const d = parseShift(inp.value);
    if (d == null) return toast('Type seconds, like 40 or -12.5 (or 1:05)', 'bad');
    shiftLyrics(all, d);
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
  const sel = S.selection;
  item.append(el('div', { class: 'c-lyrics-move' },
    el('span', {}, 'Move all lines by'), inp, el('span', { class: 'dim' }, 's'),
    el('button', { class: 'mini-btn', onclick: apply }, 'Move'),
    el('button', { class: 'mini-btn', 
      onclick: () => (S.selection ? shiftLyrics(all, Math.round(S.selection.start - first)) : toast('Select the first sung note first', 'info')) }, 'First line → selection')));
  item.append(lyricsStylePanel(all));
  const lines = el('div', { class: 'c-lyrics-lines' });
  for (const r of rows) lines.append(cInstItem(r));
  item.append(lines);
  return item;
}
function updateCFx() {
  $('cCount').textContent = S.project.instances.length || '';
  const rows = cfxRows();
  if ($('cFxList').dataset.ids !== rows.map((r) => r.ms.map((m) => m.id).join('+')).join(',')) return renderCFx();
  for (const { rep, ms } of rows) {
    const item = $('cFxList').querySelector(`[data-row="${ms[0].id}"]`);
    if (!item) continue;
    item.querySelector('.nm').textContent = rep.label || EFFECT_MAP[rep.effect].name;
    item.querySelector('.tm').textContent = cRange(rep);
    const g = S.gen.get(rep.id);
    const w = item.querySelector('.warn');
    w.textContent = g?.error || g?.warning ? '⚠' : '';
    w.title = g?.error || g?.warning || '';
  }
}
function cInstItem({ rep, ms }) {
  const eff = EFFECT_MAP[rep.effect];
  const openMember = ms.find((m) => m.id === C.openInst);
  const g = S.gen.get(rep.id);
  const picked = C.pick.has(ms[0].id);
  const head = el('div', { class: 'c-inst-head', onclick: (e) => {
    if (Date.now() - C.dragEnd < 300) return;
    if (C.pick.size || e.ctrlKey || e.shiftKey) {
      if (picked) C.pick.delete(ms[0].id); else C.pick.add(ms[0].id);
      return renderCFx();
    }
    toggleInst(openMember ? null : rep.id);
  } },
    el('button', { class: 'eye', onclick: (e) => {
      e.stopPropagation(); rep.enabled = rep.enabled === false; rebuildScene(); commit(); renderCFx();
    } }, rep.enabled === false ? '○' : '●'),
    el('span', { class: 'ic', style: { color: eff.accent } }, eff.icon),
    el('span', { class: 'nm' }, rep.label || eff.name),
    el('span', { class: 'warn' }, g?.error || g?.warning || coveredBy(rep).length ? '⚠' : ''),
    el('span', { class: 'tm' }, cRange(rep)),
    el('button', { class: 'del', onclick: (e) => {
      e.stopPropagation();
      deleteInst(rep.id);
    } }, '✕'));
  const item = el('div', { class: 'c-inst' + (openMember ? ' open' : '') + (rep.enabled === false ? ' off' : '') + (picked ? ' picked' : ''), 'data-row': ms[0].id }, head);
  if (openMember) item.append(cInstBody(openMember, EFFECT_MAP[openMember.effect], ms));
  return item;
}
function toggleInst(id) { selectInstance(id || null); }
function cInstBody(inst, eff, ms) {
  const rerender = () => renderCFx();
  const body = el('div', { class: 'c-inst-body' });
  if (eff.presets?.length) {
    body.append(el('div', { class: 'chips' }, ...presetList(eff).map((p) => el('button', {
      class: 'chip' + (inst.preset === p.name ? ' active' : '') + (p.mine ? ' mine' : ''), onclick: () => { applyPreset(inst, eff, p.name); rerender(); },
    }, p.name))));
  }
  const shown = (d) => !d.showIf || d.showIf(inst.params);
  const often = FREQUENT[eff.id] || [];
  const upFront = (d) => ESSENTIAL.includes(d.key) || often.includes(d.key);
  for (const def of eff.params.filter((d) => ESSENTIAL.includes(d.key) && shown(d))) body.append(paramRow(inst, eff, def, rerender));
  for (const def of eff.params.filter((d) => !ESSENTIAL.includes(d.key) && often.includes(d.key) && shown(d))) body.append(paramRow(inst, eff, def, rerender));
  if (inst.effect === 'lyrics' && inst.params.mode === 'letters') body.append(paceStrip(inst, rerender));
  const n = eff.scope === 'objects' ? (inst.objectTimes?.length || mapFor(inst).objectsInRange(inst.start, inst.end).length) : null;
  body.append(el('div', { class: 'c-where' },
    el('span', { class: 'grow' }, n != null ? `On ${n} note${n === 1 ? '' : 's'}, ${cRange(inst)}` : eff.scope === 'point' ? `At ${fmtTime(inst.start).slice(0, 9)}` : cRange(inst)),
    el('button', { class: 'mini-btn', onclick: () => loopInstance(inst) }, '▶ Loop'),
    el('button', { class: 'mini-btn', onclick: () => {
      if (!S.selection) { flashSelection(); return toast('Select notes or a time range first', 'info'); }
      for (const m of ms) retarget(m);
      rerender();
    } }, 'Use selection')));
  const over = coveredBy(inst);
  if (over.length) {
    const p = over[over.length - 1];
    body.append(el('div', { class: 'c-cover' },
      el('div', { class: 'warn-text' }, `In osu! this is drawn under ${over.map((x) => x.label).join(', ')}.`),
      el('div', { class: 'dim small' }, 'osu! draws what is shared by all difficulties over what belongs to one difficulty, on the same layer. The order in this list cannot change that; the preview shows it the way osu! will. Two ways out:'),
      el('div', { class: 'c-actions' },
        el('button', { class: 'mini-btn', onclick: () => { inst.output = 'osb'; scheduleGen(inst, 0); rebuildScene(); commit(); rerender(); renderCFx(); } }, 'Write this one to all difficulties'),
        el('button', { class: 'mini-btn', onclick: () => { p.output = 'diff'; p.diff = inst.diff; scheduleGen(p, 0); rebuildScene(); commit(); rerender(); renderCFx(); } }, `Write "${p.label}" to [${diffName(inst.diff)}] only`))));
  }
  if (followsKiai(inst)) {
    body.append(el('div', { class: 'c-cover' },
      el('div', { class: 'dim small' }, 'This effect was saved to follow kiai time (a setting that no longer exists), so part of it only shows during kiai.'),
      el('div', { class: 'c-actions' },
        el('button', { class: 'mini-btn', onclick: () => {
          for (const k of KIAI_KEYS) delete inst.params[k];
          scheduleGen(inst, 0); commit(); rerender();
        } }, 'Show it over its whole length'))));
  }
  const more = el('details', { class: 'c-more' }, el('summary', {}, el('span', { class: 'lbl' }, 'More settings'), el('span', { class: 'cnt' })));
  more.open = C.more;
  more.addEventListener('toggle', () => { C.more = more.open; });
  const groups = new Map();
  for (const def of eff.params) {
    if (upFront(def) || !shown(def)) continue;
    const gname = def.group || 'Settings';
    if (!groups.has(gname)) groups.set(gname, []);
    groups.get(gname).push(def);
  }
  const fold = (gname, rows) => {
    const d = el('details', { class: 'c-group' }, el('summary', {}, gname), ...rows);
    d.open = C.groups.has(gname);
    d.addEventListener('toggle', () => { if (d.open) C.groups.add(gname); else C.groups.delete(gname); });
    return d;
  };
  for (const [gname, defs] of groups) more.append(fold(gname, defs.map((def) => paramRow(inst, eff, def, rerender))));
  more.append(fold('Time & placement', [...timeRows(inst, eff, rerender), ...advancedRows(inst, eff, rerender)]));
  const hidden = [...groups.values()].reduce((n, g) => n + g.length, 0);
  more.querySelector('.cnt').textContent = hidden ? `${hidden} more` : '';
  body.append(more);
  body.append(el('div', { class: 'c-actions' },
    el('button', { class: 'mini-btn', onclick: () => openSavePreset(inst) }, 'Save preset'),
    el('button', { class: 'mini-btn', onclick: () => { inst.seed = Math.floor(Math.random() * 1e6); scheduleGen(inst, 0); commit(); } }, 'Reseed'),
    el('button', { class: 'mini-btn', onclick: () => { duplicateInstance(inst.id); C.openInst = S.selectedId; renderCFx(); } }, 'Duplicate'),
    el('button', { class: 'mini-btn', onclick: () => restack(inst, true) }, 'Front'),
    el('button', { class: 'mini-btn', onclick: () => restack(inst, false) }, 'Back'),
    el('div', { class: 'spacer' }),
    el('button', { class: 'mini-btn danger', onclick: () => deleteInst(inst.id) }, 'Delete')));
  return body;
}
function paceStrip(inst, rerender) {
  const p = inst.params;
  const span = Math.max(100, inst.end - inst.start);
  const shown = fillTemplate(p.text, mapFor(inst));
  const { chars, words } = paceUnits(shown);
  const n = chars.length;
  const box = el('div', { class: 'pace' });
  if (n < 2) return box;
  const adjusted = () => !!validPace(p, p.text, n);
  let marks = (validPace(p, p.text, n, inst.end - inst.start) || evenPace(shown, span)).map((m) => ({ c: m.c, t: m.t }));
  const GAP = Math.min(20, span / (n + 2));
  const timeOf = (c) => {
    let k = 0;
    while (k + 1 < marks.length && marks[k + 1].c <= c) k++;
    const c1 = marks[k + 1]?.c ?? n, t1 = marks[k + 1]?.t ?? span;
    return marks[k].t + ((c - marks[k].c) / (c1 - marks[k].c)) * (t1 - marks[k].t);
  };
  const at = (c) => marks.findIndex((m) => m.c === c);
  const ensure = (c) => { if (at(c) < 0) { const t = timeOf(c); marks.push({ c, t }); marks.sort((x, y) => x.c - y.c); } return at(c); };
  for (const c of words) ensure(c);
  const wordEnd = (w) => words[w + 1] ?? n;
  const wordT1 = (w) => (w + 1 < words.length ? marks[at(words[w + 1])].t : span);
  const save = (final) => {
    p.pace = marks.map((m) => ({ c: m.c, t: Math.round(m.t) })); p.paceText = p.text; p.paceDur = inst.end - inst.start;
    scheduleGen(inst, final ? 0 : 40);
    if (final) commit();
  };
  const sel = () => (C.paceWord?.id === inst.id && C.paceWord.w < words.length ? C.paceWord.w : null);
  const tapping = () => (C.tap?.id === inst.id ? C.tap : null);

  const head = el('div', { class: 'pace-head' });
  const strip = el('div', { class: 'pace-strip' }), nowLine = el('div', { class: 'pace-now' });
  const sub = el('div', { class: 'pace-sub' });
  const hint = el('div', { class: 'pace-hint dim small' });
  box.append(head, strip, sub, hint);
  let subNow = null, subRange = null;

  const draggable = (chip, stripEl, range, start, onClick) => {
    chip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); chip.setPointerCapture(e.pointerId);
      const x0 = e.clientX, W = stripEl.clientWidth || 1;
      let apply = null, moved = false;
      const move = (ev) => {
        if (!moved && Math.abs(ev.clientX - x0) < 3) return;
        if (!moved) { moved = true; chip.classList.add('drag'); apply = start?.(); }
        if (!apply) return;
        apply(((ev.clientX - x0) / W) * range());
        place(); save(false);
      };
      const up = () => {
        chip.classList.remove('drag');
        chip.removeEventListener('pointermove', move); chip.removeEventListener('pointerup', up); chip.removeEventListener('pointercancel', up);
        if (moved && apply) { save(true); draw(); } else if (!moved) onClick?.();
      };
      chip.addEventListener('pointermove', move); chip.addEventListener('pointerup', up); chip.addEventListener('pointercancel', up);
    });
  };
  const mover = (a, b, lo, hi, first, last) => {
    const before = marks.map((m) => m.t);
    return (d) => {
      marks.forEach((m, j) => { m.t = before[j]; });
      d = Math.max(lo + GAP * (a - first) - before[a], Math.min(hi - GAP * (last - (b - 1)) - before[b - 1], d));
      for (let j = a; j < b; j++) marks[j].t += d;
      for (let j = b; j <= last; j++) marks[j].t = Math.max(marks[j].t, marks[j - 1].t + GAP);
      for (let j = a - 1; j >= first; j--) marks[j].t = Math.min(marks[j].t, marks[j + 1].t - GAP);
    };
  };

  function place() {
    [...strip.querySelectorAll('.pace-w')].forEach((chip, w) => {
      const t0 = marks[at(words[w])].t, t1 = wordT1(w);
      chip.style.left = `${(t0 / span) * 100}%`;
      chip.style.width = `${(Math.max(0, t1 - t0) / span) * 100}%`;
    });
    const w = sel();
    if (w == null || !subRange) return;
    const t0 = marks[at(words[w])].t, t1 = wordT1(w), len = Math.max(1, t1 - t0);
    subRange.t0 = t0; subRange.len = len;
    [...sub.querySelectorAll('.pace-w')].forEach((chip, i) => {
      const c = words[w] + i, a = timeOf(c), b = c + 1 < wordEnd(w) ? timeOf(c + 1) : t1;
      chip.style.left = `${((a - t0) / len) * 100}%`;
      chip.style.width = `${(Math.max(0, b - a) / len) * 100}%`;
    });
  }
  const stopTap = (done) => {
    C.tap = null; C.lyric = null;
    if (S.playing) pause();
    if (done) { save(true); toast('Pace set. Drag to fine-tune', 'ok', { ms: 2500 }); }
    draw();
  };
  const tapAt = (time) => {
    const tp = tapping();
    if (!tp) return;
    const rel = time - inst.start;
    const k = () => at(tp.cs[tp.next]);
    if (tp.next > 0 && rel < marks[at(tp.cs[tp.next - 1])].t) tp.next = 0;
    if (rel <= tp.lo) return;
    const i = k(), left = tp.cs.length - 1 - tp.next;
    marks[i].t = Math.max(marks[i - 1].t + GAP, Math.min(rel, tp.hi() - GAP * (left + 1)));
    const c0 = marks[i].c, cEnd = tp.cEnd, room = tp.hi() - marks[i].t;
    for (let j = i + 1; j < marks.length && marks[j].c < cEnd; j++) marks[j].t = marks[i].t + ((marks[j].c - c0) / (cEnd - c0)) * room;
    tp.next++;
    save(false);
    if (tp.next >= tp.cs.length) stopTap(true); else draw();
  };
  const startTap = () => {
    const w = sel();
    if (w != null && wordEnd(w) - words[w] > 1) {
      for (let c = words[w]; c < wordEnd(w); c++) ensure(c);
      const cs = []; for (let c = words[w] + 1; c < wordEnd(w); c++) cs.push(c);
      C.tap = { id: inst.id, next: 0, cs, cEnd: wordEnd(w), lo: marks[at(words[w])].t, hi: () => wordT1(w) };
    } else {
      C.tap = { id: inst.id, next: 0, cs: words.slice(1), cEnd: n, lo: 0, hi: () => span };
    }
    if (!C.tap.cs.length) { C.tap = null; return; }
    C.lyric = { capture: (t) => tapAt(t) };
    loopInstance(inst);
    draw();
  };

  function draw() {
    head.innerHTML = ''; strip.innerHTML = ''; sub.innerHTML = '';
    const tp = tapping(), w = sel();
    const label = (wi) => chars.slice(words[wi], wordEnd(wi)).join('');
    const tapLabel = tp ? chars.slice(tp.cs[tp.next], tp.cs[tp.next + 1] ?? tp.cEnd).join('') : '';
    head.append(...[el('span', { class: 'grow' }, 'Singing pace'),
      tp ? el('button', { class: 'primary-btn pace-tap', onclick: () => tapAt(S.playing ? now() : S.time) }, `Tap: ${tapLabel}`) : null,
      el('button', { class: 'mini-btn', 
        onclick: () => (tp ? stopTap(false) : startTap()) }, tp ? 'Stop' : w != null && wordEnd(w) - words[w] > 1 ? 'Tap letters' : 'Tap along'),
      adjusted() && !tp ? el('button', { class: 'mini-btn', onclick: () => { delete p.pace; delete p.paceText; C.paceWord = null; scheduleGen(inst, 0); commit(); rerender(); } }, 'Even') : null].filter(Boolean));
    words.forEach((c, wi) => {
      const cls = 'pace-w' + (wi === 0 ? ' fixed' : '') + (wi === w ? ' sel' : '') + (tp && tp.cs[tp.next] === c ? ' next' : '');
      const chip = el('div', { class: cls }, el('span', {}, label(wi)));
      draggable(chip, strip, () => span,
        wi === 0 ? null : () => mover(at(c), at(wordEnd(wi)) < 0 ? marks.length : at(wordEnd(wi)), 0, span, 0, marks.length - 1),
        () => { C.paceWord = w === wi ? null : { id: inst.id, w: wi }; draw(); });
      strip.append(chip);
    });
    strip.append(nowLine);
    subRange = null; subNow = null;
    if (w != null && wordEnd(w) - words[w] > 1) {
      const sStrip = el('div', { class: 'pace-strip letters' });
      for (let c = words[w]; c < wordEnd(w); c++) {
        const first = c === words[w];
        const chip = el('div', { class: 'pace-w' + (first ? ' fixed' : '') + (tp && tp.cs[tp.next] === c ? ' next' : '') }, el('span', {}, chars[c]));
        if (!first) draggable(chip, sStrip, () => subRange.len, () => {
          for (let q = words[w]; q < wordEnd(w); q++) ensure(q);
          const a = at(words[w]), i = at(c), b = a + (wordEnd(w) - words[w]);
          return mover(i, i + 1, marks[a].t, wordT1(w), a, b - 1);
        });
        sStrip.append(chip);
      }
      subNow = el('div', { class: 'pace-now' });
      sStrip.append(subNow);
      subRange = { t0: 0, len: 1 };
      sub.append(el('div', { class: 'pace-cap dim small' }, `Letters of “${label(w)}”: drag one to where it starts. The one before it is held until then.`), sStrip);
    }
    place();
    hint.textContent = tp ? 'Click "Tap" as each one starts. The line loops; when it starts over, tapping begins again.'
      : w != null ? '' : words.length > 1 ? 'Drag a word to the moment it is sung. Click a word to time its letters (a held vowel, a long note).' : 'Click the word to time its letters.';
  }
  draw();
  const tick = () => {
    if (!box.isConnected) return;
    const rel = (S.playing ? now() : S.time) - inst.start, f = rel / span;
    nowLine.style.display = f >= 0 && f <= 1 ? '' : 'none';
    nowLine.style.left = `${f * 100}%`;
    if (subNow && subRange) {
      const g = (rel - subRange.t0) / subRange.len;
      subNow.style.display = g >= 0 && g <= 1 ? '' : 'none';
      subNow.style.left = `${g * 100}%`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return box;
}
function timeRows(inst, eff, rerender) {
  const row = (label, value, onSet) => {
    const inp = el('input', { class: 'time-input', value: fmtTime(value) });
    inp.addEventListener('change', () => { const t = parseTime(inp.value); if (t != null) onSet(t); else inp.value = fmtTime(value); });
    nudgeable(inp, () => parseTime(inp.value) ?? value, (t) => { inp.value = fmtTime(t); onSet(t); });
    return el('div', { class: 'row' }, el('label', {}, label), el('div', { class: 'ctl' }, inp));
  };
  const rows = [row('Start', inst.start, (t) => { const d = inst.end - inst.start; inst.start = t; if (eff.scope !== 'range' || inst.end <= t) inst.end = t + d; syncEnd(inst); scheduleGen(inst, 0); commit(); rerender(); })];
  if (eff.scope !== 'point') rows.push(row('End', inst.end, (t) => { inst.end = Math.max(inst.start + 10, t); scheduleGen(inst, 0); commit(); rerender(); }));
  return rows;
}

const PV = { hover: null, hoverKey: null, hoverT: 0, hoverOff: 0, block: null };
let mouse = { x: 0, y: 0 };
window.addEventListener('mousemove', (e) => {
  mouse = { x: e.clientX, y: e.clientY };
  if (PV.block && Math.hypot(mouse.x - PV.block.x, mouse.y - PV.block.y) > 12) PV.block = null;
}, true);
const hoverCache = new Map();
const openInstance = () => S.project.instances.find((i) => i.id === C.openInst) || null;
function sceneSprites(base, include = null, exclude = null) {
  const lifted = [], own = [], shared = [];
  for (const i of drawOrder(S.project.instances)) {
    const take = i.id === include || (!exclude?.has(i.id) && isWritten(i) && visibleInPreview(i));
    if (!take) continue;
    const sp = S.gen.get(i.id)?.sprites || [];
    if (!inDiffFile(i)) appendAll(shared, sp);
    else if (liftedInst(i)) for (const x of sp) (x.layer === 'Background' ? lifted : own).push(liftSprite(x));
    else appendAll(own, sp);
  }
  return [...base.diff, ...lifted, ...own, ...base.osb, ...shared];
}
function pvScenes() {
  const what = $('stageWhat');
  if (PV.hover) {
    const eff = EFFECT_MAP[PV.hover.effectId];
    preview.setCount(1);
    preview.setScene(0, PV.hover.sprites, '');
    what.textContent = `Preview: ${eff.icon} ${eff.name} · ${PV.hover.preset}`;
    what.classList.remove('hidden');
    $('stageCells').classList.remove('multi');
    return;
  }
  what.classList.add('hidden');
  const base = baseSprites();
  const inst = openInstance();
  if (S.compare) {
    preview.setCount(2);
    preview.setScene(0, sceneSprites(base), $('versionSelect').dataset.current || 'Open', { active: true, notes: inst ? new Set(inst.objectTimes || []) : null });
    preview.setScene(1, [...base.diff, ...S.compare.own, ...base.osb, ...S.compare.shared], S.compare.name);
  } else {
    preview.setCount(1);
    preview.setScene(0, sceneSprites(base), '', { notes: inst ? new Set(inst.objectTimes || []) : null });
  }
  $('stageCells').classList.remove('multi');
}
function hoverSetup(effectId, preset) {
  const eff = EFFECT_MAP[effectId];
  const sel = S.selection;
  const k = S.map.kiai[0];
  const t0 = Math.round(sel?.start ?? k?.start ?? S.map.objects[0]?.time ?? 0);
  const inst = {
    id: '__hover', effect: effectId, preset, start: t0, end: t0 + 6000, layer: eff.defaultLayer, output: 'osb', diff: S.refDiff,
    seed: 7, enabled: true, params: defaultParams(eff, preset),
    objectTimes: eff.scope === 'objects' && sel?.objectTimes ? sel.objectTimes.filter((t) => t >= t0 && t <= t0 + 6000) : null,
  };
  syncEnd(inst);
  return { inst, loop: { start: Math.max(0, t0 - 300), end: t0 + 2500 } };
}
async function genTemp(inst) {
  const eff = EFFECT_MAP[inst.effect], map = S.map;
  const set = inst.objectTimes ? new Set(inst.objectTimes) : null;
  const targets = set ? map.objects.filter((o) => set.has(o.time)) : map.objectsInRange(inst.start, inst.end);
  const ctx = makeContext(map, inst, targets, { audio: () => (S.audioUrl ? loadAudioData(S.audioUrl).catch(() => null) : null), siblings: inst.effect === 'actor' ? actorBlocks() : null });
  try { await eff.generate(ctx, inst.params); fitOwnImage(ctx); } catch (e) { console.warn('hover preview', e); return []; }
  return ctx.sprites.map((s) => s.finalize()).filter((s) => isFinite(s.start));
}
function pvHover(effectId, preset) {
  if (!S.map || !preset || PV.block) return;
  clearTimeout(PV.hoverOff);
  const sel = S.selection;
  const key = `${effectId}|${preset}|${S.map.loadedAt}|${sel?.start}|${sel?.objectTimes?.length}`;
  if (PV.hoverKey === key) return;
  PV.hoverKey = key;
  clearTimeout(PV.hoverT);
  PV.hoverT = setTimeout(async () => {
    const { inst, loop } = hoverSetup(effectId, preset);
    let sprites = hoverCache.get(key);
    if (!sprites) { sprites = await genTemp(inst); if (hoverCache.size > 60) hoverCache.clear(); hoverCache.set(key, sprites); }
    if (PV.hoverKey !== key) return;
    PV.hover = { effectId, preset, sprites, loop, t0: performance.now() };
    pvScenes();
  }, 160);
}
function pvHoverEnd(now = false) {
  clearTimeout(PV.hoverOff);
  const end = () => { PV.hoverKey = null; clearTimeout(PV.hoverT); if (PV.hover) { PV.hover = null; pvScenes(); S.dirty = true; } };
  if (now === true) end(); else PV.hoverOff = setTimeout(end, 200);
}

function parseLrc(text) {
  let offset = 0;
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const off = line.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) { offset = +off[1]; continue; }
    const stamps = [...line.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!stamps.length) continue;
    const words = line.replace(/\[[^\]]*\]/g, '').replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();
    for (const s of stamps) out.push({ time: Math.round((+s[1] * 60 + parseFloat(s[2].replace(':', '.'))) * 1000) - offset, text: words });
  }
  return out.sort((a, b) => a.time - b.time);
}
function lrcLines(entries, shift, until) {
  const lines = [];
  entries.forEach((e, i) => {
    if (!e.text) return;
    const start = e.time + shift;
    const next = entries[i + 1] ? entries[i + 1].time + shift : start + 5000;
    const end = Math.min(next, start + 10000);
    if (start >= 0 && start < until) lines.push({ text: e.text, start, end: Math.min(end, until) });
  });
  return lines;
}
async function openLyricFinder() {
  if (!S.map) return toast('Choose a beatmap first', 'bad');
  const md = S.map.metadata;
  const box = el('div', { class: 'c-lt' });
  const style = el('select', {}, ...EFFECT_MAP.lyrics.presets.map((p) => el('option', { value: p.name }, p.name)));
  style.value = S.prefs.lyricLook || 'Plain';
  let results = [], pick = null, entries = [], shift = 0;
  const m = modal('Find lyrics', box, [], { onClose: () => { C.lyric = null; } });
  const firstSung = () => entries.find((e) => e.text);
  const draw = () => {
    box.innerHTML = '';
    if (!results.length) { box.append(el('div', { class: 'dim' }, `Searching lrclib.net for “${md.Title}”…`)); return; }
    const list = el('div', { class: 'c-lf-list' }, ...results.map((r) => el('button', {
      class: 'c-lf-item' + (r === pick ? ' on' : ''), onclick: () => { pick = r; entries = parseLrc(r.synced); shift = 0; draw(); },
    }, el('b', {}, `${r.artist} - ${r.title}`), el('span', { class: 'dim' }, ` ${r.album ? r.album + ' · ' : ''}${fmtShort(r.duration * 1000)}`),
      r.artistMatch ? null : el('span', { class: 'warn-text' }, ' · different artist'))));
    if (!pick) box.append(el('div', { class: 'dim small' }, results.some((r) => r.artistMatch) ? 'Pick one.' : 'No exact match for this artist. These songs only share the title: probably not the right lyrics.'));
    box.append(list);
    if (!pick) return;
    const lines = lrcLines(entries, shift, S.duration);
    const f = firstSung();
    const sung = entries.filter((e) => e.text).length, lost = sung - lines.length;
    const late = entries.filter((e) => e.text && e.time + shift >= S.duration).length;
    box.append(
      el('div', { class: 'c-lf-sync' },
        el('span', { class: 'grow' }, f ? `First line at ${fmtTime(f.time + shift).slice(0, 9)}` : 'No timed lines'),
        el('button', { class: 'mini-btn', onclick: (e) => { shift -= e.shiftKey ? 1000 : 100; draw(); } }, '−'),
        el('button', { class: 'mini-btn', onclick: (e) => { shift += e.shiftKey ? 1000 : 100; draw(); } }, '+')),
      el('div', { class: 'c-lf-lines' }, ...lines.slice(0, 40).map((l) => el('div', {}, el('span', { class: 'dim' }, fmtShort(l.start) + '  '), l.text))),
      el('div', { class: 'c-lt-row' }, el('span', { class: 'dim' }, 'Style'), style, el('div', { class: 'spacer' }),
        el('button', { class: 'primary-btn', disabled: !lines.length, onclick: () => {
          S.prefs.lyricLook = style.value; savePrefs();
          m.close();
          addLyricLines(lines, null, style.value);
          C.openInst = null; C.lyricsOpen = true; renderCFx();
        } }, lost ? `Add ${lines.length} of ${sung} lines` : `Add ${lines.length} lines`)),
      lost ? el('div', { class: 'warn-text' }, `${lost} line${lost > 1 ? 's are' : ' is'} left out: ${late ? `${late} after the end of this map` : ''}${late && lost - late ? ', ' : ''}${lost - late ? `${lost - late} before its start` : ''}`) : null);
  };
  C.lyric = { capture(t) { const f = firstSung(); if (!pick || !f) return; shift = t - f.time; draw(); } };
  draw();
  try {
    const r = await api.post('/api/lyrics/find', {
      artist: md.Artist, title: md.Title, artistUnicode: md.ArtistUnicode, titleUnicode: md.TitleUnicode, duration: Math.round(S.duration / 1000),
    });
    results = r.results || [];
    if (!results.length) { box.innerHTML = ''; box.append(el('div', { class: 'dim' }, 'No timed lyrics found for this song on lrclib.net.')); return; }
    pick = results[0].artistMatch ? results[0] : null;
    entries = pick ? parseLrc(pick.synced) : [];
    draw();
  } catch (e) {
    box.innerHTML = '';
    box.append(el('div', { class: 'warn-text' }, `Lyrics search failed: ${e.message}`));
  }
}

const lyricDraft = () => (S.prefs.lyricDrafts || {})[S.folder] || '';
function setLyricDraft(text) {
  const d = { ...(S.prefs.lyricDrafts || {}) };
  delete d[S.folder];
  if (text && text.trim()) d[S.folder] = text;
  for (const k of Object.keys(d).slice(0, -12)) delete d[k];
  S.prefs.lyricDrafts = d; savePrefs();
}

async function loadFonts() {
  try {
    const r = await api.get('/api/fonts');
    for (const f of r.fonts) await registerFont(f);
  } catch { }
}
async function registerFont(file) {
  const name = file.replace(/\.(ttf|otf|woff2?)$/i, '');
  try {
    const face = new FontFace(name, `url(/fonts/${encodeURIComponent(file)})`);
    await face.load();
    document.fonts.add(face);
    if (!S.fonts.includes(name)) S.fonts.push(name);
  } catch (e) { console.warn('font failed', file, e); }
  return name;
}
function uploadFont(cb) {
  const inp = el('input', { type: 'file', accept: '.ttf,.otf,.woff,.woff2' });
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return cb(null);
    const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(f); });
    try {
      const safe = f.name.replace(/[^\w\-. ]+/g, '_');
      await api.post('/api/fonts', { name: safe, data: b64 });
      const name = await registerFont(safe);
      toast(`Font "${name}" added`, 'ok');
      cb(name);
    } catch (e) { toast(e.message, 'bad'); cb(null); }
  };
  inp.click();
}

function importImage(cb, gif = false) {
  if (!S.folder) return toast('Open a map first', 'bad');
  const inp = el('input', { type: 'file', accept: '.png,.jpg,.jpeg' + (gif ? ',.gif,.webp' : '') });
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return cb(null);
    if (/\.(gif|webp)$/i.test(f.name) && !gif) { toast('A .gif or .webp only works as the picture of a Character', 'bad'); return cb(null); }
    const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(f); });
    try {
      const r = await api.post('/api/image', { folder: S.folder, name: f.name, data: b64 });
      if (S.mapset && !S.mapset.images.includes(r.path)) S.mapset.images = [...S.mapset.images, r.path].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      toast(`Picture added to the map: ${r.path}`, 'ok');
      cb(r.path);
    } catch (e) { toast(e.message, 'bad'); cb(null); }
  };
  inp.click();
}

async function removeForeign(n) {
  await exportStoryboard({ purge: true });
  try { if (S.mapset?.osb?.length) S.existing.osb = parseStoryboard(await fetchText(fileUrl(S.mapset.osb[0])), sbRead()); } catch { }
  for (const f of Object.keys(S.maps)) { try { S.maps[f] = loadMap(await fetchText(fileUrl(f))); } catch { } }
  S.existing.diffs = {};
  if (S.maps[S.refDiff]) setRefDiff(S.refDiff, true);
  await genAll(); renderAll();
  const left = S.mapExtra || 0;
  $('optExistingWrap').classList.toggle('hidden', !left);
  toast(left ? `${left} could not be removed` : `Removed ${n} sprite${n === 1 ? '' : 's'} that were not from this project. In osu!: Ctrl+L`, left ? 'bad' : 'ok', { ms: 6000 });
}

const stampDate = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15));
async function restoreBackup(files, what) {
  try {
    const r = await api.post('/api/restore', { folder: S.folder, files });
    if (!r.restored.length) return toast('The map already looks like that backup', 'info');
    await openMap(S.folder, S.refDiff);
    await exportStoryboard({ quiet: true });
    toast(`Restored ${what}. In osu!: press Ctrl+L now (don't save first)`, 'ok', { ms: 9000 });
  } catch (e) { toast('Restore failed: ' + e.message, 'bad', { ms: 8000 }); }
}
async function openBackups() {
  if (!S.folder) return toast('Open a map first', 'bad');
  const box = el('div', { class: 'bk' }, el('div', { class: 'dim' }, 'Looking…'));
  const m = modal('Restore the storyboard', box);
  let list;
  try { list = (await api.get(`/api/backups?folder=${encodeURIComponent(S.folder)}`)).backups; } catch (e) { box.textContent = e.message; return; }
  box.innerHTML = '';
  if (!locked() && !S.mapDiffers) await checkWritten();
  const extra = locked() ? 0 : S.mapExtra || 0;
  if (extra) {
    box.append(el('div', { class: 'bk-row first' },
      el('div', { class: 'grow' }, el('b', {}, `${extra} sprite${extra === 1 ? '' : 's'} in the map ${extra === 1 ? 'is' : 'are'} not from this project`),
        el('div', { class: 'dim small' }, 'Leftovers of earlier versions, or a storyboard made with another tool. They are drawn under your effects. Removing them is backed up first.')),
      el('button', { class: 'ghost-btn', onclick: () => { m.close(); removeForeign(extra); } }, 'Remove')));
  }
  if (!list.length) { box.append(el('div', { class: 'dim' }, 'No backups yet. One is made automatically the first time Storyforge changes a file of this map.')); return; }
  box.append(el('div', { class: 'bk-how' },
    'Storyforge copies each file right before it first changes it. Restoring puts the storyboard back as it was then. ',
    'Your notes and timing are never touched, the effects under "On this map" stay, and the current state is backed up first, so you can go back.'));
  const oldest = {};
  for (const b of list) for (const f of b.files) oldest[f.name] = b.stamp;
  const go = (files, what) => { m.close(); restoreBackup(files, what); };
  box.append(el('div', { class: 'bk-row first' },
    el('div', { class: 'grow' }, el('b', {}, 'Oldest backup'), el('div', { class: 'dim small' }, `Every file as far back as Storyforge has it (${stampDate(list[list.length - 1].stamp).toLocaleString()})`)),
    el('button', { class: 'primary-btn', onclick: () => go(oldest, 'the oldest backup') }, 'Restore')));
  for (const b of list) {
    box.append(el('div', { class: 'bk-row' },
      el('div', { class: 'grow' }, stampDate(b.stamp).toLocaleString(), el('div', { class: 'dim small' }, b.files.map((f) => (f.name.toLowerCase().endsWith('.osb') ? 'shared storyboard (.osb)' : `difficulty ${f.name.match(/\[([^\]]*)\]\.osu$/i)?.[1] || f.name}`)).join(', '))),
      el('button', { class: 'ghost-btn', onclick: () => go(Object.fromEntries(b.files.map((f) => [f.name, b.stamp])), 'that backup') }, 'Restore')));
  }
}

let exporting = null, exportAgain = false, writeRetries = 0, writeRetryTimer = null;
let emptyOk = false;
let replaceOk = false;
async function exportStoryboard({ quiet = false, purge = false, keepStatus = false } = {}) {
  if (!S.map) return quiet ? undefined : toast('Choose a beatmap first', 'bad');
  if (locked()) return quiet ? undefined : toast('Not written: this storyboard was made with a newer Storyforge (see the note above the picture)', 'bad', { ms: 6000 });
  if (!quiet && !purge && !S.project.instances.some(isWritten) && S.mapDiffers && !emptyOk) {
    const m = modal('Nothing to write', el('div', {}, el('p', {}, 'There are no effects here, but the map still holds a storyboard made with Storyforge. Writing now would remove it from the map.'), el('p', { class: 'dim' }, 'A backup of the map files is made first (↩ puts it back).')), [
      el('button', { class: 'ghost-btn', onclick: () => m.close() }, 'Leave the map as it is'),
      el('button', { class: 'primary-btn', onclick: () => { m.close(); emptyOk = true; exportStoryboard().finally(() => { emptyOk = false; }); } }, 'Remove it from the map'),
    ]);
    return;
  }
  if (!purge && !replaceOk && madeElsewhere() > 0) {
    if (quiet) return;
    const m = modal('Replace the storyboard?', el('p', {}, 'This map already has a storyboard made with Storyforge on another PC. Writing replaces it with what is here.'), [
      el('button', { class: 'ghost-btn', onclick: () => m.close() }, 'Leave it'),
      el('button', { class: 'primary-btn', onclick: () => { m.close(); replaceOk = true; exportStoryboard().finally(() => { replaceOk = false; }); } }, 'Replace'),
    ]);
    return;
  }
  if (exporting) { exportAgain = true; return exporting; }
  exporting = doExport(quiet, purge, keepStatus);
  try { await exporting; } finally {
    exporting = null;
    if (exportAgain) { exportAgain = false; exportStoryboard({ quiet: true }); }
  }
}
function buildOutput() {
  const osb = {};
  const diffs = Object.fromEntries(Object.keys(S.maps).map((f) => [f, {}]));
  const used = new Set(), lifts = {};
  let sprites = 0, cmds = 0;
  for (const inst of drawOrder(S.project.instances)) {
    if (!isWritten(inst)) continue;
    const g = S.gen.get(inst.id);
    if (!g?.sprites?.length) continue;
    const toDiff = inst.output === 'diff' && diffs[inst.diff];
    const target = toDiff ? diffs[inst.diff] : osb;
    for (const [layer, lines] of Object.entries(serialize(g.sprites))) {
      if (toDiff && inst.layer === 'Background' && layer === 'Background') {
        const to = (lifts[inst.diff] ||= []);
        for (const l of lines) to.push(l.replace(/^(Sprite|Animation),Background,/, '$1,Foreground,'));
      } else appendAll(target[layer] ||= [], lines);
    }
    for (const s of g.sprites) for (const f of s.framePaths()) used.add(f);
    sprites += g.stats.sprites; cmds += g.stats.commands;
  }
  for (const [file, lines] of Object.entries(lifts)) diffs[file].Foreground = appendAll(lines, diffs[file].Foreground || []);
  return { osb, diffs, used, sprites, cmds };
}
async function checkWritten() {
  if (!S.map || locked() || exporting) return;
  const folder = S.folder;
  try {
    await genAll();
    const { osb, diffs } = buildOutput();
    const r = await api.post('/api/export', { folder, metadata: S.map.metadata, osb, diffs, check: true });
    if (folder !== S.folder) return;
    S.mapDiffers = r.differs.length > 0; S.mapExtra = r.extra || 0;
  } catch (e) { console.warn('could not compare with the map', e); return; }
  updateExportDot();
}
// Write the storyboard into the map (.osb, and .osu for difficulty-specific sprites).
async function doExport(quiet, purge = false, keepStatus = false) {
  const btn = $('btnExport');
  btn.disabled = true; btn.firstChild.textContent = quiet ? 'Writing…' : 'Exporting…';
  if (!keepStatus) setStatus('Writing…');
  try {
    await genAll();
    const { osb, diffs, used, sprites, cmds } = buildOutput();
    const assets = await A.exportAssets([...used]);
    const r = await api.post('/api/export', { folder: S.folder, metadata: S.map.metadata, osb, diffs, assets, purge });
    if (r.widescreen?.length) {
      for (const f of Object.keys(S.maps)) S.maps[f].general.WidescreenStoryboard = '1';
      checkBanner();
      toast('Widescreen storyboard was off in this map: it is switched on now, so nothing is cut off at the sides', 'info', { ms: 6000 });
    }
    const where = [r.osb ? `.osb (${(r.osbSize / 1024).toFixed(0)} KB)` : null, r.diffs.length ? `${r.diffs.length} difficult${r.diffs.length > 1 ? 'ies' : 'y'}` : null].filter(Boolean).join(' + ');
    if (!quiet) toast(`✓ Written ${fmtCount(sprites)} sprites → ${where || 'nothing to write'}. In osu!: Ctrl+L to reload`, 'ok', { ms: 5000 });
    if (!keepStatus) setStatus(`✓ In the map ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · osu!: Ctrl+L (unsaved changes in osu!? Ctrl+S, wait for this line, then Ctrl+L)`, 'ok');
    S.project.exportedHash = projectHash(); S.mapDiffers = false; S.mapExtra = r.extra || 0;
    saveSoon(); updateExportDot();
    if (ownInMap() !== S.ownInMap) reloadExisting();
    writeRetries = 0; clearTimeout(writeRetryTimer);
  } catch (e) {
    console.error(e);
    clearTimeout(writeRetryTimer);
    if (e.busy && writeRetries < 8) {
      writeRetries++;
      setStatus(`${e.message}, retrying…`);
      writeRetryTimer = setTimeout(() => exportStoryboard({ quiet: true }), 1500 * writeRetries);
    } else {
      writeRetries = 0;
      toast('Writing failed: ' + e.message, 'bad', { ms: 8000 });
      setStatus('Writing failed: ' + e.message);
    }
  } finally {
    btn.disabled = false; btn.firstChild.textContent = 'Write';
    updateExportDot();
  }
}
function setStatus(text, kind = '') {
  const st = $('status');
  st.textContent = text; st.className = 'status ' + kind;
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.onopen = async () => {
    $('pillClipboard').classList.toggle('on', S.server.clipboard !== false);
    try { const st = await api.get('/api/state'); if (S.server.build && st.build && st.build !== S.server.build) location.reload(); } catch { }
  };
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.type === 'clipboard') handleClipboard(ev.text);
    if (ev.type === 'tosu') onTosu(ev);
    if (ev.type === 'osu') onOsuWindow(ev);
    if (ev.type === 'files') onFilesChanged(ev);
    if (ev.type === 'project') onProjectSaved(ev);
    if (ev.type === 'hotkey') onHotkey(ev.name);
  };
  es.onerror = () => { $('pillClipboard').classList.remove('on'); };
}
function onOsuWindow(ev) {
  S.osu = ev;
  renderHeader();
  if (!ev.folder) return;
  followMap(ev.folder, ev.file);
}
function followMap(folder, file) {
  if (folder !== S.folder) { openMap(folder, file); return; }
  if (file && S.maps[file] && file !== S.refDiff) setRefDiff(file);
}

async function onFilesChanged(ev) {
  if (!S.folder || ev.folder !== S.folder.split(/[\\/]/).pop()) return;
  const osus = ev.changed.filter((n) => n.toLowerCase().endsWith('.osu') && S.maps[n]);
  for (const n of osus) {
    try { S.maps[n] = loadMap(await fetchText(fileUrl(n))); } catch (e) { console.warn('kept the previous version of', n, e); }
  }
  if (osus.includes(S.refDiff)) setRefDiff(S.refDiff, true);
  if (ev.changed.some((n) => n.toLowerCase().endsWith('.osb')) && S.mapset?.osb?.length) {
    try { S.existing.osb = parseStoryboard(await fetchText(fileUrl(S.mapset.osb[0])), sbRead()); } catch { }
  }
  S.existing.diffs = {};
  await genAll();
  renderAll();
  const saved = osus.length > 0, can = S.project.instances.some(isWritten) && !locked();
  const behind = projectHash() !== S.project.exportedHash || S.mapDiffers;
  if (!can) { setStatus('Map reloaded (saved in osu!)'); checkWritten(); return; }
  if (behind && saved) {
    setStatus('Saved in osu!: writing your latest changes into the map…');
    await exportStoryboard({ quiet: true, keepStatus: true });
    if (projectHash() === S.project.exportedHash) setStatus('✓ Ready, your latest changes are in the map now: press Ctrl+L in osu! (without saving again)', 'ok');
    return;
  }
  if (ev.osuBehind) setStatus('✓ Ready. osu! is still showing an older storyboard: press Ctrl+L in osu! now (without saving again)', 'ok');
  else if (ev.osuBehind === false && saved) setStatus('✓ Saved in osu!: it is showing the current storyboard', 'ok');
  else if (ev.osuBehind === false) return;
  else setStatus(ev.reapplied?.length ? '✓ Effects are back in the map after your save · osu!: Ctrl+L now' : 'Map reloaded (saved in osu!)', ev.reapplied?.length ? 'ok' : '');
  if (!behind) exportStoryboard({ quiet: true, keepStatus: true });
  else checkWritten();
}

async function refreshVersions() {
  const sel = $('versionSelect');
  if (!S.folder) { sel.classList.add('hidden'); return; }
  let v = { current: 'Main', versions: ['Main'] };
  try { v = await api.get(`/api/versions?folder=${encodeURIComponent(S.folder)}`); } catch { }
  if (S.compare && (S.compare.folder !== S.folder || S.compare.name === v.current || !v.versions.includes(S.compare.name))) { S.compare = null; rebuildScene(); }
  const others = v.versions.filter((n) => n !== v.current);
  const group = (label, items) => (items.length ? [el('optgroup', { label }, ...items)] : []);
  sel.replaceChildren(...v.versions.map((n) => el('option', { value: 'v:' + n }, n)), el('option', { value: 'new' }, '＋ New version (a copy of this one)…'),
    ...(S.compare ? [el('option', { value: 'stop' }, `✕ Stop comparing with ${S.compare.name}`)] : []),
    ...group('Compare side by side with', others.filter((n) => n !== S.compare?.name).map((n) => el('option', { value: 'c:' + n }, `◫ ${n}`))),
    ...group('Delete', v.versions.length > 1 ? v.versions.map((n) => el('option', { value: 'd:' + n }, `🗑 ${n}`)) : []));
  sel.value = 'v:' + v.current; sel.dataset.current = v.current;
  sel.classList.remove('hidden');
  sel.classList.toggle('comparing', !!S.compare);
}
async function startCompare(name) {
  const folder = S.folder;
  try {
    const proj = await api.get(`/api/project?folder=${encodeURIComponent(folder)}&version=${encodeURIComponent(name)}`);
    if (!Array.isArray(proj?.instances)) throw new Error(`"${name}" could not be read`);
    toast(`Building "${name}" to compare…`, 'info', { ms: 1500 });
    const list = proj.instances.filter((i) => EFFECT_MAP[i.effect]);
    list.forEach(migrateText); list.forEach(dropAlt);
    for (const i of list) i.params = normalizeParams(EFFECT_MAP[i.effect], i.params);
    const own = [], lifted = [], shared = [];
    for (const i of drawOrder(list)) {
      if (!isWritten(i) || !visibleInPreview(i)) continue;
      const sp = await genTemp(i);
      if (S.folder !== folder) return;
      if (!inDiffFile(i)) appendAll(shared, sp);
      else if (liftedInst(i)) for (const x of sp) (x.layer === 'Background' ? lifted : own).push(liftSprite(x));
      else appendAll(own, sp);
    }
    S.compare = { folder, name, own: [...lifted, ...own], shared };
    selectInstance(null);
    rebuildScene(); refreshVersions();
    toast(`Left: the open version. Right: "${name}". Both play in sync; edits go to the open one.`, 'ok', { ms: 5000 });
  } catch (e) { toast(e.message, 'bad'); }
}
function deleteVersion(name, cur) {
  const m = modal(`Delete "${name}"?`, el('p', { class: 'dim' }, name === cur ? 'It is the one that is open: another version is opened in its place.' : 'The other versions stay as they are.'), [
    el('button', { class: 'primary-btn', onclick: async () => {
      m.close();
      S.switching = true;
      try {
        if (name === cur) {
          const v = await api.get(`/api/versions?folder=${encodeURIComponent(S.folder)}`), to = v.versions.find((n) => n !== name);
          if (!to) throw new Error('It is the only version');
          S.compare = null;
          S.project.refDiff = S.refDiff;
          await api.post('/api/project', { folder: S.folder, project: S.project, client: S.clientId });
          await api.post('/api/version', { folder: S.folder, to, copy: false, client: S.clientId });
          hist.stack = []; hist.idx = -1; S.selectedId = null;
          await onProjectSaved({ by: 'versions', folder: S.folder });
        }
        if (S.compare?.name === name) { S.compare = null; rebuildScene(); }
        await api.post('/api/version', { folder: S.folder, remove: name });
        toast(`Deleted "${name}"`, 'ok');
      } catch (e) { toast(e.message, 'bad'); }
      S.switching = false;
      refreshVersions();
    } }, 'Delete'),
  ]);
}
async function onVersionPick() {
  const sel = $('versionSelect'), pick = sel.value, cur = sel.dataset.current;
  sel.value = 'v:' + cur;
  if (pick === 'stop') { S.compare = null; rebuildScene(); return refreshVersions(); }
  if (pick.startsWith('c:')) return startCompare(pick.slice(2));
  if (locked()) return toast('This project cannot be changed here right now', 'bad');
  if (pick.startsWith('d:')) return deleteVersion(pick.slice(2), cur);
  const go = async (to, copy) => {
    S.compare = null;
    S.switching = true;
    try {
      S.project.refDiff = S.refDiff;
      await api.post('/api/project', { folder: S.folder, project: S.project, client: S.clientId });
      await api.post('/api/version', { folder: S.folder, to, copy, client: S.clientId });
      if (!copy) { hist.stack = []; hist.idx = -1; S.selectedId = null; await onProjectSaved({ by: 'versions', folder: S.folder }); }
      toast(copy ? `Now working on the new version "${to}". "${cur}" stays as it was.` : `Version "${to}" is open`, 'ok');
    } catch (e) { toast(e.message, 'bad'); }
    S.switching = false;
    refreshVersions();
  };
  if (pick !== 'new') return go(pick.slice(2), false);
  const name = el('input', { placeholder: 'e.g. Meme build', style: { width: '100%' } });
  const m = modal('New version', el('div', {}, el('p', { class: 'dim' }, `A copy of "${cur}" under a new name. You carry on in the copy; "${cur}" stays as it is now and can be opened again from the same list.`), name), [
    el('button', { class: 'primary-btn', onclick: () => { const n = name.value.trim(); if (!n) return name.focus(); m.close(); go(n, true); } }, 'Make it'),
  ]);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') m.el.querySelector('.primary-btn').click(); });
  name.focus();
}

async function onProjectSaved(ev) {
  if (ev.by === S.clientId || ev.folder !== S.folder) return;
  try {
    const proj = await api.get(`/api/project?folder=${encodeURIComponent(S.folder)}`);
    if (!Array.isArray(proj.instances)) return;
    proj.instances.forEach(migrateText); proj.instances.forEach(dropAlt);
    S.locked = unknownParts(proj.instances);
    for (const inst of proj.instances) { const eff = EFFECT_MAP[inst.effect]; if (eff) inst.params = normalizeParams(eff, inst.params); }
    proj.instances = proj.instances.filter((i) => EFFECT_MAP[i.effect]);
    S.project = proj; checkBanner();
    if (!selectedInstance()) S.selectedId = null;
    snapshot(); await genAll(); renderAll(); updateExportDot();
    if (ev.by !== 'versions') refreshVersions();
  } catch { }
}

function onHotkey(name) {
  if (name === 'undo') { undo(); toast('↶ Undone', 'info', { ms: 1500 }); }
  if (name === 'repeat') repeatLast();
}
function repeatLast() {
  const base = S.project.instances.find((i) => i.id === S.lastInstId) || S.project.instances[S.project.instances.length - 1];
  if (!base) return toast('Add an effect first, then Ctrl+Alt+R repeats it', 'bad');
  if (!S.selection) { flashSelection(); return toast('Select notes or a time range first', 'bad'); }
  const eff = EFFECT_MAP[base.effect];
  const copy = { ...structuredClone(base), id: uid(), seed: Math.floor(Math.random() * 1e6) };
  copy.start = S.selection.start;
  if (S.selection.end > S.selection.start) copy.end = S.selection.end;
  else if (eff.scope !== 'point') copy.end = copy.start + (base.end - base.start);
  copy.objectTimes = eff.scope === 'objects' ? S.selection.objectTimes?.slice() || null : null;
  copy.diff = S.refDiff;
  refreshLabel(copy); syncEnd(copy);
  if (copy.effect === 'background') S.project.instances.unshift(copy); else S.project.instances.push(copy);
  S.lastInstId = copy.id;
  commit(); scheduleGen(copy, 0); selectInstance(copy.id);
  toast(`✓ ${copy.label}${copy.objectTimes ? ` on ${copy.objectTimes.length} notes` : ''}`, 'ok', { ms: 2000 });
}

function onTosu(ev) {
  const prev = S.tosu;
  S.tosu = ev;
  $('pillTosu').classList.toggle('on', !!ev.connected);
  $('pillTosu').classList.toggle('hidden', !ev.connected);
  $('btnSelOsu').classList.toggle('hidden', !ev.connected);
  $('optFollowWrap').classList.toggle('hidden', !ev.connected);
  if (!ev.connected) return;
  if (S.prefs.follow && !S.playing && ev.time != null && ev.time !== prev.time && S.map) seek(ev.time);
  if (ev.folder && S.server.songsDir && (ev.folder !== prev.folder || ev.file !== prev.file)) followMap(ev.folder, ev.file);
}

const app = {
  S, api, toast, openMap, seek, play, pause, time: () => (S.playing ? now() : S.time),
  effects: EFFECT_MAP, selectedInstance, savePrefs, openBackups, lyricDraft, setLyricDraft,
  addLyricLines: (...a) => { addLyricLines(...a); C.openInst = null; C.lyricsOpen = true; renderCFx(); },
  onPrefs: () => { updateWriteButton(); if (S.prefs.autoWrite) liveWriteSoon(); },
};
Object.assign(window.sbk, { app, timeline, C, restackTo, zOrder, stageEdit, copyEffects, pasteEffects, pasteSettings, keepSelection, saveMyPreset, addInstance, exportStoryboard, handleClipboard, selectInstance, commit, genAll, addLyricLines, parseLrc, lrcLines, buildOutput, coveredBy, projectHash });

function bind() {
  $('btnMap').onclick = $('btnMap2').onclick = () => openMapPicker(app);
  $('btnSettings').onclick = () => openSettings(app);
  $('versionSelect').onchange = onVersionPick;
  $('btnExport').onclick = exportStoryboard;
  $('btnUndo').onclick = undo;
  $('btnRedo').onclick = redo;
  $('btnBackups').onclick = openBackups;
  $('btnFit').onclick = () => timeline.fit();
  $('stage').addEventListener('contextmenu', stageMenu);
  $('cFxList').addEventListener('contextmenu', listMenu);
  $('btnKeys').onclick = openKeys;
  initSkin({ write: exportStoryboard });
  $('btnSelKeep').onclick = keepSelection;
  $('selChips').addEventListener('wheel', (e) => { e.preventDefault(); $('selChips').scrollLeft += (e.deltaY || e.deltaX); }, { passive: false });
  document.addEventListener('click', (e) => e.target.closest?.('button')?.blur());
  document.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') e.target.blur(); });
  $('btnFolder').onclick = () => S.folder && api.post('/api/open-folder', { folder: S.folder }).catch((e) => toast(e.message, 'bad'));
  $('diffSelect').onchange = (e) => setRefDiff(e.target.value);
  $('libSearch').addEventListener('input', debounce(renderLibrary, 120));
  $('libList').addEventListener('mouseover', (e) => {
    const n = e.target.closest?.('[data-fx]');
    if (n?.dataset.preset) pvHover(n.dataset.fx, n.dataset.preset); else pvHoverEnd();
  });
  $('libList').addEventListener('mouseleave', () => pvHoverEnd());
  $('btnPlay').onclick = () => (S.playing ? pause() : play());
  const bindPref = (id, key, fn) => {
    const e = $(id);
    if (e.type === 'checkbox') e.checked = !!S.prefs[key]; else e.value = S.prefs[key];
    e.addEventListener(e.type === 'range' ? 'input' : 'change', () => { S.prefs[key] = e.type === 'checkbox' ? e.checked : e.value; savePrefs(); fn?.(); S.dirty = true; });
  };
  const stageOpts = () => preview.setOpts({ notes: !!S.prefs.notes, bg: !!S.prefs.bg, safe: !!S.prefs.safe });
  bindPref('optNotes', 'notes', stageOpts);
  bindPref('optBg', 'bg', stageOpts);
  bindPref('optSafe', 'safe', stageOpts);
  bindPref('optLoop', 'loop');
  bindPref('optFollow', 'follow');
  bindPref('optExisting', 'existing', () => rebuildScene());
  bindPref('optAccum', 'accum');
  bindPref('snapSel', 'snap');
  bindPref('volume', 'volume', () => { audio.volume = +S.prefs.volume; });
  bindPref('speed', 'speed', () => { if (S.playing) { pause(); play(); } });
  preview.setOpts({ notes: !!S.prefs.notes, bg: !!S.prefs.bg, safe: !!S.prefs.safe });
  audio.volume = +S.prefs.volume;

  $('selStart').addEventListener('change', () => {
    const t = parseTime($('selStart').value);
    if (t == null) return renderSelbar();
    const end = S.selection?.end > t ? S.selection.end : t + (S.map ? S.map.beatLengthAt(t) * 8 : 2000);
    setSelection({ start: t, end, objectTimes: null, source: 'manual' });
  });
  $('selEnd').addEventListener('change', () => {
    const t = parseTime($('selEnd').value);
    if (t == null) return renderSelbar();
    const start = S.selection?.start ?? 0;
    setSelection({ start: Math.min(start, t), end: Math.max(start, t), objectTimes: null, source: 'manual' });
  });
  $('selStart').addEventListener('paste', (e) => {
    const txt = e.clipboardData.getData('text');
    if (/\(\d/.test(txt) && parseOsuTimestamp(txt)) { e.preventDefault(); handleClipboard(txt); $('selStart').blur(); }
  });
  nudgeable($('selStart'), () => S.selection?.start ?? S.time, (t) => setSelection({ start: t, end: Math.max(t, S.selection?.end ?? t), objectTimes: null, source: 'manual' }));
  nudgeable($('selEnd'), () => S.selection?.end ?? S.time, (t) => setSelection({ start: Math.min(t, S.selection?.start ?? t), end: t, objectTimes: null, source: 'manual' }));
  $('btnSelStart').onclick = () => selAtPlayhead('start');
  $('btnSelEnd').onclick = () => selAtPlayhead('end');
  $('btnSelClear').onclick = () => setSelection(null);
  $('btnSelOsu').onclick = () => {
    if (!S.tosu.connected || S.tosu.time == null) return toast('tosu is not connected', 'bad');
    const t = Math.round(S.tosu.time);
    const s = S.selection;
    if (!s || S.captureNext === 'start') { setSelection({ start: t, end: t, objectTimes: null, source: 'tosu' }); S.captureNext = 'end'; toast('Start set. Click again for the end', 'info', { ms: 2500 }); }
    else { setSelection({ start: Math.min(s.start, t), end: Math.max(s.start, t), objectTimes: null, source: 'tosu' }); S.captureNext = 'start'; }
    seek(t);
  };

  window.addEventListener('keydown', (e) => {
    if (modalOpen() || document.body.classList.contains('creating')) return;
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && document.activeElement.type !== 'checkbox' && document.activeElement.type !== 'range';
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); exportStoryboard(); return; }
    if (typing) { if (e.key === 'Escape') document.activeElement.blur(); return; }
    if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (ctrl && 'cxv'.includes(e.key.toLowerCase()) && !e.altKey) {
      if (String(getSelection?.() || '')) return;
      const k = e.key.toLowerCase();
      e.preventDefault();
      if (k === 'v') { if (e.shiftKey) pasteSettings(); else pasteEffects(); }
      else if (k === 'x') copyEffects(true);
      else if (C.focus === 'sel' && S.selection) { if (!keepSelection()) copyEffects(); }
      else if (!copyEffects()) keepSelection();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); if (S.selectedId) duplicateInstance(S.selectedId); return; }
    if (ctrl && !e.altKey && 'hj'.includes(e.key.toLowerCase())) { e.preventDefault(); flipEffects(e.key.toLowerCase() === 'h' ? 'h' : 'v'); return; }
    if (ctrl && !e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); if (e.shiftKey) removeBookmark(); else addBookmark(); return; }
    if (ctrl && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); jumpBookmark(e.key === 'ArrowLeft' ? -1 : 1); return; }
    if (ctrl || e.altKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (C.tap && C.lyric) C.lyric.capture(now());
      else if (S.playing) pause(); else play();
      return;
    }
    if (!S.map) return;
    const beat = S.map.beatLengthAt(S.time);
    if (e.key === 'ArrowLeft') { e.preventDefault(); seek(S.map.snap(S.time - beat * (e.shiftKey ? 4 : 1), 1)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); seek(S.map.snap(S.time + beat * (e.shiftKey ? 4 : 1), 1)); }
    if (e.key === 'Home') seek(0);
    if (e.key === 'End') seek(S.duration);
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'v') {
      const objs = S.map.objects, first = objs.length ? objs[0].time : 0, last = objs.length ? objs.reduce((m, o) => Math.max(m, o.endTime), 0) : Math.round(S.duration);
      const dragging = timeline.drag?.kind === 'select';
      if (e.shiftKey || dragging) {
        const sel = S.selection;
        const from = dragging ? snapTime(Math.max(0, timeline.drag.t0)) : sel ? (k === 'v' ? sel.start : sel.end) : Math.round(S.time);
        timeline.drag = null;
        if (k === 'v') setSelection({ start: from, end: Math.max(from, from < last ? last : Math.round(S.duration)), objectTimes: null, source: 'manual' });
        else setSelection({ start: 0, end: from, objectTimes: null, source: 'manual' });
        seek(k === 'v' ? S.selection.end : 0);
      } else seek(k === 'v' ? last : Math.round(S.time) <= first ? 0 : first);
    }
    if (k === 'x') { seek(0); play(); }
    if (k === 'c') { if (S.playing) pause(); else play(); }
    if (e.key === '[') selAtPlayhead('start');
    if (e.key === ']') selAtPlayhead('end');
    if (e.key === 'Escape') {
      if (C.pick.size) { C.pick.clear(); renderCFx(); }
      else if (S.selection) setSelection(null);
      else if (C.openInst) selectInstance(null);
    }
    if (e.key === 'Delete') { if (C.pick.size) deleteRows(pickedRows()); else if (S.selectedId) deleteInst(S.selectedId); }
    if (e.key.toLowerCase() === 'r') repeatLast();
  });
  window.addEventListener('beforeunload', () => { saveSoon.flush(); savePrefs.flush(); });
}

function allBookmarks() {
  const own = S.project.bookmarks || [];
  const maps = Object.values(S.maps || {}), theirs = [...new Set((maps.length ? maps : S.map ? [S.map] : []).flatMap((m) => m.bookmarks || []))];
  return [...theirs.filter((t) => !own.includes(t)).map((t) => ({ t, own: false })), ...own.map((t) => ({ t, own: true }))].sort((a, b) => a.t - b.t);
}
function addBookmark(at = S.time) {
  if (!S.map) return;
  if (locked()) return toast('This project cannot be changed here right now', 'bad');
  const t = Math.round(at);
  if (allBookmarks().some((b) => Math.abs(b.t - t) < 2)) return toast('There is a bookmark here already');
  S.project.bookmarks = [...(S.project.bookmarks || []), t].sort((a, b) => a - b);
  saveSoon(); timeline.draw();
  toast(`Bookmark at ${fmtTime(t).slice(0, 9)}`, 'ok', { ms: 1500 });
}
function removeBookmark() {
  if (!S.map) return;
  const reach = Math.max(30, (10 * (timeline.view.end - timeline.view.start)) / (timeline.w || 1000));
  const near = allBookmarks().filter((b) => Math.abs(b.t - S.time) <= reach).sort((a, b) => Math.abs(a.t - S.time) - Math.abs(b.t - S.time))[0];
  if (!near) return toast('No bookmark at the playhead');
  if (!near.own) return toast('That bookmark comes from the map: remove it in the osu! editor');
  if (locked()) return toast('This project cannot be changed here right now', 'bad');
  S.project.bookmarks = S.project.bookmarks.filter((t) => t !== near.t);
  saveSoon(); timeline.draw();
  toast('Bookmark removed', 'info', { ms: 1500 });
}
function jumpBookmark(dir) {
  const t = Math.round(S.time), list = allBookmarks().map((b) => b.t);
  const to = dir > 0 ? list.find((x) => x > t + 1) : list.findLast((x) => x < t - 1);
  if (to != null) seek(to);
}

const FLIP_SWAP = {
  h: [['left', 'right'], ['lr', 'rl'], ['cw', 'ccw'], ['note', 'mirror']],
  v: [['up', 'down'], ['top', 'bottom'], ['tb', 'bt'], ['above', 'below'], ['BottomCentre', 'TopCentre'], ['cw', 'ccw']],
};
const FLIP_OFFSET = { h: ['moveX', 'glide'], v: ['moveY', 'driftY'] };
const FLIP_TURN = ['angle', 'slant', 'spin', 'rotation', 'rotate', 'tilt', 'speed', 'curveAt'];
const FLIP_DIR = { 'blownAway.wind': 'right', 'colorSplit.angle': 'right', 'streaks.coneDir': 'up' };
// Ctrl+H / Ctrl+J: mirror an effect.
function flipParams(eff, p, axis) {
  let n = 0;
  const h = axis === 'h';
  for (const d of eff.params) {
    const v = p[d.key];
    let nv = v;
    if (d.type === 'number' && typeof v === 'number') {
      const dir = FLIP_DIR[`${eff.id}.${d.key}`];
      if (FLIP_OFFSET[axis].includes(d.key)) nv = -v;
      else if (h && (d.key === 'x' || /X$/.test(d.key)) && d.min < 0 && d.max > 600) nv = 640 - v;
      else if (!h && (d.key === 'y' || /Y$/.test(d.key)) && d.max >= 400 && d.max <= 600) nv = 480 - v;
      else if (dir) {
        nv = (dir === 'right') === h ? 180 - v : -v;
        while (nv < d.min) nv += 360;
        while (nv > d.max) nv -= 360;
      } else if (FLIP_TURN.includes(d.key) && d.min < 0 && d.min === -d.max) nv = -v;
      nv = clamp(nv, d.min, d.max);
    } else if (d.type === 'select' && Array.isArray(d.options)) {
      const has = (x) => d.options.some((o) => (Array.isArray(o) ? o[0] : o) === x);
      for (const [a, b] of FLIP_SWAP[axis]) {
        if (!has(a) || !has(b)) continue;
        if (v === a) nv = b; else if (v === b) nv = a;
      }
    }
    if (nv !== v) { p[d.key] = nv; n++; }
  }
  return n;
}
function flipEffects(axis, list = copyTargets()) {
  if (!list.length) return toast('Open or select an effect first');
  if (locked()) return toast('This project cannot be changed here right now', 'bad');
  let n = 0;
  for (const inst of list) {
    const eff = EFFECT_MAP[inst.effect];
    if (!eff) continue;
    const k = flipParams(eff, inst.params, axis);
    if (k) { n++; scheduleGen(inst, 0); }
  }
  if (!n) return toast(list.length > 1 ? 'Nothing in these effects has a side to mirror' : 'Nothing in this effect has a side to mirror');
  commit(); renderCFx();
  toast(`Mirrored ${axis === 'h' ? 'left ↔ right' : 'top ↔ bottom'}`, 'ok', { ms: 1500 });
}
function selAtPlayhead(which) {
  const t = Math.round(S.time);
  const s = S.selection;
  if (which === 'start') setSelection({ start: t, end: s && s.end > t ? s.end : t, objectTimes: null, source: 'manual' });
  else setSelection({ start: s && s.start < t ? s.start : t, end: t, objectTimes: null, source: 'manual' });
}

async function boot() {
  bind();
  try {
    S.server = await api.get('/api/state');
    Object.assign(S.prefs, S.server.prefs || {});
    setUserPresets(S.prefs.myPresets);
  } catch (e) {
    toast('Server not reachable - is server.py running?', 'bad', { ms: 15000 });
  }
  for (const [id, key] of [['optNotes', 'notes'], ['optBg', 'bg'], ['optSafe', 'safe'], ['optLoop', 'loop'], ['optFollow', 'follow'], ['optAccum', 'accum'], ['optExisting', 'existing']]) $(id).checked = !!S.prefs[key];
  $('snapSel').value = S.prefs.snap; $('volume').value = S.prefs.volume; $('speed').value = S.prefs.speed;
  preview.setOpts({ notes: !!S.prefs.notes, bg: !!S.prefs.bg, safe: !!S.prefs.safe });
  audio.volume = +S.prefs.volume;
  $('pillClipboard').classList.toggle('on', S.server.clipboard !== false);
  setupList(); setupSplits(); setupStagePicking(); updateWriteButton();
  try { setCreations((await api.get('/api/creations')).creations); } catch (e) { }
  initCreateTab({ api, toast, castOnMap, recast, useMine, pictureUses, onLeave: () => { for (const i of S.project.instances) if (i.effect === 'actor') refreshLabel(i); if (S.map) { genAll(); renderAll(); } }, pause: () => { if (S.playing) $('btnPlay').click(); } });
  renderAll();
  loadFonts();
  document.fonts?.addEventListener('loadingdone', debounce(() => {
    for (const inst of S.project.instances) {
      if (!('font' in inst.params)) continue;
      const g = S.gen.get(inst.id);
      if (g) g.key = null;
      scheduleGen(inst, 0);
    }
  }, 150));
  const qs = new URLSearchParams(location.search);
  if (!qs.has('nosse')) connectEvents();
  requestAnimationFrame(loop);
  const folder = qs.get('folder') || S.server.lastFolder;
  if (folder) {
    await openMap(folder, qs.get('diff'));
    await runScenario(qs);
  } else if (!S.server.songsDir) openSettings(app);
  else openMapPicker(app);
  Object.assign(window.sbk, { ready: true, renderer, seek, addInstance, commit, genAll, rebuildScene, exportStoryboard, defaultParams, assets: A });
}

async function runScenario(qs) {
  const add = qs.get('add');
  if (!add || !S.map) return;
  if (qs.has('fresh')) { S.project.instances = []; S.gen.clear(); }
  if (qs.get('notes') === '0') { S.prefs.notes = false; preview.setOpts({ notes: false }); $('optNotes').checked = false; }
  for (const part of add.split(',')) {
    const m = part.match(/^(\w+)(?::([^@]+))?(?:@(\d+)-(\d+))?$/);
    if (!m) continue;
    if (m[3]) S.selection = { start: +m[3], end: +m[4], objectTimes: null, source: 'manual' };
    addInstance(m[1], m[2] ? decodeURIComponent(m[2]) : undefined);
  }
  await genAll();
  if (qs.has('debug')) api.post('/api/log', { msg: `scenario ready after ${Math.round(performance.now())}ms` });
  if (qs.get('select') === '0') selectInstance(null);
  if (qs.get('seek')) seek(+qs.get('seek'));
  renderAll();
}

boot();
