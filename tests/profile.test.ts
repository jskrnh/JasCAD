import { findRegions, faceArea } from '../src/sketch/profile';
const P = (id: string, x: number, y: number) => ({ id, x, y });
const L = (id: string, a: string, b: string) => ({ id, kind: 'line' as const, a, b });
const geo: any = {
  points: [P('a',0,0),P('b',10,0),P('c',10,10),P('d',0,10),P('e',15,15),P('f',30,0),P('g',40,5),P('h',50,0),P('k',20,20)],
  curves: [L('1','a','b'),L('2','b','c'),L('3','c','d'),L('4','d','a'),L('5','a','c'),L('6','c','e'),L('7','f','g'),L('8','g','h'),{id:'9',kind:'circle',c:'k',r:3}],
  constraints: [],
};
const r = findRegions(geo);
console.log('faces', r.faces.map(f => [f.map(s=>s.src).join(','), faceArea(f).toFixed(1)]));
console.log('chains', r.chains.map(c => c.map(s=>s.src).join(',')));
