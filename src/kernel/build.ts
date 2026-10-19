// Feature-tree evaluation on top of the OpenCASCADE kernel (via replicad).
// Pure module: used by the web worker in the app and directly by the Node test suite.
import type * as RT from 'replicad';
import { Evaluator } from '../model/expr';
import { solve as solveSketch } from '../sketch/solver';
import { findRegions, faceArea, facePolygon, sampleSeg, splineBeziers, curveSeg, pointMap, type Seg, type P2 } from '../sketch/profile';
import type {
  Project, Feature, PlaneRef, SketchEntity, RebuildResult, FaceInfo, EdgeInfo, SketchDisplay, V3, Op, EdgeRef, FaceRef,
} from '../model/types';

type R = typeof RT;
type Shape = RT.Shape3D;

interface PlaneData { origin: V3; xDir: V3; normal: V3; yDir: V3 }
interface SketchData {
  drawing: RT.Drawing | null; plane: PlaneData; chains: Seg[][]; faces: Seg[][];
  geo?: import('../model/types').SketchGeo; dof?: number; status?: 'ok' | 'conflict' | 'redundant' | 'failed';
}
interface Snapshot {
  key: string;
  bodies: Shape[];
  tools: Map<string, { tool: Shape; op: Op }>;
  sketches: Map<string, SketchData>;
  faceOwner: Map<number, string>;
  edgeOwner: Map<number, string>;
  error?: string;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const AXIS: Record<string, V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

export function resolvePlane(ref: PlaneRef, ev: Evaluator): PlaneData {
  let origin: V3, xDir: V3, normal: V3;
  if (ref.kind === 'face') { origin = ref.origin!; xDir = norm(ref.xDir!); normal = norm(ref.normal!); }
  else if (ref.kind === 'XY') { origin = [0, 0, 0]; xDir = [1, 0, 0]; normal = [0, 0, 1]; }      // Top (build plate)
  else if (ref.kind === 'XZ') { origin = [0, 0, 0]; xDir = [1, 0, 0]; normal = [0, -1, 0]; }     // Front
  else { origin = [0, 0, 0]; xDir = [0, 1, 0]; normal = [1, 0, 0]; }                            // Right
  const off = ref.offset ? ev.eval(ref.offset) : 0;
  origin = add(origin, mul(normal, off));
  return { origin, xDir, normal, yDir: cross(normal, xDir) };
}

/* ---------- sketch entities ---------- */
function entityArea(e: SketchEntity, ev: Evaluator): number {
  switch (e.kind) {
    case 'rect': return ev.eval(e.w) * ev.eval(e.h);
    case 'circle': return Math.PI * (ev.eval(e.d) / 2) ** 2;
    case 'polygon': return (ev.eval(e.d) / 2) ** 2 * 2.6;
    case 'slot': return ev.eval(e.l) * ev.eval(e.w) + Math.PI * (ev.eval(e.w) / 2) ** 2;
    case 'poly': { const p = e.pts.map(([x, y]) => [ev.eval(x), ev.eval(y)]); let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(a / 2); }
  }
}

/** 2D outline points of an entity (used for display and containment tests). */
export function entityOutline(e: SketchEntity, ev: Evaluator, seg = 48): [number, number][] {
  const rot = (pts: [number, number][], ang: number, cx: number, cy: number) => {
    const c = Math.cos((ang * Math.PI) / 180), s = Math.sin((ang * Math.PI) / 180);
    return pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c] as [number, number]);
  };
  switch (e.kind) {
    case 'rect': {
      const w = ev.eval(e.w) / 2, h = ev.eval(e.h) / 2, r = Math.min(e.r ? ev.eval(e.r) : 0, w, h);
      let pts: [number, number][] = [];
      if (r > 1e-6) {
        const corners: [number, number, number][] = [[w - r, h - r, 0], [-w + r, h - r, 90], [-w + r, -h + r, 180], [w - r, -h + r, 270]];
        for (const [x, y, a0] of corners) for (let i = 0; i <= 8; i++) { const a = ((a0 + (i * 90) / 8) * Math.PI) / 180; pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]); }
      } else pts = [[w, h], [-w, h], [-w, -h], [w, -h]];
      return rot(pts, e.angle ? ev.eval(e.angle) : 0, ev.eval(e.cx), ev.eval(e.cy));
    }
    case 'circle': { const r = ev.eval(e.d) / 2, cx = ev.eval(e.cx), cy = ev.eval(e.cy); return Array.from({ length: seg }, (_, i) => { const a = (i / seg) * Math.PI * 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number]; }); }
    case 'polygon': { const r = ev.eval(e.d) / 2, n = Math.max(3, Math.round(ev.eval(e.n))); const pts = Array.from({ length: n }, (_, i) => { const a = Math.PI / 2 + (i / n) * Math.PI * 2; return [r * Math.cos(a), r * Math.sin(a)] as [number, number]; }); return rot(pts, e.angle ? ev.eval(e.angle) : 0, ev.eval(e.cx), ev.eval(e.cy)); }
    case 'slot': {
      const l = ev.eval(e.l) / 2, r = ev.eval(e.w) / 2; const pts: [number, number][] = [];
      for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + (i / 16) * Math.PI; pts.push([l + r * Math.cos(a), r * Math.sin(a)]); }
      for (let i = 0; i <= 16; i++) { const a = Math.PI / 2 + (i / 16) * Math.PI; pts.push([-l + r * Math.cos(a), r * Math.sin(a)]); }
      return rot(pts, e.angle ? ev.eval(e.angle) : 0, ev.eval(e.cx), ev.eval(e.cy));
    }
    case 'poly': return e.pts.map(([x, y]) => [ev.eval(x), ev.eval(y)]);
  }
}

function entityDrawing(R: R, e: SketchEntity, ev: Evaluator): RT.Drawing {
  const cx = 'cx' in e ? ev.eval(e.cx) : 0, cy = 'cy' in e ? ev.eval(e.cy) : 0;
  switch (e.kind) {
    case 'rect': {
      const w = ev.eval(e.w), h = ev.eval(e.h), r = e.r ? ev.eval(e.r) : 0;
      if (w <= 0 || h <= 0) throw new Error('Rectangle size must be > 0');
      let d = r > 1e-6 ? R.drawRoundedRectangle(w, h, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3)) : R.drawRectangle(w, h);
      if (e.angle && ev.eval(e.angle)) d = d.rotate(ev.eval(e.angle), [0, 0]);
      return d.translate(cx, cy);
    }
    case 'circle': { const d = ev.eval(e.d); if (d <= 0) throw new Error('Diameter must be > 0'); return R.drawCircle(d / 2).translate(cx, cy); }
    case 'polygon': {
      const d = ev.eval(e.d), n = Math.max(3, Math.round(ev.eval(e.n)));
      let dr = R.drawPolysides(d / 2, n); if (e.angle && ev.eval(e.angle)) dr = dr.rotate(ev.eval(e.angle), [0, 0]);
      return dr.translate(cx, cy);
    }
    case 'slot': {
      const l = ev.eval(e.l), w = ev.eval(e.w);
      let d = l > 1e-6 ? R.drawRoundedRectangle(l + w, w, w / 2 - 1e-4) : R.drawCircle(w / 2);
      if (e.angle && ev.eval(e.angle)) d = d.rotate(ev.eval(e.angle), [0, 0]);
      return d.translate(cx, cy);
    }
    case 'poly': {
      const p = e.pts.map(([x, y]) => [ev.eval(x), ev.eval(y)] as [number, number]);
      if (p.length < 3) throw new Error('Polyline needs 3+ points');
      let pen = R.draw(p[0]); for (let i = 1; i < p.length; i++) pen = pen.lineTo(p[i]);
      return pen.close();
    }
  }
}

