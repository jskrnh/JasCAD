import time
def wait(pg, t=30000):
    time.sleep(0.25); pg.wait_for_function("!document.querySelector('#rebuildBtn .busy')", timeout=t); time.sleep(0.35)
def scr(pg, x, y): return pg.evaluate(f"(() => {{ const a = window.__app; return a.viewer.project(a.sk.to3([{x},{y}])); }})()")
def click(pg, x, y): sx, sy = scr(pg, x, y); pg.mouse.move(sx, sy); pg.mouse.click(sx, sy); time.sleep(0.12)
def st(pg): return pg.evaluate("(() => { const s = window.__app.sk; return s ? {dof: s.dof, status: s.status, curves: s.geo.curves.map(c=>c.kind+(c.cons?'*':'')).join(','), rels: s.geo.constraints.length} : null })()")
def newsketch(pg, plane='XY', zoom=0.7):
    pg.click('.tab:has-text("Sketch")'); pg.click('[data-cmd="sketch"]'); pg.click(f'[data-seg="plane"][data-v="{plane}"]'); time.sleep(0.9)
    pg.evaluate(f"window.__app.viewer.zoom({zoom})"); time.sleep(0.2)
def vol(pg): return pg.evaluate("window.__app.result.props ? +window.__app.result.props.volume.toFixed(1) : null")
def errs(pg): return pg.evaluate("window.__app.result.errors.map(e=>e.message)")
def esc(pg): pg.keyboard.press('Escape'); wait(pg)
def boot(p, url='http://localhost:5174/'):
    b = p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width':1440,'height':900}); pg._logs = []
    pg.on('pageerror', lambda e: pg._logs.append(f'PAGEERROR: {e}'))
    pg.goto(url); pg.wait_for_function("document.querySelector('#status') && /Rebuilt|error/.test(document.querySelector('#status').textContent)", timeout=60000); time.sleep(0.6)
    return b, pg
def newpart(pg):
    pg.once('dialog', lambda d: d.accept()); pg.click('#fileBtn'); pg.click('text=New part'); wait(pg)
