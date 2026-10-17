import opencascade from 'replicad-opencascadejs';
import * as R from 'replicad';
import { Builder } from '../src/kernel/build';
import { demoProject } from '../src/model/demo';
const oc = await (opencascade as any)({ locateFile: () => process.cwd() + '/node_modules/replicad-opencascadejs/dist/replicad_single.wasm' });
R.setOC(oc);
const r = new Builder(R).rebuild(demoProject());
console.log('demo errors', r.errors, 'vol', r.props?.volume.toFixed(0), 'bbox', JSON.stringify(r.props?.bbox.map(v=>v.map(x=>+x.toFixed(2)))), r.ms+'ms', 'tris', r.mesh!.triangles.length/3);
const B2 = new Builder(R); const p2 = demoProject();
for (const [k, v] of [['plate', '8'], ['width', '80'], ['height', '55'], ['depth', '50']]) {
  p2.variables[k] = v; const r2 = B2.rebuild(p2);
  console.log(`${k}=${v}`, r2.errors.map(e => e.featureId + ': ' + e.message), 'vol', r2.props?.volume.toFixed(0));
}
