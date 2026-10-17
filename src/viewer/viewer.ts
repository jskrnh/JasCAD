import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { RebuildResult, FaceInfo, EdgeInfo, SketchDisplay, V3 } from '../model/types';
import { NAV_PRESETS, matchBinding, type NavOp, type NavSettings } from './nav';
import { SpaceMouse } from './spacemouse';

export interface PickInfo { kind: 'face' | 'edge' | 'none'; id: number; point: V3 | null; face?: FaceInfo; edge?: EdgeInfo; shift: boolean; ctrl: boolean }

const C_EDGE = 0x1b232d, C_SEL = 0xe8740c, C_HOVER = 0xf4a259;
const SKETCH = 0x1e3f7a, SKETCH_ACTIVE = 0x1f5fd1;

export const VIEWS: Record<string, { dir: V3; up: V3 }> = {
  Front: { dir: [0, -1, 0], up: [0, 0, 1] }, Back: { dir: [0, 1, 0], up: [0, 0, 1] },
  Left: { dir: [-1, 0, 0], up: [0, 0, 1] }, Right: { dir: [1, 0, 0], up: [0, 0, 1] },
  Top: { dir: [0, 0, 1], up: [0, 1, 0] }, Bottom: { dir: [0, 0, -1], up: [0, -1, 0] },
  Isometric: { dir: [1, -1, 1], up: [0, 0, 1] }, Trimetric: { dir: [1, -1.6, 0.9], up: [0, 0, 1] },
};

export class Viewer {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private ortho: THREE.OrthographicCamera;
  private persp: THREE.PerspectiveCamera;
  cam: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  private target = new THREE.Vector3();
  private model = new THREE.Group();
  private sketchGroup = new THREE.Group();
  private planeGroup = new THREE.Group();
  private overlay = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private capMesh: THREE.Mesh | null = null;
  private edgeLines: LineSegments2 | null = null;
  private pickLines: THREE.LineSegments | null = null;
  private hlLines: LineSegments2 | null = null;
  private lineMats: LineMaterial[] = [];
  private triFace = new Int32Array(0);
  private segEdge = new Int32Array(0);
  private faceIndex = new Map<number, number>();
  faces: FaceInfo[] = [];
  edges: EdgeInfo[] = [];
  private faceVertRanges: [number, number][] = [];
  private edgeSegRanges = new Map<number, [number, number]>();
  private edgeLineData: Float32Array = new Float32Array(0) as Float32Array;
  private baseColors = new Float32Array(0);
  private dirty = true;
  private anim: ((t: number) => boolean) | null = null;
  private clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private sectionOn = false;
  private hoverKey = '';
  selected = new Set<string>();
  faceColor = new Map<number, string>();
  defaultColor = '#9fb3cc';
  overhang: { on: boolean; angle: number } = { on: false, angle: 45 };
  nav: NavSettings;
  space = new SpaceMouse();
  pickFilter: 'any' | 'face' | 'edge' | 'none' = 'any';
  onPick: (p: PickInfo) => void = () => {};
  onHover: (p: PickInfo) => void = () => {};
  onCanvasMove: (e: PointerEvent) => void = () => {};
  onCanvasDown: (e: PointerEvent) => boolean = () => false;
  onCanvasUp: (e: PointerEvent) => void = () => {};
  onCameraChange: () => void = () => {};
  private cube!: HTMLElement;
  

  constructor(el: HTMLElement, nav: NavSettings) {
    this.el = el; this.nav = nav;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'vp-canvas';
    el.prepend(this.canvas);

    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    this.persp = new THREE.PerspectiveCamera(35, 1, 0.1, 100000);
    this.cam = nav.projection === 'perspective' ? this.persp : this.ortho;
    for (const c of [this.ortho, this.persp]) {
      c.up.set(0, 0, 1);
      const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(0.35, 1.8, 0.9);
      const fill = new THREE.DirectionalLight(0xe6edf7, 0.65); fill.position.set(-1.4, -0.3, 0.8);
      key.target.position.set(0, 0, -1); fill.target.position.set(0, 0, -1);
      c.add(key, fill, key.target, fill.target);
      this.scene.add(c);
    }
    this.scene.add(new THREE.HemisphereLight(0xf6f8fb, 0x9aa6b5, 1.05));
    this.scene.add(this.model, this.sketchGroup, this.planeGroup, this.overlay);
    this.ortho.position.set(300, -300, 300); this.ortho.zoom = 1;
    this.persp.position.copy(this.ortho.position);
    this.cam.lookAt(this.target);

    this.buildCube();
    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
    this.setView('Isometric', false);
    this.space.onButton = (i) => { if (i === 0) this.fit(true); else if (i === 1) this.setView('Isometric', true); };
    this.loop();
  }

