// Print-tuned hole presets (FDM, 0.4 mm nozzle). Values are starting points; tune per printer.
export const HOLE_SIZES = ['M2', 'M2.5', 'M3', 'M4', 'M5', 'M6', 'M8'] as const;

const T: Record<string, { clear: number; cboreD: number; cboreH: number; tap: number; insD: number; insH: number }> = {
  M2: { clear: 2.4, cboreD: 4.4, cboreH: 2.3, tap: 1.8, insD: 3.2, insH: 4.0 },
  'M2.5': { clear: 2.9, cboreD: 5.0, cboreH: 2.8, tap: 2.2, insD: 3.6, insH: 4.5 },
  M3: { clear: 3.4, cboreD: 6.5, cboreH: 3.3, tap: 2.6, insD: 4.0, insH: 5.7 },
  M4: { clear: 4.5, cboreD: 8.5, cboreH: 4.3, tap: 3.5, insD: 5.6, insH: 8.1 },
  M5: { clear: 5.5, cboreD: 10, cboreH: 5.3, tap: 4.4, insD: 6.4, insH: 9.5 },
  M6: { clear: 6.6, cboreD: 11.5, cboreH: 6.3, tap: 5.3, insD: 8.0, insH: 12.7 },
  M8: { clear: 9.0, cboreD: 15, cboreH: 8.3, tap: 7.1, insD: 9.6, insH: 12.7 },
};

export function holeValues(preset: string, size: string, cbore: boolean) {
  const t = T[size] || T.M3;
  if (preset === 'clearance') return { diameter: String(t.clear), depth: '10', throughAll: true, cbore: cbore ? { d: String(t.cboreD), depth: String(t.cboreH) } : null };
  if (preset === 'tap') return { diameter: String(t.tap), depth: String(Math.round(t.tap * 3)), throughAll: false, cbore: null };
  if (preset === 'insert') return { diameter: String(t.insD), depth: String(+(t.insH + 0.5).toFixed(1)), throughAll: false, cbore: null };
  return null;
}

export const PRESET_LABEL: Record<string, string> = { clearance: 'Clearance', tap: 'Self-tap', insert: 'Heat-set insert', custom: 'Custom' };

/** ISO metric coarse threads (+ two common imperial). d = major diameter, p = pitch. */
export const THREADS: { size: string; d: number; p: number }[] = [
  { size: 'M2', d: 2, p: 0.4 }, { size: 'M2.5', d: 2.5, p: 0.45 }, { size: 'M3', d: 3, p: 0.5 }, { size: 'M4', d: 4, p: 0.7 },
  { size: 'M5', d: 5, p: 0.8 }, { size: 'M6', d: 6, p: 1 }, { size: 'M8', d: 8, p: 1.25 }, { size: 'M10', d: 10, p: 1.5 },
  { size: 'M12', d: 12, p: 1.75 }, { size: 'M16', d: 16, p: 2 }, { size: 'M20', d: 20, p: 2.5 }, { size: 'M24', d: 24, p: 3 },
  { size: 'M30', d: 30, p: 3.5 }, { size: '1/4-20', d: 6.35, p: 1.27 }, { size: '3/8-16', d: 9.525, p: 1.5875 },
];
/** Best standard size for a picked cylinder: shafts match the major diameter, holes the tap-drill (minor) diameter. */
export function guessThread(r: number, internal: boolean) {
  const D = 2 * r;
  let best = THREADS[0], err = Infinity;
  for (const t of THREADS) { const e = Math.abs((internal ? t.d - 1.0825 * t.p : t.d) - D); if (e < err) { err = e; best = t; } }
  return err < Math.max(0.6, D * 0.12) ? best : null;
}
