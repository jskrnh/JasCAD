// Interactive constraint sketcher: drawing tools, auto-relations, selection, dragging, dimensions, trim, fillet, offset.
import type { SketchGeo, SkCurve, SkConstraint, SkConstraintType, V3, EdgeInfo } from '../model/types';
import { ORIGIN_ID } from '../model/types';
import { solve, curvePoints, type SolveResult } from './solver';
import { curveSeg, sampleSeg, pointMap, type P2, type Seg } from './profile';
import { Evaluator } from '../model/expr';
import type { Viewer } from '../viewer/viewer';

export type SkTool = 'select' | 'line' | 'rect' | 'circle' | 'arc' | 'polygon' | 'slot' | 'spline' | 'point' | 'trim' | 'fillet' | 'dim' | 'convert';
interface Plane { origin: V3; xDir: V3; yDir: V3; normal: V3 }
interface Snap { pt: P2; pointId?: string; curveId?: string; h?: boolean; v?: boolean }

const uid = (p: string) => p + Math.random().toString(36).slice(2, 8);
const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const DIM_LABEL: Record<string, string> = { distance: '', hdistance: 'H ', vdistance: 'V ', radius: 'R', diameter: 'Ø', angle: '' };
export const REL_GLYPH: Record<string, string> = { horizontal: 'H', vertical: 'V', parallel: '∥', perpendicular: '⊥', tangent: 'T', equal: '=', concentric: '◎', midpoint: 'M', symmetric: '⇋', collinear: '—', fix: '⚓', coincident: '•', pointOnCurve: '•' };
export const REL_NAME: Record<string, string> = { horizontal: 'Horizontal', vertical: 'Vertical', parallel: 'Parallel', perpendicular: 'Perpendicular', tangent: 'Tangent', equal: 'Equal', concentric: 'Concentric', midpoint: 'Midpoint', symmetric: 'Symmetric', collinear: 'Collinear', fix: 'Fix', coincident: 'Coincident', pointOnCurve: 'On curve', distance: 'Distance', hdistance: 'Horizontal distance', vdistance: 'Vertical distance', radius: 'Radius', diameter: 'Diameter', angle: 'Angle' };

export class SketchEditor {
  tool: SkTool = 'line';
  sel = new Set<string>();
  hover = '';
  clicks: Snap[] = [];
  cursor: Snap | null = null;
  status: SolveResult['status'] = 'ok';
  dof = 0;
  conflicting: string[] = [];
  polygonSides = 6;
  filletRadius = '2';
  showRelations = true;
  private drag: { ids: string[]; start: P2; orig: Map<string, P2>; moved: boolean } | null = null;
  private labels: HTMLElement;
  private dimEdit: HTMLInputElement | null = null;
  onChange: (rerender: boolean) => void = () => {};
  onToast: (m: string) => void = () => {};
  onSelect: () => void = () => {};
  mod: any;

  constructor(public viewer: Viewer, public plane: Plane, public geo: SketchGeo, public vars: () => Record<string, string>, mod: any) {
    this.mod = mod;
    this.labels = document.createElement('div'); this.labels.className = 'sk-labels';
    viewer.el.appendChild(this.labels);
    this.resolve();
  }
  destroy() { this.labels.remove(); this.viewer.setOverlayLayers([]); this.dimEdit?.remove(); }

  /* ------------------------------------------------ geometry helpers */
  P() { return pointMap(this.geo); }
  pt(id: string) { return this.P().get(id)!; }
  curve(id: string) { return this.geo.curves.find((c) => c.id === id); }
  addPoint(p: P2): string { const id = uid('p'); this.geo.points.push({ id, x: p[0], y: p[1] }); return id; }
  pointFor(s: Snap): string {
    if (s.pointId) return s.pointId;
    const id = this.addPoint(s.pt);
    if (s.curveId) this.addRel('pointOnCurve', [id, s.curveId]);
    return id;
  }
  addCurve(c: SkCurve) { this.geo.curves.push(c); return c.id; }
  addRel(type: SkConstraintType, refs: string[], value?: string): SkConstraint | null {
    // avoid exact duplicates
    if (this.geo.constraints.some((k) => k.type === type && k.refs.join() === refs.join() && k.value === undefined && value === undefined)) return null;
    const k: SkConstraint = { id: uid('k'), type, refs, ...(value != null ? { value } : {}) };
    this.geo.constraints.push(k); return k;
  }
  to3(p: P2): V3 { const P = this.plane; return [P.origin[0] + P.xDir[0] * p[0] + P.yDir[0] * p[1], P.origin[1] + P.xDir[1] * p[0] + P.yDir[1] * p[1], P.origin[2] + P.xDir[2] * p[0] + P.yDir[2] * p[1]]; }
  from3(v: V3): P2 { const P = this.plane; const d: V3 = [v[0] - P.origin[0], v[1] - P.origin[1], v[2] - P.origin[2]]; return [d[0] * P.xDir[0] + d[1] * P.xDir[1] + d[2] * P.xDir[2], d[0] * P.yDir[0] + d[1] * P.yDir[1] + d[2] * P.yDir[2]]; }
  tol() { return this.viewer.worldPerPixel() * 8; }

  resolve(drag?: { id: string; x: number; y: number }[]) {
    if (!this.mod) return;
    let g = this.geo;
    if (drag && drag.length) {
      // drag: temporarily pin dragged points, solve, keep result
      const tmp: SketchGeo = JSON.parse(JSON.stringify(g));
      for (const d of drag) { const p = tmp.points.find((q) => q.id === d.id); if (p) { p.x = d.x; p.y = d.y; } }
      const r = solve(this.mod, tmp, this.vars(), drag[0]);
      if (r.status !== 'conflict') { g = r.geo; } this.apply(r, g);
      return;
    }
    const r = solve(this.mod, g, this.vars());
    this.apply(r, r.geo);
  }
  private apply(r: SolveResult, g: SketchGeo) {
    // write solved coordinates back into the live geo (keeps object identity for the caller)
    const m = new Map(g.points.map((p) => [p.id, p]));
    for (const p of this.geo.points) { const q = m.get(p.id); if (q) { p.x = q.x; p.y = q.y; } }
    const cm = new Map(g.curves.map((c) => [c.id, c]));
    for (const c of this.geo.curves) if (c.kind === 'circle') { const q = cm.get(c.id) as any; if (q) c.r = q.r; }
    this.status = r.status; this.dof = r.dof; this.conflicting = r.conflicting;
  }

