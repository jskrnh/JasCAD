import time
from playwright.sync_api import sync_playwright
def wait(pg, t=30000):
    time.sleep(0.25); pg.wait_for_function("!document.querySelector('#rebuildBtn .busy')", timeout=t); time.sleep(0.35)
def scr(pg, x, y): return pg.evaluate(f"(() => {{ const a = window.__app; return a.viewer.project(a.sk.to3([{x},{y}])); }})()")
def click(pg, x, y): sx, sy = scr(pg, x, y); pg.mouse.move(sx, sy); pg.mouse.click(sx, sy); time.sleep(0.12)
def st(pg): return pg.evaluate("(() => { const s = window.__app.sk; return s ? {dof: s.dof, status: s.status, curves: s.geo.curves.map(c=>c.kind+(c.cons?'*':'')).join(','), rels: s.geo.constraints.length} : null })()")
def newsketch(pg, plane='XY', zoom=0.7):
    pg.click('.tab:has-text("Sketch")'); pg.click('[data-cmd="sketch"]'); pg.click(f'[data-seg="plane"][data-v="{plane}"]'); time.sleep(0.9)
    pg.evaluate(f"window.__app.viewer.zoom({zoom})"); time.sleep(0.2)
def dim(pg, a, b, val):
    pg.click('[data-cmd="dim"]'); click(pg, *a); click(pg, *b); time.sleep(0.25); pg.keyboard.press('Control+a'); pg.keyboard.type(val); pg.keyboard.press('Enter'); wait(pg)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width':1440,'height':900}); logs=[]
    pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
    pg.goto('http://localhost:5174/'); pg.wait_for_function("document.querySelector('#status') && /Rebuilt|error/.test(document.querySelector('#status').textContent)", timeout=60000); time.sleep(0.6)
    pg.once('dialog', lambda d: d.accept()); pg.click('#fileBtn'); pg.click('text=New part'); wait(pg)
    newsketch(pg)
    # closed line chain (triangle-ish with h/v snaps) from origin
    pg.click('[data-cmd="line"]'); click(pg, 0, 0); click(pg, 30, 0); click(pg, 30, 20); click(pg, 0, 0); wait(pg)
    print('chain', st(pg))
    # sketch fillet at (30,0) corner
    pg.click('[data-cmd="skfillet"]'); click(pg, 30, 0); wait(pg); print('fillet', st(pg))
    # arc
    pg.click('[data-cmd="arc"]'); click(pg, -20, 0); click(pg, -10, 0); click(pg, -15, 5); wait(pg); print('arc', st(pg))
    # spline
    pg.click('[data-cmd="spline"]'); click(pg, -30, 10); click(pg, -25, 18); click(pg, -15, 14); pg.keyboard.press('Enter'); wait(pg); print('spline', st(pg))
    # slot & polygon
    pg.click('[data-cmd="slot"]'); click(pg, 5, 30); click(pg, 20, 30); click(pg, 20, 33); wait(pg); print('slot', st(pg))
    pg.click('[data-cmd="polygon"]'); click(pg, -20, 30); click(pg, -15, 30); wait(pg); print('polygon', st(pg))
    # trim: line across a circle
    pg.click('[data-cmd="circle"]'); click(pg, 45, 10); click(pg, 50, 10); wait(pg)
    pg.click('[data-cmd="line"]'); click(pg, 38, 10); click(pg, 52, 10); pg.keyboard.press('Escape'); wait(pg)
    pg.click('[data-cmd="trim"]'); click(pg, 45, 15); wait(pg); print('trim circle->arc', st(pg))
    # drag a point with select tool
    pg.click('[data-cmd="select"]'); sx, sy = scr(pg, 30, 20); ex, ey = scr(pg, 34, 24)
    pg.mouse.move(sx, sy); pg.mouse.down(); pg.mouse.move(ex, ey, steps=8); pg.mouse.up(); wait(pg)
    print('dragged', pg.evaluate("(() => { const s=window.__app.sk; return s.geo.points.map(p=>[+p.x.toFixed(1),+p.y.toFixed(1)]).filter(p=>p[0]>32&&p[1]>22) })()"))
    pg.screenshot(path='/tmp/sk3.png')
    print('regions', pg.evaluate("(() => { const a=window.__app; return JSON.stringify({}) })()"))
    print('status', pg.inner_text('#status').split('\n')[0], [l for l in logs][-5:])
    # fully-defined test in a fresh sketch: rectangle at origin + 2 dims
    pg.click('#sbExit'); wait(pg); pg.keyboard.press('Escape'); wait(pg)
    newsketch(pg, 'XY')
    pg.click('[data-cmd="rect"]'); click(pg, 0, 0); click(pg, 20, 10); wait(pg)
    dim(pg, (10, 0), (10, -4), '25'); dim(pg, (25, 5), (29, 5), '12')
    print('rect dims', st(pg), pg.inner_text('.skstat'))
    pg.screenshot(path='/tmp/sk4.png')
    print([l for l in logs][-5:])
    b.close()
