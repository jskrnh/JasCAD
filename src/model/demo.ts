import { newProject, type Project } from './types';

/** The sample part shown on first launch: a printable sensor bracket. */
export function demoProject(): Project {
  const p = newProject();
  p.name = 'Sensor_Bracket';
  p.variables = { wall: '2', width: '60', depth: '40', plate: '6', height: '40' };
  p.features = [
    { id: 'sk1', type: 'sketch', name: 'Sketch 1', hidden: true, plane: { kind: 'XY' }, entities: [{ id: 'en1', kind: 'rect', cx: '0', cy: '0', w: 'width', h: 'depth', r: '4' }] },
    { id: 'ex1', type: 'extrude', name: 'Extrude 1', sketch: 'sk1', depth: 'plate', op: 'add' },
    { id: 'sk2', type: 'sketch', name: 'Sketch 2', hidden: true, plane: { kind: 'XZ', offset: 'plate - depth/2' }, entities: [{ id: 'en2', kind: 'rect', cx: '0', cy: 'height/2', w: 'width', h: 'height' }] },
    { id: 'ex2', type: 'extrude', name: 'Extrude 2', sketch: 'sk2', depth: 'plate', reverse: true, op: 'add' },
    { id: 'ho1', type: 'hole', name: 'Hole 1', plane: { kind: 'XY', offset: 'plate' }, points: [[-18, 6], [18, 6]], preset: 'clearance', size: 'M4', diameter: '4.5', depth: '10', throughAll: true, cbore: { d: '8.5', depth: '4.3' } },
    { id: 'sk3', type: 'sketch', name: 'Sketch 3', hidden: true, plane: { kind: 'XZ', offset: 'plate - depth/2' }, entities: [{ id: 'en3', kind: 'slot', cx: '0', cy: '26', l: '20', w: '6' }] },
    { id: 'ex3', type: 'extrude', name: 'Cut 1', sketch: 'sk3', depth: '1', throughAll: true, op: 'cut' },
    { id: 'fi1', type: 'fillet', name: 'Fillet 1', radius: 'wall', edges: [{ p: [0, 14, 6], t: [1, 0, 0], k: 'LINE' }] },
    { id: 'ch1', type: 'chamfer', name: 'Chamfer 1', distance: '0.6', edges: [{ p: [0, 14, 40], t: [1, 0, 0], k: 'LINE' }, { p: [0, 20, 40], t: [1, 0, 0], k: 'LINE' }] },
  ];
  return p;
}
