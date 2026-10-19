import opencascade from 'replicad-opencascadejs';
import * as R from 'replicad';
import { readFileSync, writeFileSync } from 'node:fs';
import { init_planegcs_module } from '@salusoft89/planegcs';
import { Builder } from '../src/kernel/build';
import { newProject } from '../src/model/types';
import { build3MF } from '../src/io/threemf';
const oc = await (opencascade as any)({ locateFile: () => process.cwd() + '/node_modules/replicad-opencascadejs/dist/replicad_single.wasm' });
R.setOC(oc);
const gcs = await init_planegcs_module();
const font = () => { const b = readFileSync('node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff'); return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const run = async (name: string, p: any, B = new Builder(R, gcs)) => {
  await B.prepare(p, font); const t = Date.now(); const r = B.rebuild(p);
  console.log(name.padEnd(30), r.errors.length ? 'ERR ' + r.errors.map((e: any) => e.featureId + ': ' + e.message).join('; ') : 'ok', 'vol', r.props?.volume.toFixed(1), 'bodies', r.bodies?.length, (Date.now() - t) + 'ms');
  return { r, B };
};
const box = (w = 40, d = 30, h = 20) => [
  { id: 's', type: 'sketch', name: 'S', plane: { kind: 'XY' }, entities: [{ id: 'r', kind: 'rect', cx: '0', cy: '0', w: String(w), h: String(d) }] },
  { id: 'e', type: 'extrude', name: 'E', sketch: 's', depth: String(h), op: 'add' }];
let p: any;
// thread on a shaft (M8 x 1.25, external)
p = newProject(); p.features = [
  { id: 's', type: 'sketch', name: 'S', plane: { kind: 'XY' }, entities: [{ id: 'c', kind: 'circle', cx: '0', cy: '0', d: '8' }] },
  { id: 'e', type: 'extrude', name: 'E', sketch: 's', depth: '20', op: 'add' },
  { id: 't', type: 'thread', name: 'T', face: { p: [4, 0, 10], k: 'CYLINDRE' }, size: 'M8', pitch: '1.25', length: '12', clearance: '0.1', fromEnd: true }];
const a = await run('external thread (<1005)', p);
// internal thread in a block
p = newProject(); p.features = [...box(),
  { id: 'h', type: 'hole', name: 'H', plane: { kind: 'XY', offset: '20' }, points: [[0, 0]], preset: 'custom', size: 'M8', diameter: '6.8', depth: '10', throughAll: true, cbore: null },
  { id: 't', type: 'thread', name: 'T', face: { p: [3.4, 0, 10], k: 'CYLINDRE' }, size: 'M8', pitch: '1.25', length: '20', clearance: '0.1', full: true }];
await run('internal thread', p);
// text emboss & engrave
p = newProject(); p.features = [...box(),
  { id: 'tx', type: 'text', name: 'Text', plane: { kind: 'XY', offset: '20' }, text: 'jasCAD', size: '8', x: '0', y: '0', angle: '0', depth: '1', op: 'add', align: 'center' },
  { id: 'tx2', type: 'text', name: 'Text2', plane: { kind: 'XZ', offset: '15' }, text: 'v1', size: '6', x: '0', y: '10', angle: '0', depth: '0.6', op: 'cut', align: 'center' }];
await run('text emboss+engrave', p);
// split with dowels
p = newProject(); p.features = [...box(80, 30, 20),
  { id: 'sp', type: 'split', name: 'Split', plane: 'YZ', offset: '0', keep: 'both', gap: '5', dowels: 2, dowelD: '4', dowelLen: '10', clearance: '0.2' }];
const sp = await run('split + 2 dowels (24000-holes)', p);
const objs = sp.B.export3MFData(sp.r.shapes, () => '#3366cc');
const z = build3MF(objs, 'split'); writeFileSync('/tmp/split.3mf', z); console.log('3mf bytes', z.length, 'objects', objs.length);
// boss for M3 insert on top of a box
p = newProject(); p.features = [...box(),
  { id: 'b', type: 'boss', name: 'Boss', plane: { kind: 'XY', offset: '20' }, points: [[-10, 0], [10, 0]], size: 'M3', od: '8', insertD: '4', height: '6', holeDepth: '6' }];
await run('2 bosses', p);
// snap-fit on top face
p = newProject(); p.features = [...box(),
  { id: 'sn', type: 'snap', name: 'Snap', plane: { kind: 'XY', offset: '20' }, point: [0, 0], angle: '0', length: '12', thickness: '1.6', width: '6', lip: '1', lead: '30' }];
await run('snap-fit (>24000)', p);
// lip and groove on a shelled box
p = newProject(); p.features = [...box(),
  { id: 'sh', type: 'shell', name: 'Shell', thickness: '2', faces: [{ p: [0, 0, 20], n: [0, 0, 1] }] },
  { id: 'l', type: 'lip', name: 'Lip', face: { p: [19, 0, 20], n: [0, 0, 1], k: 'PLANE' }, kind: 'lip', height: '2', width: '1', clearance: '0.15' }];
await run('lip on shelled box', p);
p.features[3].kind = 'groove'; await run('groove on shelled box', p);
// combine + move
p = newProject(); p.features = [...box(),
  { id: 's2', type: 'sketch', name: 'S2', plane: { kind: 'XY' }, entities: [{ id: 'c', kind: 'circle', cx: '20', cy: '0', d: '20' }] },
  { id: 'e2', type: 'extrude', name: 'E2', sketch: 's2', depth: '30', op: 'new' },
  { id: 'mv', type: 'move', name: 'Move', bodies: [1], dx: '0', dy: '0', dz: '-5', axis: 'z', angle: '0' },
  { id: 'cb', type: 'combine', name: 'Combine', op: 'subtract', target: 0, tools: [1] }];
await run('new body, move, subtract', p);
// STEP round trip import
const { r: rb, B: Bb } = await run('bracket for STEP', (() => { const q: any = newProject(); q.features = box(); return q; })());
const step = await Bb.exportSTEP(rb.shapes).arrayBuffer();
p = newProject(); p.features = [{ id: 'im', type: 'import', name: 'Import', file: 'x.step', format: 'step', data: Buffer.from(step).toString('base64') }];
await run('STEP import (=24000)', p);

