import { init_planegcs_module } from '@salusoft89/planegcs';
import { solve } from '../src/sketch/solver';
const mod = await init_planegcs_module();
const P = (id: string, x: number, y: number) => ({ id, x, y });
// slot made of 2 lines + 2 arcs sharing endpoints, tangent at all 4 joints, radius & length dims
const geo: any = { points: [P('c1',0,0),P('c2',20,0),P('p1',0,3),P('p2',20,3),P('p3',20,-3),P('p4',0,-3)],
  curves: [{id:'t',kind:'line',a:'p1',b:'p2'},{id:'ab',kind:'arc',c:'c2',a:'p3',b:'p2'},{id:'bo',kind:'line',a:'p3',b:'p4'},{id:'aa',kind:'arc',c:'c1',a:'p1',b:'p4'}],
  constraints: [{id:'1',type:'tangent',refs:['t','ab']},{id:'2',type:'tangent',refs:['t','aa']},{id:'3',type:'tangent',refs:['bo','ab']},{id:'4',type:'tangent',refs:['bo','aa']},{id:'5',type:'equal',refs:['aa','ab']},
    {id:'6',type:'coincident',refs:['c1','O']},{id:'7',type:'horizontal',refs:['t']},{id:'8',type:'radius',refs:['aa'],value:'4'},{id:'9',type:'distance',refs:['c1','c2'],value:'30'}] };
const r = solve(mod, geo, {});
console.log(r.status, 'dof', r.dof, r.geo.points.map((p: any) => `${p.id}(${p.x.toFixed(2)},${p.y.toFixed(2)})`).join(' '));
