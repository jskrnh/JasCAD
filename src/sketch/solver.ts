// Bridge between jasCAD sketch geometry and the FreeCAD PlaneGCS solver (WebAssembly).
import { init_planegcs_module, GcsWrapper } from '@salusoft89/planegcs';
import type { SketchGeo, SkCurve, SkConstraint } from '../model/types';
import { ORIGIN_ID } from '../model/types';
import { Evaluator } from '../model/expr';

let modP: Promise<any> | null = null;
export function initSolver(locateFile?: () => string): Promise<any> {
  if (!modP) modP = init_planegcs_module(locateFile ? { locateFile } : undefined);
  return modP!;
}

export interface SolveResult { geo: SketchGeo; dof: number; status: 'ok' | 'conflict' | 'redundant' | 'failed'; conflicting: string[]; redundant: string[] }

const DEG = Math.PI / 180;

export function arcRadius(geo: SketchGeo, c: Extract<SkCurve, { kind: 'arc' }>) {
  const P = new Map(geo.points.map((p) => [p.id, p]));
  const cc = P.get(c.c)!, a = P.get(c.a)!;
  return Math.hypot(a.x - cc.x, a.y - cc.y);
}

/** Translate geometry + constraints into PlaneGCS primitives. */
function primitives(geo: SketchGeo, ev: Evaluator, owner: Map<string, string>, drag?: { id: string; x: number; y: number }) {
  const out: any[] = [];
  const P = new Map(geo.points.map((p) => [p.id, p]));
  const C = new Map(geo.curves.map((c) => [c.id, c]));
  const fixed = new Set<string>([ORIGIN_ID]);
  for (const k of geo.constraints) if (k.type === 'fix') for (const r of k.refs) {
    if (P.has(r)) fixed.add(r);
    const c = C.get(r); if (c) for (const id of curvePoints(c)) fixed.add(id);
  }
  if (!P.has(ORIGIN_ID)) out.push({ id: ORIGIN_ID, type: 'point', x: 0, y: 0, fixed: true });
  for (const p of geo.points) out.push({ id: p.id, type: 'point', x: p.x, y: p.y, fixed: fixed.has(p.id) });
  for (const c of geo.curves) {
    if (c.kind === 'line') out.push({ id: c.id, type: 'line', p1_id: c.a, p2_id: c.b });
    else if (c.kind === 'circle') out.push({ id: c.id, type: 'circle', c_id: c.c, radius: c.r });
    else if (c.kind === 'arc') {
      const cc = P.get(c.c)!, a = P.get(c.a)!, b = P.get(c.b)!;
      let sa = Math.atan2(a.y - cc.y, a.x - cc.x), ea = Math.atan2(b.y - cc.y, b.x - cc.x);
      if (ea <= sa) ea += Math.PI * 2;
      out.push({ id: c.id, type: 'arc', c_id: c.c, radius: arcRadius(geo, c) || 1, start_angle: sa, end_angle: ea, start_id: c.a, end_id: c.b });
      out.push({ id: c.id + '#r', type: 'arc_rules', a_id: c.id });
    }
  }
  const kind = (id: string) => (P.has(id) || id === ORIGIN_ID ? 'point' : C.get(id)?.kind);
  let n = 0; let curK = '';
  const add = (o: any) => { const id = `k${n++}`; owner.set(id, curK); out.push({ id, ...o }); };
  for (const k of geo.constraints) {
    curK = k.id;
    const [r0, r1, r2] = k.refs; const k0 = kind(r0), k1 = r1 ? kind(r1) : undefined;
    const val = () => ev.eval(k.value ?? '0');
    const line = (id: string) => C.get(id) as Extract<SkCurve, { kind: 'line' }>;
    const radial = (id: string) => C.get(id) as any;
    try {
      switch (k.type) {
        case 'coincident': add({ type: 'p2p_coincident', p1_id: r0, p2_id: r1 }); break;
        case 'pointOnCurve': {
          const [p, c] = k0 === 'point' ? [r0, r1] : [r1, r0]; const ck = kind(c);
          if (ck === 'line') add({ type: 'point_on_line_pl', p_id: p, l_id: c });
          else if (ck === 'circle') add({ type: 'point_on_circle', p_id: p, c_id: c });
          else if (ck === 'arc') add({ type: 'point_on_arc', p_id: p, a_id: c });
          break;
        }
        case 'horizontal': if (k0 === 'line') add({ type: 'horizontal_l', l_id: r0 }); else add({ type: 'horizontal_pp', p1_id: r0, p2_id: r1 }); break;
        case 'vertical': if (k0 === 'line') add({ type: 'vertical_l', l_id: r0 }); else add({ type: 'vertical_pp', p1_id: r0, p2_id: r1 }); break;
        case 'parallel': add({ type: 'parallel', l1_id: r0, l2_id: r1 }); break;
        case 'perpendicular': add({ type: 'perpendicular_ll', l1_id: r0, l2_id: r1 }); break;
        case 'tangent': {
          const pair = [k0, k1].sort().join('-');
          // endpoint-to-endpoint tangency (FreeCAD style) avoids redundant equations when the curves share a point
          const shared = sharedEnd(C.get(r0), C.get(r1));
          if (shared && (pair === 'arc-line' || pair === 'arc-arc')) {
            const ang = tangentAngle(P, C.get(r0)!, C.get(r1)!, shared);
            add({ type: 'angle_via_point', crv1_id: r0, crv2_id: r1, p_id: shared, angle: ang });
            break;
          }
          const [lineId, otherId] = k0 === 'line' ? [r0, r1] : [r1, r0];
          if (pair === 'arc-line') add({ type: 'tangent_la', l_id: lineId, a_id: otherId });
          else if (pair === 'circle-line') add({ type: 'tangent_lc', l_id: lineId, c_id: otherId });
          else if (pair === 'arc-arc') add({ type: 'tangent_aa', a1_id: r0, a2_id: r1 });
          else if (pair === 'circle-circle') add({ type: 'tangent_cc', c1_id: r0, c2_id: r1 });
          else if (pair === 'arc-circle') add({ type: 'tangent_ca', c_id: k0 === 'circle' ? r0 : r1, a_id: k0 === 'arc' ? r0 : r1 });
          break;
        }
        case 'equal': {
          const pair = [k0, k1].sort().join('-');
          if (pair === 'line-line') add({ type: 'equal_length', l1_id: r0, l2_id: r1 });
          else if (pair === 'circle-circle') add({ type: 'equal_radius_cc', c1_id: r0, c2_id: r1 });
          else if (pair === 'arc-arc') add({ type: 'equal_radius_aa', a1_id: r0, a2_id: r1 });
          else if (pair === 'arc-circle') add({ type: 'equal_radius_ca', c1_id: k0 === 'circle' ? r0 : r1, a2_id: k0 === 'arc' ? r0 : r1 });
          break;
        }
        case 'concentric': add({ type: 'p2p_coincident', p1_id: radial(r0).c, p2_id: radial(r1).c }); break;
        case 'midpoint': { const [p, l] = k0 === 'point' ? [r0, r1] : [r1, r0]; const L = line(l); add({ type: 'p2p_symmetric_ppp', p1_id: L.a, p2_id: L.b, p_id: p }); break; }
        case 'symmetric': add({ type: 'p2p_symmetric_ppl', p1_id: r0, p2_id: r1, l_id: r2 }); break;
        case 'collinear': { const L2 = line(r1); add({ type: 'point_on_line_pl', p_id: L2.a, l_id: r0 }); add({ type: 'point_on_line_pl', p_id: L2.b, l_id: r0 }); break; }
        case 'fix': break;
        case 'distance': {
          if (k0 === 'line' && !r1) { const L = line(r0); add({ type: 'p2p_distance', p1_id: L.a, p2_id: L.b, distance: val() }); }
          else if (k0 === 'point' && k1 === 'point') add({ type: 'p2p_distance', p1_id: r0, p2_id: r1, distance: val() });
          else if (k0 === 'point' && k1 === 'line') add({ type: 'p2l_distance', p_id: r0, l_id: r1, distance: val() });
          else if (k0 === 'line' && k1 === 'point') add({ type: 'p2l_distance', p_id: r1, l_id: r0, distance: val() });
          else if (k0 === 'line' && k1 === 'line') { const L2 = line(r1); add({ type: 'p2l_distance', p_id: L2.a, l_id: r0, distance: val() }); }
          break;
        }
        case 'hdistance': case 'vdistance': {
          let [a, b] = [r0, r1];
          if (k0 === 'line' && !r1) { const L = line(r0); a = L.a; b = L.b; }
          const prop = k.type === 'hdistance' ? 'x' : 'y';
          const pa = P.get(a) || { x: 0, y: 0 }, pb = P.get(b) || { x: 0, y: 0 };
          const sign = (pb as any)[prop] >= (pa as any)[prop] ? 1 : -1;
          add({ type: 'difference', param1: { o_id: a, prop }, param2: { o_id: b, prop }, difference: sign * val() });
          break;
        }
        case 'radius': case 'diameter': {
          const r = k.type === 'radius' ? val() : val() / 2;
          if (k0 === 'circle') add({ type: 'circle_radius', c_id: r0, radius: r }); else add({ type: 'arc_radius', a_id: r0, radius: r });
          break;
        }
        case 'angle': add({ type: 'l2l_angle_ll', l1_id: r0, l2_id: r1, angle: val() * DEG }); break;
      }
    } catch { /* skip constraint with bad refs */ }
  }
  if (drag) { add({ type: 'coordinate_x', p_id: drag.id, x: drag.x, temporary: true }); add({ type: 'coordinate_y', p_id: drag.id, y: drag.y, temporary: true }); }
  return out;
}

