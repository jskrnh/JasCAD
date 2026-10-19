/// <reference lib="webworker" />
// Geometry worker: owns the OpenCASCADE kernel so the UI never blocks during rebuilds.
import opencascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import * as R from 'replicad';
import { Builder } from './build';
import { initSolver } from '../sketch/solver';
import gcsWasmUrl from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';
import fontUrl from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff?url';
import { build3MF } from '../io/threemf';
import type { Project } from '../model/types';

let builder: Builder | null = null;
let lastShapes: any[] = [];
const ready = (async () => {
  const oc = await (opencascade as any)({ locateFile: () => wasmUrl });
  R.setOC(oc);
  const gcs = await initSolver(() => gcsWasmUrl);
  builder = new Builder(R, gcs);
})();
const loadFont = () => fetch(fontUrl).then((r) => r.arrayBuffer());

// Queue: only the newest rebuild request matters while one is running.
let pending: { id: number; project: Project } | null = null;
let busy = false;

async function pump() {
  if (busy || !pending) return;
  busy = true;
  const job = pending; pending = null;
  try {
    await ready;
    await builder!.prepare(job.project, loadFont);
    const res = builder!.rebuild(job.project);
    lastShapes = res.shapes;
    const { shapes, ...out } = res; void shapes;
    const transfer: Transferable[] = [];
    if (out.mesh) transfer.push(out.mesh.vertices.buffer, out.mesh.normals.buffer, out.mesh.triangles.buffer);
    if (out.edges) transfer.push(out.edges.lines.buffer);
    (self as any).postMessage({ type: 'rebuilt', id: job.id, result: out }, transfer);
  } catch (e: any) {
    (self as any).postMessage({ type: 'rebuilt', id: job.id, result: { ok: false, mesh: null, edges: null, faces: [], edgeInfo: [], sketches: [], props: null, errors: [{ featureId: '', message: String(e?.message || e) }], ms: 0 } });
  }
  busy = false;
  pump();
}

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === 'init') { await ready; (self as any).postMessage({ type: 'ready' }); return; }
  if (msg.type === 'rebuild') { pending = { id: msg.id, project: msg.project }; pump(); return; }
  if (msg.type === 'export') {
    await ready;
    try {
      if (!lastShapes.length) throw new Error('Nothing to export yet');
      let buf: ArrayBuffer;
      if (msg.format === '3mf') {
        const owner = builder!.lastFaceOwner; const colors: Record<string, string> = msg.colors || {};
        const objs = builder!.export3MFData(lastShapes, (fid) => colors[owner.get(fid) || ''] || msg.defaultColor || '#9FB3CC');
        const bytes = build3MF(objs, msg.name || 'part', msg.names || []);
        buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      } else {
        const blob = msg.format === 'step' ? builder!.exportSTEP(lastShapes) : builder!.exportSTL(lastShapes, true);
        buf = await blob.arrayBuffer();
      }
      (self as any).postMessage({ type: 'exported', id: msg.id, buf }, [buf]);
    } catch (e: any) { (self as any).postMessage({ type: 'exported', id: msg.id, error: String(e?.message || e) }); }
  }
};