function inside(pt: [number, number], poly: [number, number][]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Combine entities into one region: entities lying inside a larger one become holes (alternating for islands). */
function sketchDrawing(R: R, ents: SketchEntity[], ev: Evaluator): RT.Drawing | null {
  const items = ents.map((e) => ({ e, area: entityArea(e, ev), outline: entityOutline(e, ev, 24) })).sort((a, b) => b.area - a.area);
  let result: RT.Drawing | null = null;
  const placed: { outline: [number, number][]; depth: number }[] = [];
  for (const it of items) {
    const probe = it.outline[0];
    const depth = placed.filter((p) => it.outline.every((q) => inside(q, p.outline)) || inside(probe, p.outline)).length;
    const d = entityDrawing(R, it.e, ev);
    if (!result) result = d;
    else result = depth % 2 === 1 ? result.cut(d) : result.fuse(d);
    placed.push({ outline: it.outline, depth });
  }
  return result;
}

function toPlane(R: R, p: PlaneData): RT.Plane { return new R.Plane(p.origin, p.xDir, p.normal); }

function edgeFinder(R: R, refs: EdgeRef[], tol = 0.05) {
  return (f: RT.EdgeFinder) => f.either(refs.map((r) => (g: RT.EdgeFinder) => g.atDistance(0, r.p, tol)));
}
function faceFinder(R: R, refs: FaceRef[], tol = 0.25) {
  return (f: RT.FaceFinder) => f.either(refs.map((r) => (g: RT.FaceFinder) => g.atDistance(0, r.p, tol)));
}

function diag(b: Shape) { try { const bb = (b as any).boundingBox.bounds as [V3, V3]; return Math.hypot(bb[1][0] - bb[0][0], bb[1][1] - bb[0][1], bb[1][2] - bb[0][2]); } catch { return 100; } }
const vlen = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** Greedy one-to-one matching of unresolved references to candidates (closest pairs first). */
function assign<C extends { pos: V3 }>(refs: { p: V3; ok: (c: C) => boolean; max: number }[], cands: C[]): (V3 | null)[] {
  const pairs: [number, number, number][] = [];
  refs.forEach((r, i) => cands.forEach((c, j) => { if (!r.ok(c)) return; const d = vlen(sub(c.pos, r.p)); if (d < r.max) pairs.push([d, i, j]); }));
  pairs.sort((x, y) => x[0] - y[0]);
  const out: (V3 | null)[] = refs.map(() => null); const used = new Set<number>();
  for (const [, i, j] of pairs) { if (out[i] || used.has(j)) continue; out[i] = cands[j].pos; used.add(j); }
  return out;
}

/** Re-find referenced edges: exact hit first, then the closest edge of the same type and direction. */
function resolveEdges(R: R, b: Shape, refs: EdgeRef[]): V3[] {
  const exact: V3[] = []; const todo: EdgeRef[] = [];
  for (const ref of refs) { if (new R.EdgeFinder().atDistance(0, ref.p, 0.05).find(b).length) exact.push(ref.p); else todo.push(ref); }
  if (!todo.length) return exact;
  const maxD = diag(b) * 0.35;
  const cands = b.edges.map((e) => { const p = e.pointAt(0.5); let t: V3 = [0, 0, 0]; try { const v = e.tangentAt(0.5); t = norm([v.x, v.y, v.z]); } catch { /* */ } return { pos: [p.x, p.y, p.z] as V3, tan: t, type: String(e.geomType) }; })
    .filter((c) => !exact.some((q) => vlen(sub(q, c.pos)) < 0.05));
  const got = assign(todo.map((r) => ({ p: r.p, max: r.t ? maxD : maxD * 0.4, ok: (c: typeof cands[number]) => (!r.k || c.type === r.k) && (!r.t || Math.abs(dot(c.tan, r.t)) > 0.999) })), cands);
  return [...exact, ...(got.filter(Boolean) as V3[])];
}
function resolveFaces(R: R, b: Shape, refs: FaceRef[]): V3[] {
  const exact: V3[] = []; const todo: FaceRef[] = [];
  for (const ref of refs) { if (new R.FaceFinder().atDistance(0, ref.p, 0.25).find(b).length) exact.push(ref.p); else todo.push(ref); }
  if (!todo.length) return exact;
  const maxD = diag(b) * 0.35;
  const cands = b.faces.map((f) => { const c = f.center; const type = String(f.geomType); let n: V3 | null = null; if (type === 'PLANE') { const v = f.normalAt(); n = norm([v.x, v.y, v.z]); } return { pos: [c.x, c.y, c.z] as V3, n, type }; });
  const got = assign(todo.map((r) => ({ p: r.p, max: r.n ? maxD : maxD * 0.4, ok: (c: typeof cands[number]) => (!r.k || c.type === r.k) && (!r.n || (!!c.n && dot(c.n, r.n) > 0.999)) })), cands);
  return [...exact, ...(got.filter(Boolean) as V3[])];
}

const keyOf = (prev: string, f: Feature, i: number) => {
  // FNV-1a over the previous key + this feature (ignoring display-only fields).
  const { hidden, color, name, ...geo } = f as any;
  const s = prev + '|' + i + JSON.stringify(geo);
  let h = 2166136261; for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + ':' + s.length;
};

export class Builder {
  private cache: Snapshot[] = [];
  private varsKey = '';
  private vars: Record<string, string> = {};
  private imports = new Map<string, Shape[]>();
  fontLoaded = false;
  /** Async work that must finish before a synchronous rebuild (STEP import, fonts). */
  async prepare(project: Project, loadFont?: () => Promise<ArrayBuffer>) {
    for (const f of project.features) {
      if (f.type === 'import' && !this.imports.has(f.id + ':' + f.data.length)) {
        const bin = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
        const shape: any = await this.R.importSTEP(new Blob([bin]));
        const solids: Shape[] = [];
        try { for (const sd of (shape.solids || [])) solids.push(sd); } catch { /* */ }
        if (!solids.length) solids.push(shape);
        this.imports.set(f.id + ':' + f.data.length, solids);
      }
      if (f.type === 'text' && !this.fontLoaded && loadFont) { await this.R.loadFont(await loadFont(), 'jascad-sans'); this.fontLoaded = true; }
    }
  }
  constructor(private R: R, private gcs: any = null) {}

  private emptySnap(): Snapshot {
    return { key: 'root', bodies: [], tools: new Map(), sketches: new Map(), faceOwner: new Map(), edgeOwner: new Map() };
  }

  /** Evaluate the tree. Re-uses cached results up to the first changed feature. */
  rebuild(project: Project): RebuildResult & { shapes: Shape[] } {
    const t0 = Date.now();
    const R = this.R;
    const ev = new Evaluator(project.variables);
    this.vars = project.variables;
    const vk = JSON.stringify(project.variables);
    if (vk !== this.varsKey) { this.cache = []; this.varsKey = vk; }

    const errors: { featureId: string; message: string }[] = [];
    const sketchesOut: SketchDisplay[] = [];
    const end = project.rollback == null ? project.features.length : Math.min(project.rollback, project.features.length);

    let snap = this.emptySnap();
    let key = 'root';
    const newCache: Snapshot[] = [];
    let reuse = true;

    for (let i = 0; i < end; i++) {
      const f = project.features[i];
      key = keyOf(key, f, i);
      const cached = this.cache[i];
      if (reuse && cached && cached.key === key) {
        snap = cached; newCache.push(cached);
        if (cached.error) errors.push({ featureId: f.id, message: cached.error });
        this.collectSketch(f, snap, ev, sketchesOut); continue;
      }
      reuse = false;
      const next: Snapshot = {
        key, bodies: snap.bodies.slice(), tools: new Map(snap.tools), sketches: new Map(snap.sketches),
        faceOwner: new Map(snap.faceOwner), edgeOwner: new Map(snap.edgeOwner),
      };
      if (!f.suppressed) {
        try { this.apply(f, next, ev); }
        catch (e: any) {
          if ((globalThis as any).JASCAD_DEBUG) console.error(e?.stack || e);
          next.error = cleanErr(e); errors.push({ featureId: f.id, message: next.error });
          next.bodies = snap.bodies.slice(); next.tools = new Map(snap.tools); next.sketches = new Map(snap.sketches);
        }
        if (next.bodies !== snap.bodies) this.trackOwnership(next, f.id);
      }
      newCache.push(next);
      snap = next;
      this.collectSketch(f, snap, ev, sketchesOut);
    }
    this.cache = newCache;
    this.lastFaceOwner = snap.faceOwner;
    const out = this.output(snap, project, ev);
    return { ...out, errors, sketches: sketchesOut, ms: Date.now() - t0, shapes: snap.bodies };
  }

  private collectSketch(f: Feature, snap: Snapshot, ev: Evaluator, out: SketchDisplay[]) {
    if (f.type !== 'sketch' || f.hidden === true || f.suppressed) return;
    const s = snap.sketches.get(f.id); if (!s) return;
    const lines: number[] = [];
    const P = s.plane;
    const to3 = (x: number, y: number) => add(add(P.origin, mul(P.xDir, x)), mul(P.yDir, y));
    for (const e of f.entities) {
      let pts: [number, number][];
      try { pts = entityOutline(e, ev); } catch { continue; }
      for (let k = 0; k < pts.length; k++) {
        const a = to3(...pts[k]), b = to3(...pts[(k + 1) % pts.length]);
        lines.push(...a, ...b);
      }
    }
    const consLines: number[] = [];
    if (s.geo) {
      const PM = pointMap(s.geo);
      for (const c of s.geo.curves) {
        const sg = curveSeg(c, PM); if (!sg) continue;
        const pts = sampleSeg(sg, 48); const arr = c.cons ? consLines : lines;
        for (let k = 0; k < pts.length - 1; k++) arr.push(...to3(...pts[k]), ...to3(...pts[k + 1]));
      }
    }
    out.push({ featureId: f.id, lines, consLines, origin: P.origin, xDir: P.xDir, normal: P.normal, dof: s.dof, status: s.status });
  }

  private applyOp(s: Snapshot, solid: Shape, op: Op) {
    if (op === 'new' || s.bodies.length === 0) { if (op === 'cut') throw new Error('Nothing to cut'); s.bodies.push(solid); return; }
    if (op === 'add') {
      // fuse into the first body it touches, otherwise into the first body
      s.bodies[0] = s.bodies[0].fuse(solid) as Shape;
      return;
    }
    s.bodies = s.bodies.map((b) => b.cut(solid) as Shape);
  }

  private apply(f: Feature, s: Snapshot, ev: Evaluator) {
    const R = this.R;
    switch (f.type) {
      case 'thread': {
        if (!s.bodies.length) throw new Error('No body to thread');
        if (!f.face) throw new Error('Click a cylindrical face (a shaft or a hole)');
        const P = ev.eval(f.pitch); if (P <= 0) throw new Error('Pitch must be > 0');
        const clr = ev.eval(f.clearance || '0');
        let done = false;
        s.bodies = s.bodies.map((b) => {
          if (done) return b;
          const fc = b.faces.find((x) => String(x.geomType) === 'CYLINDRE' && vlen(sub(cylAxisPoint(x), f.face!.p)) < 1e9 && onFace(R, x, f.face!.p));
          if (!fc) return b;
          const cy = cylinderInfo(fc)!; done = true;
          const L = f.full ? cy.len : Math.min(cy.len, ev.eval(f.length));
          const start = f.fromEnd ? add(cy.base, mul(cy.dir, cy.len - L)) : cy.base;
          // ISO-style 60° thread made by twist-extruding a cam-shaped section (exact helicoid, robust booleans)
          const depth = 0.6134 * P, half = 0.354, N = 24;
          const sectionR = (t: number) => { const bump = Math.max(0, 1 - Math.abs(t - 0.5) / half); return cy.internal ? cy.r - 0.02 + (depth + clr + 0.02) * bump : cy.r - Math.max(clr, 0.02) - depth * bump; }; // never coincident with the existing surface
          const pts: P2[] = Array.from({ length: N }, (_, i) => { const t = i / N, a = t * Math.PI * 2, r = sectionR(t); return [r * Math.cos(a), r * Math.sin(a)] as P2; });
          // one smooth closed spline → the helicoid has a single lateral face (fast booleans, slightly rounded crests print well)
          const pl = new R.Plane(add(start, mul(cy.dir, -0.01)), perp(cy.dir), cy.dir);
          const makeHel = (ring: P2[]) => {
            const section: any = R.drawPointsInterpolation([...ring, ring[0]] as any, { tolerance: 1e-3 } as any);
            return (section.sketchOnPlane(pl) as any).extrude(L + 0.02, { twistAngle: (360 * (L + 0.02)) / P }) as Shape;
          };
          let helicoid = makeHel(pts);
          // OCCT occasionally builds this twisted solid inside-out; rebuild with the opposite winding if so
          if (R.measureVolume(helicoid as any) < 0) helicoid = makeHel([...pts].reverse());
          const v0 = R.measureVolume(b as any);
          const okVol = (x: Shape | null) => { if (!x) return false; try { const v = R.measureVolume(x as any); return isFinite(v) && v > 0 && v < v0 - 1e-6; } catch { return false; } };
          let out: Shape | null = null;
          try {
            if (cy.internal) {
              // tap: replace a sleeve around the hole with an exact cylinder minus the helicoid. The helicoid then only
              // meets planes and exact coaxial cylinders, which is ~2-3x faster than cutting the part directly.
              const Ro = cy.r + depth + clr + 0.4;
              const sleeve = R.makeCylinder(Ro, L, start, cy.dir) as Shape;
              const rest = b.cut(sleeve.clone()) as Shape;
              const removed = v0 - R.measureVolume(rest as any), expect = Math.PI * (Ro * Ro - cy.r * cy.r) * L;
              if (Math.abs(removed - expect) < expect * 0.01) out = rest.fuse(sleeve.cut(helicoid.clone()) as Shape, { optimisation: 'sameFace' } as any) as Shape;
              if (!okVol(out)) out = b.cut(helicoid) as Shape;            // thin wall: cut the part directly
            } else {
              // replace the threaded length of the shaft with the helicoid
              let rest: Shape | null = null;
              try { rest = b.cut(R.makeCylinder(cy.r + 0.3, L, start, cy.dir) as Shape) as Shape; if (!(R.measureVolume(rest as any) > 1e-6)) rest = null; } catch { rest = null; }
              out = rest ? (rest.fuse(helicoid) as Shape) : helicoid;
            }
            if (!okVol(out)) out = null;
          } catch { out = null; }
          if (!out) throw new Error('The thread could not be cut on this face');
          return out;
        });
        if (!done) throw new Error('Pick a cylindrical face (a shaft or a hole)');
        return;
      }
      case 'text': {
        if (!this.fontLoaded) throw new Error('Font not loaded yet');
        if (!f.text.trim()) throw new Error('Type some text');
        const P = resolvePlane(f.plane, ev);
        const size = ev.eval(f.size), depth = ev.eval(f.depth);
        if (size <= 0 || depth <= 0) throw new Error('Size and depth must be > 0');
        let d: any = R.drawText(f.text, { fontSize: size, fontFamily: 'jascad-sans' });
        if (f.align === 'center') { const b = d.boundingBox; d = d.translate(-(b.bounds[0][0] + b.bounds[1][0]) / 2, -(b.bounds[0][1] + b.bounds[1][1]) / 2); }
        const ang = ev.eval(f.angle || '0'); if (ang) d = d.rotate(ang, [0, 0]);
        d = d.translate(ev.eval(f.x), ev.eval(f.y));
        const origin = f.op === 'cut' ? add(P.origin, mul(P.normal, 0.01)) : add(P.origin, mul(P.normal, -0.01));
        const solid = (d.sketchOnPlane(new R.Plane(origin, P.xDir, P.normal)) as any).extrude(f.op === 'cut' ? -(depth + 0.01) : depth + 0.01) as Shape;
        s.tools.set(f.id, { tool: solid, op: f.op });
        this.applyOp(s, solid, f.op);
        return;
      }
      case 'split': {
        if (!s.bodies.length) throw new Error('No body to split');
        const off = ev.eval(f.offset), gap = ev.eval(f.gap || '0');
        const pn = f.plane === 'XY' ? [0, 0, 1] : f.plane === 'XZ' ? [0, -1, 0] : [1, 0, 0];
        const n = pn as V3;
        const out: Shape[] = [];
        for (const b of s.bodies) {
          let body = b;
          if (f.dowels > 0) body = this.dowelCut(body, n, off, f, ev);
          const res = (body as any).split(f.plane, off);
          const pos = res.positive as Shape | null, neg = res.negative as Shape | null;
          if (!pos || !neg) { out.push(b); continue; }
          if (f.keep !== 'negative') out.push(gap ? (pos.clone().translate(mul(n, gap)) as Shape) : pos);
          if (f.keep !== 'positive') out.push(neg);
        }
        if (out.length === s.bodies.length && f.keep === 'both') throw new Error('The split plane does not cut the part');
        s.bodies = out;
        return;
      }
      case 'boss': {
        const P = resolvePlane(f.plane, ev);
        if (!f.points.length) throw new Error('Click a flat face to place the boss');
        const od = ev.eval(f.od), id = ev.eval(f.insertD), h = ev.eval(f.height), hd = ev.eval(f.holeDepth);
        if (od <= id) throw new Error('Outer diameter must be larger than the insert hole');
        let boss: Shape | null = null, holes: Shape | null = null;
        for (const [x, y] of f.points) {
          const base = add(add(add(P.origin, mul(P.xDir, x)), mul(P.yDir, y)), mul(P.normal, -0.05));
          const c = R.makeCylinder(od / 2, h + 0.05, base, P.normal) as Shape;
          boss = boss ? (boss.fuse(c) as Shape) : c;
          const top = add(base, mul(P.normal, h + 0.05));
          const hc = R.makeCylinder(id / 2, hd + 0.1, add(top, mul(P.normal, 0.05)), mul(P.normal, -1)) as Shape;
          holes = holes ? (holes.fuse(hc) as Shape) : hc;
        }
        this.applyOp(s, boss!, 'add');
        this.applyOp(s, holes!, 'cut');
        s.tools.set(f.id, { tool: boss!.cut(holes!) as Shape, op: 'add' });
        return;
      }
      case 'snap': {
        const P = resolvePlane(f.plane, ev);
        if (!f.point) throw new Error('Click a flat face to place the snap-fit');
        const L = ev.eval(f.length), t = ev.eval(f.thickness), W = ev.eval(f.width), lip = ev.eval(f.lip), lead = ev.eval(f.lead || '30');
        const hookH = Math.min(L * 0.45, lip / Math.tan((Math.max(10, Math.min(80, lead)) * Math.PI) / 180));
        const a = (ev.eval(f.angle || '0') * Math.PI) / 180;
        const u: V3 = norm(add(mul(P.xDir, Math.cos(a)), mul(P.yDir, Math.sin(a))));
        const n = P.normal; const wv = norm(cross(n, u));
        const base = add(add(add(P.origin, mul(P.xDir, f.point[0])), mul(P.yDir, f.point[1])), mul(n, -0.05));
        const prof: [number, number][] = [[0, 0], [t, 0], [t, L - hookH], [t + lip, L - hookH], [t, L], [0, L]];
        const pl = new R.Plane(add(base, mul(wv, -W / 2)), u, wv);
        let pen = R.draw(prof[0]); for (let i = 1; i < prof.length; i++) pen = pen.lineTo([prof[i][0], prof[i][1] + 0.05]);
        void pl;
        // build in the (u, n) plane and extrude along wv
        const plane2 = new R.Plane(add(base, mul(wv, -W / 2)), u, mul(wv, -1));
        const solid = (pen.close().sketchOnPlane(plane2) as any).extrude(-W) as Shape;
        // the sketch's local y must be the face normal; verify orientation and flip if needed
        const bb = (solid as any).boundingBox.bounds as [V3, V3]; const mid = mul(add(bb[0], bb[1]), 0.5);
        let fixed = solid;
        if (dot(sub(mid, base), n) < 0) fixed = solid.clone().mirror(new R.Plane(base, u, n) as any) as Shape;
        s.tools.set(f.id, { tool: fixed, op: 'add' });
        this.applyOp(s, fixed, 'add');
        return;
      }
      case 'lip': {
        if (!f.face) throw new Error('Click the rim (top edge face) of a shelled part');
        const h = ev.eval(f.height), w = ev.eval(f.width), c = ev.eval(f.clearance || '0');
        let done = false;
        s.bodies = s.bodies.map((b) => {
          if (done) return b;
          const pts = resolveFaces(R, b, [f.face!]); if (!pts.length) return b;
          let fc = b.faces.find((x) => String(x.geomType) === 'PLANE' && onFace(R, x, pts[0]));
          if (!fc && f.face!.n) { // the stored point drifted after an upstream edit: take the nearest rim-like face with the same normal
            let best = Infinity;
            for (const x of b.faces) { if (String(x.geomType) !== 'PLANE') continue; const v = x.clone().normalAt(); if (dot(norm([v.x, v.y, v.z]), f.face!.n) < 0.999) continue; if (!x.clone().innerWires().length) continue; const c = x.center; const dd = vlen(sub([c.x, c.y, c.z], f.face!.p)); if (dd < best) { best = dd; fc = x; } }
          }
          if (!fc) return b;
          const nn = fc.clone().normalAt(); const n: V3 = norm([nn.x, nn.y, nn.z]);
          const inner = fc.clone().innerWires(); if (!inner.length) throw new Error('This face has no inner edge. Pick the rim of a shelled part.');
          const iw = inner[0];
          const off = (d: number) => { const a = iw.clone().offset2D(d), b2 = iw.clone().offset2D(-d); return R.measureLength(a) > R.measureLength(b2) ? a : b2; };
          const shrink = (d: number) => { const a = iw.clone().offset2D(d), b2 = iw.clone().offset2D(-d); return R.measureLength(a) < R.measureLength(b2) ? a : b2; };
          const outerW = f.kind === 'lip' ? off(w) : off(w + c);
          const innerW = f.kind === 'lip' ? (iw.clone() as any) : c > 0 ? shrink(c) : (iw.clone() as any);
          const ext = (wire: any, from: number, len: number) => R.basicFaceExtrusion(R.makeFace(wire).translate(mul(n, from)) as any, new R.Vector(mul(n, len))) as any as Shape;
          const tool = f.kind === 'lip'
            ? (ext(outerW, -0.01, h + 0.01).cut(ext(innerW, -0.02, h + 0.04)) as Shape)
            : (ext(outerW, 0.01, -(h + c + 0.01)).cut(ext(innerW, 0.02, -(h + c + 0.04))) as Shape);
          done = true;
          return (f.kind === 'lip' ? b.fuse(tool!) : b.cut(tool!)) as Shape;
        });
        if (!done) throw new Error('Face reference lost — pick the rim face again');
        return;
      }
      case 'combine': {
        const ti = f.target, tools = f.tools.filter((i) => i !== ti && i >= 0 && i < s.bodies.length);
        if (ti < 0 || ti >= s.bodies.length) throw new Error('Pick a target body');
        if (!tools.length) throw new Error('Pick at least one other body');
        let t = s.bodies[ti];
        for (const i of tools) { const o = s.bodies[i]; t = (f.op === 'union' ? t.fuse(o) : f.op === 'subtract' ? t.cut(o) : t.intersect(o)) as Shape; }
        s.bodies = s.bodies.filter((_, i) => !tools.includes(i)).map((b) => (b === s.bodies[ti] ? t : b));
        return;
      }
      case 'move': {
        const idx = f.bodies.length ? f.bodies : s.bodies.map((_, i) => i);
        const v: V3 = [ev.eval(f.dx || '0'), ev.eval(f.dy || '0'), ev.eval(f.dz || '0')]; const ang = ev.eval(f.angle || '0');
        const moved = idx.filter((i) => i < s.bodies.length).map((i) => { let b = s.bodies[i].clone() as Shape; if (ang) b = b.rotate(ang, [0, 0, 0], AXIS[f.axis]) as Shape; return b.translate(v) as Shape; });
        if (f.copy) s.bodies = [...s.bodies, ...moved];
        else { let k = 0; s.bodies = s.bodies.map((b, i) => (idx.includes(i) ? moved[k++] : b)); }
        return;
      }
      case 'import': {
        const shapes = this.imports.get(f.id + ':' + f.data.length);
        if (!shapes) throw new Error('Importing…');
        for (const sh of shapes) s.bodies.push(sh.clone() as Shape);
        return;
      }
      case 'sketch': {
        const plane = resolvePlane(f.plane, ev);
        let drawing = f.entities.length ? sketchDrawing(R, f.entities, ev) : null;
        let faces: Seg[][] = [], chains: Seg[][] = [], geo = f.geo, dof: number | undefined, status: SketchData['status'];
        if (f.geo && f.geo.curves.length) {
          if (this.gcs) { const res = solveSketch(this.gcs, f.geo, this.vars); geo = res.geo; dof = res.dof; status = res.status; }
          const reg = findRegions(geo!); faces = reg.faces; chains = reg.chains;
          const gd = regionsDrawing(R, faces);
          if (gd) drawing = drawing ? drawing.fuse(gd) : gd;
        }
        s.sketches.set(f.id, { drawing, plane, faces, chains, geo, dof, status });
        if (status === 'conflict') throw new Error('Sketch has conflicting constraints — remove one of the highlighted constraints');
        return;
      }
      case 'sweep': {
        const prof = s.sketches.get(f.profile), path = s.sketches.get(f.path);
        if (!prof || !prof.drawing) throw new Error('Pick a closed profile sketch');
        if (!path || !path.chains.length) throw new Error('Pick a path sketch with an open line, arc or spline chain');
        const spine = chainWire(R, path.chains[0], path.plane);
        const wires = drawingWires(R, prof.drawing, prof.plane);
        let solid: Shape | null = null;
        for (const [i, w] of wires.entries()) {
          const sw = R.genericSweep(w, spine, { frenet: f.frenet ?? true, transitionMode: 'right' } as any, false) as Shape;
          solid = !solid ? sw : i === 0 ? sw : (solid.cut(sw) as Shape);
        }
        if (!solid) throw new Error('Profile is empty');
        s.tools.set(f.id, { tool: solid, op: f.op });
        this.applyOp(s, solid, f.op);
        return;
      }
      case 'loft': {
        if (f.sketches.length < 2) throw new Error('Pick at least two profile sketches');
        const wires = f.sketches.map((id) => {
          const sk = s.sketches.get(id); if (!sk || !sk.drawing) throw new Error('A loft profile is missing or empty');
          return drawingWires(R, sk.drawing, sk.plane)[0];
        });
        const solid = R.loft(wires, { ruled: !!f.ruled }) as Shape;
        s.tools.set(f.id, { tool: solid, op: f.op });
        this.applyOp(s, solid, f.op);
        return;
      }
      case 'draft': {
        if (!f.faces.length) throw new Error('Select faces to draft');
        const ang = ev.eval(f.angle);
        if (Math.abs(ang) < 1e-6) return;
        let found = 0;
        s.bodies = s.bodies.map((b) => {
          const pts = resolveFaces(R, b, f.faces); if (!pts.length) return b; found += pts.length;
          let neutral: RT.Plane;
          if (f.neutral && f.neutral.n) neutral = new R.Plane(f.neutral.p, perp(f.neutral.n), f.neutral.n);
          else neutral = new R.Plane([0, 0, 0], [1, 0, 0], [0, 0, 1]);
          return (b as any).draft(ang, (x: RT.FaceFinder) => x.either(pts.map((p) => (g: RT.FaceFinder) => g.atDistance(0, p, 0.25))), neutral) as Shape;
        });
        if (!found) throw new Error('Face references lost — reselect faces');
        return;
      }
      case 'rib': {
        const sk = s.sketches.get(f.sketch);
        if (!sk || !sk.chains.length) throw new Error('Draw an open line (or chain) in the rib sketch');
        if (!s.bodies.length) throw new Error('Ribs need an existing body');
        const t = ev.eval(f.thickness); if (t <= 0) throw new Error('Thickness must be > 0');
        const P = sk.plane;
        const bb = (s.bodies.length === 1 ? s.bodies[0] : (R.makeCompound(s.bodies.map((x) => x.clone())) as any)).boundingBox.bounds as [V3, V3];
        const box = R.makeBox(bb[0], bb[1]) as Shape;
        const build = (flip: boolean) => {
          let rib: Shape | null = null;
          for (const ch of sk.chains) {
            const pts = ch.flatMap((sg, i) => sampleSeg(sg, 16).slice(i ? 1 : 0));
            const a = pts[0], b = pts[pts.length - 1];
            const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
            let nx = -dy / L, ny = dx / L; if (flip) { nx = -nx; ny = -ny; }
            const D = 4000;
            const poly: P2[] = [...pts, [b[0] + nx * D, b[1] + ny * D], [a[0] + nx * D, a[1] + ny * D]];
            let pen = R.draw(poly[0]); for (let i = 1; i < poly.length; i++) pen = pen.lineTo(poly[i]);
            const pl = new R.Plane(add(P.origin, mul(P.normal, -t / 2)), P.xDir, P.normal);
            const slab = (pen.close().sketchOnPlane(pl) as any).extrude(t) as Shape;
            rib = rib ? (rib.fuse(slab) as Shape) : slab;
          }
          return rib!.intersect(box) as Shape;
        };
        let clipped: Shape;
        if (f.flip === undefined) {
          // automatic side: the one that adds less material (the side facing into the corner/enclosure)
          const a = build(false), b = build(true);
          const va = R.measureVolume(a), vb = R.measureVolume(b);
          clipped = va <= vb ? a : b;
        } else clipped = build(!!f.flip);
        s.tools.set(f.id, { tool: clipped, op: 'add' });
        this.applyOp(s, clipped, 'add');
        return;
      }
      case 'extrude': {
        const sk = s.sketches.get(f.sketch);
        if (!sk) throw new Error('Sketch not found');
        if (!sk.drawing) throw new Error('Sketch is empty');
        const P = sk.plane;
        let depth = f.throughAll ? 2000 : ev.eval(f.depth);
        if (depth <= 0) throw new Error('Depth must be > 0');
        const sym = f.symmetric || (f.throughAll && f.op === 'cut' && f.symmetric !== false && false);
        let origin = P.origin;
        let d = f.reverse ? -depth : depth;
        if (f.throughAll && f.op === 'cut') { origin = add(P.origin, mul(P.normal, -1000)); d = 2000; }
        else if (sym) { origin = add(P.origin, mul(P.normal, -depth / 2)); d = depth; }
        const pl = new R.Plane(origin, P.xDir, P.normal);
        let solid: Shape;
        const draftDeg = f.draft ? ev.eval(f.draft) : 0;
        if (draftDeg) {
          const endFactor = 1 - (2 * Math.abs(d) * Math.tan((draftDeg * Math.PI) / 180)) / Math.max(1e-6, minSize(sk.drawing));
          solid = (sk.drawing.sketchOnPlane(pl) as any).extrude(d, { extrusionProfile: { profile: 'linear', endFactor: Math.max(0.05, endFactor) } });
        } else solid = (sk.drawing.sketchOnPlane(pl) as any).extrude(d);
        s.tools.set(f.id, { tool: solid, op: f.op });
        this.applyOp(s, solid, f.op);
        return;
      }
      case 'revolve': {
        const sk = s.sketches.get(f.sketch);
        if (!sk || !sk.drawing) throw new Error('Sketch not found or empty');
        const P = sk.plane;
        const axis = f.axis === 'x' ? P.xDir : P.yDir;
        const ang = ev.eval(f.angle);
        const solid = (sk.drawing.sketchOnPlane(toPlane(R, P)) as any).revolve(axis, { origin: P.origin, angle: ang }) as Shape;
        s.tools.set(f.id, { tool: solid, op: f.op });
        this.applyOp(s, solid, f.op);
        return;
      }
      case 'fillet':
      case 'chamfer': {
        if (!f.edges.length) throw new Error('Select at least one edge');
        const r = ev.eval(f.type === 'fillet' ? f.radius : f.distance);
        if (r <= 0) throw new Error('Size must be > 0');
        let found = 0;
        s.bodies = s.bodies.map((b) => {
          const pts = resolveEdges(R, b, f.edges);
          if (!pts.length) return b;
          found += pts.length;
          const filt = edgeFinder(R, pts.map((p) => ({ p })));
          return (f.type === 'fillet' ? b.fillet(r, filt as any) : b.chamfer(r, filt as any)) as Shape;
        });
        if (!found) throw new Error('Edge references lost — reselect edges');
        if (found < f.edges.length) throw new Error(`${f.edges.length - found} edge reference(s) lost — reselect edges`);
        return;
      }
      case 'shell': {
        let t = ev.eval(f.thickness);
        if (t <= 0) throw new Error('Thickness must be > 0');
        if (!s.bodies.length) throw new Error('No body to shell');
        if (f.outward) t = -t;
        const tryShell = (fn: () => Shape) => {
          try { return fn(); }
          catch { throw new Error(f.outward ? 'Could not shell this body.' : 'Could not shell inward. Rounded edges next to an open face often cause this: move Shell above the Fillet in the tree, or use Outward.'); }
        };
        if (!f.faces.length) { s.bodies = s.bodies.map((b) => tryShell(() => (b as any).shell(t, (x: RT.FaceFinder) => x.atDistance(1e9, [0, 0, 0], 1)))); return; }
        let matched = 0;
        s.bodies = s.bodies.map((b) => {
          const pts = resolveFaces(R, b, f.faces);
          if (!pts.length) return b; matched += pts.length;
          return tryShell(() => b.shell(t, faceFinder(R, pts.map((p) => ({ p }))) as any) as Shape);
        });
        if (!matched) throw new Error('Face references lost — reselect faces');
        return;
      }
      case 'hole': {
        const P = resolvePlane(f.plane, ev);
        if (!f.points.length) throw new Error('Place at least one hole');
        const dia = ev.eval(f.diameter);
        if (dia <= 0) throw new Error('Diameter must be > 0');
        const depth = f.throughAll ? 2000 : ev.eval(f.depth);
        const lift = 0.02;
        const top = add(P.origin, mul(P.normal, lift));
        const pl = new R.Plane(top, P.xDir, P.normal);
        let tool: Shape | null = null;
        for (const [x, y] of f.points) {
          let t = R.drawCircle(dia / 2).translate(x, y).sketchOnPlane(pl).extrude(-(depth + lift)) as Shape;
          if (f.cbore) {
            const cd = ev.eval(f.cbore.d), ch = ev.eval(f.cbore.depth);
            if (cd > dia && ch > 0) t = t.fuse(R.drawCircle(cd / 2).translate(x, y).sketchOnPlane(pl).extrude(-(ch + lift)) as Shape) as Shape;
          }
          tool = tool ? (tool.fuse(t) as Shape) : t;
        }
        s.tools.set(f.id, { tool: tool!, op: 'cut' });
        this.applyOp(s, tool!, 'cut');
        return;
      }
      case 'pattern': {
        const targets = f.features.map((id) => s.tools.get(id)).filter(Boolean) as { tool: Shape; op: Op }[];
        if (!targets.length) throw new Error('Pick features to pattern (extrudes, revolves, holes)');
        const copies: { tool: Shape; op: Op }[] = [];
        if (f.mode === 'linear') {
          const n1 = Math.max(1, Math.round(ev.eval(f.count))), s1 = ev.eval(f.spacing);
          const n2 = f.dir2 ? Math.max(1, Math.round(ev.eval(f.count2 || '1'))) : 1, s2 = f.dir2 ? ev.eval(f.spacing2 || '0') : 0;
          const d1 = AXIS[f.dir], d2 = f.dir2 ? AXIS[f.dir2] : AXIS.x;
          for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
            if (!i && !j) continue;
            const v = add(mul(d1, s1 * i), mul(d2, s2 * j));
            for (const t of targets) copies.push({ tool: t.tool.clone().translate(v) as Shape, op: t.op });
          }
        } else {
          const n = Math.max(1, Math.round(ev.eval(f.count))), total = ev.eval(f.total || '360');
          const step = Math.abs(total - 360) < 1e-6 ? 360 / n : total / Math.max(1, n - 1);
          for (let i = 1; i < n; i++) for (const t of targets) copies.push({ tool: t.tool.clone().rotate(step * i, [0, 0, 0], AXIS[f.axis || 'z']) as Shape, op: t.op });
        }
        const merged = mergeTools(copies);
        for (const m of merged) { this.applyOp(s, m.tool, m.op === 'new' ? 'add' : m.op); }
        if (merged[0]) s.tools.set(f.id, merged[0]);
        return;
      }
      case 'mirror': {
        if (!f.features.length) {
          if (!s.bodies.length) throw new Error('No body to mirror');
          s.bodies = s.bodies.map((b) => b.fuse(b.clone().mirror(f.plane as any) as Shape) as Shape);
          return;
        }
        const targets = f.features.map((id) => s.tools.get(id)).filter(Boolean) as { tool: Shape; op: Op }[];
        if (!targets.length) throw new Error('Pick features to mirror');
        const copies = targets.map((t) => ({ tool: t.tool.clone().mirror(f.plane as any) as Shape, op: t.op }));
        for (const m of mergeTools(copies)) this.applyOp(s, m.tool, m.op === 'new' ? 'add' : m.op);
        return;
      }
    }
  }

  private dowelCut(b: Shape, n: V3, off: number, f: import('../model/types').SplitF, ev: Evaluator): Shape {
    const R = this.R;
    const d = ev.eval(f.dowelD) + ev.eval(f.clearance || '0'), L = ev.eval(f.dowelLen);
    const bb = (b as any).boundingBox.bounds as [V3, V3];
    const axes = [0, 1, 2].filter((i) => Math.abs(n[i]) < 0.5);
    const span = axes.map((i) => bb[1][i] - bb[0][i]);
    const long = span[0] >= span[1] ? 0 : 1;
    const ni = [0, 1, 2].find((i) => Math.abs(n[i]) > 0.5)!;
    const cands: V3[] = [];
    const cnt = Math.max(1, Math.min(6, f.dowels));
    for (let k = 0; k < cnt; k++) {
      const p: V3 = [0, 0, 0];
      p[axes[long]] = bb[0][axes[long]] + (span[long] * (k + 1)) / (cnt + 1);
      p[axes[1 - long]] = (bb[0][axes[1 - long]] + bb[1][axes[1 - long]]) / 2;
      p[ni] = off * (n[ni] >= 0 ? 1 : -1);
      cands.push(p);
    }
    let out = b;
    for (const p of cands) {
      const hole = R.makeCylinder(d / 2, L + 1, add(p, mul(n, -(L / 2 + 0.5))), n) as Shape;
      // only where the hole is fully surrounded by material
      try {
        const v = R.measureVolume(out.intersect(hole) as any), full = Math.PI * (d / 2) ** 2 * (L + 1);
        if (v > full * 0.97) out = out.cut(hole) as Shape;
      } catch { /* skip */ }
    }
    return out;
  }

  private trackOwnership(s: Snapshot, featureId: string) {
    for (const b of s.bodies) {
      for (const fc of b.faces) { const h = fc.hashCode; if (!s.faceOwner.has(h)) s.faceOwner.set(h, featureId); }
      for (const e of b.edges) { const h = e.hashCode; if (!s.edgeOwner.has(h)) s.edgeOwner.set(h, featureId); }
    }
  }

  private output(s: Snapshot, project: Project, ev: Evaluator) {
    const R = this.R;
    const res: Omit<RebuildResult, 'errors' | 'sketches' | 'ms'> = { ok: true, mesh: null, edges: null, faces: [], edgeInfo: [], props: null };
    if (!s.bodies.length) return res;
    const V: number[] = [], N: number[] = [], T: number[] = [];
    const FG: { start: number; count: number; faceId: number }[] = [];
    const L: number[] = []; const EG: { start: number; count: number; edgeId: number }[] = [];
    res.bodies = [];
    for (const [bi, b] of s.bodies.entries()) {
      const cached = this.meshCache.get(b);
      const freeform = cached ? cached.freeform : b.faces.some((x) => !['PLANE', 'CYLINDRE', 'CONE', 'SPHERE', 'TORUS'].includes(String(x.geomType)));
      const q = freeform ? { tolerance: 0.15, angularTolerance: 0.9 } : { tolerance: 0.03, angularTolerance: 0.12 };
      const m = cached ? cached.m : b.mesh(q);
      const e = cached ? cached.e : b.meshEdges(q);
      if (!cached) this.meshCache.set(b, { m, e, freeform });
      const base = V.length / 3, tbase = T.length;
      let bvol = 0, bbb: [V3, V3] = [[0, 0, 0], [0, 0, 0]];
      try { bvol = R.measureVolume(b as any); bbb = (b as any).boundingBox.bounds; } catch { /* */ }
      res.bodies.push({ tri: [tbase / 3, m.triangles.length / 3], volume: bvol, bbox: bbb });
      V.push(...m.vertices); N.push(...m.normals);
      for (const t of m.triangles) T.push(t + base);
      for (const g of m.faceGroups) FG.push({ start: g.start + tbase, count: g.count, faceId: g.faceId });
      const lbase = L.length / 3;
      L.push(...e.lines);
      for (const g of e.edgeGroups) EG.push({ start: g.start + lbase, count: g.count, edgeId: g.edgeId });
      for (const fc of b.faces) {
        const type = String(fc.geomType);
        let normal: V3 | null = null, xDir: V3 | null = null;
        const c = fc.center; const center: V3 = [c.x, c.y, c.z];
        if (type === 'PLANE') {
          const n = fc.normalAt(); normal = norm([n.x, n.y, n.z]);
          const ref: V3 = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
          xDir = norm(cross(ref, normal));
          if (Math.abs(normal[2]) > 0.9) xDir = [1, 0, 0];
          else xDir = norm(cross([0, 0, 1], normal));
        }
        let area = 0; try { area = R.measureArea(fc); } catch { /* ignore */ }
        const cyl = type === 'CYLINDRE' ? cylinderInfo(fc) : undefined;
        res.faces.push({ id: fc.hashCode, owner: s.faceOwner.get(fc.hashCode) ?? null, type, area, center, normal, xDir, cyl, body: bi });
      }
      for (const ed of b.edges) {
        const p = ed.pointAt(0.5);
        let length = 0; try { length = ed.length; } catch { /* ignore */ }
        let tan: V3 = [0, 0, 0]; try { const t = ed.tangentAt(0.5); tan = norm([t.x, t.y, t.z]); } catch { /* ignore */ }
        const q0 = ed.pointAt(0), q1 = ed.pointAt(1), qa = ed.pointAt(0.25);
        res.edgeInfo.push({ id: ed.hashCode, owner: s.edgeOwner.get(ed.hashCode) ?? null, type: String(ed.geomType), length, mid: [p.x, p.y, p.z], tan, pts: [[q0.x, q0.y, q0.z], [qa.x, qa.y, qa.z], [p.x, p.y, p.z], [q1.x, q1.y, q1.z]] });
      }
    }
    res.mesh = { vertices: new Float32Array(V), normals: new Float32Array(N), triangles: new Uint32Array(T), faceGroups: FG };
    res.edges = { lines: new Float32Array(L), edgeGroups: EG };
    try {
      const comp = s.bodies.length === 1 ? s.bodies[0] : (R.makeCompound(s.bodies.map((x) => x.clone())) as any);
      const vp = R.measureShapeVolumeProperties(comp);
      const sp = R.measureShapeSurfaceProperties(comp);
      const bb = comp.boundingBox; const bounds = bb.bounds as [V3, V3];
      const com = vp.centerOfMass as V3;
      res.props = { volume: vp.volume, area: sp.area, com, bbox: bounds };
    } catch { /* props are optional */ }
    void project; void ev;
    return res;
  }

  /** 3MF: one object per body, per-triangle colours from the feature that created each face. */
  export3MFData(bodies: Shape[], colorOf: (faceId: number) => string) {
    const objs: { vertices: Float32Array; triangles: Uint32Array; colors: string[] }[] = [];
    for (const b of bodies) {
      const m = b.mesh({ tolerance: 0.01, angularTolerance: 0.08 });
      const colors: string[] = new Array(m.triangles.length / 3);
      for (const g of m.faceGroups) { const c = colorOf(g.faceId); for (let t = g.start / 3; t < (g.start + g.count) / 3; t++) colors[t] = c; }
      objs.push({ vertices: new Float32Array(m.vertices), triangles: new Uint32Array(m.triangles), colors });
    }
    return objs;
  }
  lastFaceOwner = new Map<number, string>();
  private meshCache = new WeakMap<object, { m: any; e: any; freeform: boolean }>();

  exportSTEP(bodies: Shape[]): Blob {
    const comp = bodies.length === 1 ? bodies[0] : (this.R.makeCompound(bodies.map((x) => x.clone())) as any);
    return comp.blobSTEP();
  }
  exportSTL(bodies: Shape[], fine = true): Blob {
    const comp = bodies.length === 1 ? bodies[0] : (this.R.makeCompound(bodies.map((x) => x.clone())) as any);
    return comp.blobSTL({ binary: true, tolerance: fine ? 0.01 : 0.05, angularTolerance: fine ? 0.08 : 0.2 });
  }
}

