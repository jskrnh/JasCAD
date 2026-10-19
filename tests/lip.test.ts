import opencascade from 'replicad-opencascadejs';
import * as R from 'replicad';
import { Builder } from '../src/kernel/build';
import { newProject } from '../src/model/types';
const oc = await (opencascade as any)({ locateFile: () => process.cwd() + '/node_modules/replicad-opencascadejs/dist/replicad_single.wasm' });
R.setOC(oc); (globalThis as any).JASCAD_DEBUG = 1;
const box = [
  { id: 's', type: 'sketch', name: 'S', plane: { kind: 'XY' }, entities: [{ id: 'r', kind: 'rect', cx: '0', cy: '0', w: '40', h: '30' }] },
  { id: 'e', type: 'extrude', name: 'E', sketch: 's', depth: '20', op: 'add' },
  { id: 'sh', type: 'shell', name: 'Shell', thickness: '2', faces: [{ p: [0, 0, 20], n: [0, 0, 1] }] }];
for (const kind of ['lip', 'groove']) {
  const p: any = newProject(); p.features = [...box, { id: 'l', type: 'lip', name: 'Lip', face: { p: [19, 0, 20], n: [0, 0, 1], k: 'PLANE' }, kind, height: '2', width: '1', clearance: '0.15' }];
  const r = new Builder(R).rebuild(p); console.log(kind, r.errors.map((e: any) => e.message), r.props?.volume.toFixed(1), 'shell only = 7152');
}
// STEP round trip
const p: any = newProject(); p.features = box.slice(0, 2);
const B = new Builder(R); const r = B.rebuild(p);
const step = await B.exportSTEP(r.shapes).arrayBuffer();
const q: any = newProject(); q.features = [{ id: 'im', type: 'import', name: 'Import', file: 'x.step', format: 'step', data: Buffer.from(step).toString('base64') }];
const B2 = new Builder(R); await B2.prepare(q); const r2 = B2.rebuild(q); console.log('STEP import', r2.errors.map((e: any) => e.message), r2.props?.volume.toFixed(1), 'expect 24000');
