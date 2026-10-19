# jasCAD — Release notes

**Project website:** https://jascad.jskrnh.workers.dev

*jasCAD was called Forge before v0.2.0.*

## v0.1.0 — Phase 1 (2026-10-17)

The first working build of the browser CAD app. It has a real B-rep kernel, a parametric feature tree, the approved UI direction and print-focused tools.

### New
- **Kernel:** OpenCASCADE (WebAssembly) runs in a Web Worker, with incremental rebuilds cached per feature.
- **Sketching:** rectangle, circle, polygon, slot and polyline, drawn in the viewport with grid snapping. Dimensions accept expressions. You can sketch on datum planes, offset planes or flat faces.
- **Solids:** extrude (boss, cut, new body; blind, mid-plane or through-all; reverse; draft angle), revolve, fillet, chamfer, shell (inward or outward), hole wizard, linear and circular patterns, and mirror.
- **Hole wizard for printing:** clearance with counterbore, self-tapping, and heat-set insert presets for M2–M8.
- **Parametrics:** global variables with expressions. Features can be edited, suppressed, reordered, rolled back, renamed or deleted. Undo/redo, and the project autosaves in the browser.
- **Robust references:** fillets, chamfers and shells keep their edges and faces after you change upstream dimensions.
- **Evaluate:** measure, mass properties, section view, and an overhang analysis map with a legend.
- **Print check:** bed fit, Z=0 check, faces needing support, and estimated filament, time and cost. Material and printer settings are editable.
- **Export:** STEP, binary STL, and the open JSON feature tree (`pft/1.0`). Open and save projects, and import STL as a reference mesh.
- **UI:** ribbon with shaded 3D icons, feature tree with a collapsible show/hide and colour column, per-feature colours, property manager, view cube, heads-up toolbar, command search, and keyboard shortcuts.
- **Navigation:** mouse presets for SolidWorks, Fusion, Onshape, Inventor, CATIA, Creo, NX and Blender, plus orthographic or perspective view and turntable or free rotation.
- **SpaceMouse:** WebHID driver with speed, axis toggles, dominant axis, lock horizon, inversion, zoom axis, and button mapping.

### Known limitations
- Sketches use parametric shapes. A free line/arc sketcher with geometric constraints comes in Phase 2.
- A sketch placed on a face stores that face's plane. It does not follow the face if the face later moves.
- Inward shell can fail when rounded edges touch the open face (an OpenCASCADE limitation). Move Shell above the Fillet, or use Outward.
- Greyed-out tools (surfacing, sweep/loft, thickness and curvature analysis, mesh repair and booleans, orient, split, snap-fit) are not built yet.
- Print time and cost are rough estimates. Your slicer is authoritative.
- Parasolid export needs a Siemens licence, so STEP is provided instead.

### Tested
- Kernel test suite in Node: sample bracket, patterns, mirror, shell, variable changes, reference repair, STEP and STL export.
- End-to-end browser tests in headless Chromium: draw a sketch, extrude, fillet, shell, sketch on a face, through-cut, pattern, insert hole, mirror, edit a feature, change variables, all exports, undo/redo, section, overhang, settings and command search.
- Production build smoke-tested.

## v0.1.1 — Windows desktop app (2026-10-17)

### New
- **Windows app:** `Forge.exe`, an Electron shell around the same build. It runs fully offline, and the kernel and fonts are bundled.
- **SpaceMouse:** the desktop app connects to a 3Dconnexion device automatically, with no browser permission prompt.
- **Fonts:** IBM Plex is bundled, so the web build no longer calls Google Fonts.
- **Build:** `npm run desktop` rebuilds the Windows package.

### Known limitations
- The exe is unsigned, so Windows SmartScreen will warn on first launch (More info → Run anyway). Signing needs a code-signing certificate.
- The exe uses the default Electron icon. Setting a custom icon needs a Windows build machine or Wine.
- There is no installer yet. Unzip the folder anywhere and run `Forge.exe`.

## v0.1.2 — Cloudflare Pages setup (2026-10-17)

