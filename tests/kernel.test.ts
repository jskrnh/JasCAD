import opencascade from 'replicad-opencascadejs';
import * as R from 'replicad';
import { Builder } from '../src/kernel/build';
import { newProject } from '../src/model/types';
import type { Project } from '../src/model/types';

const oc = await (opencascade as any)({ locateFile: () => process.cwd() + '/node_modules/replicad-opencascadejs/dist/replicad_single.wasm' });
R.setOC(oc);
const B = new Builder(R);
const p: Project = newProject();
p.variables = { wall: '2', w: '60', d: '40', t: '6' };
p.features = [
  { id: 's1', type: 'sketch', name: 'Sketch 1', plane: { kind: 'XY' }, entities: [{ id: 'e1', kind: 'rect', cx: '0', cy: '0', w: 'w', h: 'd', r: '4' }] },
  { id: 'x1', type: 'extrude', name: 'Extrude 1', sketch: 's1', depth: 't', op: 'add' },
  { id: 's2', type: 'sketch', name: 'Sketch 2', plane: { kind: 'XZ', offset: '14' }, entities: [{ id: 'e2', kind: 'rect', cx: '0', cy: '20', w: 'w', h: '40' }] },
  { id: 'x2', type: 'extrude', name: 'Extrude 2', sketch: 's2', depth: 't', op: 'add' },
  { id: 'h1', type: 'hole', name: 'Hole 1', plane: { kind: 'XY', offset: 't' }, points: [[-20, 5]], preset: 'clearance', size: 'M4', diameter: '4.5', depth: '10', throughAll: true, cbore: { d: '8', depth: '2' } },
  { id: 'p1', type: 'pattern', name: 'Pattern 1', mode: 'linear', features: ['h1'], dir: 'x', count: '3', spacing: '20' },
  { id: 's3', type: 'sketch', name: 'Sketch 3', plane: { kind: 'XY' }, entities: [{ id: 'e3', kind: 'slot', cx: '0', cy: '-8', l: '20', w: '6' }, { id: 'e4', kind: 'polygon', cx: '22', cy: '-4', d: '8', n: '6' }] },
  { id: 'x3', type: 'extrude', name: 'Cut 1', sketch: 's3', depth: '1', throughAll: true, op: 'cut' },
];
let r = B.rebuild(p);
console.log('base', r.errors, r.props?.volume.toFixed(1), r.faces.length, 'faces', r.ms, 'ms');
// fillet: pick edge at junction (inner corner between plate top and upright)
const cand = r.edgeInfo.filter(e => e.type === 'LINE' && Math.abs(e.mid[2] - 6) < 1e-6 && Math.abs(e.mid[1] + 14) < 1e-6);
console.log('junction edges', cand.length);
p.features.push({ id: 'f1', type: 'fillet', name: 'Fillet 1', radius: 'wall', edges: cand.map(e => ({ p: e.mid })) });
const top = r.faces.find(f => f.type === 'PLANE' && f.normal && f.normal[2] > 0.99 && Math.abs(f.center[2] - 40) < 1e-6)!;
p.features.push({ id: 'c1', type: 'chamfer', name: 'Chamfer 1', distance: '0.6', edges: r.edgeInfo.filter(e => Math.abs(e.mid[2] - 40) < 1e-6).slice(0, 2).map(e => ({ p: e.mid })) });
p.features.push({ id: 'm1', type: 'mirror', name: 'Mirror 1', plane: 'XZ', features: [] });
r = B.rebuild(p);
console.log('full', r.errors, r.props?.volume.toFixed(1), r.faces.length, 'faces', r.ms, 'ms', 'owners', new Set(r.faces.map(f => f.owner)).size);
// change a variable and rebuild (cache invalidation)
p.variables.wall = '3';
r = B.rebuild(p); console.log('wall=3', r.errors, r.props?.volume.toFixed(1), r.ms, 'ms');
// edit a late feature only (cache reuse)
(p.features[p.features.length - 1] as any).plane = 'YZ';
r = B.rebuild(p); console.log('mirror YZ (cached prefix)', r.errors, r.props?.volume.toFixed(1), r.ms, 'ms');
// shell test
const p2 = newProject();
p2.features = [
  { id: 'a', type: 'sketch', name: 'S', plane: { kind: 'XY' }, entities: [{ id: 'e', kind: 'rect', cx: '0', cy: '0', w: '40', h: '30' }] },
  { id: 'b', type: 'extrude', name: 'E', sketch: 'a', depth: '20', op: 'add' },
  { id: 'c', type: 'shell', name: 'Shell', thickness: '2', faces: [{ p: [0, 0, 20] }] },
  { id: 'd', type: 'revolve', name: 'Rev', sketch: 'a2', angle: '360', axis: 'y', op: 'add' },
];
const B2 = new Builder(R); let r2 = B2.rebuild(p2); console.log('shell', r2.errors.map(e=>e.message), r2.props?.volume.toFixed(1));
const step = await B.exportSTEP(r.bodies).arrayBuffer(); const stl = await B.exportSTL(r.bodies).arrayBuffer();
console.log('STEP bytes', step.byteLength, 'STL bytes', stl.byteLength);