/** Axis, radius and extent of a cylindrical face (OCCT: u = angle, v = height; params normalised 0..1). */
function cylinderInfo(fc: any): { base: V3; dir: V3; r: number; len: number; internal: boolean } | undefined {
  try {
    const p = [0, 1 / 3, 2 / 3].map((u) => fc.pointOnSurface(u, 0)).map((v: any) => [v.x, v.y, v.z] as V3);
    const q = fc.pointOnSurface(0, 1); const top: V3 = [q.x, q.y, q.z];
    const c = circum3(p[0], p[1], p[2]); if (!c) return undefined;
    let dir = norm(sub(top, p[0])); const len = vlen(sub(top, p[0]));
    const r = vlen(sub(p[0], c));
    const nn = fc.normalAt(p[0] as any); const n: V3 = [nn.x, nn.y, nn.z];
    const internal = dot(n, sub(p[0], c)) < 0;
    let base = c;
    // canonical orientation: the dominant axis component points positive (helix sweeps are reliable that way)
    const k = [0, 1, 2].reduce((a, i) => (Math.abs(dir[i]) > Math.abs(dir[a]) ? i : a), 0);
    if (dir[k] < 0) { base = add(base, mul(dir, len)); dir = mul(dir, -1); }
    return { base, dir, r, len, internal };
  } catch { return undefined; }
}
function cylAxisPoint(fc: any): V3 { const c = fc.center; return [c.x, c.y, c.z]; }
function onFace(R: R, fc: any, p: V3) { try { return new R.FaceFinder().atDistance(0, p, 0.3).find(fc.clone()).length > 0; } catch { return false; } }
function circum3(a: V3, b: V3, c: V3): V3 | null {
  const ab = sub(b, a), ac = sub(c, a); const n = cross(ab, ac); const n2 = dot(n, n); if (n2 < 1e-12) return null;
  const t = add(mul(cross(n, ab), dot(ac, ac)), mul(cross(ac, n), dot(ab, ab)));
  return add(a, mul(t, 1 / (2 * n2)));
}

