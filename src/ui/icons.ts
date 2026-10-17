// Shaded 3D icon set (isometric three-tone lighting, orange = what the command creates/changes).
// Each icon is a list of SVG path layers drawn in a 24×24 box.

type Layer = { d: string; f: string; s: string; w: number; t: string; o: number; da: string };
const T = '#E6EDF5', L = '#AEC0D4', R = '#7E96B3', D = '#33414F', O = '#F0892A', E = '#2A3644', SB = '#1E3F7A';
const ly = (d: string, f?: string | null, s?: string | null, w?: number, t?: string | null, o?: number | null, da?: string): Layer =>
  ({ d, f: f || 'none', s: s || 'none', w: w || 0.6, t: t || '', o: o == null ? 1 : o, da: da || '' });
const slab = (cx: number, y: number, s: number, H: number, top?: string): Layer[] => {
  const a = y + s / 2, b = y + s;
  return [
    ly(`M${cx - s} ${a}L${cx} ${b}L${cx} ${b + H}L${cx - s} ${a + H}Z`, L, E),
    ly(`M${cx} ${b}L${cx + s} ${a}L${cx + s} ${a + H}L${cx} ${b + H}Z`, R, E),
    ly(`M${cx} ${y}L${cx + s} ${a}L${cx} ${b}L${cx - s} ${a}Z`, top || T, E)];
};
const cyl = (cx: number, cy: number, rx: number, ry: number, h: number, top?: string): Layer[] => [
  ly(`M${cx - rx} ${cy}V${cy + h}A${rx} ${ry} 0 0 0 ${cx} ${cy + h + ry}V${cy + ry}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}Z`, L, E),
  ly(`M${cx} ${cy + ry}V${cy + h + ry}A${rx} ${ry} 0 0 0 ${cx + rx} ${cy + h}V${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy + ry}Z`, R, E),
  ly(`M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`, top || T, E)];
const fac = (cx: number, y: number, s: number, H: number): Layer[] => {
  const a = y + s / 2, b = y + s;
  return [ly(`M${cx - s} ${a}L${cx} ${b + H}M${cx} ${b}L${cx + s} ${a + H}M${cx - s} ${a}L${cx + s} ${a}`, null, E, 0.45, null, 0.7)];
};
const sk = (d: string): Layer[] => [ly(d, null, '#B9CBE4', 2, 'translate(0.45 0.55)'), ly(d, null, SB, 1.25)];
const line = (d: string, c = '#2B3542'): Layer[] => [ly(d, null, c, 1.8)];
const sp = 'M4.5 20C4.5 11 12.5 14 14.4 6';

