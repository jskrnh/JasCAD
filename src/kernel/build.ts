// Feature-tree evaluation on top of the OpenCASCADE kernel (via replicad).
// Pure module: used by the web worker in the app and directly by the Node test suite.
import type * as RT from 'replicad';
import { Evaluator } from '../model/expr';
import type {
  Project, Feature, PlaneRef, SketchEntity, RebuildResult, FaceInfo, EdgeInfo, SketchDisplay, V3, Op, EdgeRef, FaceRef,
} from '../model/types';

type R = typeof RT;
type Shape = RT.Shape3D;

interface PlaneData { origin: V3; xDir: V3; normal: V3; yDir: V3 }
interface Snapshot {
  key: string;
  bodies: Shape[];
  tools: Map<string, { tool: Shape; op: Op }>;
  sketches: Map<string, { drawing: RT.Drawing | null; plane: PlaneData }>;
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
  constructor(private R: R) {}

  private emptySnap(): Snapshot {
    return { key: 'root', bodies: [], tools: new Map(), sketches: new Map(), faceOwner: new Map(), edgeOwner: new Map() };
  }

  /** Evaluate the tree. Re-uses cached results up to the first changed feature. */
  rebuild(project: Project): RebuildResult & { bodies: Shape[] } {
    const t0 = Date.now();
    const R = this.R;
    const ev = new Evaluator(project.variables);
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
    const out = this.output(snap, project, ev);
    return { ...out, errors, sketches: sketchesOut, ms: Date.now() - t0, bodies: snap.bodies };
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
    out.push({ featureId: f.id, lines, origin: P.origin, xDir: P.xDir, normal: P.normal });
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
      case 'sketch': {
        const plane = resolvePlane(f.plane, ev);
        const drawing = f.entities.length ? sketchDrawing(R, f.entities, ev) : null;
        s.sketches.set(f.id, { drawing, plane });
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
    for (const b of s.bodies) {
      const m = b.mesh({ tolerance: 0.03, angularTolerance: 0.12 });
      const base = V.length / 3, tbase = T.length;
      V.push(...m.vertices); N.push(...m.normals);
      for (const t of m.triangles) T.push(t + base);
      for (const g of m.faceGroups) FG.push({ start: g.start + tbase, count: g.count, faceId: g.faceId });
      const e = b.meshEdges({ tolerance: 0.03, angularTolerance: 0.12 });
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
        res.faces.push({ id: fc.hashCode, owner: s.faceOwner.get(fc.hashCode) ?? null, type, area, center, normal, xDir });
      }
      for (const ed of b.edges) {
        const p = ed.pointAt(0.5);
        let length = 0; try { length = ed.length; } catch { /* ignore */ }
        let tan: V3 = [0, 0, 0]; try { const t = ed.tangentAt(0.5); tan = norm([t.x, t.y, t.z]); } catch { /* ignore */ }
        res.edgeInfo.push({ id: ed.hashCode, owner: s.edgeOwner.get(ed.hashCode) ?? null, type: String(ed.geomType), length, mid: [p.x, p.y, p.z], tan });
      }
    }
    res.mesh = { vertices: new Float32Array(V), normals: new Float32Array(N), triangles: new Uint32Array(T), faceGroups: FG };
    res.edges = { lines: new Float32Array(L), edgeGroups: EG };
    try {
      const comp = s.bodies.length === 1 ? s.bodies[0] : (R.makeCompound(s.bodies) as any);
      const vp = R.measureShapeVolumeProperties(comp);
      const sp = R.measureShapeSurfaceProperties(comp);
      const bb = comp.boundingBox; const bounds = bb.bounds as [V3, V3];
      const com = vp.centerOfMass as V3;
      res.props = { volume: vp.volume, area: sp.area, com, bbox: bounds };
    } catch { /* props are optional */ }
    void project; void ev;
    return res;
  }

  exportSTEP(bodies: Shape[]): Blob {
    const comp = bodies.length === 1 ? bodies[0] : (this.R.makeCompound(bodies) as any);
    return comp.blobSTEP();
  }
  exportSTL(bodies: Shape[], fine = true): Blob {
    const comp = bodies.length === 1 ? bodies[0] : (this.R.makeCompound(bodies) as any);
    return comp.blobSTL({ binary: true, tolerance: fine ? 0.01 : 0.05, angularTolerance: fine ? 0.08 : 0.2 });
  }
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
