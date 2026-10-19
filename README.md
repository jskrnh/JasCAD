# jasCAD

**Website:** https://jascad.jskrnh.workers.dev

jasCAD is a parametric 3D CAD app for the browser, with a SolidWorks-style workflow: a labelled
command ribbon with shaded icons, a feature tree on the left with a show / colour column, a light
theme and SolidWorks mouse navigation by default.

jasCAD is a fork of [SolidCraft](https://github.com/bherbruck/solidcraft) (MIT OR Apache-2.0),
an open-source parametric CAD application written in Rust. The geometry kernel, sketcher,
features, file formats and almost all of the code are SolidCraft's; jasCAD changes the look and
defaults. SolidCraft's licences (`LICENSE-MIT`, `LICENSE-APACHE`), `NOTICE` and `ATTRIBUTION.md`
are kept unchanged apart from rows for jasCAD's own assets. jasCAD is not affiliated with or
endorsed by the SolidCraft project.

## What jasCAD changes
- jasCAD name, mark and web app manifest.
- Light theme by default: white title bar and ribbon, blue accent, orange selection.
- Icons recoloured: grey-blue shaded faces with orange for what a command creates, dark-blue
  sketch tools, blue for surfaces.
- Ribbon: every command shows its label under the icon (up to two lines), more commands on the
  Solid and Surface tabs, tab names in title case.
- Feature tree on the left by default, with a collapsible show / colour column: an eye for each
  sketch and for the bodies each feature makes, and a colour swatch that sets their appearance.
- SolidWorks mouse navigation by default.

## Building
- Desktop: `cargo run --release -p solidcraft`
- Browser: `cd apps/solidcraft-web && trunk build --release` (needs the `wasm32-unknown-unknown`
  target and [trunk](https://trunkrs.dev)). GitHub Actions does this on every push to `test`
  and `main` and commits the result to `site/`, which Cloudflare serves.

The previous TypeScript version of jasCAD (v0.4.0) is kept on the `jascad-v0.4` branch.
