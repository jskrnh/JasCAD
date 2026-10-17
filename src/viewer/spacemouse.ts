// 3Dconnexion SpaceMouse support through WebHID (Chrome / Edge, secure context).
// No driver plug-in needed; the browser asks the user once for permission.

const VENDORS = [0x256f /* 3Dconnexion */, 0x046d /* older Logitech-made units */];

export interface Motion { tx: number; ty: number; tz: number; rx: number; ry: number; rz: number }

export class SpaceMouse {
  device: any = null;
  motion: Motion = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };
  buttons = 0;
  lastEvent = 0;
  onChange: (connected: boolean, name: string) => void = () => {};
  onButton: (index: number) => void = () => {};

  static supported() { return typeof navigator !== 'undefined' && 'hid' in navigator; }

  /** Reconnect silently to a device the user already granted. */
  async autoConnect() {
    if (!SpaceMouse.supported()) return false;
    try {
      const list = await (navigator as any).hid.getDevices();
      const d = list.find((x: any) => VENDORS.includes(x.vendorId));
      if (d) { await this.attach(d); return true; }
    } catch { /* ignore */ }
    return false;
  }

  /** Must run inside a user gesture (button click). */
  async request() {
    if (!SpaceMouse.supported()) throw new Error('This browser has no WebHID. Use Chrome or Edge.');
    const list = await (navigator as any).hid.requestDevice({ filters: VENDORS.map((vendorId) => ({ vendorId })) });
    if (!list.length) return false;
    await this.attach(list[0]);
    return true;
  }

  private async attach(d: any) {
    if (!d.opened) await d.open();
    this.device = d;
    d.addEventListener('inputreport', (e: any) => this.onReport(e));
    (navigator as any).hid.addEventListener('disconnect', (e: any) => {
      if (e.device === this.device) { this.device = null; this.onChange(false, ''); }
    });
    this.onChange(true, d.productName || 'SpaceMouse');
  }

  private onReport(e: any) {
    const v: DataView = e.data; const id = e.reportId;
    const i16 = (o: number) => (o + 1 < v.byteLength ? v.getInt16(o, true) : 0);
    if (id === 1) {
      this.motion.tx = i16(0); this.motion.ty = i16(2); this.motion.tz = i16(4);
      if (v.byteLength >= 12) { this.motion.rx = i16(6); this.motion.ry = i16(8); this.motion.rz = i16(10); }
    } else if (id === 2) {
      this.motion.rx = i16(0); this.motion.ry = i16(2); this.motion.rz = i16(4);
    } else if (id === 3) {
      let mask = 0; for (let b = 0; b < Math.min(4, v.byteLength); b++) mask |= v.getUint8(b) << (8 * b);
      const pressed = mask & ~this.buttons;
      for (let k = 0; k < 32; k++) if (pressed & (1 << k)) this.onButton(k);
      this.buttons = mask;
    }
    this.lastEvent = performance.now();
  }

  /** Current motion, zeroed if the device went quiet (some units stop sending at rest). */
  read(): Motion {
    if (performance.now() - this.lastEvent > 200) return { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };
    return this.motion;
  }
}