function sharedEnd(a?: SkCurve, b?: SkCurve): string | null {
  if (!a || !b) return null;
  const ends = (c: SkCurve) => (c.kind === 'line' || c.kind === 'arc' ? [c.a, c.b] : c.kind === 'spline' ? [c.pts[0], c.pts[c.pts.length - 1]] : []);
  const eb = ends(b); return ends(a).find((p) => eb.includes(p)) || null;
}
function tangentDir(P: Map<string, { x: number; y: number }>, c: SkCurve, pid: string): [number, number] {
  if (c.kind === 'line') { const a = P.get(c.a)!, b = P.get(c.b)!; return [b.x - a.x, b.y - a.y]; }
  if (c.kind === 'arc') { const cc = P.get(c.c)!, p = P.get(pid)!; return [-(p.y - cc.y), p.x - cc.x]; } // ccw tangent
  return [1, 0];
}
/** 0 or π: whichever matches the current orientation of the two tangents at the shared point. */
function tangentAngle(P: Map<string, { x: number; y: number }>, a: SkCurve, b: SkCurve, pid: string) {
  const t1 = tangentDir(P, a, pid), t2 = tangentDir(P, b, pid);
  return t1[0] * t2[0] + t1[1] * t2[1] >= 0 ? 0 : Math.PI;
}

