// jasCAD parametric feature tree — open, versioned JSON format ("pft/1.0").
// Every numeric field is an expression string ("20", "wall*2", "len/2+3") evaluated against `variables`.

export type Expr = string;
export type V3 = [number, number, number];

export interface PlaneRef {
  /** Named datum plane or a stored plane taken from a face. */
  kind: 'XY' | 'XZ' | 'YZ' | 'face';
  offset?: Expr;          // along normal, for datum planes
  origin?: V3;            // for kind = 'face'
  xDir?: V3;
  normal?: V3;
}

export type SketchEntity =
  | { id: string; kind: 'rect'; cx: Expr; cy: Expr; w: Expr; h: Expr; r?: Expr; angle?: Expr }
  | { id: string; kind: 'circle'; cx: Expr; cy: Expr; d: Expr }
  | { id: string; kind: 'polygon'; cx: Expr; cy: Expr; d: Expr; n: Expr; angle?: Expr }
  | { id: string; kind: 'slot'; cx: Expr; cy: Expr; l: Expr; w: Expr; angle?: Expr }
  | { id: string; kind: 'poly'; pts: [Expr, Expr][] };

/** Geometric references. `p` must lie on the entity; `t`/`n` and `k` let the kernel re-find it after upstream edits. */
export interface EdgeRef { p: V3; t?: V3; k?: string }   // midpoint, tangent, curve type
export interface FaceRef { p: V3; n?: V3; k?: string }   // centre, normal (planar), surface type

export type Op = 'add' | 'cut' | 'new';

interface Base {
  id: string;
  name: string;
  suppressed?: boolean;
  hidden?: boolean;
  color?: string;
}

export interface SketchF extends Base { type: 'sketch'; plane: PlaneRef; entities: SketchEntity[] }
export interface ExtrudeF extends Base {
  type: 'extrude'; sketch: string; depth: Expr; reverse?: boolean; symmetric?: boolean;
  throughAll?: boolean; draft?: Expr; op: Op;
}
export interface RevolveF extends Base { type: 'revolve'; sketch: string; angle: Expr; axis: 'x' | 'y'; op: Op }
export interface FilletF extends Base { type: 'fillet'; radius: Expr; edges: EdgeRef[] }
export interface ChamferF extends Base { type: 'chamfer'; distance: Expr; edges: EdgeRef[] }
export interface ShellF extends Base { type: 'shell'; thickness: Expr; faces: FaceRef[]; outward?: boolean }
export interface HoleF extends Base {
  type: 'hole'; plane: PlaneRef; points: [number, number][];
  preset: 'custom' | 'clearance' | 'tap' | 'insert';
  size: string;           // e.g. "M3"
  diameter: Expr; depth: Expr; throughAll?: boolean;
  cbore?: { d: Expr; depth: Expr } | null;
  chamferTop?: Expr;      // print-friendly lead-in
}
export interface PatternF extends Base {
  type: 'pattern'; mode: 'linear' | 'circular'; features: string[];
  dir: 'x' | 'y' | 'z'; count: Expr; spacing: Expr;      // linear
  dir2?: 'x' | 'y' | 'z' | null; count2?: Expr; spacing2?: Expr;
  axis?: 'x' | 'y' | 'z'; total?: Expr;                  // circular: count over total angle
}
export interface MirrorF extends Base { type: 'mirror'; plane: 'XY' | 'XZ' | 'YZ'; features: string[] /* empty = whole body */ }

export type Feature = SketchF | ExtrudeF | RevolveF | FilletF | ChamferF | ShellF | HoleF | PatternF | MirrorF;
export type FeatureType = Feature['type'];

export interface Material { name: string; density: number /* g/cm3 */; pricePerKg: number }

export interface Project {
  format: 'pft/1.0';
  name: string;
  units: 'mm';
  material: Material;
  printer: { nozzle: number; overhangAngle: number; flow: number /* mm3/s */; infill: number };
  variables: Record<string, Expr>;
  features: Feature[];
  rollback?: number | null; // index after which features are rolled back
}

export const MATERIALS: Material[] = [
  { name: 'PLA', density: 1.24, pricePerKg: 25 },
  { name: 'PETG', density: 1.27, pricePerKg: 28 },
  { name: 'ABS', density: 1.04, pricePerKg: 26 },
  { name: 'ASA', density: 1.07, pricePerKg: 32 },
  { name: 'TPU 95A', density: 1.21, pricePerKg: 40 },
  { name: 'PA12-CF', density: 1.15, pricePerKg: 70 },
  { name: 'SLA Standard resin', density: 1.15, pricePerKg: 45 },
];

export function newProject(): Project {
  return {
    format: 'pft/1.0', name: 'Part1', units: 'mm',
    material: MATERIALS[1],
    printer: { nozzle: 0.4, overhangAngle: 45, flow: 10, infill: 0.25 },
    variables: { wall: '2' },
    features: [], rollback: null,
  };
}

/* ---------- Kernel protocol ---------- */
export interface FaceInfo {
  id: number; owner: string | null; type: string; area: number;
  center: V3; normal: V3 | null; xDir: V3 | null;
}
export interface EdgeInfo { id: number; owner: string | null; type: string; length: number; mid: V3; tan: V3 }
export interface SketchDisplay { featureId: string; lines: number[]; origin: V3; xDir: V3; normal: V3 }
export interface RebuildResult {
  ok: boolean;
  mesh: { vertices: Float32Array; normals: Float32Array; triangles: Uint32Array; faceGroups: { start: number; count: number; faceId: number }[] } | null;
  edges: { lines: Float32Array; edgeGroups: { start: number; count: number; edgeId: number }[] } | null;
  faces: FaceInfo[];
  edgeInfo: EdgeInfo[];
  sketches: SketchDisplay[];
  props: { volume: number; area: number; com: V3; bbox: [V3, V3] } | null;
  errors: { featureId: string; message: string }[];
  ms: number;
}