  /* ------------------------------------------------ hit testing */
  hit(q: P2): { pointId?: string; curveId?: string } {
    const tol = this.tol(); const P = this.P();
    let best: string | undefined, bd = tol;
    for (const [id, p] of P) { const d = dist(p, q); if (d < bd) { bd = d; best = id; } }
    if (best) return { pointId: best };
    let bc: string | undefined; bd = tol;
    for (const c of this.geo.curves) {
      const sg = curveSeg(c, P); if (!sg) continue;
      const pts = sampleSeg(sg, 48);
      for (let i = 0; i < pts.length - 1; i++) { const d = segDist(q, pts[i], pts[i + 1]); if (d < bd) { bd = d; bc = c.id; } }
    }
    return bc ? { curveId: bc } : {};
  }
  snap(q: P2, alt: boolean, from?: P2): Snap {
    const h = this.hit(q);
    if (h.pointId) return { pt: this.pt(h.pointId), pointId: h.pointId };
    let pt: P2 = q;
    if (!alt) { const st = niceStep(this.viewer.worldPerPixel() * 4); pt = [Math.round(q[0] / st) * st, Math.round(q[1] / st) * st]; }
    const s: Snap = { pt };
    if (from && !alt) {
      const dx = pt[0] - from[0], dy = pt[1] - from[1]; const L = Math.hypot(dx, dy);
      if (L > this.tol()) {
        const ang = Math.abs(Math.atan2(dy, dx)) * 180 / Math.PI;
        if (ang < 3 || ang > 177) { s.pt = [pt[0], from[1]]; s.h = true; }
        else if (Math.abs(ang - 90) < 3) { s.pt = [from[0], pt[1]]; s.v = true; }
      }
    }
    if (h.curveId && !s.h && !s.v) { s.curveId = h.curveId; s.pt = nearestOnCurve(this, h.curveId, q); }
    return s;
  }

  /* ------------------------------------------------ pointer handling (plane coords) */
  private pressAt: P2 | null = null;
  down(q: P2, e: PointerEvent): boolean {
    this.pressAt = q;
    const alt = e.altKey;
    const last = this.clicks[this.clicks.length - 1];
    const s = this.snap(q, alt, last?.pt);
    switch (this.tool) {
      case 'select': {
        const h = this.hit(q); const id = h.pointId || h.curveId;
        if (!id) { if (!e.shiftKey && !e.ctrlKey) this.sel.clear(); this.onSelect(); this.render(); return true; }
        if (e.shiftKey || e.ctrlKey) { if (this.sel.has(id)) this.sel.delete(id); else this.sel.add(id); }
        else if (!this.sel.has(id)) this.sel = new Set([id]);
        const ids = h.pointId ? [h.pointId] : curvePoints(this.curve(h.curveId!)!);
        const movable = ids.filter((x) => x !== ORIGIN_ID);
        if (movable.length) this.drag = { ids: movable, start: q, orig: new Map(movable.map((x) => [x, this.pt(x)])), moved: false };
        this.onSelect(); this.render(); return true;
      }
      case 'point': { this.pointFor(s); this.commit(); return true; }
      case 'line': {
        if (!last) { this.clicks = [s]; this.render(); return true; }
        if (dist(s.pt, last.pt) < 1e-9) return true;
        const first = this.clicks[0];
        const a = this.pointFor(last); last.pointId = a; if (this.clicks.length === 1) first.pointId = a;
        const closing = !!s.pointId && s.pointId === first.pointId && this.clicks.length > 1;
        const b = this.pointFor(s);
        const id = this.addCurve({ id: uid('l'), kind: 'line', a, b });
        if (s.h) this.addRel('horizontal', [id]); else if (s.v) this.addRel('vertical', [id]);
        this.clicks = closing ? [] : [first, { pt: this.pt(b), pointId: b }];
        this.commit(); return true;
      }
      case 'rect': case 'circle': case 'slot': case 'polygon': {
        if (!last) { this.clicks = [s]; this.render(); return true; }
        if (this.tool === 'slot') {
          if (this.clicks.length === 1) { this.clicks.push(s); this.render(); return true; }
          const [c1, c2] = this.clicks; this.clicks = []; this.finishSlotWith(c1, c2, s); this.commit(); return true;
        }
        this.finishShape(s); return true;
      }
      case 'arc': {
        if (this.clicks.length < 2) { this.clicks.push(s); this.render(); return true; }
        this.finishArc(s); return true;
      }
      case 'spline': {
        if (last && s.pointId && this.clicks[0].pointId === s.pointId && this.clicks.length >= 3) { this.clicks.push(s); this.finishSpline(); return true; }
        this.clicks.push(s); this.render(); return true;
      }
      case 'trim': { const h = this.hit(q); if (h.curveId) this.trim(h.curveId, q); return true; }
      case 'fillet': {
        const h = this.hit(q); if (h.pointId) this.sketchFillet(h.pointId);
        else this.onToast('Click a corner point where two lines meet');
        return true;
      }
      case 'dim': {
        const h = this.hit(q); const id = h.pointId || h.curveId;
        if (!id) {
          if (this.sel.size) { this.placeDim(q); return true; }
          return true;
        }
        if (this.sel.size === 0) {
          this.sel = new Set([id]);
          const c = h.curveId ? this.curve(h.curveId) : null;
          if (c && (c.kind === 'circle' || c.kind === 'arc')) { this.placeDim(q); return true; }
          this.render(); return true;
        }
        this.sel.add(id); this.placeDim(q); return true;
      }
    }
    return false;
  }
  move(q: P2, e: PointerEvent) {
    if (this.drag && (e.buttons & 1)) {
      const d: P2 = [q[0] - this.drag.start[0], q[1] - this.drag.start[1]];
      if (!this.drag.moved && Math.hypot(...d) < this.tol() / 3) return;
      this.drag.moved = true;
      const targets = this.drag.ids.map((id) => { const o = this.drag!.orig.get(id)!; return { id, x: o[0] + d[0], y: o[1] + d[1] }; });
      // move all dragged points rigidly, then let the solver settle everything else
      for (const t of targets) { const p = this.geo.points.find((x) => x.id === t.id); if (p) { p.x = t.x; p.y = t.y; } }
      this.resolve(targets);
      this.render(); return;
    }
    const last = this.clicks[this.clicks.length - 1];
    this.cursor = this.snap(q, e.altKey, last?.pt);
    const h = this.hit(q); this.hover = h.pointId || h.curveId || '';
    this.render();
  }
  up(q: P2, e: PointerEvent) {
    if (this.drag) { const moved = this.drag.moved; this.drag = null; if (moved) this.commit(); return; }
    // click-drag-release drawing: releasing far from the press acts as the next click
    const p = this.pressAt; this.pressAt = null;
    if (p && ['line', 'rect', 'circle', 'polygon', 'arc', 'slot'].includes(this.tool) && this.clicks.length >= 1 && dist(p, q) > this.tol() * 1.5) this.down(q, e);
  }
  get editingDim() { return !!this.dimEdit; }
  key(e: KeyboardEvent): boolean {
    if (this.dimEdit) return true;
    if (e.key === 'Escape') {
      if (this.clicks.length) { if (this.tool === 'spline' && this.clicks.length >= 2) this.finishSpline(); else { this.clicks = []; this.render(); } return true; }
      if (this.tool !== 'select') { this.tool = 'select'; this.onChange(true); return true; }
      if (this.sel.size) { this.sel.clear(); this.onSelect(); this.render(); return true; }
      return false;
    }
    if (e.key === 'Enter' && this.clicks.length) { if (this.tool === 'spline') this.finishSpline(); else { this.clicks = []; this.render(); } return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel.size) { this.deleteSel(); return true; }
    const map: Record<string, SkTool> = { l: 'line', r: 'rect', c: 'circle', a: 'arc', d: 'dim', t: 'trim', p: 'spline' };
    if (!e.ctrlKey && !e.metaKey && map[e.key]) { this.setTool(map[e.key]); this.onChange(true); return true; }
    return false;
  }
  dblclick() { if (this.tool === 'spline' && this.clicks.length >= 2) this.finishSpline(); else if (this.tool === 'line') { this.clicks = []; this.render(); } }
  setTool(t: SkTool) { this.tool = t; this.clicks = []; this.cursor = null; if (t !== 'select') this.sel.clear(); this.render(); }