  /* ---------------- scene content ---------------- */
  setResult(r: RebuildResult) {
    this.model.clear();
    this.mesh?.geometry.dispose(); this.capMesh?.geometry.dispose();
    this.edgeLines?.geometry.dispose(); this.pickLines?.geometry.dispose();
    this.mesh = this.capMesh = null; this.edgeLines = null; this.pickLines = null; this.hlLines = null;
    this.faces = r.faces; this.edges = r.edgeInfo;
    this.faceIndex = new Map(r.faces.map((f, i) => [f.id, i]));
    if (r.mesh && r.mesh.triangles.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(r.mesh.vertices, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(r.mesh.normals, 3));
      g.setIndex(new THREE.BufferAttribute(r.mesh.triangles, 1));
      const nTri = r.mesh.triangles.length / 3;
      this.triFace = new Int32Array(nTri).fill(-1);
      this.faceVertRanges = r.faces.map(() => [Infinity, -Infinity] as [number, number]);
      for (const fg of r.mesh.faceGroups) {
        const fi = this.faceIndex.get(fg.faceId) ?? -1;
        for (let t = fg.start / 3; t < (fg.start + fg.count) / 3; t++) {
          this.triFace[t] = fi;
          if (fi >= 0) for (let k = 0; k < 3; k++) { const v = r.mesh.triangles[t * 3 + k]; const rg = this.faceVertRanges[fi]; rg[0] = Math.min(rg[0], v); rg[1] = Math.max(rg[1], v); }
        }
      }
      const colors = new Float32Array(r.mesh.vertices.length);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      g.computeBoundingBox(); g.computeBoundingSphere();
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true, metalness: 0.08, roughness: 0.52, side: THREE.FrontSide,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, clippingPlanes: [],
      });
      this.mesh = new THREE.Mesh(g, mat);
      const cap = new THREE.MeshBasicMaterial({ color: 0xe8740c, side: THREE.BackSide, clippingPlanes: [] });
      this.capMesh = new THREE.Mesh(g, cap); this.capMesh.visible = false;
      this.model.add(this.mesh, this.capMesh);
    }
    if (r.edges && r.edges.lines.length) {
      this.edgeLineData = r.edges.lines;
      const nSeg = r.edges.lines.length / 6;
      this.segEdge = new Int32Array(nSeg).fill(-1);
      this.edgeSegRanges.clear();
      for (const eg of r.edges.edgeGroups) {
        // edgeGroups count in points (2 per segment)
        const s0 = eg.start / 2, s1 = (eg.start + eg.count) / 2;
        for (let s = s0; s < s1; s++) this.segEdge[s] = eg.edgeId;
        this.edgeSegRanges.set(eg.edgeId, [s0, s1]);
      }
      const lg = new LineSegmentsGeometry(); lg.setPositions(r.edges.lines);
      this.edgeLines = new LineSegments2(lg, this.lineMat(C_EDGE, 1.15));
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(r.edges.lines, 3));
      this.pickLines = new THREE.LineSegments(pg, new THREE.LineBasicMaterial({ visible: false }));
      this.model.add(this.edgeLines, this.pickLines);
    }
    // drop selections that no longer exist
    for (const k of [...this.selected]) {
      const id = +k.slice(2);
      if (k[0] === 'f' && !this.faceIndex.has(id)) this.selected.delete(k);
      if (k[0] === 'e' && !this.edgeSegRanges.has(id)) this.selected.delete(k);
    }
    this.applySection();
    this.recolor();
    this.dirty = true;
  }

  private lineMat(color: number, width: number, opts: Partial<{ depthTest: boolean; dashed: boolean }> = {}) {
    const m = new LineMaterial({ color, linewidth: width, worldUnits: false, depthTest: opts.depthTest ?? true, dashed: !!opts.dashed, dashSize: 2, gapSize: 1.5 });
    m.resolution.set(this.el.clientWidth, this.el.clientHeight);
    this.lineMats.push(m);
    return m;
  }

  recolor() {
    if (!this.mesh) return;
    const g = this.mesh.geometry;
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const arr = col.array as Float32Array;
    const c = new THREE.Color();
    const sel = new THREE.Color(C_SEL), hov = new THREE.Color(C_HOVER);
    const cosT = Math.cos((this.overhang.angle * Math.PI) / 180);
    const zmin = g.boundingBox ? g.boundingBox.min.z : 0;
    const okCol = new THREE.Color('#9fb3cc'), warn = new THREE.Color('#f2c94c'), bad = new THREE.Color('#d64545');
    this.faces.forEach((f, fi) => {
      const [a, b] = this.faceVertRanges[fi] || [Infinity, -Infinity];
      if (a > b) return;
      const key = 'f:' + f.id;
      const owner = this.faceColor.get(f.id);
      c.set(owner || this.defaultColor);
      if (this.selected.has(key)) c.lerp(sel, 0.75); else if (this.hoverKey === key) c.lerp(hov, 0.45);
      for (let v = a; v <= b; v++) {
        let cc = c;
        if (this.overhang.on) {
          const nz = nrm.getZ(v), z = pos.getZ(v);
          // surface facing down steeper than the allowed overhang angle (measured from vertical) needs support
          const down = -nz;
          if (down > cosT - 1e-6 && Math.abs(z - zmin) > 0.05 && f.type !== 'never') cc = bad;
          else if (down > Math.cos(((this.overhang.angle + 10) * Math.PI) / 180) && Math.abs(z - zmin) > 0.05) cc = warn;
          else cc = okCol;
          if (this.selected.has(key)) cc = sel;
        }
        arr[v * 3] = cc.r; arr[v * 3 + 1] = cc.g; arr[v * 3 + 2] = cc.b;
      }
    });
    col.needsUpdate = true;
    this.updateHighlightEdges();
    this.dirty = true;
  }

  /** Count faces that need support (for the print check). */
  overhangFaces(angle: number): number {
    if (!this.mesh) return 0;
    const g = this.mesh.geometry; const zmin = g.boundingBox!.min.z;
    const cosT = Math.cos((angle * Math.PI) / 180);
    let n = 0;
    for (const f of this.faces) {
      if (f.type === 'PLANE' && f.normal) { if (-f.normal[2] > cosT - 1e-6 && Math.abs(f.center[2] - zmin) > 0.05) n++; }
    }
    return n;
  }

  private updateHighlightEdges() {
    if (this.hlLines) { this.model.remove(this.hlLines); this.hlLines.geometry.dispose(); this.hlLines = null; }
    const keys = [...this.selected].filter((k) => k[0] === 'e');
    if (this.hoverKey.startsWith('e:') && !keys.includes(this.hoverKey)) keys.push(this.hoverKey);
    const pts: number[] = [];
    for (const k of keys) {
      const rg = this.edgeSegRanges.get(+k.slice(2)); if (!rg) continue;
      for (let s = rg[0]; s < rg[1]; s++) for (let j = 0; j < 6; j++) pts.push(this.edgeLineData[s * 6 + j]);
    }
    if (!pts.length) return;
    const g = new LineSegmentsGeometry(); g.setPositions(pts);
    this.hlLines = new LineSegments2(g, this.lineMat(C_SEL, 3.2, { depthTest: false }));
    this.hlLines.renderOrder = 10;
    this.model.add(this.hlLines);
  }

  setSketches(list: SketchDisplay[], activeId: string | null) {
    this.sketchGroup.clear();
    for (const s of list) {
      if (!s.lines.length) continue;
      const g = new LineSegmentsGeometry(); g.setPositions(s.lines);
      const active = s.featureId === activeId;
      const l = new LineSegments2(g, this.lineMat(active ? SKETCH_ACTIVE : SKETCH, active ? 2.2 : 1.6, { depthTest: !active }));
      l.renderOrder = active ? 8 : 2;
      this.sketchGroup.add(l);
    }
    this.dirty = true;
  }

  setModelVisible(v: boolean) { this.model.visible = v; this.dirty = true; }

  private ref: THREE.Mesh | null = null;
  /** Show an imported STL as a reference mesh (not part of the feature tree). */
  setReference(pos: Float32Array | null) {
    if (this.ref) { this.scene.remove(this.ref); this.ref.geometry.dispose(); this.ref = null; }
    if (pos) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.computeVertexNormals(); g.computeBoundingBox();
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
      this.ref = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.05, roughness: 0.6, flatShading: true }));
      this.scene.add(this.ref);
      this.recolorReference();
    }
    this.dirty = true;
  }
  recolorReference() {
    if (!this.ref) return;
    const g = this.ref.geometry; const n = g.getAttribute('normal'); const p = g.getAttribute('position');
    const col = g.getAttribute('color') as THREE.BufferAttribute; const a = col.array as Float32Array;
    const zmin = g.boundingBox!.min.z; const cosT = Math.cos((this.overhang.angle * Math.PI) / 180);
    const base = new THREE.Color('#c9b79c'), bad = new THREE.Color('#d64545'), ok = new THREE.Color('#9fb3cc');
    for (let i = 0; i < p.count; i++) {
      let c = base;
      if (this.overhang.on) c = -n.getZ(i) > cosT - 1e-6 && p.getZ(i) - zmin > 0.05 ? bad : ok;
      a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
    }
    col.needsUpdate = true; this.dirty = true;
  }
  referenceBox(): THREE.Box3 | null { return this.ref ? this.ref.geometry.boundingBox : null; }

  setPlanes(show: Record<'XY' | 'XZ' | 'YZ', boolean>, size = 60, origin = false) {
    this.planeGroup.clear();
    if (origin) {
      const L = size * 0.25;
      for (const [d, c] of [[[L, 0, 0], 0xc0392b], [[0, L, 0], 0x2e9a5b], [[0, 0, L], 0x1f5fd1]] as [V3, number][]) {
        const g = new LineSegmentsGeometry(); g.setPositions([0, 0, 0, ...d]);
        this.planeGroup.add(new LineSegments2(g, this.lineMat(c, 2, { depthTest: false })));
      }
    }
    const mk = (n: V3, x: V3, color: number) => {
      const N = new THREE.Vector3(...n), X = new THREE.Vector3(...x), Y = new THREE.Vector3().crossVectors(N, X);
      const s = size / 2;
      const corners = [[-s, -s], [s, -s], [s, s], [-s, s]].map(([a, b]) => X.clone().multiplyScalar(a).add(Y.clone().multiplyScalar(b)));
      const g = new THREE.BufferGeometry().setFromPoints([corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]]);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
      const lg = new LineSegmentsGeometry();
      lg.setPositions(corners.flatMap((c, i) => [c.x, c.y, c.z, corners[(i + 1) % 4].x, corners[(i + 1) % 4].y, corners[(i + 1) % 4].z]));
      const l = new LineSegments2(lg, this.lineMat(color, 1, { depthTest: true }));
      this.planeGroup.add(m, l);
    };
    if (show.XY) mk([0, 0, 1], [1, 0, 0], 0x5b7fb0);
    if (show.XZ) mk([0, -1, 0], [1, 0, 0], 0x5b7fb0);
    if (show.YZ) mk([1, 0, 0], [0, 1, 0], 0x5b7fb0);
    this.dirty = true;
  }

  /** Temporary drawing for sketch tools / previews (plane-local coordinates already mapped to 3D). */
  setOverlay(segments: number[], color = SKETCH_ACTIVE, points: number[] = []) {
    this.overlay.children.filter((c) => !c.userData.grid).forEach((c) => this.overlay.remove(c));
    if (segments.length) {
      const g = new LineSegmentsGeometry(); g.setPositions(segments);
      const l = new LineSegments2(g, this.lineMat(color, 2, { depthTest: false })); l.renderOrder = 9;
      this.overlay.add(l);
    }
    if (points.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe8740c, size: 7, sizeAttenuation: false, depthTest: false }));
      p.renderOrder = 10; this.overlay.add(p);
    }
    this.dirty = true;
  }

  setGrid(plane: { origin: V3; xDir: V3; normal: V3 } | null, extent = 200, step = 5) {
    this.overlay.children.filter((c) => c.userData.grid).forEach((c) => this.overlay.remove(c));
    if (!plane) { this.dirty = true; return; }
    const O = new THREE.Vector3(...plane.origin), X = new THREE.Vector3(...plane.xDir), N = new THREE.Vector3(...plane.normal), Y = new THREE.Vector3().crossVectors(N, X);
    const minor: number[] = [], major: number[] = [];
    for (let i = -extent; i <= extent; i += step) {
      const arr = i % (step * 2 * 5) === 0 ? major : minor;
      const a = O.clone().add(X.clone().multiplyScalar(i)).add(Y.clone().multiplyScalar(-extent));
      const b = O.clone().add(X.clone().multiplyScalar(i)).add(Y.clone().multiplyScalar(extent));
      const c = O.clone().add(Y.clone().multiplyScalar(i)).add(X.clone().multiplyScalar(-extent));
      const d = O.clone().add(Y.clone().multiplyScalar(i)).add(X.clone().multiplyScalar(extent));
      arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
    }
    const mk = (pts: number[], color: number, op: number) => {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false }));
      l.userData.grid = true; return l;
    };
    this.overlay.add(mk(minor, 0x7a8ba3, 0.18), mk(major, 0x4e6380, 0.35));
    this.dirty = true;
  }

  setSection(on: boolean, axis: 'x' | 'y' | 'z' = 'z', offset = 0, flip = false) {
    this.sectionOn = on;
    const n = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0).multiplyScalar(flip ? 1 : -1);
    this.clip.set(n, flip ? -offset : offset);
    this.applySection();
  }
  private applySection() {
    if (!this.mesh) return;
    const planes = this.sectionOn ? [this.clip] : [];
    (this.mesh.material as THREE.Material).clippingPlanes = planes;
    if (this.capMesh) { (this.capMesh.material as THREE.Material).clippingPlanes = planes; this.capMesh.visible = this.sectionOn; }
    for (const m of this.lineMats) m.clippingPlanes = planes;
    this.dirty = true;
  }

  bbox(): THREE.Box3 {
    const b = new THREE.Box3();
    if (this.mesh && this.model.visible) b.expandByObject(this.mesh);
    if (this.ref) b.expandByObject(this.ref);
    if (b.isEmpty()) this.sketchGroup.children.forEach((c) => b.expandByObject(c));
    if (b.isEmpty()) b.set(new THREE.Vector3(-30, -30, -30), new THREE.Vector3(30, 30, 30));
    return b;
  }

  /* ---------------- selection ---------------- */
  setHover(key: string) { if (key !== this.hoverKey) { this.hoverKey = key; this.recolor(); } }
  clearSelection() { this.selected.clear(); this.recolor(); }

  pickAt(clientX: number, clientY: number, mods = { shift: false, ctrl: false }): PickInfo {
    const none: PickInfo = { kind: 'none', id: 0, point: null, shift: mods.shift, ctrl: mods.ctrl };
    if (this.pickFilter === 'none') return none;
    const rc = this.ray(clientX, clientY);
    rc.params.Line = { threshold: this.worldPerPixel() * 6 };
    let faceHit: THREE.Intersection | null = null, edgeHit: THREE.Intersection | null = null;
    if (this.mesh && this.pickFilter !== 'edge') faceHit = rc.intersectObject(this.mesh, false).find((h) => !this.sectionOn || this.clip.distanceToPoint(h.point) >= 0) || null;
    if (this.pickLines && this.pickFilter !== 'face') edgeHit = rc.intersectObject(this.pickLines, false).find((h) => !this.sectionOn || this.clip.distanceToPoint(h.point) >= -0.01) || null;
    const tol = this.worldPerPixel() * 8;
    if (edgeHit && (!faceHit || edgeHit.distance <= faceHit.distance + tol)) {
      const seg = Math.floor((edgeHit.index ?? 0) / 2);
      const id = this.segEdge[seg];
      const edge = this.edges.find((e) => e.id === id);
      if (edge) return { kind: 'edge', id, point: edgeHit.point.toArray() as V3, edge, ...mods };
    }
    if (faceHit && faceHit.faceIndex != null) {
      const fi = this.triFace[faceHit.faceIndex];
      if (fi >= 0) return { kind: 'face', id: this.faces[fi].id, point: faceHit.point.toArray() as V3, face: this.faces[fi], ...mods };
    }
    return none;
  }

  private ray(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, this.cam);
    return rc;
  }

  /** Intersect the pointer ray with a plane; returns plane-local 2D coordinates. */
  planePoint(clientX: number, clientY: number, p: { origin: V3; xDir: V3; normal: V3 }): [number, number] | null {
    const rc = this.ray(clientX, clientY);
    const N = new THREE.Vector3(...p.normal), O = new THREE.Vector3(...p.origin);
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(N, O);
    const hit = rc.ray.intersectPlane(pl, new THREE.Vector3());
    if (!hit) return null;
    const X = new THREE.Vector3(...p.xDir), Y = new THREE.Vector3().crossVectors(N, X);
    const d = hit.sub(O);
    return [d.dot(X), d.dot(Y)];
  }

  worldPerPixel() {
    const h = this.el.clientHeight || 1;
    if (this.cam instanceof THREE.OrthographicCamera) return (this.cam.top - this.cam.bottom) / this.cam.zoom / h;
    const dist = this.cam.position.distanceTo(this.target);
    return (2 * dist * Math.tan((this.persp.fov * Math.PI) / 360)) / h;
  }

  /* ---------------- camera ---------------- */
  private resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    const half = 100, asp = w / h;
    this.ortho.left = -half * asp; this.ortho.right = half * asp; this.ortho.top = half; this.ortho.bottom = -half;
    this.ortho.updateProjectionMatrix();
    this.persp.aspect = asp; this.persp.updateProjectionMatrix();
    for (const m of this.lineMats) m.resolution.set(w, h);
    this.dirty = true;
  }

  setProjection(p: 'ortho' | 'perspective') {
    const from = this.cam, to = p === 'perspective' ? this.persp : this.ortho;
    if (from === to) return;
    const dir = from.position.clone().sub(this.target).normalize();
    to.up.copy(from.up);
    if (to === this.persp) {
      const viewH = (this.ortho.top - this.ortho.bottom) / this.ortho.zoom;
      const dist = viewH / 2 / Math.tan((this.persp.fov * Math.PI) / 360);
      to.position.copy(this.target).addScaledVector(dir, dist);
    } else {
      const dist = from.position.distanceTo(this.target);
      const viewH = 2 * dist * Math.tan((this.persp.fov * Math.PI) / 360);
      this.ortho.zoom = (this.ortho.top - this.ortho.bottom) / viewH;
      to.position.copy(this.target).addScaledVector(dir, 1000);
      this.ortho.updateProjectionMatrix();
    }
    to.lookAt(this.target);
    this.cam = to; this.dirty = true; this.onCameraChange();
  }

  private applyCam() { this.cam.lookAt(this.target); this.cam.updateMatrixWorld(); this.dirty = true; this.onCameraChange(); }

  rotate(dx: number, dy: number, pivot: THREE.Vector3) {
    const c = this.cam;
    const right = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 0);
    const yawAxis = this.nav.rotation === 'turntable' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 1);
    const q = new THREE.Quaternion().setFromAxisAngle(yawAxis, -dx * 0.006)
      .multiply(new THREE.Quaternion().setFromAxisAngle(right, -dy * 0.006));
    this.orbit(q, pivot);
  }
  private orbit(q: THREE.Quaternion, pivot: THREE.Vector3) {
    const c = this.cam;
    c.position.sub(pivot).applyQuaternion(q).add(pivot);
    this.target.sub(pivot).applyQuaternion(q).add(pivot);
    c.up.applyQuaternion(q);
    if (this.nav.rotation === 'turntable') {
      // keep Z up: avoid flipping over the pole
      const fwd = this.target.clone().sub(c.position).normalize();
      if (Math.abs(fwd.z) > 0.999) { /* allow top/bottom views */ } else {
        const r = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 0, 1)).normalize();
        c.up.crossVectors(r, fwd).normalize();
      }
    }
    this.applyCam();
  }
  roll(d: number) {
    const fwd = this.target.clone().sub(this.cam.position).normalize();
    this.cam.up.applyAxisAngle(fwd, d * 0.006);
    this.applyCam();
  }
  pan(dx: number, dy: number) {
    const c = this.cam; const k = this.worldPerPixel();
    const right = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 1);
    const v = right.multiplyScalar(-dx * k).add(up.multiplyScalar(dy * k));
    c.position.add(v); this.target.add(v); this.applyCam();
  }
  zoom(factor: number, clientX?: number, clientY?: number) {
    const before = clientX != null && this.nav.zoomToCursor ? this.cursorWorld(clientX, clientY!) : null;
    if (this.cam instanceof THREE.OrthographicCamera) {
      this.cam.zoom = THREE.MathUtils.clamp(this.cam.zoom * factor, 0.002, 2000); this.cam.updateProjectionMatrix();
    } else {
      const d = this.cam.position.clone().sub(this.target);
      this.cam.position.copy(this.target).addScaledVector(d, 1 / factor);
    }
    this.cam.updateMatrixWorld();
    if (before) {
      const after = this.cursorWorld(clientX!, clientY!);
      const v = before.sub(after); this.cam.position.add(v); this.target.add(v);
    }
    this.applyCam();
  }
  private cursorWorld(x: number, y: number) {
    const rc = this.ray(x, y);
    const fwd = this.target.clone().sub(this.cam.position).normalize();
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(fwd, this.target);
    return rc.ray.intersectPlane(pl, new THREE.Vector3()) || this.target.clone();
  }

  fit(animate = true) {
    const b = this.bbox(); const sphere = b.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 1);
    const dir = this.cam.position.clone().sub(this.target).normalize();
    this.animateTo(sphere.center, dir, this.cam.up.clone(), r, animate);
  }

  setView(name: string, animate = true) {
    const v = VIEWS[name]; if (!v) return;
    this.setViewDir(new THREE.Vector3(...v.dir).normalize(), new THREE.Vector3(...v.up), animate);
  }
  setViewDir(dir: THREE.Vector3, up: THREE.Vector3, animate = true, fit = true) {
    const b = this.bbox(); const s = b.getBoundingSphere(new THREE.Sphere());
    this.animateTo(fit ? s.center : this.target.clone(), dir, up, fit ? Math.max(s.radius, 1) : null, animate);
  }
  normalTo(n: V3, xDir: V3, origin?: V3) {
    const N = new THREE.Vector3(...n), X = new THREE.Vector3(...xDir);
    const up = new THREE.Vector3().crossVectors(N, X);
    this.animateTo(origin ? new THREE.Vector3(...origin) : this.bbox().getCenter(new THREE.Vector3()), N, up, null, true);
  }

  private animateTo(center: THREE.Vector3, dir: THREE.Vector3, up: THREE.Vector3, radius: number | null, animate: boolean) {
    const c = this.cam;
    const startQ = c.quaternion.clone();
    const m = new THREE.Matrix4().lookAt(dir.clone().multiplyScalar(1), new THREE.Vector3(), up);
    const endQ = new THREE.Quaternion().setFromRotationMatrix(m);
    const startT = this.target.clone();
    const ortho = c instanceof THREE.OrthographicCamera;
    const startZ = ortho ? (c as THREE.OrthographicCamera).zoom : c.position.distanceTo(this.target);
    const half = (this.ortho.top - this.ortho.bottom) / 2;
    const endZ = radius == null ? startZ : ortho ? half / (radius * 1.25) : (radius * 1.25) / Math.tan((this.persp.fov * Math.PI) / 360);
    const dur = animate ? 280 : 0; const t0 = performance.now();
    const step = (now: number) => {
      const k = dur ? Math.min(1, (now - t0) / dur) : 1; const e = 1 - Math.pow(1 - k, 3);
      const q = startQ.clone().slerp(endQ, e);
      this.target.lerpVectors(startT, center, e);
      const z = startZ + (endZ - startZ) * e;
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      if (ortho) { (c as THREE.OrthographicCamera).zoom = z; (c as THREE.OrthographicCamera).updateProjectionMatrix(); c.position.copy(this.target).addScaledVector(back, 1000); }
      else c.position.copy(this.target).addScaledVector(back, z);
      c.up.set(0, 1, 0).applyQuaternion(q);
      this.applyCam();
      return k < 1;
    };
    if (!dur) step(t0); else this.anim = step;
  }

  /* ---------------- input ---------------- */
  private bindInput() {
    const cv = this.canvas;
    let op: NavOp | null = null; let last = { x: 0, y: 0 }; let down = { x: 0, y: 0 }; let moved = false; let pivot = new THREE.Vector3();
    let navUsed = false; let leftDown = false;
    const preset = () => NAV_PRESETS.find((p) => p.name === this.nav.preset) || NAV_PRESETS[0];
    const startOp = (e: PointerEvent) => {
      const o = matchBinding(preset(), e);
      if (o && o !== op) {
        op = o; navUsed = true;
        if (o === 'rotate') {
          const selCenter = this.selectionCenter();
          if (selCenter) pivot = selCenter;
          else if (this.nav.rotateAboutPoint) { const h = this.pickAt(e.clientX, e.clientY); pivot = h.point ? new THREE.Vector3(...h.point) : this.bbox().getCenter(new THREE.Vector3()); }
          else pivot = this.bbox().getCenter(new THREE.Vector3());
        }
        cv.style.cursor = o === 'pan' ? 'move' : o === 'zoom' ? 'ns-resize' : 'grabbing';
      }
      return o;
    };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY }; down = { ...last }; moved = false; navUsed = false;
      if (startOp(e)) return;
      if (e.button === 0) { leftDown = true; if (this.onCanvasDown(e)) leftDown = false; }
    });
    cv.addEventListener('pointermove', (e) => {
      const dx = e.clientX - last.x, dy = e.clientY - last.y; last = { x: e.clientX, y: e.clientY };
      if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 4) moved = true;
      if (e.buttons) {
        const o = startOp(e) || op;
        if (o && matchBinding(preset(), e)) {
          leftDown = false;
          if (o === 'rotate') this.rotate(dx, dy, pivot);
          else if (o === 'pan') this.pan(dx, dy);
          else if (o === 'zoom') this.zoom(Math.exp(dy * 0.006), down.x, down.y);
          else if (o === 'roll') this.roll(dx);
          return;
        }
      }
      this.onCanvasMove(e);
      if (!e.buttons) this.queueHover(e);
    });
    cv.addEventListener('pointerup', (e) => {
      if (!e.buttons) { op = null; cv.style.cursor = ''; }
      if (e.button === 0) {
        if (leftDown && !moved) {
          const p = this.pickAt(e.clientX, e.clientY, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
          this.onPick(p);
        }
        leftDown = false;
        if (!navUsed) this.onCanvasUp(e);
      }
    });
    cv.addEventListener('contextmenu', (e) => { if (navUsed || preset().bindings.some((b) => b.buttons & 2)) e.preventDefault(); });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      let d = e.deltaY * (e.deltaMode === 1 ? 33 : 1);
      if (this.nav.invertWheel) d = -d;
      this.zoom(Math.exp(-d * 0.0015), e.clientX, e.clientY);
    }, { passive: false });
    cv.addEventListener('dblclick', (e) => { if (e.button === 1) this.fit(); });
    cv.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
    cv.addEventListener('pointerleave', () => this.setHover(''));
  }

  private hoverQueued: PointerEvent | null = null;
  private queueHover(e: PointerEvent) { this.hoverQueued = e; }

  private selectionCenter(): THREE.Vector3 | null {
    const pts: THREE.Vector3[] = [];
    for (const k of this.selected) {
      const id = +k.slice(2);
      if (k[0] === 'f') { const f = this.faces.find((x) => x.id === id); if (f) pts.push(new THREE.Vector3(...f.center)); }
      else { const e = this.edges.find((x) => x.id === id); if (e) pts.push(new THREE.Vector3(...e.mid)); }
    }
    if (!pts.length) return null;
    return pts.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / pts.length);
  }

  /* ---------------- 3D mouse ---------------- */
  private spaceStep(dt: number) {
    const m = this.space.read(); const s = this.nav.mouse3d;
    let { tx, ty, tz, rx, ry, rz } = m;
    const dead = 12;
    const dz = (v: number) => (Math.abs(v) < dead ? 0 : v);
    tx = dz(tx); ty = dz(ty); tz = dz(tz); rx = dz(rx); ry = dz(ry); rz = dz(rz);
    if (!(tx || ty || tz || rx || ry || rz)) return false;
    if (s.dominant) {
      const all = [tx, ty, tz, rx, ry, rz].map(Math.abs); const mx = Math.max(...all); const i = all.indexOf(mx);
      [tx, ty, tz, rx, ry, rz] = [tx, ty, tz, rx, ry, rz].map((v, j) => (j === i ? v : 0));
    }
    const k = s.speed * dt / 16.7;
    const pv = s.invertPan ? -1 : 1, zv = s.invertZoom ? -1 : 1, rv = s.invertRotate ? -1 : 1;
    const zoomVal = s.zoomAxis === 'z' ? tz : ty;
    const panY = s.zoomAxis === 'z' ? ty : tz;
    if (s.pan && (tx || panY)) this.pan(-tx * 0.02 * k * pv, panY * 0.02 * k * pv * (s.zoomAxis === 'z' ? -1 : 1));
    if (s.zoom && zoomVal) this.zoom(Math.exp(-zoomVal * 0.00012 * k * zv));
    if (s.rotate && (rx || ry || rz)) {
      const c = this.cam;
      const right = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 0);
      const up = s.lockHorizon || this.nav.rotation === 'turntable' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 1);
      const fwd = this.target.clone().sub(c.position).normalize();
      const a = 0.00009 * k * rv;
      const q = new THREE.Quaternion().setFromAxisAngle(up, rz * a)
        .multiply(new THREE.Quaternion().setFromAxisAngle(right, rx * a));
      if (!s.lockHorizon) q.multiply(new THREE.Quaternion().setFromAxisAngle(fwd, -ry * a));
      const pivot = this.selectionCenter() || this.bbox().getCenter(new THREE.Vector3());
      this.orbit(q, pivot);
    }
    return true;
  }

  /* ---------------- view cube ---------------- */
  private buildCube() {
    const wrap = document.createElement('div'); wrap.className = 'vcube';
    wrap.innerHTML = '<div class="vcube-stage"><div class="vcube-cube"></div></div><button class="vcube-home" title="Isometric (Ctrl+7)" aria-label="Isometric view"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9H3z"/></svg></button>';
    this.el.appendChild(wrap);
    this.cube = wrap.querySelector('.vcube-cube') as HTMLElement;
    // Faces are laid out in CSS space (x right, y down, z toward viewer) with world Front (-Y) facing the viewer.
    const faces: [string, string, string][] = [
      ['Front', 'FRONT', 'translateZ(32px)'], ['Back', 'BACK', 'rotateY(180deg) translateZ(32px)'],
      ['Right', 'RIGHT', 'rotateY(90deg) translateZ(32px)'], ['Left', 'LEFT', 'rotateY(-90deg) translateZ(32px)'],
      ['Top', 'TOP', 'rotateX(90deg) translateZ(32px)'], ['Bottom', 'BOTTOM', 'rotateX(-90deg) translateZ(32px)'],
    ];
    for (const [name, label, tf] of faces) {
      const el = document.createElement('button'); el.className = 'vcube-face'; el.textContent = label; el.title = name + ' view';
      el.style.transform = tf;
      el.addEventListener('click', () => this.setView(name));
      this.cube.appendChild(el);
    }
    (wrap.querySelector('.vcube-home') as HTMLElement).addEventListener('click', () => this.setView('Isometric'));
  }

  private updateCube() {
    const e = this.cam.matrixWorldInverse.elements;
    // T = F · V · M⁻¹ (see buildCube): columns of the CSS rotation matrix
    const c0 = [e[0], -e[1], e[2]], c1 = [-e[8], e[9], -e[10]], c2 = [-e[4], e[5], -e[6]];
    this.cube.style.transform = `matrix3d(${c0[0]},${c0[1]},${c0[2]},0,${c1[0]},${c1[1]},${c1[2]},0,${c2[0]},${c2[1]},${c2[2]},0,0,0,0,1)`;
  }

  /* ---------------- loop ---------------- */
  private lastT = performance.now();
  private loop = () => {
    const now = performance.now(); const dt = Math.min(50, now - this.lastT); this.lastT = now;
    if (this.anim && !this.anim(now)) this.anim = null;
    if (this.space.device) this.spaceStep(dt);
    if (this.hoverQueued) {
      const e = this.hoverQueued; this.hoverQueued = null;
      const p = this.pickAt(e.clientX, e.clientY);
      this.setHover(p.kind === 'none' ? '' : (p.kind === 'face' ? 'f:' : 'e:') + p.id);
      this.onHover(p);
    }
    if (this.dirty) {
      this.dirty = false;
      this.renderer.render(this.scene, this.cam);
      this.updateCube();
    }
    requestAnimationFrame(this.loop);
  };
  invalidate() { this.dirty = true; }
  snapshot(): string { this.renderer.render(this.scene, this.cam); return this.canvas.toDataURL('image/png'); }
}