### New
- **Cloudflare Pages:** ready to deploy as the project `forge-cad`. `npm run deploy:test` publishes to the test URL, and `npm run deploy:prod` publishes to the live site.
- **Caching:** `_headers` caches the kernel for a year, serves `.wasm` with the correct type, and allows WebHID so the SpaceMouse works on the site.
- **Upload bundle:** `forge-pages-dist.zip` is a ready-to-upload build for the Cloudflare dashboard. Every file is under the Pages 25 MiB limit.

## v0.1.3 — Cloudflare Workers deploy fix (2026-10-17)

### Fixed
- **Deploy:** the Cloudflare project is a Worker, so `wrangler deploy` needs an assets directory. `wrangler.toml` now serves `./dist` as static assets, with single-page fallback.

## v0.2.0 — Renamed to jasCAD (2026-10-19)

### Changed
- **Name:** the app is now called **jasCAD** everywhere: header, browser tab title, loading screen, settings footer and Windows window title.
- **Desktop app:** the Windows build now produces `jasCAD.exe`.
- **Project files:** saved projects now use `.jascad.json`. Older `.forge.json` files still open.

### Unchanged
- Work already saved in the browser carries over: autosave and navigation settings are kept.
- **Repo and project:** the code moved to the new GitHub repo **`jskrnh/jascad`**. The Cloudflare project is now named `jascad` too (set in `wrangler.toml`). The old `forge-cad` repo is no longer used.

## v0.3.0 — Constraint sketcher, sweep, loft, draft, rib (2026-10-19)

### New
- **Constraint sketcher** (FreeCAD's PlaneGCS solver, running in the browser):
  - **Drawing tools:** line chains, rectangle, circle, 3-point arc, polygon, slot, spline and point. Drawing works by click-click or click-drag.
  - **Auto-relations while drawing:** snaps to existing points and curves, and adds horizontal or vertical relations when a line is drawn close to level.
  - **Relations:** coincident, on-curve, horizontal, vertical, parallel, perpendicular, tangent (endpoint tangency, FreeCAD style), equal, concentric, midpoint, symmetric, collinear and fix. Relation glyphs show on the canvas.
  - **Smart dimensions:** length, distance, horizontal and vertical distance, diameter, radius and angle. You edit them inline on the canvas, and they accept variables and expressions (`wall*2`).
  - **Defined status:** geometry turns black and the panel says "Fully defined" when nothing can move. Otherwise the panel shows how many degrees of freedom are left. Conflicting relations turn red, and anything that would over-define the sketch is refused.
  - **Editing tools:** trim, sketch fillet, offset, construction geometry, convert model edges into the sketch, drag points, and delete.
  - **Profiles:** closed regions are found automatically. Lines that split a loop are handled, and inner loops become holes. Open chains can be used as sweep paths and ribs.
  - **Variable-driven rebuilds:** sketches re-solve whenever a variable changes, so dimensions driven by variables update the part.
- **Sweep:** a closed profile along an open path of lines, arcs and splines (boss, cut or new body).
- **Loft:** blends between two or more profiles, smooth or straight.
- **Draft:** tapers selected faces about a neutral face by an angle.
- **Rib:** an open sketch line becomes a wall that fills to the part. It automatically picks the side that faces into the corner, and you can flip it.

### Changed
- The Sketch ribbon now holds the full toolset, plus a Relations menu.
- Older shape-based sketches (rectangle, circle, slot entities) still open and stay editable.

### Known limitations
- Draft supports flat faces only.
- Sweep orients the profile where you drew it. Draw it at the start of the path, roughly square to it.
- A rib fills up to the part's bounding box. This works for brackets and enclosures, but it can overshoot on strongly curved outer walls.

### Tested
- Node kernel tests for each new feature. Volumes match hand calculations: a variable-driven rectangle, the sweep (π·r²·path length), the gusset rib, a split-region sketch and a sketch with a hole.
- Browser tests of every sketch tool, dimension editing, the fully-defined state, sweep, loft and rib through the UI.
- Both earlier regression suites still pass unchanged.
