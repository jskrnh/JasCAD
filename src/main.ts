import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './styles.css';
import { KernelClient } from './kernel/client';
import { Viewer, VIEWS, type PickInfo } from './viewer/viewer';
import { NAV_PRESETS, loadNav, saveNav, type NavSettings } from './viewer/nav';
import { SpaceMouse } from './viewer/spacemouse';
import { icon } from './ui/icons';
import { HOLE_SIZES, holeValues, PRESET_LABEL } from './ui/holes';
import { Evaluator, tryEval } from './model/expr';
import { entityOutline, resolvePlane } from './kernel/build';
import { newProject, MATERIALS } from './model/types';
import type { Project, Feature, RebuildResult, SketchF, SketchEntity, PlaneRef, V3, HoleF, PatternF, MirrorF, ExtrudeF, RevolveF, FilletF, ChamferF, ShellF } from './model/types';
import { demoProject } from './model/demo';

/* ------------------------------------------------------------------ helpers */
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = (n: number, d = 2) => (Math.abs(n) < 1e-9 ? '0' : (+n.toFixed(d)).toString());
const num = (n: number) => fmt(n, 2);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

type Tool = 'select' | 'rect' | 'circle' | 'polygon' | 'slot' | 'poly';
interface Edit { draft: Feature; isNew: boolean; index: number; selEntity: string | null; tool: Tool; pendingPlane?: boolean }
type Info = 'measure' | 'mass' | 'section' | 'print' | 'vars' | null;

const TYPE_LABEL: Record<string, string> = { sketch: 'Sketch', extrude: 'Extrude', revolve: 'Revolve', fillet: 'Fillet', chamfer: 'Chamfer', shell: 'Shell', hole: 'Hole', pattern: 'Pattern', mirror: 'Mirror' };
const PLANE_NAME: Record<string, string> = { XY: 'Top Plane', XZ: 'Front Plane', YZ: 'Right Plane', face: 'Face' };

class App {
  project: Project;
  edit: Edit | null = null;
  result: RebuildResult | null = null;
  past: string[] = []; future: string[] = [];
  tab = 'Solids';
  side: 'tree' | 'vars' = 'tree';
  cols = true;
  treeSel: string | null = null;
  info: Info = null;
  overhang = false;
  section = { on: false, axis: 'z' as 'x' | 'y' | 'z', pos: 50, flip: false };
  planes = { XY: false, XZ: false, YZ: false };
  origin = false;
  partHidden = false;
  partColor = '#9fb3cc';
  busy = false;
  nav: NavSettings = loadNav();
  kernel = new KernelClient();
  viewer!: Viewer;
  spaceName = '';
  toastTimer = 0;
  rebuildTimer = 0;
  drag: { start: [number, number]; cur: [number, number]; moved: boolean } | null = null;
  polyPts: [number, number][] = [];
  hoverPlanePt: [number, number] | null = null;

  constructor() {
    const saved = localStorage.getItem('forge.project');
    this.project = saved ? safeParse(saved) || demoProject() : demoProject();
    this.partColor = (this.project as any).color || '#9fb3cc';
    this.mount();
    this.kernel.onBusy = (b) => { this.busy = b; this.renderTop(); };
    this.kernel.onResult = (r) => this.onResult(r);
    this.kernel.ready.then(() => { this.rebuild(true); });
    this.viewer.space.onChange = (on, name) => { this.spaceName = on ? name : ''; this.renderTop(); this.toast(on ? `${name} connected` : '3D mouse disconnected'); };
    this.viewer.space.autoConnect();
  }

  /* ------------------------------------------------------------ layout */
  mount() {
    const app = $('#app');
    app.innerHTML = `
      <header class="top" id="top"></header>
      <nav class="ribbon" id="ribbon"></nav>
      <div class="body">
        <aside class="side" id="side"></aside>
        <section class="pm" id="pm"></section>
        <main class="vp" id="vp">
          <div class="hud" id="hud"></div>
          <svg class="triad" width="70" height="70" viewBox="-35 -35 70 70" id="triad" aria-label="Axis triad" role="img"></svg>
          <div id="vpextra"></div>
          <footer class="status" id="status"></footer>
        </main>
      </div>`;
    this.viewer = new Viewer($('#vp'), this.nav);
    this.viewer.onPick = (p) => this.onPick(p);
    this.viewer.onCanvasDown = (e) => this.sketchDown(e);
    this.viewer.onCanvasMove = (e) => this.sketchMove(e);
    this.viewer.onCanvasUp = (e) => this.sketchUp(e);
    this.viewer.onCameraChange = () => this.renderTriad();
    this.viewer.defaultColor = this.partColor;
    this.bindKeys();
    this.renderAll();
  }

  renderAll() { this.renderTop(); this.renderRibbon(); this.renderSide(); this.renderPanel(); this.renderHud(); this.renderStatus(); this.renderExtra(); this.renderTriad(); }

  /* ------------------------------------------------------------ project ops */
  snapshot() { return JSON.stringify(this.project); }
  commit(mutator: () => void, rebuild = true) {
    this.past.push(this.snapshot()); if (this.past.length > 100) this.past.shift();
    this.future = [];
    mutator();
    this.save();
    if (rebuild) this.rebuild();
    this.renderAll();
  }
  save() { (this.project as any).color = this.partColor; try { localStorage.setItem('forge.project', this.snapshot()); } catch { /* quota */ } }
  undo() { if (this.edit) return this.cancelEdit(); const s = this.past.pop(); if (!s) return; this.future.push(this.snapshot()); this.project = JSON.parse(s); this.save(); this.rebuild(); this.renderAll(); }
  redo() { const s = this.future.pop(); if (!s) return; this.past.push(this.snapshot()); this.project = JSON.parse(s); this.save(); this.rebuild(); this.renderAll(); }

  effective(): Project {
    const p = clone(this.project);
    if (this.edit) {
      const d = clone(this.edit.draft);
      if (d.type === 'sketch') d.hidden = false;
      if (this.edit.isNew) p.features.splice(this.edit.index, 0, d); else p.features[this.edit.index] = d;
      if (d.type === 'sketch') p.rollback = this.edit.index + 1;
      else if (p.rollback != null && this.edit.isNew) p.rollback = this.edit.index + 1;
    }
    return p;
  }
  rebuild(now = false) {
    clearTimeout(this.rebuildTimer);
    const go = () => this.kernel.rebuild(this.effective());
    if (now) go(); else this.rebuildTimer = window.setTimeout(go, 70);
  }

  onResult(r: RebuildResult) {
    const first = !this.result;
    this.result = r;
    const colors = new Map<number, string>();
    const featColor = new Map(this.effective().features.filter((f) => f.color).map((f) => [f.id, f.color!]));
    for (const f of r.faces) if (f.owner && featColor.has(f.owner)) colors.set(f.id, featColor.get(f.owner)!);
    this.viewer.faceColor = colors;
    this.viewer.defaultColor = this.partColor;
    this.viewer.setResult(r);
    this.syncPickHighlight();
    this.viewer.setSketches(r.sketches, this.edit?.draft.type === 'sketch' ? this.edit.draft.id : null);
    this.updatePlanes();
    this.viewer.setModelVisible(!this.partHidden);
    if (this.section.on) this.applySection();
    if (first) this.viewer.fit(false);
    this.renderSide(); this.renderStatus();
    if (this.edit || this.info) this.refreshPanelErrors();
    if (!this.edit && (!this.info || this.info === 'print' || this.info === 'mass')) { if (first || this.info) this.renderPanel(); }
  }