  /* ------------------------------------------------ shape builders */
  finishShape(s: Snap) {
    const a = this.clicks[0]; const t = this.tool; this.clicks = [];
    if (t === 'circle') {
      const r = dist(a.pt, s.pt); if (r < 1e-6) return this.render();
      const c = this.pointFor(a);
      const id = this.addCurve({ id: uid('c'), kind: 'circle', c, r });
      if (s.pointId && s.pointId !== c) this.addRel('pointOnCurve', [s.pointId, id]);
      return this.commit();
    }
    if (t === 'rect') {
      const [x0, y0] = a.pt, [x1, y1] = s.pt; if (Math.abs(x1 - x0) < 1e-6 || Math.abs(y1 - y0) < 1e-6) return this.render();
      const p1 = this.pointFor(a), p3 = this.pointFor(s);
      const p2 = this.addPoint([x1, y0]), p4 = this.addPoint([x0, y1]);
      const l1 = this.addCurve({ id: uid('l'), kind: 'line', a: p1, b: p2 }), l2 = this.addCurve({ id: uid('l'), kind: 'line', a: p2, b: p3 });
      const l3 = this.addCurve({ id: uid('l'), kind: 'line', a: p3, b: p4 }), l4 = this.addCurve({ id: uid('l'), kind: 'line', a: p4, b: p1 });
      this.addRel('horizontal', [l1]); this.addRel('vertical', [l2]); this.addRel('horizontal', [l3]); this.addRel('vertical', [l4]);
      return this.commit();
    }
    if (t === 'polygon') {
      const R = dist(a.pt, s.pt); if (R < 1e-6) return this.render();
      const c = this.pointFor(a); const n = Math.max(3, Math.min(64, this.polygonSides));
      const circ = this.addCurve({ id: uid('c'), kind: 'circle', c, r: R, cons: true });
      const a0 = Math.atan2(s.pt[1] - a.pt[1], s.pt[0] - a.pt[0]);
      const ids = Array.from({ length: n }, (_, i) => { const ang = a0 + (i / n) * Math.PI * 2; return this.addPoint([a.pt[0] + R * Math.cos(ang), a.pt[1] + R * Math.sin(ang)]); });
      const lines = ids.map((p, i) => this.addCurve({ id: uid('l'), kind: 'line', a: p, b: ids[(i + 1) % n] }));
      ids.forEach((p) => this.addRel('pointOnCurve', [p, circ]));
      for (let i = 1; i < n; i++) this.addRel('equal', [lines[0], lines[i]]);
      return this.commit();
    }
  }
  /** Slot: click 1 = first centre, click 2 = second centre, click 3 = width. */
  private finishSlotWith(c1: Snap, c2: Snap, w: Snap) {
    const u: P2 = [c2.pt[0] - c1.pt[0], c2.pt[1] - c1.pt[1]]; const L = Math.hypot(...u); if (L < 1e-6) return;
    const ux = u[0] / L, uy = u[1] / L, nx = -uy, ny = ux;
    const r = Math.max(0.1, Math.abs((w.pt[0] - c1.pt[0]) * nx + (w.pt[1] - c1.pt[1]) * ny));
    const a = this.pointFor(c1), b = this.pointFor(c2);
    const A = this.pt(a), B = this.pt(b);
    const p1 = this.addPoint([A[0] + nx * r, A[1] + ny * r]), p2 = this.addPoint([B[0] + nx * r, B[1] + ny * r]);
    const p3 = this.addPoint([B[0] - nx * r, B[1] - ny * r]), p4 = this.addPoint([A[0] - nx * r, A[1] - ny * r]);
    const top = this.addCurve({ id: uid('l'), kind: 'line', a: p1, b: p2 });
    const arcB = this.addCurve({ id: uid('a'), kind: 'arc', c: b, a: p3, b: p2 });
    const bot = this.addCurve({ id: uid('l'), kind: 'line', a: p3, b: p4 });
    const arcA = this.addCurve({ id: uid('a'), kind: 'arc', c: a, a: p1, b: p4 });
    this.addCurve({ id: uid('l'), kind: 'line', a, b, cons: true });
    this.addRel('tangent', [top, arcB]); this.addRel('tangent', [top, arcA]); this.addRel('tangent', [bot, arcB]); this.addRel('tangent', [bot, arcA]);
    this.addRel('equal', [arcA, arcB]);
    if (Math.abs(uy) < 1e-6) this.addRel('horizontal', [top]); else if (Math.abs(ux) < 1e-6) this.addRel('vertical', [top]);
  }
  finishArc(s: Snap) {
    const [a, b] = this.clicks; this.clicks = [];
    const c = circumcenter(a.pt, b.pt, s.pt); if (!c) { this.onToast('The three points are in a line'); return this.render(); }
    // ccw from a→b must pass through s; otherwise swap
    const ang = (p: P2) => Math.atan2(p[1] - c[1], p[0] - c[0]);
    const norm = (x: number) => ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const passes = norm(ang(s.pt) - ang(a.pt)) < norm(ang(b.pt) - ang(a.pt));
    const ia = this.pointFor(a), ib = this.pointFor(b), ic = this.addPoint(c);
    this.addCurve(passes ? { id: uid('a'), kind: 'arc', c: ic, a: ia, b: ib } : { id: uid('a'), kind: 'arc', c: ic, a: ib, b: ia });
    this.commit();
  }
  finishSpline() {
    const pts = this.clicks; this.clicks = [];
    if (pts.length < 2) return this.render();
    const ids = pts.map((p) => this.pointFor(p));
    this.addCurve({ id: uid('s'), kind: 'spline', pts: ids });
    this.commit();
  }

