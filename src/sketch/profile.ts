// Turns solved sketch geometry into closed regions (for extrude/revolve/loft) and open chains (sweep paths, ribs).
import type { SketchGeo, SkCurve } from '../model/types';
import { ORIGIN_ID } from '../model/types';

export type P2 = [number, number];
export type Seg =
  | { kind: 'line'; from: P2; to: P2; src: string }
  | { kind: 'arc'; from: P2; to: P2; c: P2; r: number; ccw: boolean; src: string }
  | { kind: 'spline'; from: P2; to: P2; pts: P2[]; src: string }
  | { kind: 'circle'; from: P2; to: P2; c: P2; r: number; src: string };

export interface Regions { faces: Seg[][]; chains: Seg[][] }

const TAU = Math.PI * 2;

export function pointMap(geo: SketchGeo) {
  const m = new Map<string, P2>(geo.points.map((p) => [p.id, [p.x, p.y] as P2]));
  if (!m.has(ORIGIN_ID)) m.set(ORIGIN_ID, [0, 0]);
  return m;
}

/** Catmull-Rom → cubic Bézier control points for a spline through pts. */
export function splineBeziers(pts: P2[]): { end: P2; c1: P2; c2: P2 }[] {
  const out: { end: P2; c1: P2; c2: P2 }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    out.push({ c1: [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2: [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], end: p2 });
  }
  return out;
}

/** Polyline approximation of a segment (for display, picking, direction tests). */
export function sampleSeg(s: Seg, n = 32): P2[] {
  if (s.kind === 'line') return [s.from, s.to];
  if (s.kind === 'circle') return Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * TAU; return [s.c[0] + s.r * Math.cos(a), s.c[1] + s.r * Math.sin(a)] as P2; });
  if (s.kind === 'arc') {
    let a0 = Math.atan2(s.from[1] - s.c[1], s.from[0] - s.c[0]), a1 = Math.atan2(s.to[1] - s.c[1], s.to[0] - s.c[0]);
    if (s.ccw) { while (a1 <= a0) a1 += TAU; } else { while (a1 >= a0) a1 -= TAU; }
    return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [s.c[0] + s.r * Math.cos(a), s.c[1] + s.r * Math.sin(a)] as P2; });
  }
  const out: P2[] = [s.pts[0]];
  const bz = splineBeziers(s.pts); let prev = s.pts[0];
  for (const b of bz) {
    for (let k = 1; k <= 8; k++) {
      const t = k / 8, u = 1 - t;
      out.push([u * u * u * prev[0] + 3 * u * u * t * b.c1[0] + 3 * u * t * t * b.c2[0] + t * t * t * b.end[0], u * u * u * prev[1] + 3 * u * u * t * b.c1[1] + 3 * u * t * t * b.c2[1] + t * t * t * b.end[1]]);
    }
    prev = b.end;
  }
  return out;
}

export function reverseSeg(s: Seg): Seg {
  if (s.kind === 'line') return { ...s, from: s.to, to: s.from };
  if (s.kind === 'arc') return { ...s, from: s.to, to: s.from, ccw: !s.ccw };
  if (s.kind === 'spline') return { ...s, from: s.to, to: s.from, pts: [...s.pts].reverse() };
  return s;
}

/** Oriented segments for all (non-construction) curves. */
export function curveSegs(geo: SketchGeo, includeConstruction = false): Seg[] {
  const P = pointMap(geo); const out: Seg[] = [];
  for (const c of geo.curves) {
    if (c.cons && !includeConstruction) continue;
    const seg = curveSeg(c, P); if (seg) out.push(seg);
  }
  return out;
}
export function curveSeg(c: SkCurve, P: Map<string, P2>): Seg | null {
  if (c.kind === 'line') { const a = P.get(c.a), b = P.get(c.b); return a && b ? { kind: 'line', from: a, to: b, src: c.id } : null; }
  if (c.kind === 'circle') { const cc = P.get(c.c); return cc ? { kind: 'circle', from: [cc[0] + c.r, cc[1]], to: [cc[0] + c.r, cc[1]], c: cc, r: c.r, src: c.id } : null; }
  if (c.kind === 'arc') {
    const cc = P.get(c.c), a = P.get(c.a), b = P.get(c.b); if (!cc || !a || !b) return null;
    return { kind: 'arc', from: a, to: b, c: cc, r: Math.hypot(a[0] - cc[0], a[1] - cc[1]), ccw: true, src: c.id };
  }
  const pts = c.pts.map((id) => P.get(id)).filter(Boolean) as P2[];
  return pts.length >= 2 ? { kind: 'spline', from: pts[0], to: pts[pts.length - 1], pts, src: c.id } : null;
}

