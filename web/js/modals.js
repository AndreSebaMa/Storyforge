import { el, fmtTime, debounce } from './util.js';

export function modal(title, body, foot = [], { wide = false, onClose } = {}) {
  const root = document.getElementById('modalRoot');
  const close = () => { back.remove(); document.removeEventListener('keydown', esc, true); onClose?.(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const back = el('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(); } },
    el('div', { class: 'modal', style: wide ? { width: 'min(980px, 94vw)' } : {} },
      el('div', { class: 'modal-head' }, el('h3', {}, title), el('button', { class: 'icon-btn', onclick: close }, '✕')),
      el('div', { class: 'modal-body' }, body),
      foot.length ? el('div', { class: 'modal-foot' }, ...foot) : null));
  root.append(back);
  document.addEventListener('keydown', esc, true);
  return { close, el: back };
}
export const modalOpen = () => !!document.querySelector('.modal-back');

function ago(ts) {
  const s = Date.now() / 1000 - ts;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function openMapPicker(app) {
  const list = el('div', { class: 'map-list' });
  const search = el('input', { type: 'search', placeholder: 'Search your Songs folder (artist, title, mapper)…', style: { width: '100%' } });
  const pathIn = el('input', { type: 'text', placeholder: 'C:\\path\\to\\a\\beatmap\\folder' });
  const status = el('div', { class: 'dim small' });
  let m;
  const load = async () => {
    try {
      const r = await app.api.get(`/api/maps?q=${encodeURIComponent(search.value)}&limit=80`);
      const top = list.scrollTop;
      list.innerHTML = '';
      if (r.error) { status.textContent = r.error; return; }
      status.textContent = r.read < r.folders ? `Reading mapper names: ${r.read} of ${r.folders}` : '';
      if (r.read < r.folders) setTimeout(() => { if (list.isConnected) load(); }, 3000);
      const mine = r.recent || [], isMine = new Set(mine.map((it) => it.folder));
      if (mine.length) {
        list.append(el('div', { class: 'map-head' }, 'Your storyboards'));
        for (const it of mine) {
          list.append(el('div', { class: 'map-item mine', onclick: () => { m.close(); app.openMap(it.folder); } },
            el('span', { class: 'grow' }, it.folder), el('span', { class: 'by' }, it.mapper || ''), el('span', { class: 'when' }, `${it.effects} effect${it.effects === 1 ? '' : 's'} · ${ago(it.mtime)}`)));
        }
      }
      list.append(el('div', { class: 'map-head' }, `Songs folder · ${r.total}, last changed first`));
      for (const it of r.maps) {
        if (isMine.has(it.folder)) continue;
        list.append(el('div', { class: 'map-item', onclick: () => { m.close(); app.openMap(it.folder); } },
          el('span', { class: 'grow' }, it.folder), el('span', { class: 'by' }, it.mapper || ''), el('span', { class: 'when' }, ago(it.mtime))));
      }
      if (!r.maps.length) list.append(el('div', { class: 'dim', style: { padding: '10px' } }, 'No matches.'));
      list.scrollTop = top;
    } catch (e) { status.textContent = e.message; }
  };
  search.addEventListener('input', debounce(load, 200));
  const body = el('div', {},
    search, status, list,
    el('div', { class: 'field', style: { marginTop: '14px' } }, el('label', {}, 'Or open any beatmap folder by its full path'),
      el('div', { style: { display: 'flex', gap: '6px' } }, pathIn, el('button', { class: 'ghost-btn', onclick: () => { if (pathIn.value.trim()) { m.close(); app.openMap(pathIn.value.trim()); } } }, 'Open'))));
  m = modal('Choose a beatmap', body, [el('button', { class: 'ghost-btn', onclick: () => { m.close(); openSettings(app); } }, 'Songs folder settings…')]);
  setTimeout(() => search.focus(), 30);
  load();
}

export function openSettings(app) {
  const st = app.S.server;
  const songs = el('input', { type: 'text', value: st.songsDir || st.detectedSongsDir || '', placeholder: 'C:\\Users\\you\\AppData\\Local\\osu!\\Songs' });
  const clip = el('input', { type: 'checkbox' }); clip.checked = st.clipboard !== false;
  const tosu = el('input', { type: 'checkbox' }); tosu.checked = st.tosu !== false;
  const live = el('input', { type: 'checkbox' }); live.checked = !!app.S.prefs.autoWrite;
  const err = el('div', { class: 'warn-text small' });
  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'osu! Songs folder'), songs,
      st.detectedSongsDir ? null : el('div', { class: 'dim small', style: { marginTop: '4px' } }, "Couldn't find osu! automatically.")),
    el('div', { class: 'field' }, el('label', { class: 'toggle' }, live, el('span', {}, 'Write to the map after every change'))),
    el('div', { class: 'field' }, el('label', { class: 'toggle' }, clip, el('span', {}, 'Read Ctrl+C from the osu! editor'))),
    el('div', { class: 'field' }, el('label', { class: 'toggle' }, tosu, el('span', {}, 'Use tosu if it is running'))),
    el('div', { class: 'field' }, el('button', { class: 'ghost-btn', onclick: () => { m.close(); app.openBackups(); } }, '↩ Restore a backup of this map…')),
    err);
  const m = modal('Settings', body, [
    el('button', { class: 'ghost-btn', onclick: () => m.close() }, 'Cancel'),
    el('button', { class: 'primary-btn', onclick: async () => {
      try {
        await app.api.post('/api/settings', { songsDir: songs.value.trim() || null, clipboard: clip.checked, tosu: tosu.checked });
        app.S.prefs.autoWrite = live.checked; app.savePrefs(); app.onPrefs?.();
        app.S.server = await app.api.get('/api/state');
        m.close();
        app.toast('Settings saved', 'ok');
      } catch (e) { err.textContent = e.message; }
    } }, 'Save'),
  ]);
}