  /* ------------------------------------------------ edits */
  commit() { this.resolve(); this.render(); this.onChange(true); }
  deleteSel() {
    const del = new Set(this.sel); this.sel.clear();
    const usedBefore = new Set(this.geo.curves.flatMap(curvePoints));
    // deleting a point deletes the curves that use it
    for (const c of this.geo.curves) if (curvePoints(c).some((p) => del.has(p))) del.add(c.id);
    this.geo.curves = this.geo.curves.filter((c) => !del.has(c.id));
    const usedAfter = new Set(this.geo.curves.flatMap(curvePoints));
    this.geo.points = this.geo.points.filter((p) => !del.has(p.id) && !(usedBefore.has(p.id) && !usedAfter.has(p.id)));
    const alive = new Set([...this.geo.points.map((p) => p.id), ...this.geo.curves.map((c) => c.id), ORIGIN_ID]);
    this.geo.constraints = this.geo.constraints.filter((k) => !del.has(k.id) && k.refs.every((r) => alive.has(r)));
    this.commit(); this.onSelect();
  }
  toggleConstruction() {
    for (const id of this.sel) { const c = this.curve(id); if (c) c.cons = !c.cons; }
    this.commit();
  }
  /** Relations that make sense for the current selection. */
  applicable(): SkConstraintType[] {
    const items = [...this.sel].map((id) => (this.P().has(id) && !this.curve(id) ? 'point' : this.curve(id)?.kind || '')).filter(Boolean);
    const cnt = (k: string) => items.filter((x) => x === k).length;
    const n = items.length, pts = cnt('point'), lines = cnt('line'), rad = cnt('circle') + cnt('arc');
    const out: SkConstraintType[] = [];
    if (n === 1 && lines === 1) out.push('horizontal', 'vertical');
    if (n === 2 && pts === 2) out.push('coincident', 'horizontal', 'vertical');
    if (n === 2 && pts === 1 && n - pts === 1) { out.push('pointOnCurve'); if (lines === 1) out.push('midpoint'); }
    if (n === 2 && lines === 2) out.push('parallel', 'perpendicular', 'equal', 'collinear');
    if (n === 2 && lines === 1 && rad === 1) out.push('tangent');
    if (n === 2 && rad === 2) out.push('equal', 'concentric', 'tangent');
    if (n === 3 && pts === 2 && lines === 1) out.push('symmetric');
    if (n >= 1) out.push('fix');
    return out;
  }
  applyRel(t: SkConstraintType) {
    const ids = [...this.sel];
    const isPt = (id: string) => this.P().has(id) && !this.curve(id);
    let refs = ids;
    if (t === 'pointOnCurve' || t === 'midpoint') refs = [ids.find(isPt)!, ids.find((x) => !isPt(x))!];
    if (t === 'symmetric') refs = [...ids.filter(isPt), ids.find((x) => !isPt(x))!];
    if (t === 'fix') { for (const id of ids) this.addRel('fix', [id]); }
    else this.addRel(t, refs);
    this.commit();
    if (this.status === 'conflict') {
      this.geo.constraints.pop(); this.commit();
      this.onToast(`${REL_NAME[t]} would over-define the sketch, so it wasn't added`);
    }
  }
  removeConstraint(id: string) { this.geo.constraints = this.geo.constraints.filter((k) => k.id !== id); this.commit(); }

