import { ORIGINS } from './sb.js';
import * as A from './assets.js';
import { PLAYFIELD_OFFSET, sliderPath, sliderPositionAt } from './osu.js';

const W = 854, H = 480, LEFT = -107;
const DRAW_LAYERS = ['Background', 'Pass', 'Foreground', 'Overlay'];
const MAX_QUADS = 4096;

const VS = `attribute vec2 a_pos; attribute vec2 a_uv; attribute vec4 a_col;
varying vec2 v_uv; varying vec4 v_col;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); v_uv = a_uv; v_col = a_col; }`;
const FS = `precision mediump float; uniform sampler2D u_tex; varying vec2 v_uv; varying vec4 v_col;
void main(){ vec4 t = texture2D(u_tex, v_uv); gl_FragColor = vec4(t.rgb * v_col.rgb, t.a) * v_col.a; }`;

export class Renderer {
  constructor(glCanvas, overlay) {
    this.canvas = glCanvas;
    this.overlay = overlay;
    this.octx = overlay.getContext('2d');
    const gl = glCanvas.getContext('webgl', { premultipliedAlpha: true, alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is not available in this browser');
    this.gl = gl;
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    this.data = new Float32Array(MAX_QUADS * 6 * 8);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const stride = 8 * 4;
    const loc = (n) => gl.getAttribLocation(prog, n);
    gl.enableVertexAttribArray(loc('a_pos')); gl.vertexAttribPointer(loc('a_pos'), 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(loc('a_uv')); gl.vertexAttribPointer(loc('a_uv'), 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(loc('a_col')); gl.vertexAttribPointer(loc('a_col'), 4, gl.FLOAT, false, stride, 16);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.enable(gl.BLEND);
    this.textures = new Map();
    this.layers = {};
    this.map = null;
    this.opts = { notes: true, bg: true, safe: false, bgDim: 0.55 };
    this.selectedObjects = new Set();
    this.quads = 0; this.curTex = null; this.curAdd = null;
  }

  setScene(sprites) {
    const layers = {};
    for (const s of sprites) (layers[s.layer] ||= []).push(s);
    this.layers = layers;
    this.usesBg = this.map?.events.background && sprites.some((s) => s.path === this.map.events.background.file);
  }
  setMap(map) { this.map = map; }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    for (const c of [this.canvas, this.overlay]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  texture(path) {
    let t = this.textures.get(path);
    const e = A.get(path);
    if (!e) { A.loadMapImage(path).then((x) => { if (x) this.onAsset?.(); }); return null; }
    if (t && t.source === e.source) return t;
    const gl = this.gl;
    this.flush();
    const tex = t?.tex || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, e.source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    t = { tex, source: e.source, w: e.w, h: e.h };
    this.textures.set(path, t);
    this.curTex = t;
    return t;
  }

  flush() {
    if (!this.quads) return;
    const gl = this.gl;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.quads * 48));
    gl.drawArrays(gl.TRIANGLES, 0, this.quads * 6);
    this.quads = 0;
  }

  quad(t, x, y, ox, oy, sx, sy, rot, r, g, b, a, additive, flipH, flipV) {
    const gl = this.gl;
    if (t !== this.curTex || additive !== this.curAdd) {
      this.flush();
      if (t !== this.curTex) { gl.bindTexture(gl.TEXTURE_2D, t.tex); this.curTex = t; }
      if (additive !== this.curAdd) { gl.blendFunc(gl.ONE, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA); this.curAdd = additive; }
    }
    if (this.quads >= MAX_QUADS) this.flush();
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const w = t.w, h = t.h;
    const px = [-ox * w, (1 - ox) * w], py = [-oy * h, (1 - oy) * h];
    const corners = [[0, 0], [1, 0], [0, 1], [1, 0], [1, 1], [0, 1]];
    let k = this.quads * 48;
    const d = this.data;
    for (const [i, j] of corners) {
      const lx = px[i] * sx, ly = py[j] * sy;
      const wx = x + lx * cos - ly * sin, wy = y + lx * sin + ly * cos;
      d[k++] = ((wx - LEFT) / W) * 2 - 1;
      d[k++] = 1 - (wy / H) * 2;
      d[k++] = flipH ? 1 - i : i;
      d[k++] = flipV ? 1 - j : j;
      d[k++] = r; d[k++] = g; d[k++] = b; d[k++] = a;
    }
    this.quads++;
  }

  render(time) {
    this.resize();
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.curTex = null; this.curAdd = null;
    let drawn = 0;
    this.notesUnder = false;
    const bg = this.map?.events.background;
    if (this.opts.bg && bg && !this.usesBg) {
      const t = this.texture(bg.file);
      if (t) {
        const k = Math.max(W / t.w, H / t.h);
        const v = 1 - this.opts.bgDim;
        this.quad(t, 320, 240, 0.5, 0.5, k, k, 0, v, v, v, 1, false, false, false);
      }
    }
    for (const layer of DRAW_LAYERS) {
      const list = this.layers[layer];
      if (!list) continue;
      if (layer === 'Overlay' && this.opts.notes && this.map && list.some((s) => time >= s.start && time <= s.end)) this.drawNotesUnder(time);
      for (const s of list) {
        if (time < s.start || time > s.end) continue;
        const st = s.stateAt(time);
        if (!st) continue;
        const t = this.texture(s.anim ? s.pathAt(time) : s.path);
        if (!t) continue;
        const o = ORIGINS[s.origin] || ORIGINS.Centre;
        const c = st.color;
        this.quad(t, st.x, st.y, o[0], o[1], st.sx, st.sy, st.rot,
          c ? c[0] / 255 : 1, c ? c[1] / 255 : 1, c ? c[2] / 255 : 1, st.opacity, !!s._additive, !!s._flipH, !!s._flipV);
        drawn++;
      }
    }
    this.flush();
    this.drawOverlay(time);
    return drawn;
  }

  notesAt(time) {
    const map = this.map;
    if (!map || map.mode !== 0 || !this.opts.notes) return [];
    const ox = PLAYFIELD_OFFSET.x, oy = PLAYFIELD_OFFSET.y;
    const at = (x, y) => ({ x: (x + ox - LEFT) / W, y: (y + oy) / H });
    const out = [];
    for (const o of map.objects) {
      if (o.time - map.preempt > time) break;
      if (o.endTime + 220 < time || o.kind === 'spinner') continue;
      const pts = o.kind === 'slider' ? sliderPath(o).points.map((p) => at(p.x, p.y)) : [];
      out.push({ o, ...at(o.x, o.y), pts, r: map.circleRadius / W });
    }
    return out;
  }

  drawNotesUnder(time) {
    const nc = (this.notesCanvas ||= document.createElement('canvas'));
    const cw = this.canvas.width, ch = this.canvas.height;
    if (nc.width !== cw || nc.height !== ch) { nc.width = cw; nc.height = ch; }
    const c = nc.getContext('2d');
    c.clearRect(0, 0, cw, ch);
    this.notesUnder = true;
    if (!this.drawNotes(c, cw, ch, time, true, false)) return;
    const gl = this.gl;
    this.flush();
    const t = (this.notesTex ||= { tex: gl.createTexture(), w: W, h: H });
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, nc);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.curTex = t;
    this.quad(t, LEFT, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, false, false, false);
  }

  drawOverlay(time) {
    const c = this.octx, cw = this.overlay.width, ch = this.overlay.height;
    c.clearRect(0, 0, cw, ch);
    const k = cw / W;
    if (this.opts.safe) {
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.setLineDash([6, 6]); c.lineWidth = 1;
      c.strokeRect(107 * k + 0.5, 0.5, 640 * k, ch - 1); c.setLineDash([]);
    }
    if (!this.opts.notes || !this.map) return;
    this.drawNotes(c, cw, ch, time, !this.notesUnder, true);
  }

  drawNotes(c, cw, ch, time, body, marks) {
    const k = cw / W, ky = ch / H;
    const X = (x) => (x - LEFT) * k, Y = (y) => y * ky;
    const map = this.map;
    const pre = map.preempt, rad = map.circleRadius * k;
    const ox = PLAYFIELD_OFFSET.x, oy = PLAYFIELD_OFFSET.y;
    const vis = [];
    for (const o of map.objects) {
      if (o.time - pre > time) break;
      if (o.endTime + 220 < time) continue;
      vis.push(o);
    }
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (let i = vis.length - 1; i >= 0; i--) {
      const o = vis[i];
      const col = map.comboColours[o.comboIndex % map.comboColours.length];
      const rgb = `${col[0]},${col[1]},${col[2]}`;
      const fadeIn = Math.min(1, (time - (o.time - pre)) / 400);
      const after = time > o.endTime ? 1 - (time - o.endTime) / 220 : 1;
      const alpha = Math.max(0, Math.min(fadeIn, after)) * 0.75;
      const sel = this.selectedObjects.has(o.time);
      if (map.mode !== 0) {
        if (body && Math.abs(time - o.time) < 120) { c.fillStyle = `rgba(${rgb},${0.6 * (1 - Math.abs(time - o.time) / 120)})`; c.beginPath(); c.arc(X(320), Y(440), 10 * k, 0, 7); c.fill(); }
        continue;
      }
      c.globalAlpha = alpha;
      if (o.kind === 'spinner') {
        if (body) { c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 3 * k; c.beginPath(); c.arc(X(256 + ox), Y(192 + oy), 150 * k, 0, 7); c.stroke(); }
        continue;
      }
      if (body && o.kind === 'slider') {
        const path = sliderPath(o);
        c.beginPath();
        path.points.forEach((p, j) => (j ? c.lineTo(X(p.x + ox), Y(p.y + oy)) : c.moveTo(X(p.x + ox), Y(p.y + oy))));
        c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = rad * 2; c.stroke();
        c.strokeStyle = `rgba(${rgb},1)`; c.lineWidth = rad * 2 - 6 * k; c.stroke();
        c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = rad * 1.2; c.stroke();
        if (time >= o.time && time <= o.endTime) {
          const p = sliderPositionAt(o, time);
          c.fillStyle = 'rgba(255,255,255,0.9)'; c.beginPath(); c.arc(X(p.x + ox), Y(p.y + oy), rad * 0.9, 0, 7); c.fill();
        }
      }
      const x = X(o.x + ox), y = Y(o.y + oy);
      if (body && (time <= o.time || o.kind === 'circle')) {
        c.fillStyle = `rgba(${rgb},0.95)`; c.beginPath(); c.arc(x, y, rad, 0, 7); c.fill();
        c.strokeStyle = '#fff'; c.lineWidth = 3 * k; c.stroke();
        c.fillStyle = '#fff'; c.font = `600 ${Math.round(rad * 0.9)}px Segoe UI, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(String(o.comboNumber), x, y + 1);
      }
      if (body && time < o.time) {
        const ap = 1 + 3 * (o.time - time) / pre;
        c.strokeStyle = `rgba(${rgb},1)`; c.lineWidth = 2.5 * k; c.beginPath(); c.arc(x, y, rad * ap, 0, 7); c.stroke();
      }
      if (marks && sel) {
        c.globalAlpha = Math.max(0.5, alpha);
        c.strokeStyle = '#66ccff'; c.lineWidth = 3 * k; c.setLineDash([5 * k, 4 * k]);
        c.beginPath(); c.arc(x, y, rad + 6 * k, 0, 7); c.stroke(); c.setLineDash([]);
      }
      if (marks && this.instObjects?.has(o.time)) {
        c.globalAlpha = Math.max(0.5, alpha);
        c.strokeStyle = '#ff66aa'; c.lineWidth = 2 * k;
        c.beginPath(); c.arc(x, y, rad + (sel ? 10 : 6) * k, 0, 7); c.stroke();
      }
    }
    c.globalAlpha = 1;
    return vis.length;
  }
}