export function curvePoints(c: SkCurve): string[] {
  return c.kind === 'line' ? [c.a, c.b] : c.kind === 'circle' ? [c.c] : c.kind === 'arc' ? [c.c, c.a, c.b] : c.pts;
}

/** Solve the sketch. Returns a new geo with updated coordinates (input is not modified). */
export function solve(mod: any, geo: SketchGeo, vars: Record<string, string>, drag?: { id: string; x: number; y: number }): SolveResult {
  const ev = new Evaluator(vars);
  const out: SketchGeo = JSON.parse(JSON.stringify(geo));
  if (!geo.points.length) return { geo: out, dof: 0, status: 'ok', conflicting: [], redundant: [] };
  const w = new GcsWrapper(new mod.GcsSystem());
  try {
    const owner = new Map<string, string>();
    w.push_primitives_and_params(primitives(geo, ev, owner, drag));
    const st = w.solve();
    w.apply_solution();
    const res = new Map<string, any>(w.sketch_index.get_primitives().map((p: any) => [p.id, p]));
    for (const p of out.points) { const r = res.get(p.id); if (r && isFinite(r.x) && isFinite(r.y)) { p.x = r.x; p.y = r.y; } }
    for (const c of out.curves) if (c.kind === 'circle') { const r = res.get(c.id); if (r && isFinite(r.radius)) c.r = Math.abs(r.radius); }
    const mapIds = (ids: string[]) => [...new Set(ids.map((i) => owner.get(i)).filter((x): x is string => !!x))];
    const conflicting = mapIds(w.get_gcs_conflicting_constraints()), redundant = mapIds(w.get_gcs_redundant_constraints());
    const dof = (w.gcs as any).dof?.() ?? 0;
    const status = conflicting.length ? 'conflict' : redundant.length ? 'redundant' : st === 0 ? 'ok' : 'failed';
    return { geo: out, dof, status, conflicting, redundant };
  } finally {
    try { w.destroy_gcs_module(); } catch { /* ignore */ }
  }
}

export type { SkConstraint };