function perp(n: V3): V3 { return norm(Math.abs(n[2]) < 0.9 ? cross([0, 0, 1], n) : cross(n, [0, 1, 0])); }

function segsDrawing(R: R, segs: Seg[]): RT.Drawing {
  if (segs.length === 1 && segs[0].kind === 'circle') return R.drawCircle(segs[0].r).translate(segs[0].c[0], segs[0].c[1]);
  let pen = R.draw(segs[0].from);
  for (const sg of segs) {
    if (sg.kind === 'line') pen = pen.lineTo(sg.to);
    else if (sg.kind === 'arc') { const pts = sampleSeg(sg, 8); pen = pen.threePointsArcTo(sg.to, pts[4]); }
    else if (sg.kind === 'spline') { for (const b of splineBeziers(sg.pts)) pen = pen.cubicBezierCurveTo(b.end, b.c1, b.c2); }
  }
  return pen.close();
}
function insidePoly(pt: P2, poly: P2[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** Fuse regions; a region lying inside a larger, non-adjacent region becomes a hole (alternating for islands). */
function regionsDrawing(R: R, faces: Seg[][]): RT.Drawing | null {
  const items = faces.map((f) => {
    const poly = facePolygon(f);
    const a = poly[0], b = poly[1] || poly[0];
    const probe: P2 = [(a[0] + b[0]) / 2 - (b[1] - a[1]) * 1e-4, (a[1] + b[1]) / 2 + (b[0] - a[0]) * 1e-4];
    return { f, poly, area: Math.abs(faceArea(f)), probe, srcs: new Set(f.map((s) => s.src)) };
  }).sort((x, y) => y.area - x.area);
  let out: RT.Drawing | null = null;
  const placed: typeof items = [];
  for (const it of items) {
    const depth = placed.filter((p) => ![...it.srcs].some((s) => p.srcs.has(s)) && insidePoly(it.probe, p.poly)).length;
    const d = segsDrawing(R, it.f);
    out = !out ? d : depth % 2 ? out.cut(d) : out.fuse(d);
    placed.push(it);
  }
  return out;
}
function to3D(P: PlaneData, p: P2): V3 { return add(add(P.origin, mul(P.xDir, p[0])), mul(P.yDir, p[1])); }
/** An open chain as a 3D wire (sweep path). */
function chainWire(R: R, chain: Seg[], P: PlaneData): any {
  const edges: any[] = [];
  for (const sg of chain) {
    if (sg.kind === 'line') edges.push(R.makeLine(to3D(P, sg.from), to3D(P, sg.to)));
    else if (sg.kind === 'arc') { const m = sampleSeg(sg, 8)[4]; edges.push(R.makeThreePointArc(to3D(P, sg.from), to3D(P, m), to3D(P, sg.to))); }
    else if (sg.kind === 'spline') {
      let prev = sg.pts[0];
      for (const b of splineBeziers(sg.pts)) { edges.push(R.makeBezierCurve([to3D(P, prev), to3D(P, b.c1), to3D(P, b.c2), to3D(P, b.end)])); prev = b.end; }
    }
  }
  return R.assembleWire(edges);
}
/** Closed wires of a sketch drawing placed in 3D (outer first). */
function drawingWires(R: R, d: RT.Drawing, P: PlaneData): any[] {
  const sk: any = d.sketchOnPlane(new R.Plane(P.origin, P.xDir, P.normal));
  const list = sk.sketches ? sk.sketches : [sk];
  const wires: any[] = [];
  for (const one of list) { if (one.wire) wires.push(one.wire); }
  return wires;
}

function mergeTools(list: { tool: Shape; op: Op }[]) {
  const byOp = new Map<Op, Shape>();
  for (const t of list) { const cur = byOp.get(t.op); byOp.set(t.op, cur ? (cur.fuse(t.tool) as Shape) : t.tool); }
  return [...byOp].map(([op, tool]) => ({ op, tool }));
}

function minSize(d: RT.Drawing) {
  const b = d.boundingBox; return Math.min(b.width, b.height);
}

function cleanErr(e: any): string {
  const m = (e && (e.message || String(e))) || 'Failed';
  if (/^\d+$/.test(m) || /WebAssembly\.Exception/.test(m)) return 'The kernel could not build this feature. Check for zero-thickness or touching geometry, or try a smaller size.';
  return m.length > 160 ? m.slice(0, 160) + '…' : m;
}

export { dot, sub, cross, norm, add, mul };
