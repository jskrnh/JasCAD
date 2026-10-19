# jasCAD — Release notes

**Project website:** https://jascad.jskrnh.workers.dev

*jasCAD was called Forge before v0.2.0. From v0.5.0 it is built on SolidCraft.*

## v0.5.0 — jasCAD on the SolidCraft engine (2026-10-19)

jasCAD now runs on [SolidCraft](https://github.com/bherbruck/solidcraft) 0.16.2, an open-source
parametric CAD application written in Rust (MIT OR Apache-2.0), restyled to look and work like
jasCAD. The 3D-printing tools from v0.4.0 are not carried over for now.

### New (from SolidCraft)
- A much larger CAD core: constraint sketcher, the full set of solid, surface, sheet metal, plastic and mesh tools, assemblies with joints, configurations, and STEP, STL, 3MF and DXF files.
- Desktop and browser builds from the same Rust code, with SpaceMouse support and navigation presets.

### jasCAD look and feel
- **Branding:** the jasCAD name, mark, browser tab and installable-app manifest. About credits SolidCraft.
- **Light theme by default:** white title bar and ribbon, blue accent, orange selection, blue-grey parts.
- **Shaded icons in jasCAD colours:** grey-blue faces with orange for what a command makes, dark-blue sketch tools, and blue for surfaces.
- **Ribbon:** every command shows its name under its icon, on up to two lines. Long words shrink instead of breaking. More commands sit on the Solid and Surface tabs, and tab names are in title case.
- **Feature tree on the left** by default, with a collapsible show / colour column:
  - an eye for each sketch, and for the bodies each feature makes;
  - a colour swatch that sets the appearance of those bodies.
- **SolidWorks mouse navigation** by default.
- "Report a bug" opens issues on jskrnh/JasCAD. Update checks against SolidCraft releases are off.

### Build and hosting
- A GitHub Action builds the browser app (Rust → WebAssembly) on every push to `test` and `main` and commits it to `site/`, which Cloudflare serves.
- The previous TypeScript jasCAD (v0.4.0) is kept on the `jascad-v0.4` branch.

### Known limitations
- The web build is new. The first deploy happens after the GitHub Action finishes, which takes around 20–40 minutes.
- SolidCraft's own automated tests were written for its original look. Some UI tests that check colours or toolbar layout will need updating, and they are not run in this repo yet.
- Print features from v0.4.0 (threads with print fit, snap-fits, lip/groove, insert bosses, split with dowels) are not in this version.

### Tested
- Built the desktop app (release) and ran it on a software GPU. Checked the ribbon, feature tree, show / colour column (eye hides a body, swatch opens the colour picker), sketch mode and the light theme with screenshots.

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

## v0.4.0 — Print-ready features, bodies, 3MF and STEP import (2026-10-19)

### New
- **Thread:** real modelled threads on shafts (external) and holes (internal). Covers ISO metric coarse sizes from M2 to M30, plus 1/4-20 and 3/8-16. jasCAD reads the size from the face you pick. You can set a print fit (radial clearance), thread the whole face or a set length, and start the thread from either end.
- **Text:** emboss or engrave text on any flat face or datum plane. You can set the height, depth, angle and alignment.
- **Split part:** cut a part across X, Y or Z so oversized prints fit the bed. You can keep both halves with a gap between them, or just one side. Optional alignment dowel holes (0–6) are cut in both halves, with a fit clearance.
- **Insert boss:** stand-off bosses with pilot holes for brass heat-set inserts (M2–M8). Click to place as many as you need.
- **Snap-fit:** a cantilever hook with a lead-in angle. A live check estimates bending strain for your material (PLA ~2.5%, PETG/ABS ~4%) and warns when the arm is too stiff.
- **Lip and groove:** a matching lip and groove on the rim of a shelled box and its lid, with a fit clearance.
- **Multi-body parts:**
  - **Bodies** tab: volume, mass and size for each body, and click a body to highlight it.
  - **Combine:** add, subtract or keep the common volume of bodies.
  - **Move / copy:** translate and rotate bodies.
- **Import STEP:** brings a STEP file in as a body, stored inside the project so the project file stays self-contained.
- **Export 3MF:** each body becomes its own object, and per-feature colours carry over as 3MF materials. The mesh is welded and watertight, ready for PrusaSlicer, Bambu Studio and Cura.

### Changed
- The Print tab holds the new print tools. Thread, Text, Combine and Move/copy are also on the Solids tab.
- New shaded icons for text, lip, groove, boss, move, STEP import, 3MF export and bodies.
- Freeform surfaces such as threads now mesh more coarsely, so the viewport stays responsive. Exports still use full precision.

### Fixed
- A part with several bodies could lose its geometry after mass properties ran or after exporting STEP or STL (an OpenCASCADE compound consumed the bodies).
- The rib clipping step had the same problem when more than one body was present.

### Known limitations
- Threads rebuild in about 4–15 s, depending on length. The result is cached, so later edits to other features stay fast.
- An internal thread needs at least ~0.5 mm of wall around the thread. Thinner walls fall back to a slower direct cut.
- Combine and Move refer to bodies by their number (Body 1, Body 2…). If an upstream change adds or removes a body, check these features.
- Orient-for-printing, thickness/curvature/zebra analysis, surfacing and mesh repair are still to come.

### Tested
- Node kernel tests for every new feature:
  - External and internal threads.
  - Text emboss and engrave.
  - Split with dowels: two bodies, with the volume matching hand calculation.
  - Bosses, snap-fit, lip and groove.
  - Combine and move.
  - A STEP round-trip (24,000 mm³ in and out).
  - 3MF output, checked as manifold (every edge shared by exactly two triangles).
- A browser test of every new tool through the UI: placement clicks, panels, the Bodies tab, 3MF download, STEP file import, and lip on a shelled box.
- Earlier node suites still pass.
