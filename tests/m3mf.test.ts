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
// split with dowels
p = newProject(); p.features = [...box(80, 30, 20),
  { id: 'sp', type: 'split', name: 'Split', plane: 'YZ', offset: '0', keep: 'both', gap: '5', dowels: 2, dowelD: '4', dowelLen: '10', clearance: '0.2' }];
const sp = await run('split + 2 dowels (24000-holes)', p);
const objs = sp.B.export3MFData(sp.r.shapes, () => '#3366cc');
const z = build3MF(objs, 'split'); writeFileSync('/tmp/split.3mf', z); console.log('3mf bytes', z.length, 'objects', objs.length);

// manifold check: every edge used by exactly two triangles per object
import('fs');
const xml = (await import('fflate')).unzipSync(z)['3D/3dmodel.model']; const txt = new TextDecoder().decode(xml);
for (const obj of txt.split('<object').slice(1)) { const tr = [...obj.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map(m => [+m[1], +m[2], +m[3]]); const ec = new Map<string, number>();
  for (const [a, b, c] of tr) for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = u < v ? u + '_' + v : v + '_' + u; ec.set(k, (ec.get(k) || 0) + 1); }
  const bad = [...ec.values()].filter(n => n !== 2).length; console.log('object tris', tr.length, 'non-manifold edges', bad); }