export function openLyricTimer(app) {
  const S = app.S;
  const ta = el('textarea', { class: 'lt-lines', spellcheck: 'false', placeholder: 'Optional: paste the lyrics here, one line per row.\n\nLeave this empty to time the lines first: every Space then makes an empty line, and you type the words in afterwards.' });
  ta.value = app.lyricDraft();
  ta.addEventListener('input', () => app.setLyricDraft(ta.value));
  const stage = el('div', { class: 'lt-stage' });
  const styleSel = el('select');
  const lyr = app.effects.lyrics;
  const selInst = app.selectedInstance();
  if (selInst && selInst.effect === 'lyrics') styleSel.append(el('option', { value: '__sel' }, `Same style as "${selInst.label}"`));
  for (const p of lyr.presets) styleSel.append(el('option', { value: p.name }, p.name));
  if (!(selInst && selInst.effect === 'lyrics') && lyr.presets.some((p) => p.name === S.prefs.lyricStyle)) styleSel.value = S.prefs.lyricStyle;
  const btnStart = el('button', { class: 'ghost-btn' }, '● Start tapping');
  const btnCreate = el('button', { class: 'primary-btn', disabled: true }, 'Create lyrics');
  const info = el('div', { class: 'lt-help' });

  let lines = [], idx = -1, tapping = false, blank = false;
  const parse = () => ta.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((text) => ({ text, start: null, end: null }));
  const draw = () => {
    stage.innerHTML = '';
    const shown = lines.length ? lines : parse();
    if (!shown.length) stage.append(el('div', { class: 'lt-line' }, tapping ? 'Press Space when the first line starts' : 'No text: every Space starts a new, empty line'));
    const from = Math.max(0, blank ? shown.length - 7 : idx - 2);
    shown.slice(from, from + 8).forEach((l, k) => {
      const i = from + k;
      stage.append(el('div', { class: 'lt-line' + (i === idx ? ' cur' : i < idx ? ' done' : '') }, l.start != null ? `[${fmtTime(l.start).slice(0, 9)}] ` : '', l.text || `Line ${i + 1}`));
    });
    const timed = lines.filter((l) => l.start != null).length;
    btnCreate.disabled = !timed;
    btnCreate.textContent = timed ? `Create ${timed} ${blank ? 'empty ' : ''}line${timed > 1 ? 's' : ''}` : 'Create lyrics';
  };
  info.append(
    el('div', { style: { marginBottom: '6px' } }, 'Put the playhead a little before the singing starts and press Start tapping: the song plays from there.'),
    el('div', {}, el('span', { class: 'kbd' }, 'Space'), ' a line starts here (and the one before ends)'),
    el('div', {}, el('span', { class: 'kbd' }, 'Enter'), ' the line ends here already (before a gap)'),
    el('div', {}, el('span', { class: 'kbd' }, 'Backspace'), ' take the last tap back and jump back a little'),
    el('div', {}, el('span', { class: 'kbd' }, 'Esc'), ' stop'),
    el('div', { style: { marginTop: '6px' } }, 'Every line can be fine-tuned later by dragging its edges on the timeline. Empty lines get their words in the list on the right.'));

  const key = (e) => {
    if (!tapping) return;
    const t = app.time();
    if (e.code === 'Space') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.repeat) return;
      if (idx >= 0 && lines[idx] && lines[idx].end == null) lines[idx].end = t;
      if (blank) { lines.push({ text: '', start: t, end: null }); idx = lines.length - 1; }
      else if (idx + 1 < lines.length) { idx++; lines[idx].start = t; lines[idx].end = null; }
      else stop();
      draw();
    } else if (e.code === 'Enter') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (idx >= 0 && lines[idx].end == null) lines[idx].end = t;
      draw();
    } else if (e.code === 'Backspace') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (idx >= 0) {
        const back = lines[idx].start;
        if (blank) lines.pop(); else lines[idx].start = lines[idx].end = null;
        idx--;
        if (idx >= 0) lines[idx].end = null;
        app.seek(Math.max(0, back - 2500)); app.play();
      }
      draw();
    } else if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); stop(); }
  };
  const stop = () => {
    if (!tapping) return;
    tapping = false;
    app.pause();
    if (idx >= 0 && lines[idx] && lines[idx].end == null) lines[idx].end = Math.max(lines[idx].start + 500, app.time());
    btnStart.textContent = '● Carry on tapping';
    ta.disabled = false;
    draw();
  };
  btnStart.onclick = () => {
    if (tapping) return stop();
    const text = parse();
    const keep = lines.some((l) => l.start != null) && (blank ? !text.length : lines.some((l) => l.start == null));
    if (!keep) { lines = text; blank = !text.length; }
    idx = keep ? lines.findLastIndex((l) => l.start != null) : -1; tapping = true; ta.disabled = true; ta.blur();
    btnStart.textContent = '■ Stop';
    app.play();
    draw();
  };
  btnCreate.onclick = () => {
    stop();
    const timed = lines.filter((l) => l.start != null).map((l, i, arr) => ({ text: l.text, start: Math.round(l.start), end: Math.round(l.end ?? (arr[i + 1]?.start ?? l.start + 3000)) }));
    const style = styleSel.value === '__sel' ? structuredClone(selInst.params) : null;
    if (styleSel.value !== '__sel') { S.prefs.lyricStyle = styleSel.value; app.savePrefs(); }
    app.addLyricLines(timed, style, styleSel.value === '__sel' ? null : styleSel.value);
    if (!blank && timed.length === lines.length) app.setLyricDraft('');
    m.close();
  };
  ta.addEventListener('input', () => { if (!tapping) { lines = []; idx = -1; btnStart.textContent = '● Start tapping'; draw(); } });
  document.addEventListener('keydown', key, true);
  const body = el('div', { class: 'lt-grid' }, el('div', {}, ta), el('div', {}, stage, el('div', { style: { marginTop: '10px' } }, info)));
  const m = modal('Tap along with the song', body,
    [el('label', { class: 'dim small' }, 'Style ', styleSel), el('div', { class: 'spacer' }), btnStart, btnCreate],
    { wide: true, onClose: () => { stop(); document.removeEventListener('keydown', key, true); } });
  draw();
}
