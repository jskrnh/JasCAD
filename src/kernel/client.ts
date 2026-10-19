import type { Project, RebuildResult } from '../model/types';

/** Main-thread handle to the geometry worker. */
export class KernelClient {
  private w: Worker;
  private seq = 0;
  private waiters = new Map<number, (v: any) => void>();
  readonly ready: Promise<void>;
  onResult: (r: RebuildResult) => void = () => {};
  onBusy: (busy: boolean) => void = () => {};
  private latest = 0;

  constructor() {
    this.w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise((res) => {
      this.w.addEventListener('message', (e) => {
        const m = e.data;
        if (m.type === 'ready') res();
        else if (m.type === 'rebuilt') { if (m.id === this.latest) { this.onBusy(false); this.onResult(m.result); } }
        else if (m.type === 'exported') { const f = this.waiters.get(m.id); this.waiters.delete(m.id); f?.(m); }
      });
    });
    this.w.postMessage({ type: 'init' });
  }

  rebuild(p: Project) {
    const id = ++this.seq; this.latest = id; this.onBusy(true);
    // strip non-serialisable/transient fields
    this.w.postMessage({ type: 'rebuild', id, project: JSON.parse(JSON.stringify(p)) });
  }

  export(format: 'step' | 'stl' | '3mf', extra: { colors?: Record<string, string>; defaultColor?: string; name?: string; names?: string[] } = {}): Promise<ArrayBuffer> {
    const id = ++this.seq;
    return new Promise((res, rej) => {
      this.waiters.set(id, (m) => (m.error ? rej(new Error(m.error)) : res(m.buf)));
      this.w.postMessage({ type: 'export', id, format, ...extra });
    });
  }
}
