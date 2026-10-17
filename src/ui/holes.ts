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