  /** Smart dimension for the current selection, placed near q. */
  placeDim(q: P2) {
    const ids = [...this.sel]; this.sel.clear();
    const isPt = (id: string) => this.P().has(id) && !this.curve(id);
    let k: SkConstraint | null = null; let value = 0;
    const c0 = this.curve(ids[0]);
    if (ids.length === 1 && c0) {
      if (c0.kind === 'line') { value = dist(this.pt(c0.a), this.pt(c0.b)); k = { id: uid('k'), type: 'distance', refs: [c0.id] }; }
      else if (c0.kind === 'circle') { value = c0.r * 2; k = { id: uid('k'), type: 'diameter', refs: [c0.id] }; }
      else if (c0.kind === 'arc') { value = dist(this.pt(c0.c), this.pt(c0.a)); k = { id: uid('k'), type: 'radius', refs: [c0.id] }; }
    } else if (ids.length === 2) {
      const [a, b] = ids;
      if (isPt(a) && isPt(b)) {
        const A = this.pt(a), B = this.pt(b); const dx = Math.abs(B[0] - A[0]), dy = Math.abs(B[1] - A[1]);
        // place like SolidWorks: horizontal / vertical / aligned depending on where the label goes
        const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
        const off = [Math.abs(q[0] - mx), Math.abs(q[1] - my)];
        if (off[1] > off[0] * 2 && dx > 1e-9) { k = { id: uid('k'), type: 'hdistance', refs: [a, b] }; value = dx; }
        else if (off[0] > off[1] * 2 && dy > 1e-9) { k = { id: uid('k'), type: 'vdistance', refs: [a, b] }; value = dy; }
        else { k = { id: uid('k'), type: 'distance', refs: [a, b] }; value = dist(A, B); }
      } else {
        const ca = this.curve(a), cb = this.curve(b);
        if (ca?.kind === 'line' && cb?.kind === 'line') {
          const d1 = dir(this.pt(ca.a), this.pt(ca.b)), d2 = dir(this.pt(cb.a), this.pt(cb.b));
          const cr = d1[0] * d2[1] - d1[1] * d2[0];
          if (Math.abs(cr) < 1e-6) { k = { id: uid('k'), type: 'distance', refs: [a, b] }; value = Math.abs(lineDist(this.pt(cb.a), this.pt(ca.a), this.pt(ca.b))); }
          else { k = { id: uid('k'), type: 'angle', refs: [a, b] }; value = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1]))) * 180 / Math.PI; }
        } else {
          const p = isPt(a) ? a : isPt(b) ? b : null; const l = [ca, cb].find((c) => c?.kind === 'line');
          if (p && l && l.kind === 'line') { k = { id: uid('k'), type: 'distance', refs: [p, l.id] }; value = Math.abs(lineDist(this.pt(p), this.pt(l.a), this.pt(l.b))); }
        }
      }
    }
    if (!k) { this.onToast('Pick a line, circle, arc, two points, a point and a line, or two lines'); this.render(); return; }
    k.value = fmt(value); k.pos = q;
    this.geo.constraints.push(k);
    this.resolve();
    if (this.status === 'conflict' || this.status === 'redundant') {
      // SolidWorks makes it a driven (reference) dimension; we keep geometry valid by removing it
      this.geo.constraints.pop(); this.resolve();
      this.onToast('That dimension would over-define the sketch'); this.render(); return;
    }
    this.render(); this.onChange(true);
    const kid = k.id; setTimeout(() => this.editDim(kid), 0); // after the click's default focus change
  }
  /** Inline editor at the dimension label (accepts expressions like wall*2). */
  editDim(id: string) {
    const k = this.geo.constraints.find((x) => x.id === id); if (!k) return;
    this.dimEdit?.remove();
    const pos = this.labelPos(k); if (!pos) return;
    const [x, y] = this.viewer.project(this.to3(pos)); const r = this.viewer.el.getBoundingClientRect();
    const inp = document.createElement('input'); inp.className = 'sk-dimedit'; inp.value = k.value || '';
    inp.style.left = x - r.left + 'px'; inp.style.top = y - r.top + 'px';
    this.viewer.el.appendChild(inp); inp.focus(); inp.select(); this.dimEdit = inp;
    const done = (ok: boolean) => {
      if (!this.dimEdit) return; this.dimEdit = null; inp.remove();
      if (!ok) return;
      const old = k.value; k.value = inp.value.trim() || old;
      try { new Evaluator(this.vars()).eval(k.value!); } catch (e: any) { k.value = old; this.onToast(e.message); return; }
      this.resolve();
      if (this.status === 'conflict' || this.status === 'failed') { k.value = old; this.resolve(); this.onToast('That value can\'t be solved. Try a value closer to the current one.'); }
      this.render(); this.onChange(true);
    };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
    inp.onblur = () => done(true);
  }

  /** Trim: remove the piece of a curve between its nearest intersections around q. */
  trim(cid: string, q: P2) {
    const c = this.curve(cid)!; const P = this.P();
    const others = this.geo.curves.filter((o) => o.id !== cid && !o.cons).map((o) => curveSeg(o, P)).filter(Boolean) as Seg[];
    const me = curveSeg(c, P)!;
    if (c.kind === 'spline') { this.sel = new Set([cid]); this.deleteSel(); return; }
    if (c.kind === 'line') {
      const A = P.get(c.a)!, B = P.get(c.b)!;
      const ts = intersectParams(me, others).filter((t) => t > 1e-6 && t < 1 - 1e-6).sort((x, y) => x - y);
      const tq = projT(q, A, B);
      const lo = Math.max(0, ...ts.filter((t) => t < tq)), hi = Math.min(1, ...ts.filter((t) => t > tq));
      const at = (t: number): P2 => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
      if (lo <= 0 && hi >= 1) { this.sel = new Set([cid]); this.deleteSel(); return; }
      const keepRel = this.geo.constraints.filter((k) => k.refs.includes(cid) && ['horizontal', 'vertical', 'parallel', 'perpendicular', 'collinear'].includes(k.type));
      this.geo.curves = this.geo.curves.filter((x) => x.id !== cid);
      this.geo.constraints = this.geo.constraints.filter((k) => !k.refs.includes(cid));
      const pieces: [string, string][] = [];
      if (lo > 0) { const m = this.addPoint(at(lo)); pieces.push([c.a, m]); }
      if (hi < 1) { const m = this.addPoint(at(hi)); pieces.push([m, c.b]); }
      for (const [a, b] of pieces) {
        const id = uid('l'); this.addCurve({ id, kind: 'line', a, b });
        for (const k of keepRel) this.addRel(k.type, k.refs.map((r) => (r === cid ? id : r)), k.value);
        // keep the new endpoint glued to the curve that cut it
        const end = a === c.a ? b : a; const ep = this.pt(end);
        const cutter = this.geo.curves.find((o) => o.id !== id && !o.cons && onCurve(this, o, ep));
        if (cutter) this.addRel('pointOnCurve', [end, cutter.id]);
      }
      return this.commit();
    }
    // circle / arc → arc
    const cc = P.get((c as any).c)!; const r = c.kind === 'circle' ? c.r : dist(cc, P.get(c.a)!);
    const angs = intersectPoints(me, others).map((p) => Math.atan2(p[1] - cc[1], p[0] - cc[0]));
    const aq = Math.atan2(q[1] - cc[1], q[0] - cc[0]);
    const norm = (x: number) => ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (c.kind === 'circle') {
      if (angs.length < 2) { this.sel = new Set([cid]); this.deleteSel(); return; }
      const rel = angs.map((a) => norm(a - aq)).sort((x, y) => x - y);
      const next = aq + rel[0], prev = aq + rel[rel.length - 1];   // ccw-nearest and cw-nearest cut points
      const pa = this.addPoint([cc[0] + r * Math.cos(next), cc[1] + r * Math.sin(next)]);
      const pb = this.addPoint([cc[0] + r * Math.cos(prev), cc[1] + r * Math.sin(prev)]);
      const id = uid('a');
      this.geo.curves = this.geo.curves.map((x) => (x.id === cid ? { id, kind: 'arc', c: (c as any).c, a: pa, b: pb } as SkCurve : x));
      this.geo.constraints = this.geo.constraints.map((k) => ({ ...k, refs: k.refs.map((x) => (x === cid ? id : x)) }));
      for (const p of [pa, pb]) { const cut = this.geo.curves.find((o) => o.id !== id && !o.cons && onCurve(this, o, this.pt(p))); if (cut) this.addRel('pointOnCurve', [p, cut.id]); }
      return this.commit();
    }
    // arc: keep the parts outside the clicked span
    const A = P.get(c.a)!, B = P.get(c.b)!; const a0 = Math.atan2(A[1] - cc[1], A[0] - cc[0]);
    const span = norm(Math.atan2(B[1] - cc[1], B[0] - cc[0]) - a0); const tq = norm(aq - a0);
    const ts = angs.map((a) => norm(a - a0)).filter((t) => t > 1e-6 && t < span - 1e-6);
    const lo = Math.max(0, ...ts.filter((t) => t < tq)), hi = Math.min(span, ...ts.filter((t) => t > tq));
    if (lo <= 0 && hi >= span) { this.sel = new Set([cid]); this.deleteSel(); return; }
    this.geo.curves = this.geo.curves.filter((x) => x.id !== cid);
    this.geo.constraints = this.geo.constraints.filter((k) => !k.refs.includes(cid));
    const at = (t: number): P2 => [cc[0] + r * Math.cos(a0 + t), cc[1] + r * Math.sin(a0 + t)];
    if (lo > 0) { const m = this.addPoint(at(lo)); this.addCurve({ id: uid('a'), kind: 'arc', c: (c as any).c, a: c.a, b: m }); }
    if (hi < span) { const m = this.addPoint(at(hi)); this.addCurve({ id: uid('a'), kind: 'arc', c: (c as any).c, a: m, b: c.b }); }
    this.commit();
  }

  /** Sketch fillet at a corner shared by two lines. */
  sketchFillet(pid: string) {
    const lines = this.geo.curves.filter((c) => c.kind === 'line' && !c.cons && (c.a === pid || c.b === pid)) as Extract<SkCurve, { kind: 'line' }>[];
    if (lines.length !== 2) { this.onToast('Fillet needs a corner where exactly two lines meet'); return; }
    let r: number; try { r = new Evaluator(this.vars()).eval(this.filletRadius); } catch { r = 2; }
    const V = this.pt(pid);
    const far = lines.map((l) => this.pt(l.a === pid ? l.b : l.a));
    const u1 = dir(V, far[0]), u2 = dir(V, far[1]);
    const cos = u1[0] * u2[0] + u1[1] * u2[1]; const th = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (th < 1e-3 || Math.PI - th < 1e-3) { this.onToast('The lines are parallel'); return; }
    const d = r / Math.tan(th / 2);
    if (d >= dist(V, far[0]) || d >= dist(V, far[1])) { this.onToast('Radius is too large for these lines'); return; }
    const t1: P2 = [V[0] + u1[0] * d, V[1] + u1[1] * d], t2: P2 = [V[0] + u2[0] * d, V[1] + u2[1] * d];
    const bis = dir([0, 0], [u1[0] + u2[0], u1[1] + u2[1]]); const cd = r / Math.sin(th / 2);
    const C: P2 = [V[0] + bis[0] * cd, V[1] + bis[1] * cd];
    const p1 = this.addPoint(t1), p2 = this.addPoint(t2), pc = this.addPoint(C);
    for (const [l, p] of [[lines[0], p1], [lines[1], p2]] as const) { if (l.a === pid) l.a = p; else l.b = p; }
    // arc must run ccw from one tangent point to the other
    const ang = (p: P2) => Math.atan2(p[1] - C[1], p[0] - C[0]);
    const span = (((ang(t2) - ang(t1)) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const arc = uid('a'); this.addCurve(span < Math.PI ? { id: arc, kind: 'arc', c: pc, a: p1, b: p2 } : { id: arc, kind: 'arc', c: pc, a: p2, b: p1 });
    // constraints that referenced the corner point move to nothing; keep the lines tangent
    this.geo.constraints = this.geo.constraints.filter((k) => !(k.refs.includes(pid) && ['coincident', 'pointOnCurve'].includes(k.type)));
    if (!this.geo.curves.some((c) => curvePoints(c).includes(pid)) && !this.geo.constraints.some((k) => k.refs.includes(pid))) this.geo.points = this.geo.points.filter((p) => p.id !== pid);
    this.addRel('tangent', [lines[0].id, arc]); this.addRel('tangent', [lines[1].id, arc]);
    this.geo.constraints.push({ id: uid('k'), type: 'radius', refs: [arc], value: this.filletRadius });
    this.commit();
  }

  /** Offset the selected curves by d (positive = to the left of each curve's direction). */
  offsetSel(dExpr: string) {
    let d: number; try { d = new Evaluator(this.vars()).eval(dExpr); } catch (e: any) { this.onToast(e.message); return; }
    const cs = [...this.sel].map((id) => this.curve(id)).filter(Boolean) as SkCurve[];
    if (!cs.length) { this.onToast('Select the curves to offset'); return; }
    const newPt = new Map<string, string>();
    const P = this.P();
    // vertex normal: average of adjacent curve normals (miter for lines)
    const normalsAt = new Map<string, P2[]>();
    const segNormal = (c: SkCurve, pid: string): P2 => {
      if (c.kind === 'line') { const u = dir(P.get(c.a)!, P.get(c.b)!); return [-u[1], u[0]]; }
      if (c.kind === 'arc') { const cc = P.get(c.c)!, p = P.get(pid)!; const u = dir(cc, p); return [-u[0], -u[1]]; }
      if (c.kind === 'spline') { const i = c.pts.indexOf(pid); const a = P.get(c.pts[Math.max(0, i - 1)])!, b = P.get(c.pts[Math.min(c.pts.length - 1, i + 1)])!; const u = dir(a, b); return [-u[1], u[0]]; }
      return [0, 0];
    };
    for (const c of cs) for (const pid of c.kind === 'circle' ? [] : c.kind === 'arc' ? [c.a, c.b] : c.kind === 'line' ? [c.a, c.b] : c.pts) {
      if (!normalsAt.has(pid)) normalsAt.set(pid, []); normalsAt.get(pid)!.push(segNormal(c, pid));
    }
    const mk = (pid: string) => {
      if (newPt.has(pid)) return newPt.get(pid)!;
      const ns = normalsAt.get(pid) || [[0, 0]]; const p = P.get(pid)!;
      let n: P2 = [ns.reduce((s, v) => s + v[0], 0), ns.reduce((s, v) => s + v[1], 0)]; const L = Math.hypot(...n) || 1; n = [n[0] / L, n[1] / L];
      const cosHalf = ns.length > 1 ? Math.max(0.2, ns[0][0] * n[0] + ns[0][1] * n[1]) : 1;
      const id = this.addPoint([p[0] + (n[0] * d) / cosHalf, p[1] + (n[1] * d) / cosHalf]); newPt.set(pid, id); return id;
    };
    for (const c of cs) {
      if (c.kind === 'circle') { const id = this.addCurve({ id: uid('c'), kind: 'circle', c: c.c, r: Math.max(0.01, c.r + d) }); void id; continue; }
      if (c.kind === 'line') { const id = this.addCurve({ id: uid('l'), kind: 'line', a: mk(c.a), b: mk(c.b) }); this.addRel('parallel', [c.id, id]); continue; }
      if (c.kind === 'arc') { this.addCurve({ id: uid('a'), kind: 'arc', c: c.c, a: mk(c.a), b: mk(c.b) }); continue; }
      this.addCurve({ id: uid('s'), kind: 'spline', pts: c.pts.map(mk) });
    }
    this.commit();
  }

  /** Convert (project) a model edge into the sketch as fixed geometry. */
  convertEdge(e: EdgeInfo) {
    const pts = (e.pts || [e.mid, e.mid, e.mid, e.mid]).map((v) => this.from3(v));
    const [s, q, m, t] = pts;
    let id: string;
    if (e.type === 'LINE') { id = this.addCurve({ id: uid('l'), kind: 'line', a: this.addPoint(s), b: this.addPoint(t) }); }
    else if (e.type === 'CIRCLE') {
      const c = circumcenter(s, q, m);
      if (!c) return this.onToast('Could not project that edge');
      const closed = dist(s, t) < 1e-6;
      if (closed) id = this.addCurve({ id: uid('c'), kind: 'circle', c: this.addPoint(c), r: dist(c, s) });
      else {
        const ang = (p: P2) => Math.atan2(p[1] - c[1], p[0] - c[0]); const n = (x: number) => ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const ccw = n(ang(m) - ang(s)) < n(ang(t) - ang(s));
        const a = this.addPoint(s), b = this.addPoint(t);
        id = this.addCurve(ccw ? { id: uid('a'), kind: 'arc', c: this.addPoint(c), a, b } : { id: uid('a'), kind: 'arc', c: this.addPoint(c), a: b, b: a });
      }
    } else { id = this.addCurve({ id: uid('s'), kind: 'spline', pts: [s, q, m, t].map((p) => this.addPoint(p)) }); }
    this.addRel('fix', [id]);
    this.commit();
  }

  /* ------------------------------------------------ rendering */
  labelPos(k: SkConstraint): P2 | null {
    if (k.pos) return k.pos;
    const P = this.P(); const c = this.curve(k.refs[0]);
    if (c) { const sg = curveSeg(c, P); if (sg) { if (sg.kind === 'line') return [(sg.from[0] + sg.to[0]) / 2, (sg.from[1] + sg.to[1]) / 2]; const s = sampleSeg(sg, 8); return s[Math.floor(s.length / 2)]; } }
    const p = P.get(k.refs[0]); return p || null;
  }
  render() {
    const P = this.P(); const full = this.dof === 0 && this.status === 'ok';
    const base = this.status === 'conflict' ? 0xd64545 : full ? 0x101418 : 0x1f5fd1;
    const L = { norm: [] as number[], cons: [] as number[], sel: [] as number[], hov: [] as number[], prev: [] as number[], bad: [] as number[] };
    const bad = new Set(this.conflicting.flatMap((cid) => this.geo.constraints.find((k) => k.id === cid)?.refs || []));
    const push = (arr: number[], pts: P2[]) => { for (let i = 0; i < pts.length - 1; i++) arr.push(...this.to3(pts[i]), ...this.to3(pts[i + 1])); };
    for (const c of this.geo.curves) {
      const sg = curveSeg(c, P); if (!sg) continue; const pts = sampleSeg(sg, 64);
      const arr = this.sel.has(c.id) ? L.sel : bad.has(c.id) ? L.bad : this.hover === c.id ? L.hov : c.cons ? L.cons : L.norm;
      push(arr, pts);
    }
    // previews
    const cur = this.cursor?.pt; const cl = this.clicks;
    if (cur && cl.length) {
      const a = cl[cl.length - 1].pt;
      if (this.tool === 'line') push(L.prev, [a, cur]);
      if (this.tool === 'rect') push(L.prev, [a, [cur[0], a[1]], cur, [a[0], cur[1]], a]);
      if (this.tool === 'circle') push(L.prev, circlePts(a, dist(a, cur)));
      if (this.tool === 'polygon') { const R = dist(a, cur), a0 = Math.atan2(cur[1] - a[1], cur[0] - a[0]); const n = this.polygonSides; push(L.prev, Array.from({ length: n + 1 }, (_, i) => [a[0] + R * Math.cos(a0 + (i / n) * Math.PI * 2), a[1] + R * Math.sin(a0 + (i / n) * Math.PI * 2)] as P2)); }
      if (this.tool === 'slot') { if (cl.length === 1) push(L.prev, [a, cur]); else push(L.prev, slotPts(cl[0].pt, cl[1].pt, cur)); }
      if (this.tool === 'arc') { if (cl.length === 1) push(L.prev, [a, cur]); else { const c = circumcenter(cl[0].pt, cl[1].pt, cur); if (c) push(L.prev, arcPts(c, cl[0].pt, cl[1].pt, cur)); } }
      if (this.tool === 'spline') { const pts = [...cl.map((x) => x.pt), cur]; const sg: Seg = { kind: 'spline', from: pts[0], to: cur, pts, src: '' }; push(L.prev, sampleSeg(sg)); }
    }
    const ptsNorm: number[] = [], ptsSel: number[] = [], ptsHov: number[] = [];
    const used = new Set(this.geo.curves.flatMap((c) => (c.kind === 'circle' ? [c.c] : c.kind === 'arc' ? [c.a, c.b, c.c] : curvePoints(c))));
    for (const [id, p] of P) {
      if (!used.has(id) && id !== ORIGIN_ID && this.geo.points.find((q) => q.id === id) === undefined) continue;
      const arr = this.sel.has(id) ? ptsSel : this.hover === id ? ptsHov : ptsNorm;
      arr.push(...this.to3(p));
    }
    if (cur && this.tool !== 'select') ptsHov.push(...this.to3(cur));
    // origin axes
    const s = this.viewer.worldPerPixel() * 28;
    const ax = [...this.to3([0, 0]), ...this.to3([s, 0])], ay = [...this.to3([0, 0]), ...this.to3([0, s])];
    this.viewer.setOverlayLayers([
      { pos: L.norm, color: base, width: 2 }, { pos: L.cons, color: 0x6b8fd6, width: 1.3, dashed: true },
      { pos: L.bad, color: 0xd64545, width: 2.6 }, { pos: L.hov, color: 0xf4a259, width: 2.6 }, { pos: L.sel, color: 0xe8740c, width: 3 },
      { pos: L.prev, color: 0xe8740c, width: 1.6, dashed: true }, { pos: ax, color: 0xc0392b, width: 2 }, { pos: ay, color: 0x2e9a5b, width: 2 },
    ], [{ pos: ptsNorm, color: base, size: 6 }, { pos: ptsHov, color: 0xf4a259, size: 8 }, { pos: ptsSel, color: 0xe8740c, size: 9 }]);
    this.renderLabels();
  }
  renderLabels() {
    const r = this.viewer.el.getBoundingClientRect(); const html: string[] = [];
    const ev = new Evaluator(this.vars());
    this.geo.constraints.forEach((k, i) => {
      const isDim = k.value != null;
      if (!isDim && (!this.showRelations || k.type === 'coincident' || k.type === 'pointOnCurve')) return;
      const pos = this.labelPos(k); if (!pos) return;
      const [x, y] = this.viewer.project(this.to3(pos));
      let txt = REL_GLYPH[k.type] || '';
      if (isDim) { let v = '?'; try { v = fmt(ev.eval(k.value!)); } catch { /* */ } txt = `${DIM_LABEL[k.type] || ''}${v}${k.type === 'angle' ? '°' : ''}`; if (/[A-Za-z_]/.test(k.value!)) txt += ` <i>=${escapeHtml(k.value!)}</i>`; }
      const off = isDim ? 0 : 14 + (i % 3) * 2;
      const bad = this.conflicting.includes(k.id) ? ' bad' : '';
      html.push(`<button class="sk-lbl ${isDim ? 'dim' : 'rel'}${bad}" data-k="${k.id}" style="left:${x - r.left + off}px;top:${y - r.top - (isDim ? 0 : off)}px" title="${REL_NAME[k.type]}${isDim ? ' — click to edit' : ' — click to select, Del to remove'}">${txt}</button>`);
    });
    this.labels.innerHTML = html.join('');
    this.labels.querySelectorAll<HTMLElement>('[data-k]').forEach((b) => {
      b.onpointerdown = (e) => e.stopPropagation();
      b.onclick = () => {
        const k = this.geo.constraints.find((x) => x.id === b.dataset.k); if (!k) return;
        if (k.value != null) { if (this.tool === 'dim') this.sel.clear(); this.editDim(k.id); } else { this.sel = new Set([k.id]); this.onSelect(); }
      };
    });
  }
}

/* ------------------------------------------------ math helpers */
function segDist(p: P2, a: P2, b: P2) { const dx = b[0] - a[0], dy = b[1] - a[1]; const l = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
function projT(p: P2, a: P2, b: P2) { const dx = b[0] - a[0], dy = b[1] - a[1]; return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1); }
function dir(a: P2, b: P2): P2 { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; }
function lineDist(p: P2, a: P2, b: P2) { const u = dir(a, b); return (p[0] - a[0]) * -u[1] + (p[1] - a[1]) * u[0]; }
export function fmt(n: number) { return String(+n.toFixed(3)); }
function niceStep(min: number) { for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50]) if (s >= min) return s; return 100; }
function circumcenter(a: P2, b: P2, c: P2): P2 | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])); if (Math.abs(d) < 1e-9) return null;
  const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2;
  return [(a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d];
}
function circlePts(c: P2, r: number, n = 48): P2[] { return Array.from({ length: n + 1 }, (_, i) => [c[0] + r * Math.cos((i / n) * Math.PI * 2), c[1] + r * Math.sin((i / n) * Math.PI * 2)] as P2); }
function arcPts(c: P2, a: P2, b: P2, through: P2): P2[] {
  const ang = (p: P2) => Math.atan2(p[1] - c[1], p[0] - c[0]); const n = (x: number) => ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const r = dist(c, a); let a0 = ang(a); let span = n(ang(b) - a0);
  if (!(n(ang(through) - a0) < span)) { a0 = ang(b); span = n(ang(a) - a0); }
  return Array.from({ length: 33 }, (_, i) => [c[0] + r * Math.cos(a0 + (span * i) / 32), c[1] + r * Math.sin(a0 + (span * i) / 32)] as P2);
}
function slotPts(c1: P2, c2: P2, w: P2): P2[] {
  const u = dir(c1, c2), nn: P2 = [-u[1], u[0]]; const r = Math.max(0.1, Math.abs((w[0] - c1[0]) * nn[0] + (w[1] - c1[1]) * nn[1]));
  const a0 = Math.atan2(u[1], u[0]); const out: P2[] = [];
  for (let i = 0; i <= 16; i++) { const a = a0 - Math.PI / 2 + (i / 16) * Math.PI; out.push([c2[0] + r * Math.cos(a), c2[1] + r * Math.sin(a)]); }
  for (let i = 0; i <= 16; i++) { const a = a0 + Math.PI / 2 + (i / 16) * Math.PI; out.push([c1[0] + r * Math.cos(a), c1[1] + r * Math.sin(a)]); }
  out.push(out[0]); return out;
}
function nearestOnCurve(ed: SketchEditor, cid: string, q: P2): P2 {
  const c = ed.curve(cid)!; const sg = curveSeg(c, ed.P())!; const pts = sampleSeg(sg, 96);
  let best = pts[0], bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; const t = Math.max(0, Math.min(1, projT(q, a, b))); const p: P2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; const d = dist(p, q); if (d < bd) { bd = d; best = p; } }
  if (c.kind === 'circle') { const cc = ed.pt(c.c); const u = dir(cc, q); return [cc[0] + u[0] * c.r, cc[1] + u[1] * c.r]; }
  return best;
}
function onCurve(ed: SketchEditor, c: SkCurve, p: P2) { const sg = curveSeg(c, ed.P()); if (!sg) return false; const pts = sampleSeg(sg, 96); for (let i = 0; i < pts.length - 1; i++) if (segDist(p, pts[i], pts[i + 1]) < 1e-4 * Math.max(1, Math.hypot(...p))) return true; return false; }
function polyOf(s: Seg) { return sampleSeg(s, 128); }
function segSeg(a: P2, b: P2, c: P2, d: P2): number | null {
  const r: P2 = [b[0] - a[0], b[1] - a[1]], s: P2 = [d[0] - c[0], d[1] - c[1]]; const den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}
/** Intersection parameters (0..1 along a line) with other segments. */
function intersectParams(line: Seg, others: Seg[]): number[] {
  const out: number[] = [];
  for (const o of others) { const pts = polyOf(o); for (let i = 0; i < pts.length - 1; i++) { const t = segSeg(line.from, line.to, pts[i], pts[i + 1]); if (t != null) out.push(t); } }
  return out;
}
function intersectPoints(me: Seg, others: Seg[]): P2[] {
  const mine = polyOf(me); const out: P2[] = [];
  for (const o of others) { const pts = polyOf(o); for (let i = 0; i < mine.length - 1; i++) for (let j = 0; j < pts.length - 1; j++) { const t = segSeg(mine[i], mine[i + 1], pts[j], pts[j + 1]); if (t != null) out.push([mine[i][0] + (mine[i + 1][0] - mine[i][0]) * t, mine[i][1] + (mine[i + 1][1] - mine[i][1]) * t]); } }
  return out;
}
function escapeHtml(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
export { circumcenter };
