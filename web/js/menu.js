import { el } from './util.js';

let pop = null;
export function closeMenu() { pop?.remove(); pop = null; }
export function openMenu(x, y, items) {
  closeMenu();
  const list = items.filter(Boolean);
  const clean = list.filter((it, i) => it !== '-' || (i > 0 && i < list.length - 1 && list[i - 1] !== '-'));
  if (!clean.some((it) => Array.isArray(it))) return;
  pop = el('div', { class: 'ctx-menu' });
  for (const it of clean) {
    if (it === '-') { pop.append(el('div', { class: 'ctx-sep' })); continue; }
    if (typeof it === 'string') { pop.append(el('div', { class: 'ctx-head' }, it.replace(/^#/, ''))); continue; }
    const [label, key, run, state] = it;
    pop.append(el('button', { class: 'ctx-item' + (state === 'danger' ? ' danger' : ''), disabled: state === 'off', onclick: () => { closeMenu(); run(); } },
      el('span', { class: 'grow' }, label), el('span', { class: 'key' }, key || '')));
  }
  document.body.append(pop);
  const r = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  pop.style.top = `${Math.max(4, y + r.height > innerHeight - 4 ? y - r.height : y)}px`;
}
addEventListener('pointerdown', (e) => { if (pop && !e.target.closest?.('.ctx-menu')) closeMenu(); }, true);
addEventListener('keydown', (e) => { if (pop && e.key === 'Escape') { e.stopPropagation(); closeMenu(); } }, true);
addEventListener('blur', closeMenu);
addEventListener('wheel', closeMenu, { passive: true, capture: true });
addEventListener('resize', closeMenu);
