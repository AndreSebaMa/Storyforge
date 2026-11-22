import { el, debounce } from './util.js';
import { creations, getCreation, putCreation, dropCreation, sourceFrames, sourceOptions, isVideo, MAX_FRAMES, mineValue } from './creations.js';

const $ = (id) => document.getElementById(id);
const newId = () => Array.from({ length: 10 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
let app = null, root = null, cur = null, sel = [], lastClick = null, changed = false;
const previews = new Set();

const current = () => getCreation(cur);
const saveSoon = debounce((c) => app.api.post('/api/creation', { creation: c }).catch((e) => app.toast('Not saved: ' + e.message, 'bad')), 300);
function save(c) { putCreation(c); changed = true; saveSoon(c); }

export function initCreateTab(opts) {
  app = opts;
  root = el('div', { id: 'createView', class: 'hidden' });
  document.body.append(root);
  $('tabStory').onclick = () => show(false);
  $('tabCreate').onclick = () => show(true);
  requestAnimationFrame(tick);
  if (new URLSearchParams(location.search).has('create')) show(true);
  window.sbkCreate = { show, render, state: () => ({ cur, sel, n: creations().length }) };
}

function show(on) {
  if (on === document.body.classList.contains('creating')) return;
  document.body.classList.toggle('creating', on);
  root.classList.toggle('hidden', !on);
  $('tabCreate').classList.toggle('on', on); $('tabStory').classList.toggle('on', !on);
  if (on) { app.pause?.(); if (!current()) cur = creations()[0]?.id || null; render(); }
  else if (changed) { changed = false; app.onLeave?.(); }
}

function thumb(canvas, h) {
  const k = h / canvas.height, c = el('canvas', { width: Math.max(1, Math.round(canvas.width * k)), height: h, class: 'cr-px' });
  const x = c.getContext('2d'); x.imageSmoothingEnabled = k < 1;
  x.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}
function tick(now) {
  requestAnimationFrame(tick);
  if (!root || root.classList.contains('hidden')) return;
  for (const p of previews) {
    if (!p.canvas.isConnected) { previews.delete(p); continue; }
    const total = p.frames.reduce((a, f) => a + f.ms, 0);
    let t = (now - p.t0) % (total + (p.loop ? 0 : 1200)), i = 0;
    while (i < p.frames.length - 1 && t >= p.frames[i].ms) { t -= p.frames[i].ms; i++; }
    if (i === p.shown) continue;
    p.shown = i;
    const x = p.canvas.getContext('2d'), f = p.frames[i].canvas, k = Math.min(p.canvas.width / f.width, p.canvas.height / f.height);
    x.clearRect(0, 0, p.canvas.width, p.canvas.height);
    x.imageSmoothingEnabled = k < 1;
    x.drawImage(f, (p.canvas.width - f.width * k) / 2, (p.canvas.height - f.height * k) / 2, f.width * k, f.height * k);
  }
}

async function poseLook(c, pose) {
  const out = [];
  for (const [src, i] of pose.frames) {
    const f = (await sourceFrames(c, src))?.frames[i];
    if (f) out.push({ canvas: f.canvas, ms: pose.ms > 0 ? pose.ms : f.ms });
  }
  return out;
}

function render() {
  previews.clear();
  const c = current();
  root.replaceChildren(
    el('aside', { class: 'cr-col cr-list' },
      el('div', { class: 'cr-head' }, el('h2', {}, 'Your characters')),
      el('button', { class: 'primary-btn cr-new cr-btn', onclick: newCharacter }, '+ New character'),
      el('div', { class: 'cr-scroll' }, ...creations().map((x) => el('button', { class: 'cr-item' + (x.id === cur ? ' on' : ''), onclick: () => { cur = x.id; sel = []; lastClick = null; render(); } },
        el('span', { class: 'cr-item-name' }, x.name), el('span', { class: 'dim small' }, `${x.poses.length} pose${x.poses.length === 1 ? '' : 's'}`))))),
    c ? middle(c) : el('section', { class: 'cr-col cr-mid cr-empty' },
      el('button', { class: 'primary-btn cr-btn cr-huge', onclick: newCharacter }, '+ New character')),
    c ? right(c) : el('aside', { class: 'cr-col cr-poses' }),
  );
}

function newCharacter() {
  const c = { id: newId(), kind: 'character', name: 'New character', sources: [], poses: [] };
  save(c); cur = c.id; sel = []; render();
  root.querySelector('.cr-name')?.select();
}

function middle(c) {
  const name = el('input', { class: 'cr-name', value: c.name, onchange: () => { c.name = name.value.trim() || 'Picture'; save(c); render(); } });
  let armed = false;
  const remove = el('button', { class: 'mini-btn danger cr-btn', onclick: async () => {
    if (!armed) { armed = true; remove.textContent = 'Click again to remove'; setTimeout(() => { armed = false; remove.textContent = 'Remove'; }, 3000); return; }
    try { await app.api.post('/api/creation', { remove: true, id: c.id }); dropCreation(c.id); changed = true; cur = creations()[0]?.id || null; sel = []; render(); } catch (e) { app.toast(e.message, 'bad'); }
  } }, 'Remove');
  const rows = el('div', { class: 'cr-scroll cr-sources' });
  if (!c.sources.length) rows.append(el('div', { class: 'cr-hint' }, 'Start by bringing in a picture, an animation (.gif, .webp, .png, .jpg) or a short video (.mp4, .webm). Every frame is laid out here.'));
  for (const src of c.sources) rows.append(sourceRow(c, src));
  const n = sel.length;
  return el('section', { class: 'cr-col cr-mid' },
    el('div', { class: 'cr-head' }, name, el('div', { class: 'spacer' }), c.sources.length ? useControl(c, null) : null, recastControl(c), remove),
    el('div', { class: 'cr-bar' },
      el('button', { class: 'ghost-btn cr-btn', onclick: () => importFiles(c) }, 'Bring in pictures…'),
      el('span', { class: 'dim small' }, n ? `${n} frame${n === 1 ? '' : 's'} picked, in the order of the numbers` : ''),
      el('div', { class: 'spacer' }),
      n ? el('button', { class: 'mini-btn', onclick: () => { sel = []; lastClick = null; render(); } }, 'Clear') : null,
      el('button', { class: 'primary-btn cr-btn', disabled: !n, onclick: () => newPose(c) }, n ? `Make a pose from ${n === 1 ? 'this frame' : `these ${n} frames`}` : 'Make a pose')),
    rows);
}

function recastControl(c) {
  const cast = (app.castOnMap?.() || []).filter((x) => x.id !== c.id);
  if (!cast.length) return null;
  const sel = el('select', { class: 'cr-recast' },
    el('option', { value: '' }, 'Swap in for…'), ...cast.map((x) => el('option', { value: x.id }, `${x.name} (${x.count} block${x.count === 1 ? '' : 's'})`)));
  sel.onchange = () => {
    if (!sel.value) return;
    const r = app.recast(sel.value, c.id);
    app.toast(`${c.name} is now in ${r.blocks} block${r.blocks === 1 ? '' : 's'}` + (r.missing.length ? `. No pose here called: ${r.missing.join(', ')} (those blocks show the first pose)` : ''), r.missing.length ? 'info' : 'ok', { ms: r.missing.length ? 9000 : 3500 });
    changed = true; render();
  };
  return sel;
}

function useControl(c, pose) {
  const uses = app.pictureUses?.() || [];
  if (!uses.length) return null;
  const sel = el('select', { class: 'cr-use' + (pose ? ' small' : '') },
    el('option', { value: '' }, pose ? 'Add this pose as…' : 'Add to the library as…'),
    el('option', { value: 'actor' }, 'A character on the stage'));
  const cats = [...new Set(uses.map((u) => u.category))];
  for (const cat of cats) {
    const g = el('optgroup', { label: cat });
    for (const u of uses) if (u.category === cat && u.id !== 'actor') g.append(el('option', { value: u.id }, u.name));
    if (g.children.length) sel.append(g);
  }
  sel.onchange = () => {
    const id = sel.value; sel.value = '';
    if (!id) return;
    const made = app.useMine(id, mineValue(c.id, pose?.id), pose ? `${c.name} · ${pose.name}` : c.name);
    if (!made) return;
    show(false);
    app.toast(`“${made.preset}” is now under ${made.category} → ${made.effect} on the left. Select where it goes and click it.`, 'ok', { ms: 7000 });
  };
  return sel;
}

function sourceRow(c, src) {
  const strip = el('div', { class: 'cr-strip' }, el('span', { class: 'dim small' }, 'Reading…'));
  const used = c.poses.some((p) => p.frames.some(([s]) => s === src));
  const o = sourceOptions(c, src);
  const setOpt = (patch) => { c.sourceOpts = { ...(c.sourceOpts || {}), [src]: { ...o, ...patch } }; save(c); render(); };
  const cut = el('input', { type: 'checkbox', onchange: () => setOpt({ cut: cut.checked }) }); cut.checked = o.cut;
  const tol = el('input', { type: 'number', min: 1, max: 120, step: 1, value: o.tol, onchange: () => setOpt({ tol: Math.max(1, Math.min(120, Math.round(+tol.value || 28))) }) });
  const row = el('div', { class: 'cr-source' },
    el('div', { class: 'cr-source-head' }, el('b', {}, src), el('span', { class: 'dim small cr-count' }),
      el('div', { class: 'spacer' }),
      el('label', { class: 'toggle small' }, cut, el('span', {}, 'Remove the background')),
      o.cut ? el('label', { class: 'cr-ms small' }, 'strength', tol) : null,
      el('button', { class: 'mini-btn', disabled: used, onclick: () => { c.sources = c.sources.filter((s) => s !== src); sel = sel.filter(([s]) => s !== src); save(c); render(); } }, 'Take out')),
    strip);
  sourceFrames(c, src).then((s) => {
    if (!s) { strip.replaceChildren(el('span', { class: 'danger small' }, isVideo(src) ? 'This video could not be read. An .mp4 (H.264) or .webm works best.' : 'This picture could not be read.')); return; }
    row.querySelector('.cr-count').textContent = `${s.frames.length} frame${s.frames.length === 1 ? '' : 's'} · ${s.w}×${s.h}` + (s.frames.length >= MAX_FRAMES ? ` · only the first ${MAX_FRAMES} frames are used` : '');
    strip.replaceChildren(...s.frames.map((f, i) => {
      const at = sel.map(([a, b], k) => (a === src && b === i ? k + 1 : 0)).filter(Boolean);
      return el('button', { class: 'cr-frame' + (at.length ? ' on' : ''), onclick: (e) => pick(src, i, e.shiftKey, e.ctrlKey || e.metaKey) },
        thumb(f.canvas, 84), el('span', { class: 'cr-num' }, String(i + 1)), at.length ? el('span', { class: 'cr-order' }, at.join(' ')) : null);
    }));
  });
  return row;
}

function pick(src, i, range, again) {
  const has = (a, b) => sel.findLastIndex(([x, y]) => x === a && y === b);
  if (again) sel.push([src, i]);
  else if (range && lastClick && lastClick[0] === src && lastClick[1] !== i) {
    const step = i > lastClick[1] ? 1 : -1;
    for (let k = lastClick[1] + step; k !== i + step; k += step) if (has(src, k) < 0) sel.push([src, k]);
  } else {
    const at = has(src, i);
    if (at >= 0) sel.splice(at, 1); else sel.push([src, i]);
  }
  lastClick = [src, i];
  render();
}

function importFiles(c) {
  const inp = el('input', { type: 'file', accept: '.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.mov,.m4v', multiple: true });
  inp.onchange = async () => {
    for (const f of inp.files) {
      if (f.size > 25 * 1024 * 1024) { app.toast(`${f.name} is too large (25 MB at most). Cut the video down to the part you need first.`, 'bad', { ms: 7000 }); continue; }
      const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(f); });
      try {
        const r = await app.api.post('/api/creation/asset', { id: c.id, name: f.name, data: b64 });
        if (!c.sources.includes(r.name)) c.sources.push(r.name);
      } catch (e) { app.toast(`${f.name}: ${e.message}`, 'bad'); }
    }
    save(c); render();
  };
  inp.click();
}

