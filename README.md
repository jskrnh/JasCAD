# jasCAD — parametric CAD for 3D-printable parts

A lightweight, SolidWorks-style parametric modeller that runs entirely in the browser. It uses the OpenCASCADE B-rep kernel (compiled to WebAssembly), a Three.js viewport and an open JSON feature-tree format.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # kernel test suite (Node)
npm run build        # static site in dist/
npm run preview      # serve dist/ locally
```

Requires Node 20+. Chrome or Edge is recommended (needed for the SpaceMouse); Firefox and Safari work for everything else.

## Deploy (GitHub → Cloudflare Workers)

The Cloudflare project `jascad` is connected to this repo (`jskrnh/jascad`), with these settings:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Non-production branch deploy command | `npx wrangler versions upload` |

`wrangler.toml` serves `./dist` as static assets.

- **Live:** a push to `main` deploys to production.
- **Test:** a push to `test` uploads a preview version with its own URL, which is used to check changes before they go live.

`public/_headers` caches the kernel, serves `.wasm` correctly, and allows WebHID for the SpaceMouse.

To build the Windows desktop app, run `npm run desktop`. The output goes to `release/`.

## What's in Phase 1

| Area | Tools |
|---|---|
| Sketch | Rectangle (rounded, rotated), circle, polygon, slot, polyline. You draw them in the viewport with grid snapping and edit dimensions as expressions. Inner shapes become holes automatically. You can sketch on datum planes, offset planes or any flat face. |
| Solids | Extrude (boss / cut / new body, blind / mid-plane / through-all, reverse, draft angle), revolve, fillet, chamfer, shell (inward / outward), hole wizard, linear pattern (1–2 directions), circular pattern, mirror (whole body or features). |
| Hole wizard | Print-tuned presets for M2–M8: clearance with optional counterbore, self-tapping, and heat-set insert. |
| Evaluate | Measure (area, length, distances), mass properties, section view, overhang map. |
| Print | Print check (fits the bed, sits on Z=0, faces needing support, estimated grams, time and cost), material and printer settings. |
| Mesh / files | Export STEP, export STL (binary), export the feature tree (JSON), open and save projects, import STL as a reference mesh. |
| Parametrics | Global variables with expressions (`wall*2`, `width/2 - 3`, `sin(30)`). Edit, suppress, reorder, roll back, rename or delete features. Edge and face references re-find themselves after upstream dimension changes. Undo/redo, plus autosave in the browser. |
| UI | Ribbon with shaded 3D icons, feature tree with a show/hide and colour column, property manager, view cube, heads-up toolbar, command search (S), standard views (Ctrl+1…7). |
| Navigation | Mouse presets for SolidWorks, Fusion, Onshape, Inventor, CATIA, Creo, NX and Blender. Orthographic or perspective view, turntable or free rotation, zoom to cursor. |
| 3D mouse | 3Dconnexion SpaceMouse over WebHID, with no driver plug-in. Settings for speed, per-axis enable, dominant axis, lock horizon, inversion, zoom axis, and button mapping (Fit / Iso). |

Surfacing, sweep/loft, thickness and curvature analysis, mesh repair and booleans, orientation and splitting tools, and a full constraint sketcher are greyed out in the ribbon. They are scheduled for later phases.

## Architecture

```
src/
  main.ts              UI shell: ribbon, tree, property manager, dialogs, sketch tools
  model/types.ts       Feature-tree types ("pft/1.0") + kernel protocol
  model/expr.ts        Safe expression evaluator (no eval)
  kernel/build.ts      Feature evaluation on OpenCASCADE (replicad): caching, face ownership, reference repair
  kernel/worker.ts     Web Worker that owns the kernel; the UI never blocks during rebuilds
  viewer/viewer.ts     Three.js viewport: picking, highlighting, section, overhang, view cube
  viewer/nav.ts        Navigation presets and settings
  viewer/spacemouse.ts WebHID SpaceMouse driver
  ui/icons.ts          Shaded 3D icon set
  ui/holes.ts          Print-tuned hole tables
tests/                 Node tests that run the real kernel
```

- **Rebuilds are incremental.** Each feature's result is cached, keyed by a hash of everything above it, so editing a late feature only recomputes from that point.
- **References are geometric.** A picked edge stores a point, a tangent and a curve type; a face stores a point, a normal and a surface type. After an upstream change, the kernel matches each reference one-to-one to the closest entity of the same type and direction.

## Feature-tree format (`.jascad.json`)

The format is plain, versioned and diffable JSON. Every dimension is an expression string, so the file stays parametric.

```json
{
  "format": "pft/1.0", "name": "Sensor_Bracket", "units": "mm",
  "variables": { "wall": "2", "plate": "6" },
  "features": [
    { "id": "sk1", "type": "sketch", "name": "Sketch 1", "plane": { "kind": "XY" },
      "entities": [{ "id": "en1", "kind": "rect", "cx": "0", "cy": "0", "w": "60", "h": "40", "r": "4" }] },
    { "id": "ex1", "type": "extrude", "name": "Extrude 1", "sketch": "sk1", "depth": "plate", "op": "add" },
    { "id": "fi1", "type": "fillet", "name": "Fillet 1", "radius": "wall",
      "edges": [{ "p": [0, 14, 6], "t": [1, 0, 0], "k": "LINE" }] }
  ]
}
```

## Coordinate system

The view is Z-up, so the XY plane is the build plate. Top = XY, Front = XZ (normal −Y), Right = YZ.

## Keyboard

| Key | Action |
|---|---|
| S | Command search |
| F / Home | Zoom to fit |
| Space | View orientation menu |
| Ctrl+1…7 | Front, Back, Left, Right, Top, Bottom, Isometric |
| Ctrl+8 | Normal to selected face |
| Enter / Esc | Confirm / cancel the active feature |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Del | Delete the selected feature or sketch entity |
| F2 | Rename |
| Alt (while sketching) | Turn off snapping |

## Licences

jasCAD's code is yours. Bundled libraries:

- replicad: MIT.
- three.js: MIT.
- replicad-opencascadejs (OpenCASCADE): LGPL-2.1 with the OCCT exception. The kernel ships as a separate, replaceable `.wasm` file, which satisfies LGPL relinking. Keep its licence notice when you redistribute.

Parasolid export is not included: writing `.x_t` files requires a commercial Siemens licence. STEP AP214 is exported instead, and SolidWorks, Fusion, NX, Onshape and Inventor all import it.
