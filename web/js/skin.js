import { el } from './util.js';

const $ = (id) => document.getElementById(id);
const svg = (d, extra = '') => `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${extra}<path d="${d}"/></svg>`;
const ICONS = {
  btnUndo: svg('M6 3 3 6l3 3M3 6h6.5a3.5 3.5 0 0 1 0 7H7'),
  btnRedo: svg('M10 3l3 3-3 3M13 6H6.5a3.5 3.5 0 0 0 0 7H9'),
  btnBackups: svg('M2.5 8a5.5 5.5 0 1 0 1.7-4M2.5 2.5v2.6h2.6M8 5v3.2l2 1.3'),
  btnFolder: svg('M1.8 4.2c0-.6.4-1 1-1h3l1.3 1.5h6c.6 0 1 .4 1 1v6.1c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z'),
  btnSettings: svg('M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7', '<circle cx="10.5" cy="4.5" r="1.5"/><circle cx="5.5" cy="11.5" r="1.5"/>'),
};
const VOLUME = svg('M2 6.2h2.3L7.5 3.5v9L4.3 9.8H2zM10 6a3 3 0 0 1 0 4M11.8 4.2a5.5 5.5 0 0 1 0 7.6');

function menu(name, items, bar) {
  const head = el('button', { class: 'menu-head' }, name);
  const close = () => { bar.querySelector('.menu-pop')?.remove(); bar.querySelector('.menu-head.on')?.classList.remove('on'); };
  const open = () => {
    close();
    const pop = el('div', { class: 'menu-pop' });
    for (const it of items()) {
      if (it === '-') { pop.append(el('div', { class: 'menu-sep' })); continue; }
      if (!it) continue;
      const [label, key, run, state] = it;
      pop.append(el('button', { class: 'menu-item', disabled: state === 'off', onclick: () => { close(); run(); } },
        el('span', { class: 'ck' }, state === true ? '✓' : ''), el('span', { class: 'grow' }, label), el('span', { class: 'key' }, key || '')));
    }
    pop.style.left = head.getBoundingClientRect().left + 'px';
    bar.append(pop);
    head.classList.add('on');
  };
  head.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (head.classList.contains('on')) close(); else open(); });
  head.addEventListener('pointerenter', () => { if (bar.querySelector('.menu-head.on') && !head.classList.contains('on')) open(); });
  return { head, close };
}

export function initSkin(act) {
  for (const [id, icon] of Object.entries(ICONS)) $(id).innerHTML = icon;
  const vol = document.querySelector('.vol');
  vol.firstChild.remove(); vol.insertAdjacentHTML('afterbegin', VOLUME);

  const click = (id) => () => $(id).click();
  const toggle = (id, label) => ($(id).closest('.hidden') ? null : [label, '', click(id), $(id).checked]);
  const bar = el('nav', { id: 'menubar' });
  const menus = [
    menu('File', () => [
      ['Open beatmap…', '', click('btnMap')],
      ['Open beatmap folder', '', click('btnFolder')],
      '-',
      ['Write storyboard', 'Ctrl+S', act.write],
      ['Restore backup…', '', click('btnBackups')],
      '-',
      ['Settings…', '', click('btnSettings')],
    ], bar),
    menu('View', () => [
      toggle('optNotes', 'Notes'),
      toggle('optBg', 'Map background'),
      toggle('optExisting', 'Existing storyboard'),
      toggle('optSafe', '4:3 area'),
      '-',
      toggle('optLoop', 'Loop selection'),
      toggle('optFollow', 'Follow osu! editor'),
      toggle('optAccum', 'Add osu! copies to selection'),
      '-',
      ['Fit timeline', '', click('btnFit')],
    ], bar),
  ];
  bar.append(...menus.map((m) => m.head));
  document.querySelector('#topbar .brand').replaceWith(bar);
  addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu-pop')) menus[0].close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') menus[0].close(); }, true);
  addEventListener('blur', () => menus[0].close());

  const sb = el('div', { id: 'statusbar' });
  sb.append($('status'), el('div', { class: 'spacer' }), $('projStats'), $('pillClipboard'), $('pillTosu'));
  document.body.insertBefore(sb, $('modalRoot'));
  $('pillClipboard').textContent = 'osu! clipboard';

  const text = (sel, s) => { const n = document.querySelector(sel); if (n) n.textContent = s; };
  text('#library .panel-head h2', 'Library');
  $('libSearch').placeholder = 'Search';
  $('right').querySelector('h2').firstChild.textContent = 'Effects ';
  text('#optLoop + span', 'Loop selection');
  text('#optBg + span', 'BG');
  text('#optExisting + span', 'SB');
  text('#optAccum + span', 'Ctrl+C in osu! adds to selection');
  text('#btnSelKeep', 'Keep');
  text('.stage-empty .primary-btn', 'Open beatmap…');
}