const I: Record<string, Layer[]> = {
  // sketch
  line: sk('M4 20L20 4'), rect: sk('M4 6h16v12H4z'), circle: sk('M12 4a8 8 0 1 0 .01 0'), polygon: sk('M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z'),
  slot: sk('M8 8h8a4 4 0 0 1 0 8H8a4 4 0 0 1 0-8z'), poly: sk('M4 18L8 6l7 4 5-4v12z'), sketch: sk('M4 6h16v12H4zM4 6l6 6'),
  dimension: sk('M4 8v8M20 8v8M4 12h16'), exitSketch: sk('M5 12l5 5 9-10'),
  // solids
  extrude: [...slab(12, 10, 8, 5), ly('M12 9V2.5M9.5 5L12 2.5L14.5 5', null, O, 1.8)],
  cutExtrude: [...slab(12, 8, 8, 6), ly('M12 10.5L16 12.5L12 14.5L8 12.5Z', D, E), ly('M12 2V9M9.5 6.5L12 9L14.5 6.5', null, O, 1.8)],
  revolve: [...cyl(12, 7, 7, 3, 10), ly('M2.5 10.5A9.5 4 0 0 0 21.5 10.5', null, O, 1.6), ly('M19.4 12.6L21.5 10.5L22.6 13.2', null, O, 1.6)],
  sweep: [ly(sp, null, '#4E6380', 5.2), ly(sp, null, R, 4), ly(sp, null, L, 2.2, 'translate(-0.5 -0.5)'), ly('M11.8 6A2.6 2.6 0 1 0 17 6A2.6 2.6 0 1 0 11.8 6Z', O, E)],
  loft: [ly('M8 5L12 7L12 22L3 17.5Z', L, E), ly('M12 7L16 5L21 17.5L12 22Z', R, E), ly('M12 3L16 5L12 7L8 5Z', O, E), ly('M3 17.5L12 22L21 17.5', null, O, 1.4)],
  fillet: [...slab(12, 9, 8, 6), ly('M4 13.2Q12 18.6 20 13.2', null, O, 2.2)],
  chamfer: [...slab(12, 9, 8, 6), ly('M4 12.4L12 16.4L12 18.6L4 14.6Z', O, E)],
  shell: [...slab(12, 7, 8, 7), ly('M12 9.2L17.6 12L12 14.8L6.4 12Z', D, E), ly('M6.4 12L12 14.8L17.6 12', null, O, 1.2)],
  draft: [ly('M5 7.5L12 11L12 22L3.5 17.5Z', L, E), ly('M12 11L19 7.5L20.5 17.5L12 22Z', R, E), ly('M12 4L19 7.5L12 11L5 7.5Z', T, E), ly('M19 7.5V19', null, O, 1.3, null, 1, '2 1.6')],
  hole: [...slab(12, 9, 8, 5), ly('M8.4 13A3.6 1.8 0 1 0 15.6 13A3.6 1.8 0 1 0 8.4 13Z', D, O, 1)],
  pattern: [...slab(12, 4.5, 4.5, 3.5), ...slab(6.5, 8, 4.5, 3.5), ...slab(17.5, 8, 4.5, 3.5), ...slab(12, 11.5, 4.5, 3.5, O)],
  circPattern: [...cyl(12, 13, 9, 4, 2), ...slab(12, 4, 3, 3, O), ...slab(5.5, 9, 2.6, 2.6), ...slab(18.5, 9, 2.6, 2.6)],
  mirror: [...slab(5.5, 7, 4.5, 6), ly('M10.2 3L13.8 5L13.8 21L10.2 19Z', O, O, 0.6, null, 0.55), ...slab(18.5, 7, 4.5, 6)],
  combine: [...slab(9, 4, 6, 5), ...slab(15, 9, 6, 5, O)],
  part: slab(12, 4, 8, 8),
  material: cyl(12, 5, 7, 3, 10),
  plane: [ly('M12 5L22 10L12 15L2 10Z', '#DCE7F5', '#5B7FB0', 0.9)],
  origin: [ly('M12 3v18M3 12h18', null, '#5B6470', 1.2), ly('M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', '#F0892A', E, 0.5)],
  // surfaces
  sExtruded: [ly('M4 9Q8 6 12 9T20 9V18Q16 15 12 18T4 18Z', L, E), ly('M4 9Q8 6 12 9T20 9', null, O, 1.6)],
  sRevolved: [ly('M5 7A7 3 0 0 1 19 7V17A7 3 0 0 0 5 17Z', R, E), ly('M5 7A7 3 0 0 0 12 10V20A7 3 0 0 1 5 17Z', L, E), ly('M12 2V23', null, O, 1.2, null, 1, '2 1.6')],
  sSwept: [ly(sp, null, R, 4.4), ly(sp, null, L, 2.4, 'translate(-0.6 -0.6)'), ly('M12.2 5.2L16.6 6.8', null, O, 1.8)],
  sLofted: [ly('M3 18Q12 22 21 18L17 5Q12 3 7 5Z', L, E), ly('M7 5Q12 3 17 5', null, O, 1.4), ly('M3 18Q12 22 21 18', null, O, 1.4)],
  sBoundary: [ly('M3 8Q12 4 21 8L20 18Q12 21 4 18Z', T, E), ly('M4 13Q12 10 20.5 13M12 6V19.5', null, R, 0.8), ly('M3 8Q12 4 21 8L20 18Q12 21 4 18Z', null, O, 1.2)],
  sFill: [ly('M12 5L22 10L12 15L2 10Z', L, E), ly('M12 7.8L16.8 10L12 12.2L7.2 10Z', O, E)],
  sOffset: [ly('M4 7Q12 3 20 7V11Q12 7 4 11Z', R, E), ly('M4 12Q12 8 20 12V16Q12 12 4 16Z', T, E), ly('M12 5.2V9.8', null, O, 1.4)],
  sTrim: [ly('M12 4L22 9L12 14L2 9Z', L, E), ly('M12 14L17 11.5L12 9L7 11.5Z', '#FFFFFF', O, 1, null, 1, '1.6 1.2')],
  sExtend: [ly('M3 10L12 5.5L12 14L3 18.5Z', L, E), ly('M12 5.5L20 9.5L20 18L12 14Z', T, O, 1, null, 0.75, '1.6 1.2'), ly('M14 12.5L18.5 14.8', null, O, 1.4)],
  sKnit: [ly('M2 9L11 5L11 14L2 18Z', L, E), ly('M11 5L22 9L22 18L11 14Z', R, E), ly('M11 5V14', null, O, 2)],
  sThicken: [...slab(12, 7, 8, 4, O), ly('M12 23V19.5M10 21.5L12 23.3L14 21.5', null, O, 1.4)],
  // evaluate
  measure: [...slab(12, 10, 8, 5), ly('M3.5 11L11.5 7', null, O, 1.4), ly('M3.5 12.8V9.2M11.5 8.8V5.2', null, O, 1.2)],
  massProps: [...slab(12, 9, 8, 6), ly('M10 14.5A2 2 0 1 0 14 14.5A2 2 0 1 0 10 14.5Z', O, E), ly('M12 12.5V16.5M10 14.5H14', null, '#FFFFFF', 0.9)],
  section: [...slab(12, 6, 8, 8), ly('M8 6.5L16 10.5L16 22L8 18Z', O, O, 0.6, null, 0.55)],
  interference: [...slab(9, 5, 6, 5), ...slab(15, 9, 6, 5), ly('M11 12.2L15 14.2V17L11 15Z', '#D64545', E)],
  thickness: [...slab(12, 8, 8, 6), ly('M12 8L20 12L12 16L4 12Z', '#4FB477', E), ly('M12 9.6L16.8 12L12 14.4L7.2 12Z', '#F2C94C'), ly('M12 11L14 12L12 13L10 12Z', '#E05353')],
  curvature: [ly('M3 15Q12 3 21 15L21 19Q12 7 3 19Z', L, E), ly('M6.2 10.8L4.6 7.6M9 8.4L8.1 5M12 7.6V4M15 8.4L15.9 5M17.8 10.8L19.4 7.6', null, O, 1)],
  zebra: [...slab(12, 8, 8, 7), ly('M4 14.5L12 18.5M4 17.5L12 21.5M12 18.5L20 14.5M12 21.5L20 17.5M6 11L14 15M10 9L18 13', null, '#1B2430', 1)],
  // print
  overhang: [...slab(12, 11, 4.5, 7), ...slab(12, 5, 9, 3), ly('M5 14V17M8 15.5V18.5M19 14V17M16 15.5V18.5', null, O, 1.1, null, 1, '1.2 1')],
  thinWall: [ly('M5 9L15 14L15 22L5 17Z', L, E), ly('M15 14L17 13L17 21L15 22Z', R, E), ly('M5 9L7 8L17 13L15 14Z', O, E)],
  orient: [ly('M12 13L22 17.5L12 22L2 17.5Z', '#D5DBE3', E), ...slab(12, 5, 5, 7.5), ly('M17 3.5A6 6 0 0 1 21 9', null, O, 1.5), ly('M19 8.5L21 9.5L22 7.2', null, O, 1.5)],
  split: [...slab(12, 2.5, 8, 3), ...slab(12, 10.5, 8, 4), ly('M7.5 14.5A1.2 .6 0 1 0 9.9 14.5A1.2 .6 0 1 0 7.5 14.5ZM14.1 14.5A1.2 .6 0 1 0 16.5 14.5A1.2 .6 0 1 0 14.1 14.5Z', O, E)],
  thread: [...cyl(12, 5, 6, 2.6, 13), ly('M6 9.5Q12 13.5 18 8.5M6 13Q12 17 18 12M6 16.5Q12 20.5 18 15.5', null, O, 1.1)],
  insert: [...slab(12, 12, 8, 4), ...cyl(12, 10.5, 3, 1.5, 4), ly('M10.6 10.5A1.4 .7 0 1 0 13.4 10.5A1.4 .7 0 1 0 10.6 10.5Z', O, E)],
  snapFit: [...slab(12, 12, 8, 4), ly('M11 15V5.5L13 4.5V6.5L16 8L13 9.5V14Z', O, E)],
  clearance: [...slab(7.5, 6, 5, 9), ...slab(16.5, 8.5, 5, 9), ly('M11 18L14 19.5', null, O, 1.6)],
  cost: [...slab(9, 10, 7, 5), ly('M13 5V7.5A4.5 2 0 0 0 22 7.5V5Z', '#C96A16', E), ly('M13 5A4.5 2 0 1 0 22 5A4.5 2 0 1 0 13 5Z', O, E)],
  // mesh / file
  importStl: [...slab(12, 10, 8, 5), ...fac(12, 10, 8, 5), ly('M12 1.5V8.5M9.5 6L12 8.5L14.5 6', null, O, 1.8)],
  repair: [...slab(12, 8, 8, 6), ...fac(12, 8, 8, 6), ly('M12 8L16 10L12 12Z', O, E)],
  decimate: [ly('M12 3L12 21L3 17Z', L, E), ly('M12 3L21 17L12 21Z', R, E), ly('M12 3L7.5 19M12 3L16.5 19', null, E, 0.45, null, 0.7), ly('M12 3L12 21', null, O, 1)],
  cutPlane: [...slab(12, 6, 8, 10), ly('M12 7L22.5 12.5L12 18L1.5 12.5Z', O, O, 0.6, null, 0.5)],
  emboss: [...slab(12, 10, 8, 5), ...slab(12, 10.4, 3.5, 1.6, O)],
  toSolid: [...slab(12, 9, 8, 6), ...fac(12, 9, 8, 6), ly('M6 4H17M14.5 1.8L17 4L14.5 6.2', null, O, 1.6)],
  exportStl: [...slab(12, 10, 8, 5), ...fac(12, 10, 8, 5), ly('M12 8.5V1.5M9.5 4L12 1.5L14.5 4', null, O, 1.8)],
  exportStep: [...slab(12, 10, 8, 5), ly('M12 8.5V1.5M9.5 4L12 1.5L14.5 4', null, O, 1.8)],
  exportJson: [ly('M6 3h9l4 4v14H6z', '#F6F8FA', E, 0.8), ly('M9 11c-1 0-1 1-1 2s0 2-1 2c1 0 1 1 1 2s0 2 1 2M15 11c1 0 1 1 1 2s0 2 1 2c-1 0-1 1-1 2s0 2-1 2', null, O, 1.2)],
  fit: [...slab(12, 5, 8, 8), ly('M2 7V2h5M22 7V2h-5M2 17v5h5M22 17v5h-5', null, O, 1.4)],
  shaded: slab(12, 5, 8, 8),
  views: [...slab(12, 5, 8, 8, '#DCE7F5'), ly('M12 5L20 9L12 13L4 9Z', null, O, 1.2)],
  variables: [ly('M4 5h16v14H4z', '#F6F8FA', E, 0.8), ly('M7 9.5h4M9 7.5v4M13 15h4M7 15l3-3', null, O, 1.4)],
  // ui line icons
  undo: line('M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2'), redo: line('M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h2'),
  rebuild: line('M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5'), gear: line('M12 9a3 3 0 1 0 .01 0M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2'),
  check: [ly('M5 12l5 5 9-10', null, '#FFFFFF', 2.4)], close: [ly('M6 6l12 12M18 6L6 18', null, '#B3261E', 2.4)],
  eye: line('M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM12 9.5a2.5 2.5 0 1 0 .01 0'), eyeOff: [ly('M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM4 4l16 16', null, '#9AA3AE', 1.8)],
  search: line('M11 5a6 6 0 1 0 .01 0M20 20l-4-4'), chevL: line('M15 6l-6 6 6 6'), chevR: line('M9 6l6 6-6 6'),
  file: line('M6 3h9l4 4v14H6zM15 3v4h4'), open: line('M3 7h6l2 2h10v10H3z'), save: line('M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7'),
  trash: line('M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13'), plus: line('M12 5v14M5 12h14'), suppress: line('M12 3a9 9 0 1 0 .01 0M5.6 5.6l12.8 12.8'),
  edit: line('M14 6l4 4-9 9H5v-4z'), rollback: line('M4 12h16M8 8l-4 4 4 4'), mouse3d: line('M4 15a8 4 0 1 0 16 0a8 4 0 1 0 -16 0M8 13V9a4 4 0 0 1 8 0v4'),
};

export function iconLayers(name: string) { return I[name] || I.part; }

export function icon(name: string, size = 24, extraAttrs = ''): string {
  const ls = iconLayers(name);
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" ${extraAttrs}>${ls.map((l) =>
    `<path d="${l.d}" fill="${l.f}" stroke="${l.s}" stroke-width="${l.w}"${l.t ? ` transform="${l.t}"` : ''}${l.o !== 1 ? ` opacity="${l.o}"` : ''}${l.da ? ` stroke-dasharray="${l.da}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`).join('')}</svg>`;
}

export const FEATURE_ICON: Record<string, string> = {
  sketch: 'sketch', extrude: 'extrude', revolve: 'revolve', fillet: 'fillet', chamfer: 'chamfer', shell: 'shell', hole: 'hole',
  pattern: 'pattern', mirror: 'mirror',
};
