import { Renderer } from './renderer.js';
import { el } from './util.js';

const MAX_CELLS = 4;

export class PreviewGrid {
  constructor(root) {
    this.root = root;
    this.box = root.parentElement;
    this.cells = [];
    this.count = 1;
    this.map = null;
    this.opts = {};
    this.selected = new Set();
    this.dirty = true;
    new ResizeObserver(() => this.layout()).observe(this.box);
    this.setCount(1);
  }

  setCount(n) {
    n = Math.max(1, Math.min(MAX_CELLS, n));
    while (this.cells.length < n) this.cells.push(this.makeCell(this.cells.length));
    this.cells.forEach((c, i) => c.el.classList.toggle('hidden', i >= n));
    if (n !== this.count) { this.count = n; this.layout(); }
    this.dirty = true;
  }

  makeCell(i) {
    const gl = el('canvas', { class: 'gl' });
    const ov = el('canvas', { class: 'ov' });
    const label = el('div', { class: 'c-cell-label hidden' });
    const cell = el('div', { class: 'c-cell' }, gl, ov, label);
    this.root.append(cell);
    const renderer = new Renderer(gl, ov);
    renderer.onAsset = () => { this.dirty = true; };
    renderer.setMap(this.map);
    renderer.selectedObjects = this.selected;
    Object.assign(renderer.opts, this.opts);
    return { el: cell, renderer, label };
  }

  setMap(map) {
    this.map = map;
    for (const c of this.cells) c.renderer.setMap(map);
    this.dirty = true;
  }

  setOpts(opts) {
    Object.assign(this.opts, opts);
    for (const c of this.cells) Object.assign(c.renderer.opts, opts);
    this.dirty = true;
  }

  setSelected(set) {
    this.selected = set;
    for (const c of this.cells) c.renderer.selectedObjects = set;
    this.dirty = true;
  }

  setScene(i, sprites, label = '', { active = false, notes = null } = {}) {
    const c = this.cells[i];
    if (!c) return;
    c.renderer.setScene(sprites);
    c.renderer.instObjects = notes;
    c.label.textContent = label;
    c.label.classList.toggle('hidden', !label);
    c.el.classList.toggle('active', active);
    this.dirty = true;
  }

  layout() {
    const cs = getComputedStyle(this.box);
    const W = this.box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const H = this.box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W <= 0 || H <= 0) return;
    const gap = 6, n = this.count;
    const fit = (cols) => {
      const rows = Math.ceil(n / cols);
      let cw = Math.floor((W - gap * (cols - 1)) / cols), ch = Math.floor((cw * 480) / 854);
      if (rows * ch + (rows - 1) * gap > H) { ch = Math.floor((H - (rows - 1) * gap) / rows); cw = Math.floor((ch * 854) / 480); }
      return { cols, cw, ch };
    };
    const one = fit(1), two = fit(2);
    const best = n === 1 || (n === 2 && one.cw > two.cw * 1.2) ? one : two;
    this.root.style.gridTemplateColumns = `repeat(${best.cols}, ${best.cw}px)`;
    this.root.style.gridAutoRows = `${best.ch}px`;
    this.dirty = true;
  }

  render(time) {
    for (let i = 0; i < this.count; i++) this.cells[i].renderer.render(time);
    this.dirty = false;
  }
}
