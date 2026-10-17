// Mouse navigation presets that mimic popular CAD packages, plus 3D mouse settings.
export type NavOp = 'rotate' | 'pan' | 'zoom' | 'roll';
export interface Binding { buttons: number; ctrl?: boolean; shift?: boolean; alt?: boolean; op: NavOp }
export interface NavPreset { name: string; bindings: Binding[]; hints: [string, string][] }

// `buttons` is the PointerEvent.buttons mask: 1 = left, 2 = right, 4 = middle.
export const NAV_PRESETS: NavPreset[] = [
  { name: 'SolidWorks', bindings: [
      { buttons: 4, ctrl: true, op: 'pan' }, { buttons: 4, shift: true, op: 'zoom' }, { buttons: 4, alt: true, op: 'roll' }, { buttons: 4, op: 'rotate' }],
    hints: [['Rotate', 'Middle drag'], ['Pan', 'Ctrl + Middle drag'], ['Zoom', 'Wheel / Shift + Middle'], ['Roll', 'Alt + Middle drag'], ['Fit', 'F']] },
  { name: 'Fusion', bindings: [
      { buttons: 4, shift: true, op: 'rotate' }, { buttons: 4, op: 'pan' }],
    hints: [['Rotate', 'Shift + Middle drag'], ['Pan', 'Middle drag'], ['Zoom', 'Wheel'], ['Roll', '—'], ['Fit', 'F']] },
  { name: 'Onshape', bindings: [
      { buttons: 2, ctrl: true, op: 'pan' }, { buttons: 2, shift: true, op: 'zoom' }, { buttons: 2, op: 'rotate' }, { buttons: 4, op: 'pan' }],
    hints: [['Rotate', 'Right drag'], ['Pan', 'Ctrl + Right / Middle drag'], ['Zoom', 'Wheel / Shift + Right'], ['Roll', '—'], ['Fit', 'F']] },
  { name: 'Inventor', bindings: [
      { buttons: 4, shift: true, op: 'rotate' }, { buttons: 4, op: 'pan' }],
    hints: [['Rotate', 'Shift + Middle drag'], ['Pan', 'Middle drag'], ['Zoom', 'Wheel'], ['Roll', '—'], ['Fit', 'F']] },
  { name: 'CATIA', bindings: [
      { buttons: 5, op: 'rotate' }, { buttons: 6, op: 'zoom' }, { buttons: 4, op: 'pan' }],
    hints: [['Rotate', 'Middle + Left hold, drag'], ['Pan', 'Middle drag'], ['Zoom', 'Middle + Right hold, drag'], ['Roll', '—'], ['Fit', 'F']] },
  { name: 'Creo', bindings: [
      { buttons: 4, shift: true, op: 'pan' }, { buttons: 4, ctrl: true, op: 'zoom' }, { buttons: 4, op: 'rotate' }],
    hints: [['Rotate', 'Middle drag'], ['Pan', 'Shift + Middle drag'], ['Zoom', 'Wheel / Ctrl + Middle'], ['Roll', '—'], ['Fit', 'F']] },
  { name: 'NX', bindings: [
      { buttons: 4, shift: true, op: 'pan' }, { buttons: 6, op: 'pan' }, { buttons: 4, ctrl: true, op: 'zoom' }, { buttons: 5, op: 'zoom' }, { buttons: 4, op: 'rotate' }],
    hints: [['Rotate', 'Middle drag'], ['Pan', 'Shift + Middle / Middle + Right'], ['Zoom', 'Wheel / Ctrl + Middle'], ['Roll', '—'], ['Fit', 'F']] },
  { name: 'Blender', bindings: [
      { buttons: 4, shift: true, op: 'pan' }, { buttons: 4, ctrl: true, op: 'zoom' }, { buttons: 4, op: 'rotate' }],
    hints: [['Rotate', 'Middle drag'], ['Pan', 'Shift + Middle drag'], ['Zoom', 'Wheel / Ctrl + Middle'], ['Roll', '—'], ['Fit', 'Home']] },
];

export function matchBinding(p: NavPreset, e: { buttons: number; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): NavOp | null {
  const ctrl = e.ctrlKey || e.metaKey;
  for (const b of p.bindings) {
    if (b.buttons !== e.buttons) continue;
    if (!!b.ctrl !== ctrl || !!b.shift !== e.shiftKey || !!b.alt !== e.altKey) continue;
    return b.op;
  }
  // tolerate extra modifiers by falling back to the plain binding for these buttons
  const plain = p.bindings.find((b) => b.buttons === e.buttons && !b.ctrl && !b.shift && !b.alt);
  return plain && !ctrl && !e.shiftKey && !e.altKey ? plain.op : null;
}

export interface NavSettings {
  preset: string;
  zoomToCursor: boolean;
  invertWheel: boolean;
  rotateAboutPoint: boolean;
  rotation: 'turntable' | 'free';
  projection: 'ortho' | 'perspective';
  mouse3d: {
    speed: number; rotate: boolean; pan: boolean; zoom: boolean; dominant: boolean;
    lockHorizon: boolean; invertPan: boolean; invertZoom: boolean; invertRotate: boolean;
    zoomAxis: 'z' | 'y';
  };
}

export const DEFAULT_NAV: NavSettings = {
  preset: 'SolidWorks', zoomToCursor: true, invertWheel: false, rotateAboutPoint: true, rotation: 'turntable', projection: 'ortho',
  mouse3d: { speed: 1, rotate: true, pan: true, zoom: true, dominant: false, lockHorizon: false, invertPan: false, invertZoom: false, invertRotate: false, zoomAxis: 'z' },
};

export function loadNav(): NavSettings {
  try { const s = JSON.parse(localStorage.getItem('forge.nav') || 'null'); if (s) return { ...DEFAULT_NAV, ...s, mouse3d: { ...DEFAULT_NAV.mouse3d, ...(s.mouse3d || {}) } }; } catch { /* ignore */ }
  return structuredClone(DEFAULT_NAV);
}
export function saveNav(s: NavSettings) { try { localStorage.setItem('forge.nav', JSON.stringify(s)); } catch { /* ignore */ } }
