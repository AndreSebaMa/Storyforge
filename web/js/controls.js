import { el } from './util.js';
import { EASINGS } from './easing.js';

export const SYSTEM_FONTS = ['Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Impact', 'Consolas', 'Courier New', 'Comic Sans MS', 'Yu Gothic', 'Meiryo', 'MS Gothic', 'Malgun Gothic', 'Microsoft YaHei'];
export const WEB_FONTS = ['Montserrat', 'Poppins', 'Raleway', 'Quicksand', 'Exo 2', 'Oswald', 'Bebas Neue', 'Orbitron', 'Righteous', 'Playfair Display', 'Cinzel', 'Pacifico', 'Dancing Script', 'Kaushan Script', 'Noto Sans JP', 'Zen Maru Gothic', 'M PLUS Rounded 1c'];

const POPULAR_EASINGS = [0, 4, 3, 5, 7, 6, 8, 10, 13, 16, 15, 17, 19, 18, 20, 22, 30, 29, 31, 25, 26, 33];

export function control(def, opts) {
  const row = el('div', { class: 'row' });
  const label = el('label', {}, def.label);
  const ctl = el('div', { class: 'ctl' });
  row.append(label, ctl);
  const v = opts.value;
  const commit = (x) => { opts.onInput?.(x); opts.onChange?.(x); };

  switch (def.type) {
    case 'number': {
      const range = el('input', { type: 'range', min: def.min, max: def.max, step: def.step ?? 1, value: v });
      const num = el('input', { type: 'number', min: def.min, max: def.max, step: def.step ?? 1, value: round(v, def.step) });
      range.addEventListener('input', () => { num.value = round(+range.value, def.step); opts.onInput?.(+range.value); });
      range.addEventListener('change', () => opts.onChange?.(+range.value));
      num.addEventListener('change', () => {
        let x = parseFloat(num.value);
        if (!isFinite(x)) x = def.default;
        range.value = x; commit(x);
      });
      ctl.append(range, num);
      break;
    }
    case 'color': {
      const inp = el('input', { type: 'color', value: v });
      const hex = el('input', { type: 'text', value: v, style: { width: '82px' } });
      inp.addEventListener('input', () => { hex.value = inp.value; opts.onInput?.(inp.value); });
      inp.addEventListener('change', () => opts.onChange?.(inp.value));
      hex.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { inp.value = hex.value; commit(hex.value); } else hex.value = inp.value; });
      ctl.append(inp, hex);
      break;
    }
    case 'palette': {
      const list = Array.isArray(v) ? v.slice() : [];
      const wrap = el('div', { class: 'palette' });
      const redraw = () => {
        wrap.innerHTML = '';
        list.forEach((c, i) => {
          const inp = el('input', { type: 'color', value: c });
          inp.addEventListener('input', () => { list[i] = inp.value; opts.onInput?.(list.slice()); });
          inp.addEventListener('change', () => opts.onChange?.(list.slice()));
          inp.addEventListener('contextmenu', (e) => { e.preventDefault(); if (list.length > 1) { list.splice(i, 1); redraw(); commit(list.slice()); } });
          wrap.append(inp);
        });
        wrap.append(el('button', { class: 'mini-btn', onclick: () => { list.push(list[list.length - 1] || '#ffffff'); redraw(); commit(list.slice()); } }, '+'));
      };
      redraw();
      ctl.append(wrap);
      break;
    }
    case 'select': case 'easing': case 'image': case 'font': {
      const sel = el('select');
      if (def.type === 'easing') {
        const g1 = el('optgroup', { label: 'Popular' }), g2 = el('optgroup', { label: 'All' });
        POPULAR_EASINGS.forEach((i) => g1.append(el('option', { value: i }, EASINGS[i])));
        EASINGS.forEach((n, i) => { if (!POPULAR_EASINGS.includes(i)) g2.append(el('option', { value: i }, n)); });
        sel.append(g1, g2);
      } else if (def.type === 'image') {
        sel.append(el('option', { value: '' }, def.none || 'Map background'));
        const mine = opts.mine || [];
        if (mine.length) { const g = el('optgroup', { label: 'Your pictures (Create tab)' }); mine.forEach(([val, lab]) => g.append(el('option', { value: val }, lab))); sel.append(g); }
        const files = (opts.images || []).filter((im) => def.gif || !/\.(gif|webp)$/i.test(im));
        if (mine.length && files.length) { const g = el('optgroup', { label: 'In the map folder' }); files.forEach((im) => g.append(el('option', { value: im }, im))); sel.append(g); }
        else for (const im of files) sel.append(el('option', { value: im }, im));
        if (v && typeof v === 'string' && v.startsWith('my:') && !mine.some(([val]) => val === v)) sel.append(el('option', { value: v }, '(a picture of yours that is no longer there)'));
      } else if (def.type === 'font') {
        const custom = opts.fonts || [];
        if (custom.length) { const g = el('optgroup', { label: 'Your fonts' }); custom.forEach((f) => g.append(el('option', { value: f }, f))); sel.append(g); }
        const g1 = el('optgroup', { label: 'Web fonts (need internet)' }); WEB_FONTS.forEach((f) => g1.append(el('option', { value: f, style: { fontFamily: f } }, f)));
        const g2 = el('optgroup', { label: 'System fonts' }); SYSTEM_FONTS.forEach((f) => g2.append(el('option', { value: f, style: { fontFamily: f } }, f)));
        sel.append(g1, g2);
        if (v && ![...custom, ...WEB_FONTS, ...SYSTEM_FONTS].includes(v)) sel.prepend(el('option', { value: v }, v));
      } else {
        const list = typeof def.options === 'function' ? def.options(opts.params || {}) : def.options;
        for (const [val, lab] of list) sel.append(el('option', { value: val }, lab));
        if (typeof def.options === 'function' && v && !list.some(([val]) => val === v)) sel.append(el('option', { value: v }, '(no longer there)'));
      }
      sel.value = String(v);
      if (sel.selectedIndex < 0 && sel.options.length) sel.selectedIndex = 0;
      sel.addEventListener('change', () => commit(def.type === 'easing' ? +sel.value : sel.value));
      ctl.append(sel);
      if (def.type === 'image' && opts.onImportImage) {
        ctl.append(el('button', { class: 'mini-btn', onclick: () => opts.onImportImage((path) => {
          if (!path) return;
          if (![...sel.options].some((o) => o.value === path)) sel.append(el('option', { value: path }, path));
          sel.value = path; commit(path);
        }, !!def.gif) }, 'Import…'));
      }
      if (def.type === 'font') {
        ctl.append(el('button', { class: 'mini-btn', onclick: () => opts.onUploadFont?.((name) => { if (name) { commit(name); } }) }, '+ font'));
      }
      break;
    }
    case 'bool': {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = !!v;
      cb.addEventListener('change', () => commit(cb.checked));
      ctl.append(el('label', { class: 'toggle' }, cb, el('span', {}, cb.checked ? 'On' : 'Off')));
      cb.addEventListener('change', () => { cb.nextSibling.textContent = cb.checked ? 'On' : 'Off'; });
      break;
    }
    case 'text': {
      if (def.multiline) {
        row.style.gridTemplateColumns = '1fr';
        const ta = el('textarea', { rows: 3, spellcheck: 'false', placeholder: def.placeholder || '' });
        ta.value = v ?? '';
        ta.addEventListener('input', () => opts.onInput?.(ta.value));
        ta.addEventListener('change', () => opts.onChange?.(ta.value));
        ctl.append(ta);
      } else {
        const inp = el('input', { type: 'text', value: v ?? '' });
        inp.addEventListener('input', () => opts.onInput?.(inp.value));
        inp.addEventListener('change', () => opts.onChange?.(inp.value));
        ctl.append(inp);
      }
      break;
    }
  }
  return row;
}

function round(v, step) {
  if (step == null || step >= 1) return Math.round(v);
  const d = Math.max(0, -Math.floor(Math.log10(step)));
  return +(+v).toFixed(d);
}
