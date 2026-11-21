import { el, clamp } from './util.js';
import { ease as easeFn } from './easing.js';

const TEXT = new Set(['lyrics', 'titleCard']);
const SBW = 854, SBH = 480, LEFT = -107;

export class StageEdit {
  constructor(stage, app) {
    this.stage = stage; this.app = app; this.sig = ''; this.drag = null;
    const h = (cls) => el('div', { class: 'se-h ' + cls });
    this.guideV = el('div', { class: 'se-guide v hidden' }); this.guideH = el('div', { class: 'se-guide h hidden' });
    this.line = el('div', { class: 'se-line hidden' });
    this.startDot = el('div', { class: 'se-start hidden' });
    this.ghost = el('div', { class: 'se-ghost hidden' }, el('span', {}, 'end'));
    this.box = el('div', { class: 'se-box hidden' },
      h('c nw'), h('c ne'), h('c sw'), h('c se'),
      el('div', { class: 'se-stem' }), h('rot'),
      h('go'));
    this.goEnd = el('div', { class: 'se-h go end hidden' });
    this.ring = el('div', { class: 'se-ring hidden' });
    this.ringH = el('div', { class: 'se-h rad hidden' });
    this.point = el('div', { class: 'se-point hidden' });
    this.root = el('div', { class: 'se-root' }, this.guideV, this.guideH, this.ring, this.line, this.startDot, this.ghost, this.box, this.goEnd, this.ringH, this.point);
    stage.append(this.root);
    const on = (node, kind) => node.addEventListener('pointerdown', (e) => this.down(e, kind, node));
    on(this.box, 'move'); on(this.point, 'move'); on(this.ghost, 'travel'); on(this.goEnd, 'travel'); on(this.ringH, 'radius');
    for (const c of this.box.querySelectorAll('.se-h.c')) on(c, 'size');
    on(this.box.querySelector('.rot'), 'turn'); on(this.box.querySelector('.go'), 'travel');
    for (const n of [this.ghost, this.goEnd]) n.addEventListener('dblclick', (e) => { e.stopPropagation(); const s = this.cur; if (s) this.app.onEdit(s.inst, { moveX: 0, moveY: 0, glide: 0 }, { done: true }); });
    this.box.querySelector('.rot').addEventListener('dblclick', (e) => { e.stopPropagation(); const s = this.cur; if (s) this.app.onEdit(s.inst, { angle: 0 }, { done: true }); });
  }

  shape(inst, t = this.app.time()) {
    if (!inst || inst.enabled === false || t < inst.start - 1 || t > (inst.end ?? inst.start) + 1) return null;
    const eff = this.app.effectOf(inst), p = inst.params;
    if (!eff) return null;
    const has = (k) => { const d = eff.params.find((x) => x.key === k); return !!d && d.type === 'number' && (!d.showIf || d.showIf(p)); };
    if (TEXT.has(inst.effect)) {
      if (p.mode === 'letters' && p.curve && p.curve !== 'none') return { inst, kind: 'circle', xk: 'curveX', yk: 'curveY', x: p.curveX, y: p.curveY, r: p.curveR, under: p.curve === 'under', at: ((p.curveAt || 0) * Math.PI) / 180 };
      const m = this.app.meta(inst);
      if (!m?.box) return null;
      const k = p.size / (m.box.size || p.size), a = ((p.angle || 0) * Math.PI) / 180;
      const stillKind = ['shake', 'glitch'].includes(p.idle);
      const mv = stillKind ? { x: 0, y: 0 } : { x: (p.glide || 0) + (p.moveX || 0), y: p.moveY || 0 };
      const span = m.move ? m.move.b - m.move.a : 0;
      const f = span > 0 ? easeFn(m.move.ease || 0, clamp((t - m.move.a) / span, 0, 1)) : 0;
      const ox = (m.box.cx - m.box.px) * k, c = { x: p.x + ox * Math.cos(a), y: p.y + ox * Math.sin(a) };
      return { inst, kind: 'box', xk: 'x', yk: 'y', x: p.x, y: p.y, c, w: Math.max(12, m.box.w * k), h: Math.max(8, m.box.h * k), a, mv, f, canTravel: !stillKind };
    }
    const point = (xk, yk) => ({ inst, kind: 'point', xk, yk, x: p[xk], y: p[yk], mv: { x: 0, y: 0 }, f: 0, canTravel: false });
    if (has('posX') && has('posY')) return point('posX', 'posY');
    if (has('x') && has('y')) return point('x', 'y');
    return null;
  }

