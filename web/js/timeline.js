import { fmtTime } from './util.js';

const RULER = 22, SECT = 20, OBJ = 48, LANE = 24, PAD = 7, DIV = 14;
const OBJ_TOP = RULER + SECT + 2, LANES_TOP = OBJ_TOP + OBJ + PAD;
const FONT = 'Segoe UI, system-ui, sans-serif';
const css = getComputedStyle(document.documentElement);
const cv = (n, d) => css.getPropertyValue(n).trim() || d;
const TH = {
  bg: cv('--tl-bg', '#101017'), ruler: cv('--tl-ruler', '#16161f'), obj: cv('--tl-obj', '#13131b'), grid: cv('--tl-grid', '#242432'),
  text: cv('--tl-text', '#9090a6'), play: cv('--tl-play', '#ff66aa'), tip: cv('--tl-tip', '#2a2a38'), r: +cv('--tl-radius', '5'), icons: cv('--tl-icons', '1') !== '0',
};

export class Timeline {
  constructor(canvas, app) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.app = app;
    this.view = { start: 0, end: 60000 };
    this.drag = null; this.hoverX = null;
    this.bars = []; this.laneOf = new Map(); this.laneScroll = 0; this.laneCount = 0;
    canvas.addEventListener('mousedown', (e) => this.down(e));
    window.addEventListener('mousemove', (e) => this.move(e));
    window.addEventListener('mouseup', (e) => this.up(e));
    canvas.addEventListener('mouseleave', () => { if (this.hoverX != null) { this.hoverX = null; this.draw(); } });
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('dblclick', (e) => { const b = this.barAt(e); if (b) this.app.onFocusInstance?.(b.inst); });
    canvas.addEventListener('auxclick', (e) => e.preventDefault());
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = this.pos(e), bar = this.barAt(e);
      this.app.onMenu?.({ inst: bar?.inst || null, t: Math.max(0, this.x2t(p.x)), zone: this.zone(p.y), x: e.clientX, y: e.clientY });
    });
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  fit() {
    const d = this.app.duration || 60000;
    this.view = { start: -d * 0.01, end: d * 1.01 };
    this.draw();
  }
  t2x(t) { return ((t - this.view.start) / (this.view.end - this.view.start)) * this.w; }
  x2t(x) { return this.view.start + (x / this.w) * (this.view.end - this.view.start); }
  pos(e) { const r = this.c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  zone(y) { return y < RULER ? 'ruler' : y < OBJ_TOP ? 'sect' : y < LANES_TOP - PAD / 2 ? 'notes' : 'lanes'; }
  maxLaneScroll() { return Math.max(0, (this.lanesH || 0) - (this.h - LANES_TOP)); }
  rowY(id) {
    const L = this.laneOf.get(id), b = this.band;
    if (!L || !b) return 0;
    return L.over ? (b.over - 1 - L.lane) * LANE : b.over * LANE + b.div + (b.under - 1 - L.lane) * LANE;
  }
  dropAt(p) {
    const b = this.band, Y = p.y - LANES_TOP + this.laneScroll, cl = (v, n) => Math.max(0, Math.min(n, v));
    if (b.over ? Y < b.over * LANE + b.div / 2 : p.y < LANES_TOP - 2) {
      const k = b.over ? cl(Math.round(b.over - Y / LANE), b.over) : 0;
      return { over: true, k, y: LANES_TOP - this.laneScroll + (b.over - k) * LANE };
    }
    const top = b.over * LANE + b.div;
    const k = cl(Math.round(b.under - (Y - top) / LANE), b.under);
    return { over: false, k, y: LANES_TOP - this.laneScroll + top + (b.under - k) * LANE };
  }

  barAt(e) {
    const { x, y } = this.pos(e);
    if (y < LANES_TOP - 2) return null;
    for (let i = this.bars.length - 1; i >= 0; i--) {
      const b = this.bars[i];
      if (x >= b.x0 - 4 && x <= b.x1 + 4 && y >= b.y && y <= b.y + LANE - 3) {
        const edge = b.canResize && b.x1 - b.x0 > 14 ? (x < b.x0 + 6 ? 'start' : x > b.x1 - 6 ? 'end' : null) : null;
        return { ...b, edge };
      }
    }
    return null;
  }
  magnets(inst) {
    const app = this.app, out = [];
    for (const i of app.instances || []) if (i.id !== inst.id && (i.effect !== 'lyrics' || inst.effect === 'lyrics')) out.push(i.start, i.end);
    for (const s of app.sections || []) out.push(s.start, s.end);
    for (const b of app.bookmarks || []) out.push(b.t);
    if (app.selection) out.push(app.selection.start, app.selection.end);
    out.push(Math.round(app.time));
    return out;
  }
  snapT(t, free) {
    if (!free) { const m = this.magnet(t, (this.app.bookmarks || []).map((b) => b.t), 6); if (m != null) return m; }
    return this.app.snap(t, free);
  }
  magnet(t, list, px = 8) {
    let best = null, bd = (px * (this.view.end - this.view.start)) / this.w;
    for (const m of list) { const dd = Math.abs(m - t); if (dd <= bd) { bd = dd; best = m; } }
    return best;
  }
  noteAt(x) {
    const map = this.app.map;
    if (!map) return null;
    let best = null, bd = 8;
    for (const o of map.objects) {
      const x0 = this.t2x(o.time), x1 = this.t2x(o.endTime);
      if (x1 < x - 8) continue;
      if (x0 > x + 8) break;
      const d = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
      if (d < bd || (d === bd && d === 0)) { bd = d; best = o; }
    }
    return best;
  }
  notesSelection(times) {
    const set = new Set(times);
    const objs = this.app.map.objects.filter((o) => set.has(o.time));
    if (!objs.length) return null;
    return { start: objs[0].time, end: Math.max(...objs.map((o) => o.endTime)), objectTimes: objs.map((o) => o.time) };
  }

  down(e) {
    if (e.button === 1) { e.preventDefault(); this.drag = { kind: 'pan', x0: e.clientX, v0: { ...this.view } }; return; }
    if (e.button !== 0) return;
    e.preventDefault();
    document.activeElement?.blur?.();
    const p = this.pos(e);
    if (this.maxLaneScroll() > 0 && p.x > this.w - 12 && p.y > LANES_TOP) { this.drag = { kind: 'vscroll', y0: p.y, s0: this.laneScroll }; return; }
    const bar = this.barAt(e);
    const part = (e.ctrlKey || e.metaKey) && !e.shiftKey ? this.selAt(p) : null;
    if (part && (part !== 'selMove' || !bar)) {
      const s = this.app.selection;
      this.drag = { kind: part, t0: this.x2t(p.x), s0: s.start, e0: s.end, moved: false };
      return;
    }
    if (bar) {
      const multi = e.ctrlKey || e.metaKey || e.shiftKey;
      const picked = this.app.pickedIds;
      if (!multi && picked?.size > 1 && picked.has(bar.inst.id)) {
        const items = (this.app.instances || []).filter((i) => picked.has(i.id) && !(i.objectTimes && i.objectTimes.length)).map((inst) => ({ inst, s0: inst.start, e0: inst.end }));
        this.drag = { kind: 'group', inst: bar.inst, items, t0: this.x2t(p.x), s0: bar.inst.start, e0: bar.inst.end, moved: false };
        return;
      }
      this.app.onPickInstance(bar.inst.id, e);
      if (!multi) this.drag = { kind: bar.edge || 'move', inst: bar.inst, t0: this.x2t(p.x), x0: p.x, y0: p.y, s0: bar.inst.start, e0: bar.inst.end, moved: false, canMove: bar.canMove };
      return;
    }
    const add = e.ctrlKey || e.metaKey || e.shiftKey;
    this.drag = { kind: 'select', zone: this.zone(p.y), t0: this.x2t(p.x), x0: p.x, moved: false, add, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, base: add ? this.app.selection?.objectTimes || [] : [] };
  }
  selAt(p) {
    const s = this.app.selection;
    if (!s || s.objectTimes || !(s.end > s.start)) return null;
    const x0 = this.t2x(s.start), x1 = this.t2x(s.end);
    if (Math.abs(p.x - x0) <= 6 && (x1 - x0 > 14 || p.x <= x0)) return 'selStart';
    if (Math.abs(p.x - x1) <= 6) return 'selEnd';
    return p.x > x0 && p.x < x1 ? 'selMove' : null;
  }

  move(e) {
    const p = this.pos(e);
    const over = e.target === this.c;
    const d = this.drag;
    if (!d) {
      if (over) { this.hoverX = p.x; this.draw(); }
      if (!over) return;
      const bar = this.barAt(e);
      const z = this.zone(p.y);
      const part = (e.ctrlKey || e.metaKey) && !e.shiftKey ? this.selAt(p) : null;
      if (part && (part !== 'selMove' || !bar)) { this.c.style.cursor = part === 'selMove' ? 'grab' : 'ew-resize'; this.c.title = ''; return; }
      this.c.style.cursor = bar ? (bar.edge ? 'ew-resize' : bar.canMove ? 'grab' : 'pointer') : z === 'sect' ? 'pointer' : z === 'notes' ? 'crosshair' : 'text';
      this.c.title = bar ? (bar.inst.label || '') : '';
      return;
    }
    if (d.kind === 'pan') {
      const dt = ((d.x0 - e.clientX) / this.w) * (d.v0.end - d.v0.start);
      this.view = { start: d.v0.start + dt, end: d.v0.end + dt };
      return this.draw();
    }
    if (d.kind === 'vscroll') {
      const track = this.h - LANES_TOP, total = this.lanesH;
      this.laneScroll = Math.max(0, Math.min(this.maxLaneScroll(), d.s0 + ((p.y - d.y0) / track) * total));
      return this.draw();
    }
    const t = this.x2t(p.x);
    if (d.kind === 'group') {
      const dt = t - d.t0;
      if (Math.abs(dt) * this.w / (this.view.end - this.view.start) > 2) d.moved = true;
      if (!d.moved) return;
      let by = this.snapT(d.s0 + dt, e.altKey) - d.s0;
      const first = Math.min(...d.items.map((x) => x.s0));
      if (first + by < 0) by = -first;
      for (const x of d.items) this.app.onInstanceChange(x.inst, { start: Math.round(x.s0 + by), end: Math.round(x.e0 + by) }, false);
      return this.draw();
    }
    if (d.kind === 'move') {
      if (!d.mode) {
        const ax = Math.abs(p.x - d.x0), ay = Math.abs(p.y - d.y0);
        if (ay > 10 && (ay > ax || !d.canMove)) d.mode = 'stack';
        else if (ax > 4 && d.canMove) d.mode = 'time';
        else return;
      }
      if (d.mode === 'stack') {
        d.moved = true; d.drop = this.dropAt(p);
        this.c.style.cursor = 'ns-resize';
        return this.draw();
      }
    }
    if (d.kind === 'selStart' || d.kind === 'selEnd' || d.kind === 'selMove') {
      const dt = t - d.t0;
      if (Math.abs(dt) * this.w / (this.view.end - this.view.start) > 2) d.moved = true;
      if (!d.moved) return;
      let ns = d.s0, ne = d.e0;
      if (d.kind === 'selMove') { ns = Math.max(0, this.snapT(d.s0 + dt, e.altKey)); ne = ns + (d.e0 - d.s0); }
      if (d.kind === 'selStart') ns = Math.max(0, Math.min(this.snapT(d.s0 + dt, e.altKey), d.e0 - 10));
      if (d.kind === 'selEnd') ne = Math.max(this.snapT(d.e0 + dt, e.altKey), d.s0 + 10);
      this.app.onSelect({ start: Math.round(ns), end: Math.round(ne), objectTimes: null }, false);
      return this.draw();
    }
    if (d.kind === 'select') {
      if (Math.abs(p.x - d.x0) > 3) d.moved = true;
      if (!d.moved) return;
      if (d.zone === 'notes' && this.app.map) {
        const a = Math.min(d.t0, t), b = Math.max(d.t0, t);
        const times = this.app.map.objects.filter((o) => o.endTime >= a && o.time <= b).map((o) => o.time);
        const sel = this.notesSelection([...d.base, ...times]);
        this.app.onSelect(sel || { start: Math.max(0, Math.round(a)), end: Math.max(0, Math.round(b)), objectTimes: null }, false);
      } else {
        const a = this.snapT(Math.min(d.t0, t), e.altKey), b = this.snapT(Math.max(d.t0, t), e.altKey);
        this.app.onSelect({ start: Math.max(0, a), end: Math.max(0, b), objectTimes: null }, false);
      }
    } else {
      const dt = t - d.t0;
      if (Math.abs(dt) * this.w / (this.view.end - this.view.start) > 2) d.moved = true;
      if (!d.moved) return;
      const { s0, e0 } = d;
      let ns = s0, ne = e0;
      d.mags ||= this.magnets(d.inst);
      const pull = (x) => (e.altKey ? null : this.magnet(x, d.mags));
      d.guide = null;
      if (d.kind === 'move' && d.canMove) {
        const len = e0 - s0, a = pull(s0 + dt), b = pull(e0 + dt);
        if (a != null && (b == null || Math.abs(a - (s0 + dt)) <= Math.abs(b - (e0 + dt)))) { ns = a; d.guide = a; }
        else if (b != null) { ns = b - len; d.guide = b; }
        else ns = this.snapT(s0 + dt, e.altKey);
        ne = ns + len;
      }
      if (d.kind === 'start') { const m = pull(s0 + dt); ns = Math.min(m ?? this.snapT(s0 + dt, e.altKey), e0 - 10); if (m === ns) d.guide = m; }
      if (d.kind === 'end') { const m = pull(e0 + dt); ne = Math.max(m ?? this.snapT(e0 + dt, e.altKey), s0 + 10); if (m === ne) d.guide = m; }
      this.app.onInstanceChange(d.inst, { start: Math.round(ns), end: Math.round(ne) }, false);
    }
    this.draw();
  }

  up(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.kind === 'group') {
      if (d.moved) this.app.onGroupDone?.();
      else this.app.onPickInstance(d.inst.id, e);
    } else if (d.mode === 'stack') {
      const drop = d.drop, me = this.laneOf.get(d.inst.id);
      if (drop && me && !(drop.over === me.over && (drop.k === me.lane || drop.k === me.lane + 1))) {
        const below = [], above = [], s = d.inst.start, en = Math.max(d.inst.end, s + 1);
        for (const i of this.app.instances || []) {
          const L = this.laneOf.get(i.id);
          if (i.id === d.inst.id || !L || L.over !== drop.over || !(i.start < en && Math.max(i.end, i.start + 1) > s)) continue;
          (L.lane < drop.k ? below : above).push(i.id);
        }
        this.app.onRestack?.(d.inst, { over: drop.over, below, above });
      }
    } else if (d.kind === 'selStart' || d.kind === 'selEnd' || d.kind === 'selMove') {
      if (d.moved) this.app.onSelect(null, true);
      else this.app.onSeek(this.snapT(Math.max(0, this.x2t(this.pos(e).x)), e.altKey));
    } else if (d.kind === 'select') {
      const p = this.pos(e), t = Math.max(0, this.x2t(p.x));
      if (d.moved) this.app.onSelect(null, true);
      else if (d.zone === 'sect' && this.sectionAt(t)) {
        const s = this.sectionAt(t);
        this.app.onSelect({ start: s.start, end: s.end, objectTimes: null }, true);
      } else if (d.shift && d.zone !== 'sect') {
        const s = this.app.selection, tt = this.snapT(t, e.altKey);
        let a = tt, b = tt;
        if (s && s.end > s.start) [a, b] = Math.abs(tt - s.start) <= Math.abs(tt - s.end) ? [tt, s.end] : [s.start, tt];
        else if (s && s.start != null) [a, b] = [Math.min(s.start, tt), Math.max(s.start, tt)];
        const notes = b > a && (d.zone === 'notes' || s?.objectTimes) && this.app.map
          ? this.notesSelection(this.app.map.objects.filter((o) => o.endTime >= Math.min(a, b) && o.time <= Math.max(a, b)).map((o) => o.time)) : null;
        this.app.onSelect(notes || { start: Math.min(a, b), end: Math.max(a, b), objectTimes: null }, true);
      } else if (d.zone === 'notes' && d.ctrl && this.noteAt(p.x)) {
        const o = this.noteAt(p.x);
        const times = d.base.includes(o.time) ? d.base.filter((x) => x !== o.time) : [...d.base, o.time];
        this.app.onSelect(this.notesSelection(times) || { clear: true }, true);
      } else {
        if (d.zone !== 'ruler' && !d.add && this.app.selection) this.app.onSelect({ clear: true }, true);
        this.app.onSeek(this.snapT(t, e.altKey));
      }
    } else if (d.moved && d.inst) this.app.onInstanceChange(d.inst, { start: d.inst.start, end: d.inst.end }, true);
    this.draw();
  }
  sectionAt(t) { return (this.app.sections || []).find((s) => t >= s.start && t < s.end) || null; }

  wheel(e) {
    e.preventDefault();
    const span = this.view.end - this.view.start;
    const dy = e.deltaY || (e.shiftKey ? e.deltaX : 0);
    if (e.altKey) {
      this.laneScroll = Math.max(0, Math.min(this.maxLaneScroll(), this.laneScroll + Math.sign(e.deltaY) * LANE * 2));
    } else if (e.ctrlKey || e.metaKey || (!e.shiftKey && Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
      const dt = ((e.ctrlKey || e.metaKey ? dy || e.deltaX : e.deltaX) / this.w) * span;
      this.view.start += dt; this.view.end += dt;
    } else {
      const { x } = this.pos(e);
      const t = this.x2t(x);
      const k = Math.exp(dy * 0.0015);
      const ns = Math.max(800, Math.min((this.app.duration || 60000) * 2, span * k));
      this.view.start = t - (x / this.w) * ns;
      this.view.end = this.view.start + ns;
    }
    this.draw();
  }

  ensureVisible(t) {
    const span = this.view.end - this.view.start;
    if (t < this.view.start || t > this.view.end) { this.view.start = t - span * 0.2; this.view.end = this.view.start + span; }
  }
  reveal(inst) {
    if (!inst) return;
    if (inst.end < this.view.start || inst.start > this.view.end) {
      const span = Math.max(this.view.end - this.view.start, (inst.end - inst.start) * 1.6);
      this.view.start = inst.start - span * 0.2; this.view.end = this.view.start + span;
    }
    this.revealId = inst.id;
    this.draw();
  }

  // Rows are the drawing order: of two bars at the same time, the higher one is in front.
  layoutLanes(list) {
    const over = (i) => !!this.app.isOver?.(i);
    const laneOf = new Map(), counts = [0, 0];
    [list.filter((i) => !over(i)), list.filter(over)].forEach((group, band) => {
      const stack = (floor) => {
        const placed = [];
        let n = 0, lyricBase = 0;
        for (const inst of group) {
          const lyr = inst.effect === 'lyrics', s = inst.start, e = Math.max(inst.end, inst.start + 1);
          let lane = lyr ? floor : 0;
          for (const q of placed) if (q.s < e && q.e > s && q.lane >= lane && !(lyr && q.lyr)) lane = q.lane + 1;
          if (lyr) {
            if (lane > lyricBase) lyricBase = lane;
            while (placed.some((q) => q.lyr && q.lane === lane && q.s < e && q.e > s)) lane++;
          }
          placed.push({ id: inst.id, s, e, lane, lyr });
          if (lane + 1 > n) n = lane + 1;
        }
        return { placed, n, lyricBase };
      };
      let res = stack(0);
      if (res.lyricBase > 0) res = stack(res.lyricBase);
      for (const q of res.placed) laneOf.set(q.id, { over: band === 1, lane: q.lane });
      counts[band] = res.n;
    });
    this.laneOf = laneOf; this.laneCount = counts[0] + counts[1];
    this.band = { under: counts[0], over: counts[1], div: counts[1] ? DIV : 0 };
    this.lanesH = this.laneCount * LANE + this.band.div + 4;
  }

  draw() {
    const c = this.c, dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = r.width; this.h = r.height;
    const W = r.width, H = r.height;
    g.fillStyle = TH.bg; g.fillRect(0, 0, W, H);
    g.fillStyle = TH.ruler; g.fillRect(0, 0, W, RULER);
    g.fillStyle = TH.obj; g.fillRect(0, OBJ_TOP, W, OBJ);
    const app = this.app, map = app.map;
    const span = this.view.end - this.view.start;
    const sel = app.selection;
    const selSet = sel?.objectTimes ? new Set(sel.objectTimes) : null;

    const steps = [100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000];
    const step = steps.find((s) => (s / span) * W > 80) || 60000;
    g.font = `11px ${FONT}`; g.textBaseline = 'middle';
    for (let t = Math.ceil(this.view.start / step) * step; t < this.view.end; t += step) {
      if (t < 0) continue;
      const x = Math.round(this.t2x(t)) + 0.5;
      g.fillStyle = TH.grid; g.fillRect(x, 0, 1, H);
      g.fillStyle = TH.text; g.fillText(fmtTime(t).slice(0, step < 1000 ? 9 : 5), x + 5, RULER / 2 + 0.5);
    }

    if (map) {
      if (span < 14000) {
        for (const b of map.beats(Math.max(0, this.view.start), this.view.end, 1)) {
          const x = Math.round(this.t2x(b.time)) + 0.5;
          g.fillStyle = b.downbeat ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
          g.fillRect(x, RULER, 1, H - RULER);
        }
      }
      g.font = `600 11px ${FONT}`;
      for (const s of app.sections || []) {
        const x0 = Math.max(-2, this.t2x(s.start)), x1 = Math.min(W + 2, this.t2x(s.end));
        if (x1 < 0 || x0 > W) continue;
        g.fillStyle = s.kiai ? 'rgba(255,140,60,0.30)' : 'rgba(255,255,255,0.045)';
        roundRect(g, x0 + 1, RULER + 2, Math.max(1, x1 - x0 - 2), SECT - 3, Math.min(4, TH.r)); g.fill();
        if (s.kiai) { g.fillStyle = 'rgba(255,140,60,0.95)'; g.fillRect(x0 + 1, RULER + SECT - 3, Math.max(1, x1 - x0 - 2), 2); }
        if (x1 - x0 > 50) {
          g.save(); g.beginPath(); g.rect(x0, RULER, x1 - x0 - 4, SECT); g.clip();
          g.fillStyle = s.kiai ? '#ffc79a' : '#8a8aa0';
          g.fillText(s.name, x0 + 7, RULER + SECT / 2 + 0.5);
          g.restore();
        }
      }
      if (!(app.sections || []).length) for (const k of map.kiai) { g.fillStyle = 'rgba(255,140,60,0.75)'; g.fillRect(this.t2x(k.start), RULER + 6, this.t2x(k.end) - this.t2x(k.start), 6); }
      for (const b of map.events.breaks) { g.fillStyle = 'rgba(150,150,170,0.55)'; g.fillRect(this.t2x(b.start), OBJ_TOP + OBJ - 3, this.t2x(b.end) - this.t2x(b.start), 3); }

      const cy = OBJ_TOP + OBJ / 2;
      const wf = app.waveform;
      if (wf) {
        g.fillStyle = 'rgba(102,204,255,0.20)';
        const half = OBJ / 2 - 2;
        for (let x = 0; x < W; x++) {
          const a = Math.max(0, Math.floor(this.x2t(x) / wf.step)), b = Math.min(wf.peaks.length, Math.ceil(this.x2t(x + 1) / wf.step));
          let m = 0;
          for (let i = a; i < b; i++) if (wf.peaks[i] > m) m = wf.peaks[i];
          if (m > 0.01) g.fillRect(x, cy - m * half, 1, Math.max(1, m * half * 2));
        }
      }
      const mine = app.highlightTimes;
      const rr = span < 8000 ? 9 : span < 20000 ? 7 : span < 60000 ? 4.5 : 3;
      for (const o of map.objects) {
        if (o.endTime < this.view.start - 500) continue;
        if (o.time > this.view.end + 500) break;
        const x = this.t2x(o.time);
        const col = map.comboColours[o.comboIndex % map.comboColours.length];
        const picked = selSet ? selSet.has(o.time) : sel && sel.end > sel.start && o.time >= sel.start && o.time <= sel.end;
        g.globalAlpha = sel && !picked ? 0.4 : 1;
        if (o.kind !== 'circle') {
          g.fillStyle = o.kind === 'spinner' ? 'rgba(200,200,220,0.35)' : `rgba(${col[0]},${col[1]},${col[2]},0.45)`;
          roundRect(g, x, cy - rr, Math.max(rr, this.t2x(o.endTime) - x + rr), rr * 2, rr); g.fill();
        }
        g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
        g.beginPath(); g.arc(x, cy, rr, 0, 7); g.fill();
        if (rr >= 7) { g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, cy, rr - 0.75, 0, 7); g.stroke(); }
        if (picked && selSet) { g.globalAlpha = 1; g.strokeStyle = '#66ccff'; g.lineWidth = 2; g.beginPath(); g.arc(x, cy, rr + 3, 0, 7); g.stroke(); }
        if (mine?.has(o.time)) { g.globalAlpha = 1; g.strokeStyle = TH.play; g.lineWidth = 1.5; g.beginPath(); g.arc(x, cy, rr + (picked && selSet ? 6 : 3.5), 0, 7); g.stroke(); }
      }
      g.globalAlpha = 1;
    }
    g.fillStyle = TH.grid; g.fillRect(0, OBJ_TOP + OBJ, W, 1); g.fillRect(0, RULER, W, 1);
    for (const b of app.bookmarks || []) {
      const x = Math.round(this.t2x(b.t));
      if (x < -4 || x > W + 4) continue;
      const col = b.own ? '95,224,160' : '77,163,255';
      g.fillStyle = `rgba(${col},0.22)`; g.fillRect(x, LANES_TOP - PAD, 1, H - LANES_TOP + PAD);
      g.fillStyle = `rgba(${col},0.95)`; g.fillRect(x - 0.5, RULER - 8, 2, LANES_TOP - PAD - RULER + 8);
      g.beginPath(); g.moveTo(x - 4.5, RULER - 9); g.lineTo(x + 5.5, RULER - 9); g.lineTo(x + 0.5, RULER - 3); g.fill();
    }

    const list = app.instances || [];
    this.layoutLanes(list);
    this.laneScroll = Math.max(0, Math.min(this.maxLaneScroll(), this.laneScroll));
    if (this.revealId) {
      if (this.laneOf.has(this.revealId)) {
        const top = this.rowY(this.revealId), view = H - LANES_TOP;
        if (top < this.laneScroll) this.laneScroll = top;
        else if (top + LANE > this.laneScroll + view) this.laneScroll = Math.min(this.maxLaneScroll(), top + LANE - view + 4);
      }
      this.revealId = null;
    }
    this.bars = [];
    const picked = app.pickedIds;
    g.save(); g.beginPath(); g.rect(0, LANES_TOP - 2, W, H - LANES_TOP + 2); g.clip();
    if (this.band.div) {
      const dy = LANES_TOP + this.band.over * LANE - this.laneScroll;
      g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, dy, W, DIV - 3);
      g.fillStyle = TH.text; g.font = `10px ${FONT}`;
      g.fillText('\u25B2 in front of the notes      \u25BC behind the notes', 8, dy + (DIV - 3) / 2 + 0.5);
    }
    g.font = `12px ${FONT}`;
    for (const inst of list) {
      const by = LANES_TOP + this.rowY(inst.id) - this.laneScroll;
      const x0 = this.t2x(inst.start), x1 = Math.max(x0 + 5, this.t2x(inst.end));
      const eff = app.effectOf(inst);
      const canMove = !(inst.objectTimes && inst.objectTimes.length);
      if (by > H || by + LANE < LANES_TOP - 2 || x1 < -10 || x0 > W + 10) continue;
      this.bars.push({ inst, x0, x1, y: by, canMove, canResize: canMove && eff?.scope !== 'point' });
      const selected = inst.id === app.selectedId;
      const accent = eff?.accent || '#888';
      const bx = Math.max(-6, x0), bw = Math.min(W + 6, x1) - bx;
      g.globalAlpha = inst.enabled === false ? 0.3 : 1;
      g.fillStyle = selected ? accent : hexA(accent, 0.32);
      roundRect(g, bx, by, bw, LANE - 4, TH.r); g.fill();
      g.fillStyle = selected ? 'rgba(0,0,0,0.25)' : accent; g.fillRect(Math.max(x0, bx), by + 3, 2.5, LANE - 10);
      if (selected) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; roundRect(g, bx + 0.75, by + 0.75, bw - 1.5, LANE - 5.5, TH.r); g.stroke(); }
      else if (picked?.has(inst.id)) { g.globalAlpha = 1; g.strokeStyle = '#66ccff'; g.lineWidth = 2; roundRect(g, bx + 1, by + 1, bw - 2, LANE - 6, TH.r); g.stroke(); }
      if (bw > 22) {
        g.save(); g.beginPath(); g.rect(bx, by, bw - 3, LANE); g.clip();
        g.fillStyle = selected ? '#111' : '#ececf3';
        g.fillText(`${TH.icons ? (eff?.icon || '') + ' ' : ''}${inst.label || eff?.name || inst.effect}`, Math.max(x0, 0) + 8, by + (LANE - 4) / 2 + 0.5);
        g.restore();
      }
      g.globalAlpha = 1;
    }
    g.restore();
    if (!list.length && map) {
      g.fillStyle = '#66667a'; g.font = `12px ${FONT}`;
      g.fillText('Drag over the notes to select them, or drag on the ruler for a time range (or Shift + click its start, then its end). Then click a preset on the left.', 12, LANES_TOP + 14);
    }
    const maxS = this.maxLaneScroll();
    if (maxS > 0) {
      const track = H - LANES_TOP, total = this.lanesH;
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(W - 7, LANES_TOP, 5, track);
      g.fillStyle = 'rgba(255,255,255,0.35)'; roundRect(g, W - 7, LANES_TOP + (this.laneScroll / total) * track, 5, Math.max(16, (track / total) * track), 2.5); g.fill();
    }

    if (sel && sel.end > sel.start) {
      const x0 = this.t2x(sel.start), x1 = this.t2x(sel.end);
      const top = selSet ? OBJ_TOP : RULER, hh = selSet ? OBJ : H - RULER;
      g.fillStyle = 'rgba(102,204,255,0.11)'; g.fillRect(x0, top, x1 - x0, hh);
      g.fillStyle = 'rgba(102,204,255,0.9)'; g.fillRect(x0, top, 1.5, hh); g.fillRect(x1 - 1.5, top, 1.5, hh);
      if (!selSet) { g.fillRect(x0, 0, x1 - x0, 2); g.fillRect(x0 - 2.5, 0, 6, 9); g.fillRect(x1 - 3.5, 0, 6, 9); }
    } else if (sel && sel.start != null && !selSet) {
      g.fillStyle = 'rgba(102,204,255,0.9)'; g.fillRect(this.t2x(sel.start), RULER, 1.5, H - RULER);
    }
    if (this.drag?.mode === 'stack' && this.drag.drop) {
      const dr = this.drag.drop, i = this.drag.inst;
      const x0 = Math.max(0, this.t2x(i.start) - 30), x1 = Math.min(W, Math.max(this.t2x(i.end), this.t2x(i.start) + 5) + 30);
      const ly = Math.max(LANES_TOP - 5, dr.y - 2.5);
      g.fillStyle = '#ffffff'; g.fillRect(x0, ly, x1 - x0, 2);
      g.beginPath(); g.arc(x0, ly + 1, 3.5, 0, 7); g.arc(x1, ly + 1, 3.5, 0, 7); g.fill();
      if (dr.over && !this.band.over) { g.font = `11px ${FONT}`; g.fillText('in front of the notes', x1 + 8, ly + 1); }
    }
    if (this.drag?.guide != null) {
      const gx = Math.round(this.t2x(this.drag.guide)) + 0.5;
      g.fillStyle = '#ffffff'; g.fillRect(gx - 0.5, LANES_TOP - PAD / 2, 1.5, H - LANES_TOP + PAD / 2);
    }
    const px = Math.round(this.t2x(app.time)) + 0.5;
    g.fillStyle = TH.play; g.fillRect(px - 0.5, 0, 2, H);
    g.beginPath(); g.moveTo(px - 6, 0); g.lineTo(px + 7, 0); g.lineTo(px + 0.5, 9); g.fill();
    if (this.hoverX != null && !this.drag) {
      const hx = Math.round(this.hoverX) + 0.5;
      g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(hx, RULER, 1, H - RULER);
      const label = fmtTime(Math.max(0, this.x2t(this.hoverX)));
      g.font = `11px ${FONT}`;
      const tw = g.measureText(label).width + 10;
      const lx = Math.min(W - tw - 2, Math.max(2, hx - tw / 2));
      g.fillStyle = TH.tip; roundRect(g, lx, 2, tw, RULER - 4, 4); g.fill();
      g.fillStyle = '#ececf3'; g.fillText(label, lx + 5, RULER / 2 + 0.5);
    }
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function hexA(hex, a) {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