  updatePlanes() {
    const b = this.viewer.bbox();
    const size = Math.max(40, Math.min(400, Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) * 1.2));
    this.viewer.setPlanes(this.planes, size, this.origin);
  }

  /* ------------------------------------------------------------ header */
  renderTop() {
    const el = $('#top');
    const preset = this.nav.preset;
    el.innerHTML = `
      <div class="brand">${logo()}<span>Forge</span></div>
      <div style="display:flex;gap:2px">
        <button class="tbtn" id="fileBtn" aria-haspopup="menu">File</button>
        <button class="tbtn" id="undo" title="Undo (Ctrl+Z)" aria-label="Undo" ${this.past.length || this.edit ? '' : 'disabled'}>${icon('undo', 16)}</button>
        <button class="tbtn" id="redo" title="Redo (Ctrl+Y)" aria-label="Redo" ${this.future.length ? '' : 'disabled'}>${icon('redo', 16)}</button>
        <button class="tbtn" id="rebuildBtn" title="Rebuild (Ctrl+B)" aria-label="Rebuild">${this.busy ? '<span class="busy"></span>' : icon('rebuild', 16)}</button>
      </div>
      <div class="docname"><input id="docName" value="${esc(this.project.name)}" aria-label="Part name" spellcheck="false"/><span class="meta">· Part · mm · ${esc(this.project.material.name)}</span></div>
      <button class="tbtn" id="searchBtn" style="border:1px solid var(--line);width:190px;justify-content:flex-start;color:var(--muted)">${icon('search', 14)} Search commands <span style="margin-left:auto;font-family:var(--mono);font-size:11px">S</span></button>
      <button class="pill blue" id="navPill" title="Mouse navigation style">${icon('mouse3d', 14)} Nav: ${esc(preset)}</button>
      <button class="pill ${this.spaceName ? 'green' : 'grey'}" id="spacePill" title="3D mouse">${this.spaceName ? '<span class="dot"></span>' : ''}${this.spaceName ? 'SpaceMouse' : 'No 3D mouse'}</button>
      <button class="tbtn" id="gear" title="Settings" aria-label="Settings">${icon('gear', 18)}</button>`;
    $('#undo').onclick = () => this.undo();
    $('#redo').onclick = () => this.redo();
    $('#rebuildBtn').onclick = () => this.rebuild(true);
    $('#fileBtn').onclick = (e) => this.fileMenu(e.currentTarget as HTMLElement);
    $('#searchBtn').onclick = () => this.openSearch();
    $('#navPill').onclick = () => this.openSettings('nav');
    $('#spacePill').onclick = () => this.openSettings('nav');
    $('#gear').onclick = () => this.openSettings('nav');
    const dn = $<HTMLInputElement>('#docName');
    dn.onchange = () => this.commit(() => { this.project.name = dn.value.trim() || 'Part1'; }, false);
    dn.onkeydown = (e) => { if (e.key === 'Enter') dn.blur(); };
  }

  /* ------------------------------------------------------------ ribbon */
  commands(): Record<string, { id: string; label: string; icon: string; run?: () => void; on?: boolean; soon?: boolean; sep?: boolean }[]> {
    const inSketch = this.edit?.draft.type === 'sketch';
    const tool = (t: Tool) => () => this.setTool(t);
    return {
      Sketch: [
        { id: 'sketch', label: inSketch ? 'Exit sketch' : 'Sketch', icon: inSketch ? 'exitSketch' : 'sketch', run: () => (inSketch ? this.confirmEdit() : this.startFeature('sketch')) },
        { id: 'sep1', label: '', icon: '', sep: true },
        { id: 'rect', label: 'Rectangle', icon: 'rect', run: tool('rect'), on: inSketch && this.edit!.tool === 'rect' },
        { id: 'circle', label: 'Circle', icon: 'circle', run: tool('circle'), on: inSketch && this.edit!.tool === 'circle' },
        { id: 'polygon', label: 'Polygon', icon: 'polygon', run: tool('polygon'), on: inSketch && this.edit!.tool === 'polygon' },
        { id: 'slot', label: 'Slot', icon: 'slot', run: tool('slot'), on: inSketch && this.edit!.tool === 'slot' },
        { id: 'poly', label: 'Polyline', icon: 'poly', run: tool('poly'), on: inSketch && this.edit!.tool === 'poly' },
        { id: 'sep2', label: '', icon: '', sep: true },
        { id: 'line', label: 'Line / Arc', icon: 'line', soon: true },
        { id: 'dimension', label: 'Constraints', icon: 'dimension', soon: true },
      ],
      Solids: [
        { id: 'extrude', label: 'Extrude', icon: 'extrude', run: () => this.startFeature('extrude') },
        { id: 'cut', label: 'Cut', icon: 'cutExtrude', run: () => this.startFeature('extrude', { op: 'cut' }) },
        { id: 'revolve', label: 'Revolve', icon: 'revolve', run: () => this.startFeature('revolve') },
        { id: 'fillet', label: 'Fillet', icon: 'fillet', run: () => this.startFeature('fillet') },
        { id: 'chamfer', label: 'Chamfer', icon: 'chamfer', run: () => this.startFeature('chamfer') },
        { id: 'shell', label: 'Shell', icon: 'shell', run: () => this.startFeature('shell') },
        { id: 'hole', label: 'Hole', icon: 'hole', run: () => this.startFeature('hole') },
        { id: 'pattern', label: 'Linear pattern', icon: 'pattern', run: () => this.startFeature('pattern') },
        { id: 'cpattern', label: 'Circular pattern', icon: 'circPattern', run: () => this.startFeature('pattern', { mode: 'circular' }) },
        { id: 'mirror', label: 'Mirror', icon: 'mirror', run: () => this.startFeature('mirror') },
        { id: 'sepS', label: '', icon: '', sep: true },
        { id: 'sweep', label: 'Sweep', icon: 'sweep', soon: true },
        { id: 'loft', label: 'Loft', icon: 'loft', soon: true },
      ],
      Surfaces: [
        { id: 's1', label: 'Extruded', icon: 'sExtruded', soon: true }, { id: 's2', label: 'Revolved', icon: 'sRevolved', soon: true },
        { id: 's3', label: 'Lofted', icon: 'sLofted', soon: true }, { id: 's4', label: 'Boundary', icon: 'sBoundary', soon: true },
        { id: 's5', label: 'Fill', icon: 'sFill', soon: true }, { id: 's6', label: 'Offset', icon: 'sOffset', soon: true },
        { id: 's7', label: 'Trim', icon: 'sTrim', soon: true }, { id: 's8', label: 'Knit', icon: 'sKnit', soon: true },
        { id: 's9', label: 'Thicken', icon: 'sThicken', soon: true },
      ],
      Evaluate: [
        { id: 'measure', label: 'Measure', icon: 'measure', run: () => this.setInfo('measure'), on: this.info === 'measure' },
        { id: 'mass', label: 'Mass props', icon: 'massProps', run: () => this.setInfo('mass'), on: this.info === 'mass' },
        { id: 'section', label: 'Section', icon: 'section', run: () => this.toggleSection(), on: this.section.on },
        { id: 'overhangE', label: 'Overhang', icon: 'overhang', run: () => this.toggleOverhang(), on: this.overhang },
        { id: 'sepE', label: '', icon: '', sep: true },
        { id: 'thick', label: 'Thickness', icon: 'thickness', soon: true }, { id: 'curv', label: 'Curvature', icon: 'curvature', soon: true },
        { id: 'zebra', label: 'Zebra', icon: 'zebra', soon: true },
      ],
      Print: [
        { id: 'printcheck', label: 'Print check', icon: 'cost', run: () => this.setInfo('print'), on: this.info === 'print' },
        { id: 'overhangP', label: 'Overhang', icon: 'overhang', run: () => this.toggleOverhang(), on: this.overhang },
        { id: 'insert', label: 'Insert hole', icon: 'insert', run: () => this.startFeature('hole', { preset: 'insert' }) },
        { id: 'clear', label: 'Clearance hole', icon: 'clearance', run: () => this.startFeature('hole', { preset: 'clearance' }) },
        { id: 'tap', label: 'Self-tap hole', icon: 'thread', run: () => this.startFeature('hole', { preset: 'tap' }) },
        { id: 'sepP', label: '', icon: '', sep: true },
        { id: 'orient', label: 'Orient', icon: 'orient', soon: true }, { id: 'split', label: 'Split part', icon: 'split', soon: true },
        { id: 'snap', label: 'Snap-fit', icon: 'snapFit', soon: true },
      ],
      Mesh: [
        { id: 'impstl', label: 'Import STL', icon: 'importStl', run: () => this.importSTL() },
        { id: 'expstl', label: 'Export STL', icon: 'exportStl', run: () => this.exportFile('stl') },
        { id: 'expstep', label: 'Export STEP', icon: 'exportStep', run: () => this.exportFile('step') },
        { id: 'expjson', label: 'Export tree', icon: 'exportJson', run: () => this.exportJSON() },
        { id: 'sepM', label: '', icon: '', sep: true },
        { id: 'repair', label: 'Repair', icon: 'repair', soon: true }, { id: 'boolean', label: 'Mesh boolean', icon: 'combine', soon: true },
        { id: 'tosolid', label: 'To solid', icon: 'toSolid', soon: true },
      ],
    };
  }

  renderRibbon() {
    const el = $('#ribbon');
    const tabs = ['Sketch', 'Solids', 'Surfaces', 'Evaluate', 'Print', 'Mesh'];
    const cmds = this.commands()[this.tab];
    const note = this.tab === 'Surfaces' ? '<div class="rnote">Surface modelling is planned for Phase 2. Solid tools cover most printable parts today.</div>' : '';
    el.innerHTML = `<div class="tabs" role="tablist">${tabs.map((t) => `<button class="tab ${t === this.tab ? 'on' : ''}" role="tab" aria-selected="${t === this.tab}" data-tab="${t}">${t}</button>`).join('')}</div>
      <div class="cmds">${cmds.map((c) => c.sep ? '<div class="rsep"></div>' : `<button class="rb ${c.on ? 'on' : ''}" data-cmd="${c.id}" ${c.soon ? 'disabled title="Coming in Phase 2"' : `title="${esc(c.label)}"`}>${icon(c.icon, 28)}<span>${esc(c.label)}</span></button>`).join('')}${note}</div>`;
    el.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => (b.onclick = () => { this.tab = b.dataset.tab!; this.renderRibbon(); }));
    el.querySelectorAll<HTMLElement>('[data-cmd]').forEach((b) => (b.onclick = () => cmds.find((c) => c.id === b.dataset.cmd)?.run?.()));
  }

  /* ------------------------------------------------------------ feature tree */
  renderSide() {
    const el = $('#side');
    el.style.width = (this.cols ? 300 : 244) + 'px';
    const head = `<div class="side-tabs">
      <button class="stab ${this.side === 'tree' ? 'on' : ''}" data-side="tree">Tree</button>
      <button class="stab ${this.side === 'vars' ? 'on' : ''}" data-side="vars">Variables</button>
      <button class="sqbtn" id="colsBtn" title="${this.cols ? 'Collapse' : 'Expand'} display pane" aria-label="${this.cols ? 'Collapse' : 'Expand'} display pane">${icon(this.cols ? 'chevL' : 'chevR', 14)}</button></div>`;
    if (this.side === 'vars') { el.innerHTML = head + this.varsHTML(); this.bindSideHead(el); this.bindVars(el); return; }
    const errs = new Map((this.result?.errors || []).map((e) => [e.featureId, e.message]));
    const rb = this.project.rollback;
    const rows: string[] = [];
    const cols = (eye: string | null, sw: string | null, key: string) => !this.cols ? '' : `<div class="row-cols">
        ${eye == null ? '<span class="eye"></span>' : `<button class="eye" data-eye="${key}" aria-label="${eye === 'off' ? 'Show' : 'Hide'}">${icon(eye === 'off' ? 'eyeOff' : 'eye', 15)}</button>`}
        ${sw == null ? '<span class="swb"><span class="sw none"></span></span>' : `<label class="swb" title="Appearance"><span class="sw" style="background:${sw}"></span><input type="color" value="${sw}" data-color="${key}" aria-label="Appearance color"></label>`}</div>`;
    const row = (key: string, ic: string, name: string, meta: string, extra = '', eye: string | null = null, sw: string | null = null, indent = false) =>
      `<div class="row"><button class="row-main ${this.treeSel === key ? 'on' : ''} ${extra}" data-row="${key}" ${indent ? 'style="padding-left:22px"' : ''}>${icon(ic, 18)}<span class="row-name">${esc(name)}</span>${meta}</button>${cols(eye, sw, key)}</div>`;
    rows.push(row('part', 'part', this.project.name, '', '', this.partHidden ? 'off' : 'on', this.partColor));
    rows.push(row('material', 'material', 'Material: ' + this.project.material.name, '', '', null, null, true));
    for (const [k, n] of [['XZ', 'Front Plane'], ['XY', 'Top Plane'], ['YZ', 'Right Plane']] as const)
      rows.push(row('plane:' + k, 'plane', n, '', '', this.planes[k] ? 'on' : 'off', null, true));
    rows.push(row('origin', 'origin', 'Origin', '', '', this.origin ? 'on' : 'off', null, true));
    this.project.features.forEach((f, i) => {
      if (rb != null && i === rb) rows.push('<div class="rollbar" title="Rollback bar"></div>');
      const err = errs.get(f.id);
      const meta = err ? `<span class="row-err" title="${esc(err)}">!</span>` : `<span class="row-meta">${esc(featureMeta(f, this.project))}</span>`;
      const cls = `${f.suppressed ? 'sup' : ''} ${rb != null && i >= rb ? 'rolled' : ''}`;
      const ic = f.type === 'extrude' && f.op === 'cut' ? 'cutExtrude' : f.type === 'pattern' && f.mode === 'circular' ? 'circPattern' : f.type;
      const eye = f.type === 'sketch' ? (f.hidden ? 'off' : 'on') : null;
      const sw = f.type === 'sketch' ? null : f.color || this.partColor;
      rows.push(row(f.id, ic, f.name, meta, cls, eye, sw));
    });
    if (rb == null) rows.push('<div class="rollbar" title="Rollback bar — right-click a feature to roll back"></div>');
    el.innerHTML = head + (this.cols ? '<div class="colhead"><span style="flex:1">FEATURE</span><span style="width:33px;text-align:center">SHOW</span><span style="width:34px;text-align:center">COLOR</span></div>' : '') + `<div class="tree" role="tree">${rows.join('')}</div>`;
    this.bindSideHead(el);
    el.querySelectorAll<HTMLElement>('[data-row]').forEach((b) => {
      const key = b.dataset.row!;
      b.onclick = () => this.selectRow(key);
      b.ondblclick = () => { const f = this.project.features.find((x) => x.id === key); if (f) this.editFeature(f.id); };
      b.oncontextmenu = (e) => { e.preventDefault(); this.rowMenu(key, e.clientX, e.clientY); };
    });
    el.querySelectorAll<HTMLElement>('[data-eye]').forEach((b) => (b.onclick = () => this.toggleEye(b.dataset.eye!)));
    el.querySelectorAll<HTMLInputElement>('[data-color]').forEach((inp) => {
      inp.oninput = () => { (inp.previousElementSibling as HTMLElement).style.background = inp.value; };
      inp.onchange = () => this.setColor(inp.dataset.color!, inp.value);
    });
  }
  bindSideHead(el: HTMLElement) {
    el.querySelectorAll<HTMLElement>('[data-side]').forEach((b) => (b.onclick = () => { this.side = b.dataset.side as any; this.renderSide(); }));
    $('#colsBtn', el).onclick = () => { this.cols = !this.cols; this.renderSide(); };
  }

  selectRow(key: string) {
    this.treeSel = key;
    const f = this.project.features.find((x) => x.id === key);
    if (f && this.result) {
      // highlight faces created by this feature
      this.viewer.selected = new Set(this.result.faces.filter((fc) => fc.owner === key).map((fc) => 'f:' + fc.id));
      this.viewer.recolor();
    } else if (key === 'material') { this.setInfo('print'); }
    this.renderSide(); if (this.info === 'measure') this.renderPanel();
  }

  toggleEye(key: string) {
    if (key === 'part') { this.partHidden = !this.partHidden; this.viewer.setModelVisible(!this.partHidden); }
    else if (key.startsWith('plane:')) { const k = key.slice(6) as 'XY'; this.planes[k] = !this.planes[k]; this.updatePlanes(); }
    else if (key === 'origin') { this.origin = !this.origin; this.updatePlanes(); }
    else { const f = this.project.features.find((x) => x.id === key); if (f) return this.commit(() => { f.hidden = !f.hidden; }); }
    this.renderSide();
  }
  setColor(key: string, color: string) {
    if (key === 'part') return this.commit(() => { this.partColor = color; });
    const f = this.project.features.find((x) => x.id === key); if (f) this.commit(() => { f.color = color; });
  }

  rowMenu(key: string, x: number, y: number) {
    const i = this.project.features.findIndex((f) => f.id === key);
    if (i < 0) { if (key.startsWith('plane:')) this.menu([{ label: 'Sketch on this plane', icon: 'sketch', run: () => { this.treeSel = key; this.startFeature('sketch'); } }], x, y); return; }
    const f = this.project.features[i];
    const rb = this.project.rollback;
    this.menu([
      { label: 'Edit feature', icon: 'edit', run: () => this.editFeature(f.id), k: 'Dbl-click' },
      { label: 'Rename', icon: 'edit', run: () => this.rename(f.id), k: 'F2' },
      { label: f.suppressed ? 'Unsuppress' : 'Suppress', icon: 'suppress', run: () => this.commit(() => { f.suppressed = !f.suppressed; }) },
      ...(f.type === 'sketch' ? [{ label: f.hidden ? 'Show sketch' : 'Hide sketch', icon: 'eye', run: () => this.toggleEye(f.id) }] : []),
      ...(f.type === 'sketch' ? [{ label: 'Extrude this sketch', icon: 'extrude', run: () => { this.treeSel = f.id; this.startFeature('extrude'); } }] : []),
      { label: 'Move up', icon: 'chevL', run: () => this.moveFeature(i, -1) },
      { label: 'Move down', icon: 'chevR', run: () => this.moveFeature(i, 1) },
      { sep: true },
      { label: 'Roll back to here', icon: 'rollback', run: () => this.commit(() => { this.project.rollback = i; }) },
      ...(rb != null ? [{ label: 'Roll to end', icon: 'rollback', run: () => this.commit(() => { this.project.rollback = null; }) }] : []),
      { sep: true },
      { label: 'Delete', icon: 'trash', run: () => this.deleteFeature(f.id), k: 'Del' },
    ], x, y);
  }

  moveFeature(i: number, dir: number) {
    const j = i + dir; const fs = this.project.features;
    if (j < 0 || j >= fs.length) return;
    const a = fs[i], b = fs[j];
    const uses = (x: Feature, y: Feature) => (x as any).sketch === y.id || ((x as any).features || []).includes(y.id);
    if ((dir < 0 && uses(a, b)) || (dir > 0 && uses(b, a))) return this.toast(`${dir < 0 ? a.name : b.name} depends on ${dir < 0 ? b.name : a.name}`);
    this.commit(() => { fs[i] = b; fs[j] = a; });
  }

  rename(id: string) {
    const f = this.project.features.find((x) => x.id === id); if (!f) return;
    const btn = document.querySelector<HTMLElement>(`[data-row="${id}"] .row-name`); if (!btn) return;
    const inp = document.createElement('input'); inp.value = f.name; inp.style.cssText = 'width:100%;font:inherit;border:1px solid var(--accent);border-radius:4px;padding:1px 4px';
    btn.replaceWith(inp); inp.focus(); inp.select();
    const done = (ok: boolean) => { if (ok && inp.value.trim()) this.commit(() => { f.name = inp.value.trim(); }, false); else this.renderSide(); };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
    inp.onblur = () => done(true); inp.onclick = (e) => e.stopPropagation();
  }

  deleteFeature(id: string) {
    const f = this.project.features.find((x) => x.id === id); if (!f) return;
    const deps = this.project.features.filter((x) => (x as any).sketch === id || ((x as any).features || []).includes(id));
    this.commit(() => {
      const drop = new Set([id, ...(f.type === 'sketch' ? deps.map((d) => d.id) : [])]);
      this.project.features = this.project.features.filter((x) => !drop.has(x.id));
      for (const x of this.project.features) if ((x as any).features) (x as any).features = (x as any).features.filter((y: string) => !drop.has(y));
      if (this.project.rollback != null) this.project.rollback = Math.min(this.project.rollback, this.project.features.length);
    });
    if (deps.length && f.type === 'sketch') this.toast(`Deleted ${f.name} and ${deps.length} feature(s) that used it`);
  }

  /* ------------------------------------------------------------ variables */
  varsHTML() {
    const vars = this.project.variables;
    return `<div class="vars">
      <div class="hint">Use variables in any dimension field, e.g. <code>wall*2</code> or <code>width/2 - 3</code>.</div>
      ${Object.entries(vars).map(([k, v]) => { const r = tryEval(vars, v); return `<div class="var">
        <input value="${esc(k)}" data-vname="${esc(k)}" aria-label="Variable name" spellcheck="false">
        <input value="${esc(v)}" data-vexpr="${esc(k)}" class="${r.ok ? '' : 'bad'}" aria-label="Value of ${esc(k)}" spellcheck="false">
        <button class="sqbtn" data-vdel="${esc(k)}" aria-label="Delete ${esc(k)}">${icon('trash', 14)}</button>
        <span class="v">${r.ok ? '= ' + num(r.v) : esc(r.err)}</span></div>`; }).join('')}
      <button class="btn" id="addVar">${icon('plus', 14)} Add variable</button></div>`;
  }
  bindVars(el: HTMLElement) {
    el.querySelectorAll<HTMLInputElement>('[data-vexpr]').forEach((i) => (i.onchange = () => this.commit(() => { this.project.variables[i.dataset.vexpr!] = i.value.trim() || '0'; })));
    el.querySelectorAll<HTMLInputElement>('[data-vname]').forEach((i) => (i.onchange = () => {
      const old = i.dataset.vname!, nu = i.value.trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nu) || nu in this.project.variables) { this.toast('Use letters, digits and _ (must be unique)'); this.renderSide(); return; }
      this.commit(() => {
        const vars: Record<string, string> = {};
        for (const [k, v] of Object.entries(this.project.variables)) vars[k === old ? nu : k] = v;
        this.project.variables = renameVarEverywhere(vars, old, nu);
        this.project.features = renameVarEverywhere(this.project.features, old, nu);
      });
    }));
    el.querySelectorAll<HTMLElement>('[data-vdel]').forEach((b) => (b.onclick = () => this.commit(() => { delete this.project.variables[b.dataset.vdel!]; })));
    $('#addVar', el).onclick = () => this.commit(() => { let n = 1; while (('v' + n) in this.project.variables) n++; this.project.variables['v' + n] = '10'; });
  }

  /* ------------------------------------------------------------ feature editing */
  nextName(type: string) { return this.nextLabel(TYPE_LABEL[type] || 'Feature'); }
  nextLabel(label: string) {
    let n = 1; const names = new Set(this.project.features.map((f) => f.name));
    while (names.has(`${label} ${n}`)) n++;
    return `${label} ${n}`;
  }
  insertIndex() { return this.project.rollback == null ? this.project.features.length : this.project.rollback; }
  lastSketch(): SketchF | null {
    const end = this.insertIndex();
    const sel = this.project.features.find((f) => f.id === this.treeSel && f.type === 'sketch') as SketchF | undefined;
    if (sel) return sel;
    const used = new Set(this.project.features.map((f) => (f as any).sketch).filter(Boolean));
    const list = this.project.features.slice(0, end).filter((f) => f.type === 'sketch') as SketchF[];
    return list.reverse().find((s) => !used.has(s.id)) || list[0] || null;
  }
  selectedEdges() { return [...this.viewer.selected].filter((k) => k[0] === 'e').map((k) => this.viewer.edges.find((e) => e.id === +k.slice(2))).filter(Boolean).map((e) => ({ p: e!.mid, t: e!.tan, k: e!.type })); }
  selectedFaces() { return [...this.viewer.selected].filter((k) => k[0] === 'f').map((k) => this.viewer.faces.find((f) => f.id === +k.slice(2))).filter(Boolean) as RebuildResult['faces']; }
  planeFromSelection(): PlaneRef | null {
    if (this.treeSel?.startsWith('plane:')) return { kind: this.treeSel.slice(6) as any };
    const f = this.selectedFaces().find((x) => x.type === 'PLANE' && x.normal);
    if (f) return facePlane(f);
    return null;
  }

  startFeature(type: Feature['type'], opts: any = {}) {
    if (this.edit) { if (this.edit.draft.type === 'sketch' && type !== 'sketch') this.confirmEdit(); else this.cancelEdit(); }
    const id = uid(); const name = this.nextName(type);
    let draft: Feature; let pendingPlane = false;
    switch (type) {
      case 'sketch': {
        const pl = this.planeFromSelection();
        draft = { id, type, name, plane: pl || { kind: 'XY' }, entities: [] };
        pendingPlane = !pl; break;
      }
      case 'extrude': {
        const s = this.lastSketch();
        if (!s) return this.toast('Create a sketch first (Sketch tab → Sketch)');
        draft = { id, type, name: opts.op === 'cut' ? this.nextLabel('Cut') : name, sketch: s.id, depth: opts.op === 'cut' ? '5' : '10', op: opts.op || 'add', throughAll: false } as ExtrudeF;
        if (!this.result?.mesh) (draft as ExtrudeF).op = 'add';
        break;
      }
      case 'revolve': {
        const s = this.lastSketch(); if (!s) return this.toast('Create a sketch first');
        draft = { id, type, name, sketch: s.id, angle: '360', axis: 'y', op: this.result?.mesh ? 'add' : 'add' } as RevolveF; break;
      }
      case 'fillet': draft = { id, type, name, radius: '1', edges: this.selectedEdges() } as FilletF; break;
      case 'chamfer': draft = { id, type, name, distance: '0.6', edges: this.selectedEdges() } as ChamferF; break;
      case 'shell': draft = { id, type, name, thickness: 'wall' in this.project.variables ? 'wall' : '2', faces: this.selectedFaces().map((f) => ({ p: f.center, n: f.normal || undefined, k: f.type })) } as ShellF; break;
      case 'hole': {
        const preset = opts.preset || 'clearance'; const hv = holeValues(preset, 'M3', true)!;
        const pl = this.planeFromSelection();
        draft = { id, type, name, plane: pl || { kind: 'XY' }, points: [], preset, size: 'M3', diameter: hv.diameter, depth: hv.depth, throughAll: hv.throughAll, cbore: hv.cbore } as HoleF;
        pendingPlane = !pl; break;
      }
      case 'pattern': {
        const tools = this.toolFeatures();
        const sel = tools.find((f) => f.id === this.treeSel) || tools[tools.length - 1];
        draft = { id, type, name: opts.mode === 'circular' ? this.nextLabel('Circular pattern') : name, mode: opts.mode || 'linear', features: sel ? [sel.id] : [], dir: 'x', count: opts.mode === 'circular' ? '6' : '3', spacing: '10', dir2: null, count2: '2', spacing2: '10', axis: 'z', total: '360' } as PatternF;
        break;
      }
      case 'mirror': draft = { id, type, name, plane: 'YZ', features: [] } as MirrorF; break;
      default: return;
    }
    this.info = null;
    this.edit = { draft, isNew: true, index: this.insertIndex(), selEntity: null, tool: type === 'sketch' ? 'rect' : 'select', pendingPlane };
    if (type === 'sketch') { this.tab = 'Sketch'; if (!pendingPlane) this.enterSketchView(); }
    this.applyPickMode();
    this.syncPickHighlight();
    this.rebuild(true); this.renderAll();
  }

  editFeature(id: string) {
    if (this.edit) this.cancelEdit();
    const i = this.project.features.findIndex((f) => f.id === id); if (i < 0) return;
    const draft = clone(this.project.features[i]);
    this.edit = { draft, isNew: false, index: i, selEntity: null, tool: 'select' };
    this.info = null;
    if (draft.type === 'sketch') { this.tab = 'Sketch'; this.enterSketchView(); }
    this.applyPickMode(); this.syncPickHighlight();
    this.rebuild(true); this.renderAll();
  }

  enterSketchView() {
    if (!this.edit || this.edit.draft.type !== 'sketch') return;
    const P = resolvePlane(this.edit.draft.plane, new Evaluator(this.project.variables));
    this.viewer.normalTo(P.normal, P.xDir);
    this.viewer.setGrid(P);
  }

  applyPickMode() {
    const d = this.edit?.draft;
    this.viewer.pickFilter = !d ? 'any' : d.type === 'fillet' || d.type === 'chamfer' ? 'edge' : d.type === 'shell' || d.type === 'hole' ? 'face' : d.type === 'sketch' ? (this.edit!.pendingPlane ? 'face' : 'none') : 'none';
    this.viewer.canvas.style.cursor = d?.type === 'sketch' && this.edit!.tool !== 'select' && !this.edit!.pendingPlane ? 'crosshair' : '';
  }

  syncPickHighlight() {
    const d = this.edit?.draft;
    if (!d) return;
    if (d.type === 'fillet' || d.type === 'chamfer') {
      const refs = d.edges;
      this.viewer.selected = new Set(this.viewer.edges.filter((e) => refs.some((r) => dist(r.p, e.mid) < 0.05)).map((e) => 'e:' + e.id));
    } else if (d.type === 'shell') {
      this.viewer.selected = new Set(this.viewer.faces.filter((f) => d.faces.some((r) => dist(r.p, f.center) < 1e-3)).map((f) => 'f:' + f.id));
    } else this.viewer.selected = new Set();
    this.viewer.recolor();
  }

  confirmEdit() {
    const e = this.edit; if (!e) return;
    const d = e.draft;
    if (d.type === 'sketch' && e.pendingPlane) return this.toast('Pick a plane or a flat face first');
    if (d.type === 'sketch' && !d.entities.length && e.isNew) { this.cancelEdit(); return; }
    const wasNewSketch = d.type === 'sketch' && e.isNew;
    this.commit(() => {
      if (e.isNew) {
        this.project.features.splice(e.index, 0, d);
        if (this.project.rollback != null) this.project.rollback = e.index + 1;
      } else this.project.features[e.index] = d;
      if ((d.type === 'extrude' || d.type === 'revolve')) { const s = this.project.features.find((f) => f.id === d.sketch); if (s) s.hidden = true; }
      this.edit = null;
    });
    this.exitEditView();
    if (wasNewSketch) { this.treeSel = d.id; this.startFeature('extrude'); this.tab = 'Solids'; this.renderRibbon(); this.viewer.setView('Isometric'); }
  }
  cancelEdit() {
    if (!this.edit) return;
    const wasSketch = this.edit.draft.type === 'sketch';
    this.edit = null; this.polyPts = []; this.drag = null;
    this.exitEditView(wasSketch);
    this.rebuild(true); this.renderAll();
  }
  exitEditView(wasSketch = true) {
    this.viewer.setGrid(null); this.viewer.setOverlay([]); this.viewer.pickFilter = 'any'; this.viewer.canvas.style.cursor = '';
    this.viewer.selected.clear(); this.viewer.recolor();
    if (wasSketch && this.tab === 'Sketch') { this.tab = 'Solids'; }
  }

  /** Mutate the draft and refresh the preview. */
  upd(fn: (d: any) => void, rerender = true) {
    if (!this.edit) return;
    fn(this.edit.draft);
    this.rebuild();
    if (rerender) this.renderPanel();
  }

  toolFeatures() { return this.project.features.slice(0, this.edit && !this.edit.isNew ? this.edit.index : this.insertIndex()).filter((f) => f.type === 'extrude' || f.type === 'revolve' || f.type === 'hole' || f.type === 'pattern'); }

  /* ------------------------------------------------------------ picking */
  onPick(p: PickInfo) {
    const e = this.edit;
    if (e) {
      const d = e.draft;
      if ((d.type === 'fillet' || d.type === 'chamfer') && p.kind === 'edge' && p.edge) {
        const i = d.edges.findIndex((r) => dist(r.p, p.edge!.mid) < 0.05);
        this.upd((x) => { if (i >= 0) x.edges.splice(i, 1); else x.edges.push({ p: p.edge!.mid, t: p.edge!.tan, k: p.edge!.type }); });
        this.syncPickHighlight(); return;
      }
      if (d.type === 'shell' && p.kind === 'face' && p.face) {
        const i = d.faces.findIndex((r) => dist(r.p, p.face!.center) < 1e-3);
        this.upd((x) => { if (i >= 0) x.faces.splice(i, 1); else x.faces.push({ p: p.face!.center, n: p.face!.normal || undefined, k: p.face!.type }); });
        this.syncPickHighlight(); return;
      }
      if ((d.type === 'sketch' && e.pendingPlane) && p.kind === 'face' && p.face) {
        if (p.face.type !== 'PLANE') return this.toast('Pick a flat face');
        this.upd((x) => { x.plane = facePlane(p.face!); });
        e.pendingPlane = false; this.applyPickMode(); this.enterSketchView(); this.renderAll(); return;
      }
      if (d.type === 'hole' && p.kind === 'face' && p.face && p.point) {
        if (p.face.type !== 'PLANE') return this.toast('Holes go on flat faces');
        const f = p.face;
        const ev = new Evaluator(this.project.variables);
        let P = resolvePlane(d.plane, ev);
        const samePlane = dot(P.normal, f.normal!) > 0.9999 && Math.abs(dot(sub(f.center, P.origin), P.normal)) < 1e-4;
        if (!samePlane || e.pendingPlane) {
          d.plane = facePlane(f); d.points = [];
          P = resolvePlane(d.plane, ev); e.pendingPlane = false;
        }
        const v = sub(p.point, P.origin);
        const pt: [number, number] = [snap(dot(v, P.xDir), 0.5), snap(dot(v, P.yDir), 0.5)];
        this.upd((x) => { x.points.push(pt); });
        return;
      }
      return;
    }
    // plain selection
    const key = p.kind === 'none' ? '' : (p.kind === 'face' ? 'f:' : 'e:') + p.id;
    if (!key) { if (!p.shift && !p.ctrl) this.viewer.selected.clear(); }
    else if (p.shift || p.ctrl) { if (this.viewer.selected.has(key)) this.viewer.selected.delete(key); else this.viewer.selected.add(key); }
    else { this.viewer.selected = new Set([key]); }
    const owner = p.face?.owner || p.edge?.owner || null;
    this.treeSel = owner || (key ? this.treeSel : null);
    this.viewer.recolor();
    this.renderSide();
    if (this.info === 'measure' || this.info === 'section') this.renderPanel();
  }

  /* ------------------------------------------------------------ sketching */
  setTool(t: Tool) {
    if (!this.edit || this.edit.draft.type !== 'sketch') { this.startFeature('sketch'); if (!this.edit) return; }
    this.edit!.tool = t; this.polyPts = []; this.drag = null; this.viewer.setOverlay([]);
    this.applyPickMode(); this.renderRibbon(); this.renderPanel(); this.renderExtra();
  }
  sketchPlane() {
    const d = this.edit?.draft; if (!d || d.type !== 'sketch' || this.edit!.pendingPlane) return null;
    return resolvePlane(d.plane, new Evaluator(this.project.variables));
  }
  planePt(e: PointerEvent): [number, number] | null {
    const P = this.sketchPlane(); if (!P) return null;
    const q = this.viewer.planePoint(e.clientX, e.clientY, P); if (!q) return null;
    if (e.altKey) return q;
    const step = niceStep(this.viewer.worldPerPixel() * 7);
    return [snap(q[0], step), snap(q[1], step)];
  }
  sketchDown(e: PointerEvent): boolean {
    const ed = this.edit; if (!ed || ed.draft.type !== 'sketch' || ed.pendingPlane) return false;
    const pt = this.planePt(e); if (!pt) return false;
    if (ed.tool === 'select') {
      // hit test entities
      const P = this.sketchPlane()!; const ev = new Evaluator(this.project.variables);
      const tol = this.viewer.worldPerPixel() * 8; let best: string | null = null; let bd = tol;
      for (const en of (ed.draft as SketchF).entities) {
        let o: [number, number][]; try { o = entityOutline(en, ev); } catch { continue; }
        for (let i = 0; i < o.length; i++) { const dd = segDist(pt, o[i], o[(i + 1) % o.length]); if (dd < bd) { bd = dd; best = en.id; } }
      }
      void P; ed.selEntity = best; this.renderPanel(); return true;
    }
    if (ed.tool === 'poly') {
      if (this.polyPts.length >= 3 && Math.hypot(pt[0] - this.polyPts[0][0], pt[1] - this.polyPts[0][1]) < this.viewer.worldPerPixel() * 10) { this.finishPoly(); return true; }
      this.polyPts.push(pt); this.drawPreview(pt); return true;
    }
    if (this.drag && !this.drag.moved) { this.drag.cur = pt; this.finishDrag(); return true; } // second click of click-click mode
    this.drag = { start: pt, cur: pt, moved: false };
    return true;
  }
  sketchMove(e: PointerEvent) {
    const ed = this.edit; if (!ed || ed.draft.type !== 'sketch' || ed.pendingPlane || ed.tool === 'select') return;
    const pt = this.planePt(e); if (!pt) return;
    this.hoverPlanePt = pt;
    if (this.drag) { this.drag.cur = pt; if (e.buttons & 1) this.drag.moved = true; }
    this.drawPreview(pt);
    this.renderCursorReadout(pt);
  }
  sketchUp(_e: PointerEvent) {
    if (this.drag && this.drag.moved) this.finishDrag();
  }
  previewEntity(): SketchEntity | null {
    const ed = this.edit; if (!ed || !this.drag) return null;
    const [x0, y0] = this.drag.start, [x1, y1] = this.drag.cur;
    const id = uid();
    switch (ed.tool) {
      case 'rect': return { id, kind: 'rect', cx: num((x0 + x1) / 2), cy: num((y0 + y1) / 2), w: num(Math.abs(x1 - x0)), h: num(Math.abs(y1 - y0)) };
      case 'circle': return { id, kind: 'circle', cx: num(x0), cy: num(y0), d: num(2 * Math.hypot(x1 - x0, y1 - y0)) };
      case 'polygon': { const r = Math.hypot(x1 - x0, y1 - y0); const a = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI - 90; return { id, kind: 'polygon', cx: num(x0), cy: num(y0), d: num(2 * r), n: '6', angle: num(a) }; }
      case 'slot': { const L = Math.hypot(x1 - x0, y1 - y0); const a = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI; const w = Math.max(1, Math.min(6, L / 2)); return { id, kind: 'slot', cx: num((x0 + x1) / 2), cy: num((y0 + y1) / 2), l: num(L), w: num(w), angle: num(a) }; }
    }
    return null;
  }
  drawPreview(cursor: [number, number]) {
    const P = this.sketchPlane(); if (!P) return;
    const to3 = (x: number, y: number) => [P.origin[0] + P.xDir[0] * x + P.yDir[0] * y, P.origin[1] + P.xDir[1] * x + P.yDir[1] * y, P.origin[2] + P.xDir[2] * x + P.yDir[2] * y];
    const segs: number[] = []; const pts: number[] = [...to3(...cursor)];
    if (this.edit!.tool === 'poly' && this.polyPts.length) {
      const all = [...this.polyPts, cursor];
      for (let i = 0; i < all.length - 1; i++) segs.push(...to3(...all[i]), ...to3(...all[i + 1]));
      this.polyPts.forEach((p) => pts.push(...to3(...p)));
    } else {
      const en = this.previewEntity();
      if (en) { try { const o = entityOutline(en, new Evaluator({})); for (let i = 0; i < o.length; i++) segs.push(...to3(...o[i]), ...to3(...o[(i + 1) % o.length])); } catch { /* ignore */ } }
    }
    this.viewer.setOverlay(segs, 0xe8740c, pts);
  }
  finishDrag() {
    const en = this.previewEntity(); this.drag = null; this.viewer.setOverlay([]);
    if (!en) return;
    const tiny = (v: string) => Math.abs(+v) < 0.2;
    if ((en.kind === 'rect' && (tiny(en.w) || tiny(en.h))) || (en.kind === 'circle' && tiny(en.d)) || (en.kind === 'polygon' && tiny(en.d)) || (en.kind === 'slot' && tiny(en.l))) return;
    this.upd((d: SketchF) => { d.entities.push(en); }, false);
    this.edit!.selEntity = en.id; this.renderPanel();
  }
  finishPoly() {
    if (this.polyPts.length >= 3) {
      const en: SketchEntity = { id: uid(), kind: 'poly', pts: this.polyPts.map(([x, y]) => [num(x), num(y)] as [string, string]) };
      this.upd((d: SketchF) => { d.entities.push(en); }, false);
      this.edit!.selEntity = en.id;
    }
    this.polyPts = []; this.viewer.setOverlay([]); this.renderPanel();
  }
  renderCursorReadout(pt: [number, number]) {
    const el = document.getElementById('cursorXY'); if (el) el.textContent = `X ${fmt(pt[0], 2)}  Y ${fmt(pt[1], 2)}`;
  }

  /* ------------------------------------------------------------ property panel */
  renderPanel() {
    const el = $('#pm');
    if (this.edit) { el.innerHTML = this.featurePanel(); this.bindPanel(el); this.refreshPanelErrors(); return; }
    if (this.info) { el.innerHTML = this.infoPanel(); this.bindInfo(el); return; }
    el.innerHTML = this.homePanel(); this.bindHome(el);
  }

  refreshPanelErrors() {
    const box = document.getElementById('featErr'); if (!box || !this.edit) return;
    const err = this.result?.errors.find((e) => e.featureId === this.edit!.draft.id);
    box.style.display = err ? '' : 'none'; box.textContent = err ? err.message : '';
  }

  pmHead(ic: string, title: string, actions = true) {
    return `<div class="pm-head"><div class="pm-title">${icon(ic, 22)}<span>${esc(title)}</span></div>${actions ? `<div style="display:flex;gap:6px">
      <button class="okbtn" id="ok" title="OK (Enter)" aria-label="Confirm">${icon('check', 16)}</button>
      <button class="xbtn" id="cancel" title="Cancel (Esc)" aria-label="Cancel">${icon('close', 14)}</button></div>` : `<button class="xbtn" id="closeInfo" aria-label="Close">${icon('close', 14)}</button>`}</div>`;
  }

  exprField(key: string, label: string, value: string, unit = 'mm') {
    const r = tryEval(this.project.variables, value);
    return `<label class="field ${r.ok ? '' : 'bad'}"><span>${esc(label)}</span><input data-expr="${key}" value="${esc(value)}" spellcheck="false" aria-label="${esc(label)}"><span class="val" data-val="${key}">${r.ok ? (value.trim() === num(r.v) ? unit : `${num(r.v)} ${unit}`) : '!'}</span></label>`;
  }
  seg(key: string, opts: [string, string][], value: string) {
    return `<div class="seg">${opts.map(([v, l]) => `<button data-seg="${key}" data-v="${v}" class="${v === value ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
  }
  check(key: string, label: string, on: boolean) { return `<label class="chk"><input type="checkbox" data-chk="${key}" ${on ? 'checked' : ''}> ${esc(label)}</label>`; }

  featurePanel(): string {
    const e = this.edit!; const d = e.draft;
    const err = `<div class="errbox" id="featErr" style="display:none"></div>`;
    const sketches = this.project.features.slice(0, e.isNew ? e.index : e.index).filter((f) => f.type === 'sketch') as SketchF[];
    const sketchSel = (cur: string) => `<label class="field"><span>Sketch</span><select data-sel="sketch">${sketches.map((s) => `<option value="${s.id}" ${s.id === cur ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>`;
    const opSeg = (op: string) => this.seg('op', [['add', 'Boss'], ['cut', 'Cut'], ['new', 'New body']], op);
    const icName = d.type === 'extrude' && d.op === 'cut' ? 'cutExtrude' : d.type === 'pattern' && d.mode === 'circular' ? 'circPattern' : d.type;
    let body = '';
    switch (d.type) {
      case 'sketch': {
        if (e.pendingPlane) {
          body = `<div class="grp"><span class="lbl">Sketch plane</span><div class="hint">Pick a datum plane, or click a flat face in the viewport.</div>
            ${this.seg('plane', [['XZ', 'Front'], ['XY', 'Top'], ['YZ', 'Right']], '')}</div>`;
          break;
        }
        const pk = d.plane.kind;
        body = `<div class="grp"><span class="lbl">Plane</span>${pk === 'face' ? `<div class="kv"><span>On face</span><b>${fmtV(d.plane.normal!)}</b></div>` : this.seg('plane', [['XZ', 'Front'], ['XY', 'Top'], ['YZ', 'Right']], pk)}
          ${this.exprField('offset', 'Offset', d.plane.offset || '0')}</div>
          <div class="grp"><span class="lbl">Draw</span>${this.seg('tool', [['select', 'Select'], ['rect', 'Rect'], ['circle', 'Circle'], ['polygon', 'Poly'], ['slot', 'Slot'], ['poly', 'Line']], e.tool)}
          <div class="hint">${toolHint(e.tool)}</div></div>
          <div class="grp"><span class="lbl">Entities (${d.entities.length})</span>${d.entities.length ? d.entities.map((en) => this.entityCard(en, en.id === e.selEntity)).join('') : '<div class="hint">Nothing drawn yet.</div>'}</div>`;
        break;
      }
      case 'extrude':
        body = `<div class="grp"><span class="lbl">From</span>${sketchSel(d.sketch)}</div>
          <div class="grp"><span class="lbl">Operation</span>${opSeg(d.op)}</div>
          <div class="grp"><span class="lbl">Direction 1</span>${this.seg('end', [['blind', 'Blind'], ['mid', 'Mid-plane'], ...(d.op === 'cut' ? [['through', 'Through all'] as [string, string]] : [])], d.throughAll ? 'through' : d.symmetric ? 'mid' : 'blind')}
          ${d.throughAll ? '' : this.exprField('depth', 'Depth', d.depth)}
          ${this.check('reverse', 'Reverse direction', !!d.reverse)}
          ${this.exprField('draft', 'Draft°', d.draft || '0', '°')}</div>`;
        break;
      case 'revolve':
        body = `<div class="grp"><span class="lbl">From</span>${sketchSel(d.sketch)}</div>
          <div class="grp"><span class="lbl">Operation</span>${opSeg(d.op)}</div>
          <div class="grp"><span class="lbl">Axis (sketch)</span>${this.seg('axis', [['x', 'Sketch X'], ['y', 'Sketch Y']], d.axis)}${this.exprField('angle', 'Angle', d.angle, '°')}</div>`;
        break;
      case 'fillet': case 'chamfer': {
        const key = d.type === 'fillet' ? 'radius' : 'distance';
        body = `<div class="grp"><span class="lbl">Edges (${d.edges.length})</span><div class="list active">${d.edges.length ? d.edges.map((r, i) => `<div class="li ${i === d.edges.length - 1 ? 'on' : ''}"><span>Edge ${i + 1}</span><span class="row-meta">${fmtV(r.p)}</span><button class="x" data-rmedge="${i}" aria-label="Remove edge">✕</button></div>`).join('') : '<div class="hint" style="padding:6px">Click edges in the viewport.</div>'}</div></div>
          <div class="grp"><span class="lbl">${d.type === 'fillet' ? 'Radius' : 'Distance'}</span>${this.exprField(key, d.type === 'fillet' ? 'R' : 'D', (d as any)[key])}</div>`;
        break;
      }
      case 'shell':
        body = `<div class="grp"><span class="lbl">Faces to remove (${d.faces.length})</span><div class="list active">${d.faces.length ? d.faces.map((r, i) => `<div class="li"><span>Face ${i + 1}</span><button class="x" data-rmface="${i}" aria-label="Remove face">✕</button></div>`).join('') : '<div class="hint" style="padding:6px">Click faces to open (or leave empty for a closed hollow part).</div>'}</div></div>
          <div class="grp"><span class="lbl">Wall</span>${this.exprField('thickness', 'T', d.thickness)}${this.seg('sdir', [['in', 'Inward'], ['out', 'Outward']], d.outward ? 'out' : 'in')}</div>
          <div class="hint">Tip: a wall of at least 2 × nozzle (${fmt(this.project.printer.nozzle * 2)} mm) prints cleanly.</div>`;
        break;
      case 'hole': {
        const preset = d.preset;
        body = `<div class="grp"><span class="lbl">Type</span>${this.seg('preset', [['clearance', 'Clearance'], ['tap', 'Self-tap'], ['insert', 'Insert'], ['custom', 'Custom']], preset)}
          ${preset !== 'custom' ? `<label class="field"><span>Size</span><select data-sel="size">${HOLE_SIZES.map((s) => `<option ${s === d.size ? 'selected' : ''}>${s}</option>`).join('')}</select></label>` : ''}
          ${preset === 'clearance' ? this.check('cbore', 'Counterbore for cap screw head', !!d.cbore) : ''}
          <div class="hint">${preset === 'insert' ? 'Sized for brass heat-set inserts (standard length).' : preset === 'tap' ? 'Undersized so screws cut their own thread in plastic.' : preset === 'clearance' ? 'Print-tuned clearance for a free fit.' : ''}</div></div>
          <div class="grp"><span class="lbl">Size</span>${this.exprField('diameter', 'Ø', d.diameter)}
          ${this.seg('hend', [['blind', 'Blind'], ['through', 'Through all']], d.throughAll ? 'through' : 'blind')}
          ${d.throughAll ? '' : this.exprField('depth', 'Depth', d.depth)}
          ${d.cbore ? `<div class="two">${this.exprField('cbd', 'Ø', d.cbore.d)}${this.exprField('cbh', 'H', d.cbore.depth)}</div>` : ''}</div>
          <div class="grp"><span class="lbl">Positions (${d.points.length})</span>
          <div class="hint">${e.pendingPlane ? 'Click a flat face to place the first hole.' : `On ${d.plane.kind === 'face' ? 'selected face' : PLANE_NAME[d.plane.kind]}. Click to add more; edit X/Y below.`}</div>
          ${d.points.map((pt, i) => `<div class="two" style="grid-template-columns:1fr 1fr auto"><label class="field"><span>X</span><input data-hpt="${i}:0" value="${pt[0]}"></label><label class="field"><span>Y</span><input data-hpt="${i}:1" value="${pt[1]}"></label><button class="sqbtn" style="height:34px;width:30px" data-rmpt="${i}" aria-label="Remove hole">✕</button></div>`).join('')}</div>`;
        break;
      }
      case 'pattern': {
        const tools = this.toolFeatures().filter((f) => f.id !== d.id);
        body = `<div class="grp"><span class="lbl">Features to pattern</span><div class="list">${tools.length ? tools.map((f) => `<label class="li chk"><span><input type="checkbox" data-pf="${f.id}" ${d.features.includes(f.id) ? 'checked' : ''}> ${esc(f.name)}</span></label>`).join('') : '<div class="hint" style="padding:6px">No extrudes, revolves or holes yet.</div>'}</div></div>
          <div class="grp"><span class="lbl">Type</span>${this.seg('mode', [['linear', 'Linear'], ['circular', 'Circular']], d.mode)}</div>
          ${d.mode === 'linear' ? `<div class="grp"><span class="lbl">Direction 1</span>${this.seg('dir', [['x', 'X'], ['y', 'Y'], ['z', 'Z']], d.dir)}<div class="two">${this.exprField('count', 'N', d.count, '×')}${this.exprField('spacing', 'Δ', d.spacing)}</div></div>
          <div class="grp"><span class="lbl">Direction 2</span>${this.seg('dir2', [['', 'None'], ['x', 'X'], ['y', 'Y'], ['z', 'Z']], d.dir2 || '')}${d.dir2 ? `<div class="two">${this.exprField('count2', 'N', d.count2 || '2', '×')}${this.exprField('spacing2', 'Δ', d.spacing2 || '10')}</div>` : ''}</div>`
          : `<div class="grp"><span class="lbl">Axis (through origin)</span>${this.seg('axis', [['x', 'X'], ['y', 'Y'], ['z', 'Z']], d.axis || 'z')}<div class="two">${this.exprField('count', 'N', d.count, '×')}${this.exprField('total', '∠', d.total || '360', '°')}</div></div>`}`;
        break;
      }
      case 'mirror': {
        const tools = this.toolFeatures().filter((f) => f.id !== d.id);
        body = `<div class="grp"><span class="lbl">Mirror plane</span>${this.seg('mplane', [['YZ', 'Right (YZ)'], ['XZ', 'Front (XZ)'], ['XY', 'Top (XY)']], d.plane)}</div>
          <div class="grp"><span class="lbl">What to mirror</span>${this.seg('mwhat', [['body', 'Whole body'], ['features', 'Features']], d.features.length ? 'features' : 'body')}
          ${d.features.length || (this as any)._mf ? `<div class="list">${tools.map((f) => `<label class="li chk"><span><input type="checkbox" data-pf="${f.id}" ${d.features.includes(f.id) ? 'checked' : ''}> ${esc(f.name)}</span></label>`).join('')}</div>` : ''}</div>`;
        break;
      }
    }
    return this.pmHead(icName, d.name) + `<div class="pm-body">${err}${body}</div>`;
  }

  entityCard(en: SketchEntity, on: boolean) {
    const f = (k: string, l: string, u = 'mm') => this.exprField(`en:${en.id}:${k}`, l, (en as any)[k] ?? '0', u);
    const title = { rect: 'Rectangle', circle: 'Circle', polygon: 'Polygon', slot: 'Slot', poly: 'Polyline' }[en.kind];
    let inner = '';
    if (en.kind === 'rect') inner = `<div class="two">${f('w', 'W')}${f('h', 'H')}</div><div class="two">${f('cx', 'X')}${f('cy', 'Y')}</div><div class="two">${f('r', 'R')}${f('angle', '∠', '°')}</div>`;
    if (en.kind === 'circle') inner = `${f('d', 'Ø')}<div class="two">${f('cx', 'X')}${f('cy', 'Y')}</div>`;
    if (en.kind === 'polygon') inner = `<div class="two">${f('d', 'Ø')}${f('n', 'N', 'sides')}</div><div class="two">${f('cx', 'X')}${f('cy', 'Y')}</div>${f('angle', '∠', '°')}`;
    if (en.kind === 'slot') inner = `<div class="two">${f('l', 'L')}${f('w', 'W')}</div><div class="two">${f('cx', 'X')}${f('cy', 'Y')}</div>${f('angle', '∠', '°')}`;
    if (en.kind === 'poly') inner = `<div class="hint">${en.pts.length} points</div>${en.pts.map((p, i) => `<div class="two">${this.exprField(`pp:${en.id}:${i}:0`, 'X' + (i + 1), p[0])}${this.exprField(`pp:${en.id}:${i}:1`, 'Y' + (i + 1), p[1])}</div>`).join('')}`;
    return `<div class="entity ${on ? 'on' : ''}" data-entity="${en.id}"><div class="entity-h"><span>${title}</span><button class="x" style="border:0;background:transparent;cursor:pointer;color:var(--muted)" data-rment="${en.id}" aria-label="Delete ${title}">${icon('trash', 14)}</button></div>${inner}</div>`;
  }

  bindPanel(el: HTMLElement) {
    const ok = el.querySelector<HTMLElement>('#ok'); if (ok) ok.onclick = () => this.confirmEdit();
    const cancel = el.querySelector<HTMLElement>('#cancel'); if (cancel) cancel.onclick = () => this.cancelEdit();
    const ed = this.edit!;
    // expression fields
    el.querySelectorAll<HTMLInputElement>('[data-expr]').forEach((inp) => {
      const key = inp.dataset.expr!;
      const set = (v: string) => this.setExpr(key, v);
      inp.oninput = () => {
        const r = tryEval(this.project.variables, inp.value);
        inp.parentElement!.classList.toggle('bad', !r.ok);
        const val = el.querySelector<HTMLElement>(`[data-val="${CSS.escape(key)}"]`);
        if (val) val.textContent = r.ok ? `${num(r.v)}` : '!';
        if (r.ok) { set(inp.value); }
      };
      inp.onchange = () => { this.renderPanel(); };
      inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { inp.blur(); } if (e.key === 'Escape') inp.blur(); };
      inp.onfocus = () => { const m = /^en:([^:]+)/.exec(key) || /^pp:([^:]+)/.exec(key); if (m && ed.selEntity !== m[1]) { ed.selEntity = m[1]; el.querySelectorAll('.entity').forEach((c) => c.classList.toggle('on', (c as HTMLElement).dataset.entity === m[1])); } };
    });
    el.querySelectorAll<HTMLElement>('[data-seg]').forEach((b) => (b.onclick = () => this.setSeg(b.dataset.seg!, b.dataset.v!)));
    el.querySelectorAll<HTMLInputElement>('[data-chk]').forEach((c) => (c.onchange = () => this.setChk(c.dataset.chk!, c.checked)));
    el.querySelectorAll<HTMLSelectElement>('[data-sel]').forEach((s) => (s.onchange = () => this.setSel(s.dataset.sel!, s.value)));
    el.querySelectorAll<HTMLElement>('[data-rmedge]').forEach((b) => (b.onclick = () => { this.upd((d) => d.edges.splice(+b.dataset.rmedge!, 1)); this.syncPickHighlight(); }));
    el.querySelectorAll<HTMLElement>('[data-rmface]').forEach((b) => (b.onclick = () => { this.upd((d) => d.faces.splice(+b.dataset.rmface!, 1)); this.syncPickHighlight(); }));
    el.querySelectorAll<HTMLElement>('[data-rment]').forEach((b) => (b.onclick = () => this.upd((d) => { d.entities = d.entities.filter((x: SketchEntity) => x.id !== b.dataset.rment); })));
    el.querySelectorAll<HTMLElement>('[data-rmpt]').forEach((b) => (b.onclick = () => this.upd((d) => d.points.splice(+b.dataset.rmpt!, 1))));
    el.querySelectorAll<HTMLInputElement>('[data-hpt]').forEach((i) => (i.onchange = () => { const [a, b] = i.dataset.hpt!.split(':').map(Number); const v = parseFloat(i.value); if (isFinite(v)) this.upd((d) => { d.points[a][b] = v; }); }));
    el.querySelectorAll<HTMLInputElement>('[data-pf]').forEach((c) => (c.onchange = () => this.upd((d) => { const id = c.dataset.pf!; d.features = c.checked ? [...new Set([...d.features, id])] : d.features.filter((x: string) => x !== id); })));
  }

  setExpr(key: string, v: string) {
    const ed = this.edit!; const d: any = ed.draft;
    if (key.startsWith('en:')) { const [, id, k] = key.split(':'); const en = d.entities.find((x: any) => x.id === id); if (en) en[k] = v; }
    else if (key.startsWith('pp:')) { const [, id, i, j] = key.split(':'); const en = d.entities.find((x: any) => x.id === id); if (en) en.pts[+i][+j] = v; }
    else if (key === 'offset') d.plane.offset = v;
    else if (key === 'cbd') d.cbore.d = v;
    else if (key === 'cbh') d.cbore.depth = v;
    else { d[key] = v; if (d.type === 'hole' && key === 'diameter') d.preset = 'custom'; }
    this.rebuild();
  }
  setSeg(key: string, v: string) {
    const ed = this.edit!;
    this.upd((d) => {
      switch (key) {
        case 'op': d.op = v;
          if (d.type === 'extrude' && /^(Extrude|Cut) \d+$/.test(d.name)) d.name = this.nextLabel(v === 'cut' ? 'Cut' : 'Extrude');
          break;
        case 'end': d.throughAll = v === 'through'; d.symmetric = v === 'mid'; break;
        case 'hend': d.throughAll = v === 'through'; break;
        case 'axis': d.axis = v; break;
        case 'sdir': d.outward = v === 'out'; break;
        case 'mode': d.mode = v; break;
        case 'dir': d.dir = v; break;
        case 'dir2': d.dir2 = v || null; break;
        case 'mplane': d.plane = v; break;
        case 'mwhat': if (v === 'body') { d.features = []; (this as any)._mf = false; } else { (this as any)._mf = true; } break;
        case 'tool': ed.tool = v as Tool; this.polyPts = []; this.drag = null; this.viewer.setOverlay([]); this.applyPickMode(); this.renderRibbon(); break;
        case 'plane':
          d.plane = { kind: v, offset: d.plane?.offset || '0' }; ed.pendingPlane = false;
          setTimeout(() => { this.applyPickMode(); this.enterSketchView(); this.renderRibbon(); });
          break;
        case 'preset': {
          d.preset = v; const hv = holeValues(v, d.size, true);
          if (hv) { d.diameter = hv.diameter; d.depth = hv.depth; d.throughAll = hv.throughAll; d.cbore = v === 'clearance' ? (d.cbore ? hv.cbore : null) : null; }
          break;
        }
      }
    });
  }
  setChk(key: string, on: boolean) {
    this.upd((d) => {
      if (key === 'reverse') d.reverse = on;
      if (key === 'cbore') { const hv = holeValues('clearance', d.size, true)!; d.cbore = on ? hv.cbore : null; }
    });
  }
  setSel(key: string, v: string) {
    this.upd((d) => {
      if (key === 'sketch') d.sketch = v;
      if (key === 'size') { d.size = v; const hv = holeValues(d.preset, v, !!d.cbore); if (hv) { d.diameter = hv.diameter; d.depth = hv.depth; d.throughAll = hv.throughAll; d.cbore = d.cbore ? hv.cbore : null; } }
    });
  }

  /* ------------------------------------------------------------ info panels */
  setInfo(i: Info) {
    if (this.edit) this.cancelEdit();
    this.info = this.info === i ? null : i;
    this.renderPanel(); this.renderRibbon();
  }
  homePanel() {
    const r = this.result; const hasModel = !!r?.mesh;
    return `${this.pmHead('part', 'Properties', false).replace('<button class="xbtn" id="closeInfo" aria-label="Close">' + icon('close', 14) + '</button>', '')}
      <div class="pm-body">
        ${hasModel ? '' : '<div class="card"><b>Start a part</b><div class="hint">1. Sketch tab → <b>Sketch</b>, pick the Top plane.<br>2. Drag a rectangle or circle.<br>3. Click ✓ — Extrude opens automatically.</div></div>'}
        <div class="grp"><span class="lbl">Quick start</span>
          <button class="btn" data-q="sketch">${icon('sketch', 18)} New sketch</button>
          <button class="btn" data-q="extrude">${icon('extrude', 18)} Extrude last sketch</button>
          <button class="btn" data-q="print">${icon('cost', 18)} Print check</button></div>
        <div class="hint">Select a face, edge or feature, then pick a command. Double-click a feature in the tree to edit it. Right-click for more.</div>
      </div>`;
  }
  bindHome(el: HTMLElement) {
    el.querySelectorAll<HTMLElement>('[data-q]').forEach((b) => (b.onclick = () => {
      const q = b.dataset.q!;
      if (q === 'sketch') this.startFeature('sketch'); else if (q === 'extrude') this.startFeature('extrude'); else this.setInfo('print');
    }));
  }
  stats() {
    const p = this.result?.props; if (!p) return null;
    const vol = p.volume, area = p.area, mat = this.project.material, pr = this.project.printer;
    const shell = Math.min(vol, area * (pr.nozzle * 2) * 0.55);
    const printed = shell + pr.infill * Math.max(0, vol - shell);
    const grams = (printed / 1000) * mat.density;
    const hours = (printed / Math.max(1, pr.flow)) * 1.35 / 3600;
    return { vol, area, mass: (vol / 1000) * mat.density, grams, hours, cost: (grams / 1000) * mat.pricePerKg, bbox: p.bbox, com: p.com };
  }
  infoPanel(): string {
    const s = this.stats();
    const mm = (v: number) => `${fmt(v, 2)} mm`;
    if (this.info === 'mass') {
      return this.pmHead('massProps', 'Mass properties', false) + `<div class="pm-body">${!s ? '<div class="hint">No solid yet.</div>' : `<div class="card">
        <div class="kv"><span>Material</span><b>${esc(this.project.material.name)} · ${this.project.material.density} g/cm³</b></div>
        <div class="kv"><span>Volume</span><b>${fmt(s.vol / 1000, 3)} cm³</b></div>
        <div class="kv"><span>Surface area</span><b>${fmt(s.area / 100, 2)} cm²</b></div>
        <div class="kv"><span>Mass (solid)</span><b>${fmt(s.mass, 2)} g</b></div>
        <div class="kv"><span>Centre of mass</span><b>${fmtV(s.com)}</b></div>
        <div class="kv"><span>Size X·Y·Z</span><b>${fmt(s.bbox[1][0] - s.bbox[0][0], 1)} × ${fmt(s.bbox[1][1] - s.bbox[0][1], 1)} × ${fmt(s.bbox[1][2] - s.bbox[0][2], 1)}</b></div></div>`}</div>`;
    }
    if (this.info === 'measure') {
      const faces = this.selectedFaces(); const edges = [...this.viewer.selected].filter((k) => k[0] === 'e').map((k) => this.viewer.edges.find((e) => e.id === +k.slice(2))!).filter(Boolean);
      let out = '';
      for (const f of faces) out += `<div class="card"><b>Face · ${f.type.toLowerCase()}</b><div class="kv"><span>Area</span><b>${fmt(f.area, 3)} mm²</b></div>${f.normal ? `<div class="kv"><span>Normal</span><b>${fmtV(f.normal)}</b></div>` : ''}<div class="kv"><span>Centre</span><b>${fmtV(f.center)}</b></div></div>`;
      for (const e of edges) out += `<div class="card"><b>Edge · ${e.type.toLowerCase()}</b><div class="kv"><span>Length</span><b>${mm(e.length)}</b></div><div class="kv"><span>Midpoint</span><b>${fmtV(e.mid)}</b></div></div>`;
      if (faces.length === 2 && faces[0].normal && faces[1].normal && Math.abs(dot(faces[0].normal, faces[1].normal)) > 0.9999) {
        out = `<div class="card" style="border-color:var(--sel)"><b>Distance (parallel faces)</b><div class="kv"><span>Normal distance</span><b>${mm(Math.abs(dot(sub(faces[1].center, faces[0].center), faces[0].normal)))}</b></div></div>` + out;
      } else if (faces.length + edges.length === 2) {
        const pts = [...faces.map((f) => f.center), ...edges.map((e) => e.mid)];
        out = `<div class="card" style="border-color:var(--sel)"><b>Distance</b><div class="kv"><span>Centre to centre</span><b>${mm(dist(pts[0], pts[1]))}</b></div><div class="kv"><span>ΔX ΔY ΔZ</span><b>${fmtV(sub(pts[1], pts[0]))}</b></div></div>` + out;
      }
      return this.pmHead('measure', 'Measure', false) + `<div class="pm-body"><div class="hint">Click faces or edges. Shift/Ctrl-click to add a second item for distance.</div>${out || ''}</div>`;
    }
    if (this.info === 'section') {
      const b = this.viewer.bbox();
      return this.pmHead('section', 'Section view', false) + `<div class="pm-body"><div class="grp"><span class="lbl">Plane</span>${this.seg('saxis', [['x', 'Right (X)'], ['y', 'Front (Y)'], ['z', 'Top (Z)']], this.section.axis)}</div>
        <div class="grp"><span class="lbl">Position</span><input type="range" id="spos" min="0" max="100" step="0.5" value="${this.section.pos}" aria-label="Section position" style="width:100%;accent-color:var(--accent)">
        <div class="kv"><span>Offset</span><b id="sval">${fmt(this.sectionOffset(b), 2)} mm</b></div>${this.check('sflip', 'Flip side', this.section.flip)}</div>
        <button class="btn" id="soff">Turn off section</button></div>`;
    }
    if (this.info === 'print') {
      const pr = this.project.printer;
      const oh = this.viewer.overhangFaces(pr.overhangAngle);
      const bedOK = s ? (s.bbox[1][0] - s.bbox[0][0] <= 256 && s.bbox[1][1] - s.bbox[0][1] <= 256 && s.bbox[1][2] - s.bbox[0][2] <= 256) : true;
      const onBed = s ? Math.abs(s.bbox[0][2]) < 0.01 : true;
      return this.pmHead('cost', 'Print check', false) + `<div class="pm-body">
        <div class="grp"><span class="lbl">Material</span><label class="field"><span>Mat</span><select id="matSel">${MATERIALS.map((m) => `<option ${m.name === this.project.material.name ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
        <div class="two"><label class="field"><span>$/kg</span><input id="price" value="${this.project.material.pricePerKg}"></label><label class="field"><span>g/cm³</span><input id="dens" value="${this.project.material.density}"></label></div></div>
        <div class="grp"><span class="lbl">Printer</span><div class="two"><label class="field"><span>Nozzle</span><input id="nozzle" value="${pr.nozzle}"></label><label class="field"><span>Infill %</span><input id="infill" value="${Math.round(pr.infill * 100)}"></label></div>
        <div class="two"><label class="field"><span>Overhang°</span><input id="ohang" value="${pr.overhangAngle}"></label><label class="field"><span>mm³/s</span><input id="flow" value="${pr.flow}"></label></div></div>
        ${s ? `<div class="card">
          <div class="kv"><span>Fits 256 mm bed</span><b style="color:${bedOK ? 'var(--ok-ink)' : 'var(--err)'}">${bedOK ? 'Yes ✓' : 'No'}</b></div>
          <div class="kv"><span>Sits on bed (Z=0)</span><b style="color:${onBed ? 'var(--ok-ink)' : 'var(--warn)'}">${onBed ? 'Yes ✓' : 'Lifted ' + fmt(s.bbox[0][2], 2)}</b></div>
          <div class="kv"><span>Flat faces needing support</span><b style="color:${oh ? 'var(--warn)' : 'var(--ok-ink)'}">${oh}</b></div>
          <div class="kv"><span>Filament (est.)</span><b>${fmt(s.grams, 1)} g</b></div>
          <div class="kv"><span>Print time (est.)</span><b>${Math.floor(s.hours)} h ${Math.round((s.hours % 1) * 60)} m</b></div>
          <div class="kv"><span>Material cost (est.)</span><b>$${fmt(s.cost, 2)}</b></div></div>
          <button class="btn" id="ohBtn">${icon('overhang', 18)} ${this.overhang ? 'Hide' : 'Show'} overhang map</button>
          <div class="hint">Estimates use ${Math.round(pr.infill * 100)}% infill and 2 perimeters. Your slicer will be more exact.</div>` : '<div class="hint">No solid yet.</div>'}</div>`;
    }
    return '';
  }
  bindInfo(el: HTMLElement) {
    const c = el.querySelector<HTMLElement>('#closeInfo'); if (c) c.onclick = () => { if (this.info === 'section') this.toggleSection(); else { this.info = null; this.renderPanel(); this.renderRibbon(); } };
    el.querySelectorAll<HTMLElement>('[data-seg="saxis"]').forEach((b) => (b.onclick = () => { this.section.axis = b.dataset.v as any; this.applySection(); this.renderPanel(); }));
    const sp = el.querySelector<HTMLInputElement>('#spos');
    if (sp) sp.oninput = () => { this.section.pos = +sp.value; this.applySection(); $('#sval').textContent = fmt(this.sectionOffset(this.viewer.bbox()), 2) + ' mm'; };
    const sf = el.querySelector<HTMLInputElement>('[data-chk="sflip"]'); if (sf) sf.onchange = () => { this.section.flip = sf.checked; this.applySection(); };
    const so = el.querySelector<HTMLElement>('#soff'); if (so) so.onclick = () => this.toggleSection();
    const ms = el.querySelector<HTMLSelectElement>('#matSel');
    if (ms) ms.onchange = () => this.commit(() => { this.project.material = { ...MATERIALS.find((m) => m.name === ms.value)! }; }, false);
    const numIn = (id: string, fn: (v: number) => void) => { const i = el.querySelector<HTMLInputElement>('#' + id); if (i) i.onchange = () => { const v = parseFloat(i.value); if (isFinite(v) && v > 0) this.commit(() => fn(v), false); }; };
    numIn('price', (v) => (this.project.material.pricePerKg = v));
    numIn('dens', (v) => (this.project.material.density = v));
    numIn('nozzle', (v) => (this.project.printer.nozzle = v));
    numIn('infill', (v) => (this.project.printer.infill = Math.min(1, v / 100)));
    numIn('ohang', (v) => { this.project.printer.overhangAngle = Math.min(89, v); this.viewer.overhang.angle = this.project.printer.overhangAngle; this.viewer.recolor(); this.viewer.recolorReference(); });
    numIn('flow', (v) => (this.project.printer.flow = v));
    const oh = el.querySelector<HTMLElement>('#ohBtn'); if (oh) oh.onclick = () => this.toggleOverhang();
  }

  sectionOffset(b: any) {
    const a = this.section.axis; const lo = b.min[a], hi = b.max[a];
    return lo + ((hi - lo) * this.section.pos) / 100;
  }
  applySection() { this.viewer.setSection(this.section.on, this.section.axis, this.sectionOffset(this.viewer.bbox()), this.section.flip); }
  toggleSection() {
    this.section.on = !this.section.on;
    this.applySection();
    if (this.section.on) { if (this.edit) this.cancelEdit(); this.info = 'section'; } else if (this.info === 'section') this.info = null;
    this.renderPanel(); this.renderRibbon(); this.renderHud();
  }
  toggleOverhang() {
    this.overhang = !this.overhang;
    this.viewer.overhang = { on: this.overhang, angle: this.project.printer.overhangAngle };
    this.viewer.recolor(); this.viewer.recolorReference();
    this.renderRibbon(); this.renderHud(); this.renderExtra();
    if (this.info === 'print') this.renderPanel();
  }

  /* ------------------------------------------------------------ viewport chrome */
  renderHud() {
    const el = $('#hud');
    const b = (id: string, ic: string, label: string, on = false) => `<button class="tbtn ${on ? 'on' : ''}" id="${id}" title="${esc(label)}" aria-label="${esc(label)}">${icon(ic, 22)}</button>`;
    el.innerHTML = b('hFit', 'fit', 'Zoom to fit (F)') + b('hViews', 'views', 'View orientation (Space)') + b('hSection', 'section', 'Section view', this.section.on)
      + b('hMeasure', 'measure', 'Measure', this.info === 'measure') + b('hOverhang', 'overhang', 'Overhang analysis', this.overhang) + b('hMass', 'massProps', 'Mass properties', this.info === 'mass');
    $('#hFit').onclick = () => this.viewer.fit();
    $('#hViews').onclick = (e) => this.viewsMenu(e.currentTarget as HTMLElement);
    $('#hSection').onclick = () => this.toggleSection();
    $('#hMeasure').onclick = () => this.setInfo('measure');
    $('#hOverhang').onclick = () => this.toggleOverhang();
    $('#hMass').onclick = () => this.setInfo('mass');
  }
  renderExtra() {
    const el = $('#vpextra');
    let html = '';
    if (this.overhang) html += `<div class="legend"><span><i style="background:#9fb3cc"></i>OK</span><span><i style="background:#f2c94c"></i>Borderline</span><span><i style="background:#d64545"></i>Needs support &gt; ${this.project.printer.overhangAngle}°</span></div>`;
    const ed = this.edit;
    if (ed?.draft.type === 'sketch') html += `<div class="sketchbar">${ed.pendingPlane ? 'Pick a plane or flat face' : `Sketching on ${ed.draft.plane.kind === 'face' ? 'face' : PLANE_NAME[ed.draft.plane.kind]} · <span id="cursorXY" style="font-family:var(--mono)"></span>`}
      <button class="btn" id="sbExit" style="background:#fff;color:#1e3f7a">${icon('exitSketch', 16)} Exit sketch</button></div>`;
    el.innerHTML = html;
    const ex = el.querySelector<HTMLElement>('#sbExit'); if (ex) ex.onclick = () => this.confirmEdit();
  }
  renderStatus() {
    const el = $('#status'); const r = this.result; const s = this.stats();
    const errs = r?.errors.length || 0;
    const preset = NAV_PRESETS.find((p) => p.name === this.nav.preset)!;
    el.innerHTML = `${!r ? '<span>Loading geometry kernel…</span>' : errs ? `<span class="bad">● ${errs} feature error${errs > 1 ? 's' : ''}</span>` : '<span class="ok">● Rebuilt</span>'}
      ${r ? `<span>${r.ms} ms</span>` : ''}
      ${s ? `<span>${fmt(s.mass, 1)} g · ${esc(this.project.material.name)}</span><span>Print ≈ ${Math.floor(s.hours)} h ${Math.round((s.hours % 1) * 60)} m</span>` : ''}
      <span class="sp">${preset.hints.slice(0, 3).map(([a, b]) => `${a}: ${b}`).join(' · ')}</span>
      <span style="font-family:var(--mono);color:var(--text)">mm</span>`;
  }
  renderTriad() {
    const el = document.getElementById('triad'); if (!el || !this.viewer) return;
    const m = this.viewer.cam.matrixWorldInverse.elements;
    const ax = (x: number, y: number, z: number) => [m[0] * x + m[4] * y + m[8] * z, -(m[1] * x + m[5] * y + m[9] * z)];
    const L = 24; const parts = [['X', [1, 0, 0], '#C0392B'], ['Y', [0, 1, 0], '#2E9A5B'], ['Z', [0, 0, 1], '#1F5FD1']] as const;
    el.innerHTML = parts.map(([n, v, c]) => { const [x, y] = ax(v[0], v[1], v[2]); return `<path d="M0 0L${x * L} ${y * L}" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/><text x="${x * (L + 7)}" y="${y * (L + 7) + 4}" font-size="11" font-weight="600" text-anchor="middle" fill="${c}" font-family="IBM Plex Sans">${n}</text>`; }).join('');
  }
  toast(msg: string) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); $('#vp').appendChild(t); }
    t.textContent = msg; t.style.display = '';
    clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => { t!.style.display = 'none'; }, 3200);
  }

  /* ------------------------------------------------------------ menus */
  menu(items: ({ label: string; icon?: string; run: () => void; k?: string } | { sep: true })[], x: number, y: number) {
    document.querySelectorAll('.menu.pop').forEach((m) => m.remove());
    const m = document.createElement('div'); m.className = 'menu pop'; m.setAttribute('role', 'menu');
    m.innerHTML = items.map((it, i) => 'sep' in it ? '<hr>' : `<button role="menuitem" data-i="${i}">${it.icon ? icon(it.icon, 16) : ''}<span>${esc(it.label)}</span>${it.k ? `<span class="k">${esc(it.k)}</span>` : ''}</button>`).join('');
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'; m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
    m.querySelectorAll<HTMLElement>('[data-i]').forEach((b) => (b.onclick = () => { m.remove(); (items[+b.dataset.i!] as any).run(); }));
    (m.querySelector('button') as HTMLElement)?.focus();
    const close = (e: Event) => { if (!m.contains(e.target as Node)) { m.remove(); document.removeEventListener('pointerdown', close, true); } };
    setTimeout(() => document.addEventListener('pointerdown', close, true));
    m.onkeydown = (e) => { if (e.key === 'Escape') m.remove(); };
  }
  fileMenu(anchor: HTMLElement) {
    const r = anchor.getBoundingClientRect();
    this.menu([
      { label: 'New part', icon: 'file', run: () => { if (confirm('Start a new part? Unsaved changes in this one are kept in undo history only.')) this.commit(() => { this.project = newProject(); this.partColor = '#9fb3cc'; this.viewer.setReference(null); }); } },
      { label: 'Open sample bracket', icon: 'part', run: () => this.commit(() => { this.project = demoProject(); }) },
      { label: 'Open project…', icon: 'open', run: () => this.openProject(), k: 'Ctrl+O' },
      { label: 'Save project (.forge.json)', icon: 'save', run: () => this.exportJSON(), k: 'Ctrl+S' },
      { sep: true },
      { label: 'Export STEP (AP214)', icon: 'exportStep', run: () => this.exportFile('step') },
      { label: 'Export STL (binary)', icon: 'exportStl', run: () => this.exportFile('stl') },
      { label: 'Export feature tree (JSON)', icon: 'exportJson', run: () => this.exportJSON() },
      { sep: true },
      { label: 'Import STL as reference', icon: 'importStl', run: () => this.importSTL() },
      ...(this.viewer.referenceBox() ? [{ label: 'Remove STL reference', icon: 'trash', run: () => this.viewer.setReference(null) }] : []),
    ], r.left, r.bottom + 4);
  }
  viewsMenu(anchor: HTMLElement) {
    const r = anchor.getBoundingClientRect();
    const keys: Record<string, string> = { Front: 'Ctrl+1', Back: 'Ctrl+2', Left: 'Ctrl+3', Right: 'Ctrl+4', Top: 'Ctrl+5', Bottom: 'Ctrl+6', Isometric: 'Ctrl+7' };
    const sf = this.selectedFaces().find((f) => f.normal);
    this.menu([
      ...Object.keys(VIEWS).map((v) => ({ label: v, icon: 'views', run: () => this.viewer.setView(v), k: keys[v] })),
      ...(sf ? [{ label: 'Normal to selection', icon: 'plane', run: () => this.viewer.normalTo(sf.normal!, sf.xDir!), k: 'Ctrl+8' }] : []),
      { sep: true },
      { label: this.nav.projection === 'ortho' ? 'Switch to perspective' : 'Switch to orthographic', icon: 'shaded', run: () => { this.nav.projection = this.nav.projection === 'ortho' ? 'perspective' : 'ortho'; saveNav(this.nav); this.viewer.setProjection(this.nav.projection); } },
    ], r.left, r.bottom + 6);
  }

  allCommands() {
    const out: { label: string; icon: string; run: () => void; tab: string }[] = [];
    for (const [tab, list] of Object.entries(this.commands())) for (const c of list) if (c.run && !c.sep) out.push({ label: c.label, icon: c.icon, run: c.run, tab });
    out.push({ label: 'Settings: navigation & 3D mouse', icon: 'gear', run: () => this.openSettings('nav'), tab: 'App' });
    out.push({ label: 'Settings: display', icon: 'gear', run: () => this.openSettings('display'), tab: 'App' });
    for (const v of Object.keys(VIEWS)) out.push({ label: `View: ${v}`, icon: 'views', run: () => this.viewer.setView(v), tab: 'View' });
    return out;
  }
  openSearch() {
    document.querySelector('.search')?.remove();
    const box = document.createElement('div'); box.className = 'search';
    box.innerHTML = `<input placeholder="Type a command…" aria-label="Search commands"><div class="menu" role="listbox"></div>`;
    document.body.appendChild(box);
    const inp = box.querySelector('input')!; const list = box.querySelector('.menu') as HTMLElement;
    let idx = 0; let items = this.allCommands();
    const draw = () => {
      const q = inp.value.toLowerCase().trim();
      items = this.allCommands().filter((c) => !q || c.label.toLowerCase().includes(q) || c.tab.toLowerCase().includes(q)).slice(0, 12);
      idx = Math.min(idx, Math.max(0, items.length - 1));
      list.innerHTML = items.map((c, i) => `<button class="${i === idx ? 'on' : ''}" data-i="${i}">${icon(c.icon, 18)}<span>${esc(c.label)}</span><span class="k">${esc(c.tab)}</span></button>`).join('') || '<div class="empty">No matching command</div>';
      list.querySelectorAll<HTMLElement>('[data-i]').forEach((b) => (b.onclick = () => { box.remove(); items[+b.dataset.i!].run(); }));
    };
    inp.oninput = () => { idx = 0; draw(); };
    inp.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') box.remove();
      if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); draw(); e.preventDefault(); }
      if (e.key === 'Enter' && items[idx]) { box.remove(); items[idx].run(); }
    };
    inp.onblur = () => setTimeout(() => box.remove(), 150);
    draw(); inp.focus();
  }

  /* ------------------------------------------------------------ settings */
  openSettings(page: 'nav' | 'display') {
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const draw = () => {
      const n = this.nav; const preset = NAV_PRESETS.find((p) => p.name === n.preset)!;
      const m3 = n.mouse3d;
      const t = (k: keyof typeof m3, label: string) => `<label class="chk"><input type="checkbox" data-m3="${k}" ${m3[k] ? 'checked' : ''}> ${label}</label>`;
      scrim.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" aria-label="Settings">
        <nav class="dlg-nav"><h2>Settings</h2>
          <button class="${page === 'nav' ? 'on' : ''}" data-page="nav">Navigation &amp; input</button>
          <button class="${page === 'display' ? 'on' : ''}" data-page="display">Display</button>
          <button data-page="print">Printer &amp; material</button>
          <div style="margin-top:auto;padding:10px;color:var(--muted);font-size:12px">Forge 0.1 · Phase 1</div></nav>
        <div class="dlg-main">
        ${page === 'nav' ? `
          <div><h1>Navigation &amp; input</h1><p class="hint" style="margin:6px 0 0">Pick a mouse scheme you already know. Left click always selects.</p></div>
          <div class="cols2"><section><span class="lbl">Mouse navigation style</span>
            <div class="presets">${NAV_PRESETS.map((p) => `<button data-preset="${p.name}" class="${p.name === n.preset ? 'on' : ''}">${p.name}</button>`).join('')}</div>
            <div class="maptable">${preset.hints.map(([a, b]) => `<div><span class="hint">${a}</span><code>${esc(b)}</code></div>`).join('')}<div><span class="hint">Zoom wheel</span><code>${n.invertWheel ? 'Reversed' : 'Standard'}</code></div></div>
            <label class="chk"><input type="checkbox" data-nv="zoomToCursor" ${n.zoomToCursor ? 'checked' : ''}> Zoom toward cursor</label>
            <label class="chk"><input type="checkbox" data-nv="invertWheel" ${n.invertWheel ? 'checked' : ''}> Reverse wheel zoom direction</label>
            <label class="chk"><input type="checkbox" data-nv="rotateAboutPoint" ${n.rotateAboutPoint ? 'checked' : ''}> Rotate about selection or point under cursor</label>
            <span class="lbl">Rotation</span>${this.seg('rotation', [['turntable', 'Turntable (Z up)'], ['free', 'Free (trackball)']], n.rotation)}
          </section>
          <section><span class="lbl">3D mouse</span>
            <div class="devcard">${icon('mouse3d', 28)}<div style="flex:1"><b>${this.spaceName ? esc(this.spaceName) + ' connected' : 'No 3D mouse connected'}</b><div class="hint">${SpaceMouse.supported() ? '3Dconnexion devices via WebHID (Chrome / Edge).' : 'This browser has no WebHID. Use Chrome or Edge for SpaceMouse support.'}</div></div>
              ${SpaceMouse.supported() ? `<button class="btn ${this.spaceName ? '' : 'primary'}" id="connect3d">${this.spaceName ? 'Reconnect' : 'Connect'}</button>` : ''}</div>
            <label style="display:flex;justify-content:space-between" for="m3speed"><span>Speed</span><span class="row-meta" id="m3v">${m3.speed.toFixed(1)}×</span></label>
            <input id="m3speed" type="range" min="0.2" max="4" step="0.1" value="${m3.speed}" style="width:100%;accent-color:var(--accent)">
            <div class="seg">${(['rotate', 'pan', 'zoom'] as const).map((k) => `<button data-m3t="${k}" class="${m3[k] ? 'on' : ''}">${m3[k] ? '✓ ' : ''}${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
            ${t('dominant', 'Dominant axis only')}${t('lockHorizon', 'Lock horizon')}${t('invertPan', 'Invert pan')}${t('invertZoom', 'Invert zoom')}${t('invertRotate', 'Invert rotation')}
            <span class="lbl">Zoom axis</span>${this.seg('zoomAxis', [['z', 'Pull / push cap'], ['y', 'Forward / back']], m3.zoomAxis)}
            <span class="lbl">Buttons</span><div class="maptable"><div><span class="hint">Left button</span><code>Fit all</code></div><div><span class="hint">Right button</span><code>Isometric view</code></div></div>
          </section></div>` : `
          <div><h1>Display</h1></div>
          <div class="cols2"><section><span class="lbl">Projection</span>${this.seg('projection', [['ortho', 'Orthographic'], ['perspective', 'Perspective']], n.projection)}
            <span class="lbl">Default part colour</span><label class="field"><span>Colour</span><input type="color" id="partCol" value="${this.partColor}" style="height:26px;padding:0"></label></section>
          <section><span class="lbl">Keyboard</span><div class="maptable">
            ${[['Search commands', 'S'], ['Zoom to fit', 'F'], ['View menu', 'Space'], ['Standard views', 'Ctrl+1 … 7'], ['Confirm / cancel', 'Enter / Esc'], ['Undo / redo', 'Ctrl+Z / Ctrl+Y'], ['Delete feature', 'Del'], ['Rename', 'F2']].map(([a, b]) => `<div><span class="hint">${a}</span><code>${b}</code></div>`).join('')}</div></section></div>`}
        <div style="margin-top:auto;display:flex;justify-content:flex-end"><button class="btn primary" id="closeDlg">Done</button></div>
        </div></div>`;
      scrim.querySelectorAll<HTMLElement>('[data-page]').forEach((b) => (b.onclick = () => { if (b.dataset.page === 'print') { scrim.remove(); this.setInfo('print'); return; } page = b.dataset.page as any; draw(); }));
      scrim.querySelectorAll<HTMLElement>('[data-preset]').forEach((b) => (b.onclick = () => { n.preset = b.dataset.preset!; save(); draw(); }));
      scrim.querySelectorAll<HTMLInputElement>('[data-nv]').forEach((c) => (c.onchange = () => { (n as any)[c.dataset.nv!] = c.checked; save(); draw(); }));
      scrim.querySelectorAll<HTMLInputElement>('[data-m3]').forEach((c) => (c.onchange = () => { (m3 as any)[c.dataset.m3!] = c.checked; save(); }));
      scrim.querySelectorAll<HTMLElement>('[data-m3t]').forEach((b) => (b.onclick = () => { const k = b.dataset.m3t as 'rotate'; m3[k] = !m3[k]; save(); draw(); }));
      scrim.querySelectorAll<HTMLElement>('[data-seg]').forEach((b) => (b.onclick = () => {
        const k = b.dataset.seg!, v = b.dataset.v!;
        if (k === 'rotation') n.rotation = v as any;
        if (k === 'zoomAxis') m3.zoomAxis = v as any;
        if (k === 'projection') { n.projection = v as any; this.viewer.setProjection(n.projection); }
        save(); draw();
      }));
      const sp = scrim.querySelector<HTMLInputElement>('#m3speed'); if (sp) sp.oninput = () => { m3.speed = +sp.value; $('#m3v', scrim).textContent = m3.speed.toFixed(1) + '×'; save(); };
      const cb = scrim.querySelector<HTMLElement>('#connect3d'); if (cb) cb.onclick = async () => { try { await this.viewer.space.request(); draw(); } catch (e: any) { this.toast(e.message); } };
      const pc = scrim.querySelector<HTMLInputElement>('#partCol'); if (pc) pc.onchange = () => this.setColor('part', pc.value);
      $('#closeDlg', scrim).onclick = () => scrim.remove();
    };
    const save = () => { saveNav(this.nav); this.viewer.nav = this.nav; this.renderTop(); this.renderStatus(); };
    scrim.onpointerdown = (e) => { if (e.target === scrim) scrim.remove(); };
    scrim.onkeydown = (e) => { if (e.key === 'Escape') scrim.remove(); e.stopPropagation(); };
    document.body.appendChild(scrim); draw();
    (scrim.querySelector('#closeDlg') as HTMLElement)?.focus();
  }

  /* ------------------------------------------------------------ files */
  download(data: BlobPart, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  safeName() { return (this.project.name || 'part').replace(/[^\w.-]+/g, '_'); }
  async exportFile(fmt: 'step' | 'stl') {
    if (!this.result?.mesh) return this.toast('Nothing to export yet');
    this.toast(`Exporting ${fmt.toUpperCase()}…`);
    try {
      const buf = await this.kernel.export(fmt);
      this.download(buf, `${this.safeName()}.${fmt === 'step' ? 'step' : 'stl'}`, fmt === 'step' ? 'application/step' : 'model/stl');
      this.toast(`${fmt.toUpperCase()} exported (${(buf.byteLength / 1024).toFixed(0)} KB)`);
    } catch (e: any) { this.toast('Export failed: ' + e.message); }
  }
  exportJSON() {
    const p = clone(this.project); (p as any).color = this.partColor;
    this.download(JSON.stringify(p, null, 2), `${this.safeName()}.forge.json`, 'application/json');
  }
  pickFile(accept: string): Promise<File | null> {
    return new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => res(i.files?.[0] || null); i.click(); });
  }
  async openProject() {
    const f = await this.pickFile('.json,.forge.json'); if (!f) return;
    const p = safeParse(await f.text());
    if (!p || p.format !== 'pft/1.0' || !Array.isArray(p.features)) return this.toast('Not a Forge project (expected format "pft/1.0")');
    this.commit(() => { this.project = p; this.partColor = (p as any).color || '#9fb3cc'; });
    this.toast(`Opened ${p.name}`);
    setTimeout(() => this.viewer.fit(), 400);
  }
  async importSTL() {
    const f = await this.pickFile('.stl'); if (!f) return;
    try {
      const pos = parseSTL(await f.arrayBuffer());
      this.viewer.setReference(pos); this.viewer.fit();
      this.toast(`${f.name}: ${(pos.length / 9).toLocaleString()} triangles (reference mesh)`);
    } catch (e: any) { this.toast('Could not read STL: ' + e.message); }
  }

  /* ------------------------------------------------------------ keyboard */
  bindKeys() {
    addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (document.querySelector('.scrim')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); return; }
      if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); this.exportJSON(); return; }
      if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); this.openProject(); return; }
      if (ctrl && e.key.toLowerCase() === 'b') { e.preventDefault(); this.rebuild(true); return; }
      if (ctrl && /^[1-8]$/.test(e.key)) {
        e.preventDefault();
        const v = ['Front', 'Back', 'Left', 'Right', 'Top', 'Bottom', 'Isometric'][+e.key - 1];
        if (v) this.viewer.setView(v); else { const sf = this.selectedFaces().find((f) => f.normal); if (sf) this.viewer.normalTo(sf.normal!, sf.xDir!); }
        return;
      }
      if (ctrl) return;
      if (e.key === 'Escape') {
        if (this.drag || this.polyPts.length) { this.drag = null; this.polyPts = []; this.viewer.setOverlay([]); return; }
        if (this.edit) return this.cancelEdit();
        this.viewer.clearSelection(); this.treeSel = null; this.renderSide(); return;
      }
      if (e.key === 'Enter') { if (this.edit?.tool === 'poly' && this.polyPts.length) return this.finishPoly(); if (this.edit) this.confirmEdit(); return; }
      if (e.key === 'f' || e.key === 'F' || e.key === 'Home') { this.viewer.fit(); return; }
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); this.openSearch(); return; }
      if (e.key === ' ') { e.preventDefault(); this.viewsMenu($('#hViews')); return; }
      if (e.key === 'F2' && this.treeSel) { this.rename(this.treeSel); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.edit?.draft.type === 'sketch' && this.edit.selEntity) { const id = this.edit.selEntity; this.edit.selEntity = null; this.upd((d) => { d.entities = d.entities.filter((x: SketchEntity) => x.id !== id); }); return; }
        if (!this.edit && this.treeSel && this.project.features.some((f) => f.id === this.treeSel)) this.deleteFeature(this.treeSel);
      }
    });
  }
}