  instAt(clientX, clientY) {
    if (!this.app.active()) return null;
    const r = this.app.cellRect(), sc = r.width / SBW;
    const x = (clientX - r.left) / sc + LEFT, y = (clientY - r.top) / sc;
    let hit = null;
    for (const inst of this.app.textInsts()) {
      const s = this.shape(inst);
      if (s?.kind !== 'box') continue;
      const dx = x - (s.c.x + s.mv.x * s.f), dy = y - (s.c.y + s.mv.y * s.f);
      const lx = dx * Math.cos(-s.a) - dy * Math.sin(-s.a), ly = dx * Math.sin(-s.a) + dy * Math.cos(-s.a);
      if (Math.abs(lx) <= s.w / 2 + 4 && Math.abs(ly) <= s.h / 2 + 4) hit = inst;
    }
    return hit;
  }

  update() {
    const s = this.app.active() ? this.shape(this.app.target()) : null;
    this.cur = s;
    const r = s ? this.app.cellRect() : null, st = s ? this.stage.getBoundingClientRect() : null;
    const sig = s ? JSON.stringify([s.kind, s.x, s.y, s.c, s.w, s.h, s.a, s.mv, s.f, s.r, s.at, s.under, r.left - st.left, r.top - st.top, r.width, this.drag?.kind, this.snapX, this.snapY]) : '';
    if (sig === this.sig) return;
    this.sig = sig;
    const show = (node, on) => node.classList.toggle('hidden', !on);
    show(this.root, !!s);
    if (!s) return;
    const sc = r.width / SBW;
    Object.assign(this.root.style, { left: `${r.left - st.left}px`, top: `${r.top - st.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const X = (x) => (x - LEFT) * sc, Y = (y) => y * sc;
    const place = (node, x, y, w, h, a = 0) => Object.assign(node.style, { left: `${X(x) - (w * sc) / 2}px`, top: `${Y(y) - (h * sc) / 2}px`, width: `${w * sc}px`, height: `${h * sc}px`, transform: a ? `rotate(${a}rad)` : '' });
    const at = (node, x, y) => Object.assign(node.style, { left: `${X(x)}px`, top: `${Y(y)}px` });
    show(this.box, s.kind === 'box'); show(this.point, s.kind === 'point' || s.kind === 'circle');
    show(this.ring, s.kind === 'circle'); show(this.ringH, s.kind === 'circle');
    const travels = (s.kind === 'box' || s.kind === 'point') && !!(s.mv.x || s.mv.y);
    show(this.ghost, travels && s.kind === 'box'); show(this.line, travels); show(this.startDot, travels); show(this.goEnd, travels);
    const from = s.c || { x: s.x, y: s.y };
    if (travels) {
      at(this.startDot, from.x, from.y);
      at(this.goEnd, from.x + s.mv.x, from.y + s.mv.y);
      Object.assign(this.line.style, { left: `${X(from.x)}px`, top: `${Y(from.y)}px`, width: `${Math.hypot(s.mv.x, s.mv.y) * sc}px`, transform: `rotate(${Math.atan2(s.mv.y, s.mv.x)}rad)` });
    }
    show(this.guideV, this.drag && this.snapX != null); show(this.guideH, this.drag && this.snapY != null);
    if (this.snapX != null) this.guideV.style.left = `${X(this.snapX)}px`;
    if (this.snapY != null) this.guideH.style.top = `${Y(this.snapY)}px`;
    if (s.kind === 'box') {
      const pad = 6 / sc;
      place(this.box, s.c.x + s.mv.x * s.f, s.c.y + s.mv.y * s.f, s.w + pad * 2, s.h + pad * 2, s.a);
      this.box.querySelector('.go').classList.toggle('hidden', !s.canTravel || !!travels);
      if (travels) place(this.ghost, s.c.x + s.mv.x, s.c.y + s.mv.y, s.w + pad * 2, s.h + pad * 2, s.a);
    } else if (s.kind === 'point') {
      at(this.point, s.x + s.mv.x * s.f, s.y + s.mv.y * s.f);
    }
    else {
      at(this.point, s.x, s.y);
      place(this.ring, s.x, s.y, s.r * 2, s.r * 2);
      const th = (s.under ? Math.PI : 0) + s.at;
      at(this.ringH, s.x + Math.sin(th) * s.r, s.y - Math.cos(th) * s.r);
    }
  }

  down(e, kind, node) {
    const s = this.cur;
    if (e.button !== 0 || !s) return;
    e.preventDefault(); e.stopPropagation();
    const r = this.app.cellRect(), sc = r.width / SBW, p = s.inst.params;
    const toSb = (ev) => ({ x: (ev.clientX - r.left) / sc + LEFT, y: (ev.clientY - r.top) / sc });
    const p0 = toSb(e), v0 = { ...p }, pivot = { x: s.x + (s.mv ? s.mv.x * s.f : 0), y: s.y + (s.mv ? s.mv.y * s.f : 0) };
    const mid = s.c ? { x: s.c.x + s.mv.x * s.f, y: s.c.y + s.mv.y * s.f } : pivot;
    let last = { x: v0[s.xk], y: v0[s.yk] }, moved = false;
    this.drag = { kind };
    node.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const q = toSb(ev);
      let dx = q.x - p0.x, dy = q.y - p0.y;
      if (!moved && Math.hypot(dx, dy) * sc < 3) return;
      moved = true;
      const ch = {};
      this.snapX = this.snapY = null;
      if (kind === 'move') {
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        let nx = Math.round(v0[s.xk] + dx), ny = Math.round(v0[s.yk] + dy);
        if (!ev.ctrlKey) {
          const off = mid.x - v0[s.xk], offY = mid.y - v0[s.yk];
          if (Math.abs(nx + off - 320) <= 5) { nx = Math.round(320 - off); this.snapX = 320; }
          if (Math.abs(ny + offY - 240) <= 5) { ny = Math.round(240 - offY); this.snapY = 240; }
        }
        ch[s.xk] = clamp(nx, -207, 847); ch[s.yk] = clamp(ny, -100, 580);
      } else if (kind === 'size') {
        const k = Math.hypot(q.x - mid.x, q.y - mid.y) / Math.max(4, Math.hypot(p0.x - mid.x, p0.y - mid.y));
        ch.size = clamp(Math.round(v0.size * k), 6, 140);
      } else if (kind === 'turn') {
        let deg = (Math.atan2(q.y - pivot.y, q.x - pivot.x) * 180) / Math.PI + 90;
        deg = ((deg + 540) % 360) - 180;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        else { const near = Math.round(deg / 45) * 45; if (Math.abs(deg - near) <= 3) deg = near; }
        ch.angle = Math.round(deg) === -180 ? 180 : Math.round(deg);
      } else if (kind === 'travel') {
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        const from = node === this.ghost || node === this.goEnd ? { x: (v0.glide || 0) + (v0.moveX || 0), y: v0.moveY || 0 } : { x: 0, y: 0 };
        let mx = Math.round(from.x + dx), my = Math.round(from.y + dy);
        if (Math.abs(mx) <= 3) mx = 0;
        if (Math.abs(my) <= 3) my = 0;
        ch.glide = 0; ch.moveX = clamp(mx, -900, 900); ch.moveY = clamp(my, -600, 600);
      } else if (kind === 'radius') {
        ch.curveR = clamp(Math.round(Math.hypot(q.x - s.x, q.y - s.y)), 20, 600);
      }
      const d = kind === 'move' ? { dx: ch[s.xk] - last.x, dy: ch[s.yk] - last.y } : { dx: 0, dy: 0 };
      if (kind === 'move') last = { x: ch[s.xk], y: ch[s.yk] };
      this.app.onEdit(s.inst, ch, { done: false, alt: ev.altKey && kind === 'move', ...d });
    };
    const up = (ev) => {
      node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up);
      this.drag = null; this.snapX = this.snapY = null; this.sig = '';
      if (moved) this.app.onEdit(s.inst, {}, { done: true, alt: ev.altKey && kind === 'move', dx: 0, dy: 0 });
    };
    node.addEventListener('pointermove', move); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', up);
  }
}
