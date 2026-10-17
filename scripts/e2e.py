import time, sys
from playwright.sync_api import sync_playwright
def wait_rebuilt(pg, t=30000):
    time.sleep(0.25)
    pg.wait_for_function("!document.querySelector('#rebuildBtn .busy')", timeout=t); time.sleep(0.4)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    ctx = b.new_context(viewport={'width':1440,'height':900}, accept_downloads=True)
    pg = ctx.new_page(); logs=[]
    pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error','warning') else None)
    pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
    pg.goto('http://localhost:5173/')
    pg.wait_for_function("document.querySelector('#status') && /Rebuilt|error/.test(document.querySelector('#status').textContent)", timeout=60000)
    pg.screenshot(path='/tmp/e0.png')
    # new part
    pg.once('dialog', lambda d: d.accept())
    pg.click('#fileBtn'); pg.click('text=New part'); wait_rebuilt(pg)
    # sketch on top plane
    pg.click('.tab:has-text("Sketch")'); pg.click('[data-cmd="sketch"]')
    pg.click('[data-seg="plane"][data-v="XY"]'); time.sleep(1)
    vp = pg.locator('#vp').bounding_box(); cx, cy = vp['x']+vp['width']/2, vp['y']+vp['height']/2
    pg.click('[data-cmd="rect"]')
    pg.mouse.move(cx-150, cy-100); pg.mouse.down(); pg.mouse.move(cx+50, cy+20, steps=8); pg.mouse.move(cx+150, cy+100, steps=8); pg.mouse.up()
    wait_rebuilt(pg)
    pg.click('[data-cmd="circle"]')
    pg.mouse.move(cx+60, cy); pg.mouse.down(); pg.mouse.move(cx+90, cy, steps=6); pg.mouse.up(); wait_rebuilt(pg)
    pg.screenshot(path='/tmp/e1.png')
    # exit sketch -> extrude auto opens
    pg.click('#sbExit'); wait_rebuilt(pg)
    pg.fill('[data-expr="depth"]', '12'); pg.keyboard.press('Tab'); wait_rebuilt(pg)
    pg.click('#ok'); wait_rebuilt(pg)
    pg.keyboard.press('Control+7'); time.sleep(0.6)
    pg.screenshot(path='/tmp/e2.png')
    print('tree:', pg.inner_text('.tree').replace('\n',' | '))
    # fillet: pick an edge by clicking on top outer edge - find via JS projection
    pg.click('.tab:has-text("Solids")'); pg.click('[data-cmd="fillet"]')
    pts = pg.evaluate("""() => { const v = window.__app.viewer; const out=[]; for (const e of v.edges) { if (e.type!=='LINE') continue; const p=new v.cam.position.constructor(...e.mid).project(v.cam); const r=v.canvas.getBoundingClientRect(); out.push([e.id, r.left+(p.x+1)/2*r.width, r.top+(1-p.y)/2*r.height, e.mid[2]]); } return out; }""")
    top = [q for q in pts if abs(q[3]-12)<1e-6][:2]
    for q in top: pg.mouse.click(q[1], q[2]); wait_rebuilt(pg)
    pg.fill('[data-expr="radius"]', '3'); pg.keyboard.press('Tab'); wait_rebuilt(pg)
    pg.screenshot(path='/tmp/e3.png')
    print('fillet panel:', pg.inner_text('#pm')[:200].replace('\n',' | '))
    pg.click('#ok'); wait_rebuilt(pg)
    # shell top face
    pg.click('[data-cmd="shell"]')
    faces = pg.evaluate("""() => { const v = window.__app.viewer; return v.faces.filter(f=>f.normal && f.normal[2]>0.99).map(f=>{const p=new v.cam.position.constructor(...f.center).project(v.cam); const r=v.canvas.getBoundingClientRect(); return [r.left+(p.x+1)/2*r.width, r.top+(1-p.y)/2*r.height]}) }""")
    pg.mouse.click(faces[0][0], faces[0][1]); wait_rebuilt(pg)
    pg.click('#ok'); wait_rebuilt(pg)
    # hole on bottom? add hole on top rim skipped; overhang + print check
    pg.click('.tab:has-text("Print")'); pg.click('[data-cmd="printcheck"]'); pg.click('[data-cmd="overhangP"]'); time.sleep(0.5)
    pg.screenshot(path='/tmp/e4.png')
    print('print:', pg.inner_text('#pm').replace('\n',' | ')[:600])
    # exports
    with pg.expect_download() as d1: pg.click('.tab:has-text("Mesh")'); pg.click('[data-cmd="expstep"]')
    d1.value.save_as('/tmp/out.step')
    with pg.expect_download() as d2: pg.click('[data-cmd="expstl"]')
    d2.value.save_as('/tmp/out.stl')
    with pg.expect_download() as d3: pg.click('[data-cmd="expjson"]')
    d3.value.save_as('/tmp/out.forge.json')
    # undo / redo
    pg.keyboard.press('Control+z'); wait_rebuilt(pg); n1 = pg.locator('.tree .row').count()
    pg.keyboard.press('Control+y'); wait_rebuilt(pg); n2 = pg.locator('.tree .row').count()
    print('undo/redo rows', n1, n2, 'status', pg.inner_text('#status').replace('\n',' '))
    # section
    pg.click('#hSection'); time.sleep(0.5); pg.screenshot(path='/tmp/e5.png')
    print('\n'.join(logs[-20:]))
    b.close()
