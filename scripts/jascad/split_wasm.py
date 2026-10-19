#!/usr/bin/env python3
"""Cloudflare Workers serves static files up to 25 MiB each. SolidCraft's WebAssembly is larger, so
split every big .wasm into parts and make index.html fetch and join them before starting the app.

Usage: split_wasm.py DIST_DIR   (then re-run `cargo xtask web-offline DIST_DIR` so sw.js lists the parts)
"""
import pathlib, re, sys

LIMIT = 20 * 1024 * 1024  # well under Cloudflare's 25 MiB
dist = pathlib.Path(sys.argv[1])
index = dist / "index.html"
html = index.read_text()

for wasm in sorted(dist.glob("*.wasm")):
    data = wasm.read_bytes()
    if len(data) <= LIMIT:
        continue
    parts = []
    for k in range(0, len(data), LIMIT):
        part = wasm.with_name(f"{wasm.name}.part{k // LIMIT}")
        part.write_bytes(data[k:k + LIMIT])
        parts.append(part.name)
    wasm.unlink()
    name = re.escape(wasm.name)
    # Drop the preload of the whole file (it no longer exists).
    html = re.sub(r'<link[^>]*href="(?:\./)?' + name + r'"[^>]*>\s*', "", html)
    joined = (
        "(async () => { const bufs = await Promise.all(" + repr(["./" + p for p in parts]).replace("'", '"')
        + ".map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.arrayBuffer(); })));"
        " const out = new Uint8Array(bufs.reduce((n, b) => n + b.byteLength, 0)); let o = 0;"
        " for (const b of bufs) { out.set(new Uint8Array(b), o); o += b.byteLength; } return out; })()"
    )
    html, n = re.subn(r"""(['"])(?:\./)?""" + name + r"""\1""", lambda m: joined, html)
    if n == 0:
        sys.exit(f"split_wasm: {wasm.name} is not referenced in index.html")
    print(f"split_wasm: {wasm.name} ({len(data) / 1048576:.1f} MiB) -> {len(parts)} parts, {n} reference(s) rewritten")

index.write_text(html)