function newPose(c) {
  const names = ['Idle', 'Pose 2', 'Pose 3', 'Pose 4', 'Pose 5', 'Pose 6', 'Pose 7', 'Pose 8'];
  c.poses.push({ id: newId(), name: names.find((n) => !c.poses.some((p) => p.name === n)) || 'Pose', frames: sel.map((x) => [...x]), play: 'loop', ms: 0 });
  sel = []; lastClick = null; save(c); render();
  const inputs = root.querySelectorAll('.cr-pose-name'); inputs[inputs.length - 1]?.select();
}

function right(c) {
  const list = el('div', { class: 'cr-scroll' });
  for (const pose of c.poses) list.append(poseCard(c, pose));
  return el('aside', { class: 'cr-col cr-poses' }, el('div', { class: 'cr-head' }, el('h2', {}, 'Poses')), list);
}

function poseCard(c, pose) {
  const canvas = el('canvas', { width: 120, height: 120, class: 'cr-px cr-preview' });
  poseLook(c, pose).then((frames) => { if (frames.length) previews.add({ canvas, frames, loop: pose.play !== 'once', t0: performance.now(), shown: -1 }); });
  const name = el('input', { class: 'cr-pose-name', value: pose.name, onchange: () => { pose.name = name.value.trim() || 'Pose'; save(c); render(); } });
  const play = el('select', { onchange: () => { pose.play = play.value; save(c); render(); } },
    el('option', { value: 'loop' }, 'Keeps repeating'), el('option', { value: 'once' }, 'Plays once, then holds the last frame'));
  play.value = pose.play === 'once' ? 'once' : 'loop';
  const ms = el('input', { type: 'number', min: 0, max: 5000, step: 10, value: pose.ms || 0, onchange: () => { pose.ms = Math.max(0, Math.round(+ms.value || 0)); save(c); render(); } });
  const many = pose.frames.length > 1;
  return el('div', { class: 'cr-pose' },
    canvas,
    el('div', { class: 'cr-pose-body' },
      name,
      el('div', { class: 'dim small' }, pose.frames.length === 1 ? `Frame ${pose.frames[0][1] + 1} of ${pose.frames[0][0]}` : `${pose.frames.length} frames: ${pose.frames.map(([, i]) => i + 1).join(', ')}`),
      many ? play : null,
      many ? el('label', { class: 'cr-ms small' }, 'ms per frame', ms, el('span', { class: 'dim' }, pose.ms > 0 ? '' : '0 = as in the file')) : null,
      useControl(c, pose),
      el('div', { class: 'cr-pose-btns' },
        el('button', { class: 'mini-btn', disabled: !sel.length, onclick: () => { pose.frames = sel.map((x) => [...x]); sel = []; lastClick = null; save(c); render(); } }, 'Use picked frames'),
        el('button', { class: 'mini-btn danger', onclick: () => { c.poses = c.poses.filter((p) => p !== pose); save(c); render(); } }, 'Remove'))));
}