/* ------------------------------------------------------------ utilities */
/** Plane of a flat face, with its origin at the part origin projected onto the face (stable sketch coordinates). */
function facePlane(f: { center: V3; normal: V3 | null; xDir: V3 | null }): PlaneRef {
  const n = f.normal!; const k = dot(f.center, n);
  return { kind: 'face', origin: [n[0] * k, n[1] * k, n[2] * k], xDir: f.xDir!, normal: n };
}
function logo() { return `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l9 5v10l-9 5-9-5V7z" fill="#1F5FD1"/><path d="M12 12l9-5M12 12v10M12 12L3 7" stroke="#fff" stroke-width="1.5" fill="none"/></svg>`; }
function safeParse(s: string): any { try { return JSON.parse(s); } catch { return null; } }
function dist(a: V3, b: V3) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function dot(a: V3, b: V3) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function fmtV(v: V3) { return v.map((x) => fmt(x, 2)).join(', '); }
function snap(v: number, s: number) { return Math.round(v / s) * s; }
function niceStep(min: number) { for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50]) if (s >= min) return s; return 100; }
function segDist(p: [number, number], a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0], dy = b[1] - a[1]; const l = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function toolHint(t: Tool) {
  return ({ select: 'Click an entity to select it. Delete removes it.', rect: 'Drag corner to corner (or click twice).', circle: 'Drag from centre to radius.', polygon: 'Drag from centre to a corner. 6 sides by default.', slot: 'Drag from one end to the other.', poly: 'Click points; click the first point or press Enter to close.' } as Record<string, string>)[t] + ' Hold Alt to turn off snapping.';
}
function featureMeta(f: Feature, p: Project): string {
  const ev = new Evaluator(p.variables);
  const v = (x?: string) => { try { return fmt(ev.eval(x || '0'), 2); } catch { return '?'; } };
  switch (f.type) {
    case 'extrude': return f.throughAll ? 'thru' : v(f.depth);
    case 'revolve': return v(f.angle) + '°';
    case 'fillet': return 'R' + v(f.radius);
    case 'chamfer': return v(f.distance);
    case 'shell': return v(f.thickness);
    case 'hole': return f.preset === 'custom' ? 'Ø' + v(f.diameter) : `${f.size}${f.preset === 'insert' ? ' ins' : ''}`;
    case 'pattern': return '×' + v(f.count);
    case 'sketch': return f.entities.length ? '✓' : '';
    default: return '';
  }
}
function renameVarEverywhere<T>(obj: T, oldName: string, newName: string): T {
  const re = new RegExp(`\\b${oldName}\\b`, 'g');
  const walk = (x: any): any => typeof x === 'string' ? x.replace(re, newName) : Array.isArray(x) ? x.map(walk) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === 'id' || k === 'name' || k === 'sketch' ? v : walk(v)])) : x;
  return walk(obj);
}
function parseSTL(buf: ArrayBuffer): Float32Array {
  const dv = new DataView(buf);
  if (buf.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === buf.byteLength) {
      const out = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) { const o = 84 + i * 50 + 12; for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(o + k * 4, true); }
      return out;
    }
  }
  const txt = new TextDecoder().decode(buf);
  const vs = [...txt.matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g)].map((m) => [+m[1], +m[2], +m[3]]).flat();
  if (!vs.length || vs.length % 9) throw new Error('unrecognised STL');
  return new Float32Array(vs);
}

(window as any).__app = new App();