const area = (poly: P2[]) => { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

/**
 * Find bounded faces (closed regions) and open chains.
 * Uses planar-graph face traversal so lines that split a loop produce separate regions.
 */
export function findRegions(geo: SketchGeo): Regions {
  const segs = curveSegs(geo);
  const faces: Seg[][] = []; const chains: Seg[][] = [];
  // circles are faces on their own
  for (const s of segs) if (s.kind === 'circle') faces.push([s]);
  const ed = segs.filter((s) => s.kind !== 'circle');
  // node merging
  const scale = Math.max(1, ...ed.flatMap((s) => [Math.abs(s.from[0]), Math.abs(s.from[1]), Math.abs(s.to[0]), Math.abs(s.to[1])]));
  const tol = 1e-6 * scale;
  const nodes: P2[] = [];
  const nodeOf = (p: P2) => { let i = nodes.findIndex((q) => Math.abs(q[0] - p[0]) < tol && Math.abs(q[1] - p[1]) < tol); if (i < 0) { nodes.push(p); i = nodes.length - 1; } return i; };
  type HE = { seg: Seg; from: number; to: number; ang: number; used: boolean; twin: number };
  const hes: HE[] = [];
  for (const s of ed) {
    const a = nodeOf(s.from), b = nodeOf(s.to);
    if (a === b) { faces.push([s]); continue; } // closed spline
    const fwd = sampleSeg(s, 16), rev = [...fwd].reverse();
    const dirA = Math.atan2(fwd[1][1] - fwd[0][1], fwd[1][0] - fwd[0][0]);
    const dirB = Math.atan2(rev[1][1] - rev[0][1], rev[1][0] - rev[0][0]);
    const i = hes.length;
    hes.push({ seg: s, from: a, to: b, ang: dirA, used: false, twin: i + 1 });
    hes.push({ seg: reverseSeg(s), from: b, to: a, ang: dirB, used: false, twin: i });
  }
  const out = new Map<number, number[]>();
  hes.forEach((h, i) => { if (!out.has(h.from)) out.set(h.from, []); out.get(h.from)!.push(i); });
  for (const list of out.values()) list.sort((x, y) => hes[x].ang - hes[y].ang);
  // degree-1 pruning: edges that belong to dangling trees are chains, not faces
  const deg = new Map<number, number>(); for (const h of hes) deg.set(h.from, (deg.get(h.from) || 0) + 1);
  const alive = new Set(hes.map((_, i) => i));
  let changed = true;
  while (changed) {
    changed = false;
    for (const i of [...alive]) {
      const h = hes[i];
      if ((deg.get(h.from) || 0) === 1 || (deg.get(h.to) || 0) === 1) {
        alive.delete(i); alive.delete(h.twin);
        deg.set(h.from, (deg.get(h.from) || 0) - 1); deg.set(h.to, (deg.get(h.to) || 0) - 1);
        changed = true;
      }
    }
  }
  // faces: next half-edge = the one turning most clockwise at the arrival node
  for (const start of alive) {
    if (hes[start].used) continue;
    const loop: number[] = []; let cur = start; let guard = 0;
    while (!hes[cur].used && guard++ < 10000) {
      hes[cur].used = true; loop.push(cur);
      const h = hes[cur]; const list = (out.get(h.to) || []).filter((j) => alive.has(j));
      const back = hes[h.twin].ang;
      // pick the outgoing edge with the smallest counter-clockwise angle after 'back' (i.e. rightmost turn)
      let best = -1, bestD = Infinity;
      for (const j of list) { if (j === h.twin && list.length > 1) continue; let d = hes[j].ang - back; while (d <= 1e-12) d += TAU; if (TAU - d < bestD) { bestD = TAU - d; best = j; } }
      if (best < 0) break; cur = best;
    }
    if (cur !== start) continue;
    const poly = loop.flatMap((i) => sampleSeg(hes[i].seg, 12).slice(0, -1));
    if (area(poly) > 1e-9) faces.push(loop.map((i) => hes[i].seg));
  }
  // open chains: walk unused-by-faces edges among non-alive half-edges
  const chainUsed = new Set<number>();
  for (let i = 0; i < hes.length; i += 2) {
    if (alive.has(i) || chainUsed.has(i)) continue;
    // walk backward to a chain start
    const comp: number[] = [i]; chainUsed.add(i); chainUsed.add(i + 1);
    const extend = (fromNode: number, atEnd: boolean) => {
      let node = fromNode;
      for (;;) {
        const next = hes.findIndex((h, j) => j % 2 === 0 && !alive.has(j) && !chainUsed.has(j) && (h.from === node || h.to === node));
        if (next < 0) break;
        chainUsed.add(next); chainUsed.add(next + 1);
        const h = hes[next]; const forward = h.from === node;
        const idx = atEnd ? (forward ? next : next + 1) : (forward ? next + 1 : next);
        if (atEnd) comp.push(idx); else comp.unshift(idx);
        node = forward ? h.to : h.from;
      }
    };
    extend(hes[i].to, true); extend(hes[i].from, false);
    chains.push(comp.map((j) => hes[j].seg));
  }
  return { faces, chains };
}

/** Signed area of a face (positive = counter-clockwise). */
export function faceArea(f: Seg[]) { return area(f.flatMap((s) => sampleSeg(s, 16).slice(0, -1))); }
export function facePolygon(f: Seg[], n = 16) { return f.flatMap((s) => sampleSeg(s, n).slice(0, -1)); }
