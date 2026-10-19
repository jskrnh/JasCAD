// Minimal 3MF writer (core spec + base materials for colour). Units: millimetres.
import { zipSync, strToU8 } from 'fflate';

export interface MeshObj { vertices: Float32Array; triangles: Uint32Array; colors?: string[] }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const hex = (c: string) => { const h = c.replace('#', '').toUpperCase(); return '#' + (h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6)) + 'FF'; };

export function build3MF(objs: MeshObj[], title: string, names: string[] = []): Uint8Array {
  const palette: string[] = [];
  const idx = (c: string) => { const k = hex(c); let i = palette.indexOf(k); if (i < 0) { palette.push(k); i = palette.length - 1; } return i; };
  const parts: string[] = [];
  objs.forEach((o, n) => {
    // weld coincident vertices (the kernel meshes face by face) so slicers see one watertight shell
    const v: string[] = []; const t: string[] = []; const map = new Map<string, number>(); const remap: number[] = [];
    for (let i = 0; i < o.vertices.length; i += 3) {
      const x = +o.vertices[i].toFixed(4), y = +o.vertices[i + 1].toFixed(4), z = +o.vertices[i + 2].toFixed(4); const k = x + ',' + y + ',' + z;
      let j = map.get(k); if (j == null) { j = v.length; map.set(k, j); v.push(`<vertex x="${x}" y="${y}" z="${z}"/>`); }
      remap.push(j);
    }
    for (let i = 0; i < o.triangles.length; i += 3) {
      const a = remap[o.triangles[i]], b = remap[o.triangles[i + 1]], d = remap[o.triangles[i + 2]];
      if (a === b || b === d || a === d) continue; // degenerate after welding
      const c = o.colors?.[i / 3]; const p = c ? ` pid="1" p1="${idx(c)}"` : '';
      t.push(`<triangle v1="${a}" v2="${b}" v3="${d}"${p}/>`);
    }
    const first = o.colors?.[0];
    parts.push(`<object id="${n + 2}" type="model" name="${esc(names[n] || `${title} body ${n + 1}`)}"${first ? ` pid="1" pindex="${idx(first)}"` : ''}><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object>`);
  });
  const mats = palette.length ? `<basematerials id="1">${palette.map((c, i) => `<base name="Colour ${i + 1}" displaycolor="${c}"/>`).join('')}</basematerials>` : '';
  const items = objs.map((_, n) => `<item objectid="${n + 2}"/>`).join('');
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${esc(title)}</metadata><metadata name="Application">jasCAD</metadata>
<resources>${mats}${parts.join('')}</resources><build>${items}</build></model>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  return zipSync({ '[Content_Types].xml': strToU8(types), '_rels/.rels': strToU8(rels), '3D/3dmodel.model': strToU8(model) }, { level: 6 });
}
