import opencascade from 'replicad-opencascadejs';
import * as R from 'replicad';
import { init_planegcs_module } from '@salusoft89/planegcs';
import { Builder } from '../src/kernel/build';
import { newProject } from '../src/model/types';
const oc = await (opencascade as any)({ locateFile: () => process.cwd() + '/node_modules/replicad-opencascadejs/dist/replicad_single.wasm' });
R.setOC(oc);
const gcs = await init_planegcs_module();
const B = () => new Builder(R, gcs);
const P = (id: string, x: number, y: number) => ({ id, x, y });
const L = (id: string, a: string, b: string) => ({ id, kind: 'line' as const, a, b });
const rectGeo = (w: string, h: string) => ({
  points: [P('a', 1, 1), P('b', 9, 2), P('c', 8, 6), P('d', 0, 5)],
  curves: [L('l1', 'a', 'b'), L('l2', 'b', 'c'), L('l3', 'c', 'd'), L('l4', 'd', 'a')],
  constraints: [
    { id: 'k1', type: 'coincident', refs: ['a', 'O'] }, { id: 'k2', type: 'horizontal', refs: ['l1'] }, { id: 'k3', type: 'vertical', refs: ['l2'] },
    { id: 'k4', type: 'horizontal', refs: ['l3'] }, { id: 'k5', type: 'vertical', refs: ['l4'] },
    { id: 'k6', type: 'distance', refs: ['l1'], value: w }, { id: 'k7', type: 'distance', refs: ['l2'], value: h },
  ],
});
const check = (name: string, p: any) => { const r = B().rebuild(p); console.log(name.padEnd(26), r.errors.length ? 'ERR ' + r.errors.map((e: any) => e.featureId + ': ' + e.message).join('; ') : 'ok', 'vol', r.props?.volume.toFixed(1), 'dof', r.sketches.map((s: any) => s.dof).join(',')); return r; };

// 1. constrained rectangle driven by a variable
let p: any = newProject(); p.variables = { w: '30', h: '20' };
p.features = [{ id: 's1', type: 'sketch', name: 'S', plane: { kind: 'XY' }, entities: [], geo: rectGeo('w', 'h') }, { id: 'e1', type: 'extrude', name: 'E', sketch: 's1', depth: '5', op: 'add' }];
check('rect 30x20x5 (=3000)', p);
p.variables.w = '50'; check('rect w=50 (=5000)', p);

// 2. sweep: circle profile on YZ plane, path on XZ plane (line + arc)
p = newProject();
p.features = [
  { id: 'pr', type: 'sketch', name: 'Prof', plane: { kind: 'YZ' }, entities: [], geo: { points: [P('c', 0, 0)], curves: [{ id: 'ci', kind: 'circle', c: 'c', r: 2 }], constraints: [{ id: 'q', type: 'coincident', refs: ['c', 'O'] }] } },
  { id: 'pa', type: 'sketch', name: 'Path', plane: { kind: 'XZ' }, entities: [], geo: { points: [P('o', 0, 0), P('m', 20, 0), P('ac', 20, 10), P('e', 30, 10)], curves: [L('pl', 'o', 'm'), { id: 'pc', kind: 'arc', c: 'ac', a: 'm', b: 'e' }], constraints: [{ id: 'q', type: 'coincident', refs: ['o', 'O'] }] } },
  { id: 'sw', type: 'sweep', name: 'Sweep', profile: 'pr', path: 'pa', op: 'add' },
];
check('sweep tube', p);

// 3. loft square -> circle
p = newProject();
p.features = [
  { id: 'a', type: 'sketch', name: 'A', plane: { kind: 'XY' }, entities: [{ id: 'r', kind: 'rect', cx: '0', cy: '0', w: '20', h: '20' }] },
  { id: 'b', type: 'sketch', name: 'B', plane: { kind: 'XY', offset: '30' }, entities: [], geo: { points: [P('c', 0, 0)], curves: [{ id: 'ci', kind: 'circle', c: 'c', r: 6 }], constraints: [] } },
  { id: 'lo', type: 'loft', name: 'Loft', sketches: ['a', 'b'], op: 'add' },
];
check('loft square->circle', p);

// 4. draft on box side faces
p = newProject();
p.features = [
  { id: 'a', type: 'sketch', name: 'A', plane: { kind: 'XY' }, entities: [{ id: 'r', kind: 'rect', cx: '0', cy: '0', w: '20', h: '20' }] },
  { id: 'e', type: 'extrude', name: 'E', sketch: 'a', depth: '20', op: 'add' },
  { id: 'd', type: 'draft', name: 'Draft', angle: '5', faces: [{ p: [10, 0, 10], n: [1, 0, 0], k: 'PLANE' }, { p: [-10, 0, 10], n: [-1, 0, 0], k: 'PLANE' }], neutral: { p: [0, 0, 0], n: [0, 0, 1] } },
];
check('draft 5deg (<8000)', p);

// 5. rib gusset in an L bracket
p = newProject();
p.features = [
  { id: 'a', type: 'sketch', name: 'A', plane: { kind: 'XY' }, entities: [{ id: 'r', kind: 'rect', cx: '0', cy: '0', w: '40', h: '40' }] },
  { id: 'e', type: 'extrude', name: 'E', sketch: 'a', depth: '5', op: 'add' },
  { id: 'b', type: 'sketch', name: 'B', plane: { kind: 'XZ', offset: '-15' }, entities: [{ id: 'r', kind: 'rect', cx: '0', cy: '20', w: '40', h: '40' }] },
  { id: 'e2', type: 'extrude', name: 'E2', sketch: 'b', depth: '5', reverse: true, op: 'add' },
  { id: 'rs', type: 'sketch', name: 'RibS', plane: { kind: 'YZ' }, entities: [], geo: { points: [P('p', 10, 5), P('q', 15, 30)], curves: [L('rl', 'p', 'q')], constraints: [] } },
  { id: 'rb', type: 'rib', name: 'Rib', sketch: 'rs', thickness: '3' },
];
const rb = check('rib gusset', p);
p.features[5].flip = true; check('rib gusset flipped', p);
// 6. split region sketch (square + diagonal) extrudes as one body
p = newProject();
p.features = [{ id: 's', type: 'sketch', name: 'S', plane: { kind: 'XY' }, entities: [], geo: { points: [P('a', 0, 0), P('b', 10, 0), P('c', 10, 10), P('d', 0, 10)], curves: [L('1', 'a', 'b'), L('2', 'b', 'c'), L('3', 'c', 'd'), L('4', 'd', 'a'), L('5', 'a', 'c')], constraints: [] } }, { id: 'e', type: 'extrude', name: 'E', sketch: 's', depth: '1', op: 'add' }];
check('split square (=100)', p);
// 7. nested: square with circle hole
p.features[0].geo.points.push(P('cc', 5, 5)); p.features[0].geo.curves.push({ id: 'h', kind: 'circle', c: 'cc', r: 2 }); p.features[0].geo.curves.splice(4, 1);
check('square w/ hole (=87.4)', p);
