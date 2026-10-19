import time
from playwright.sync_api import sync_playwright
def wait_rebuilt(pg, t=30000):
    time.sleep(0.25); pg.wait_for_function("!document.querySelector('#rebuildBtn .busy')", timeout=t); time.sleep(0.4)
PROJ = """() => { const v = window.__app.viewer; const r=v.canvas.getBoundingClientRect(); return (pt)=>{ const p=new v.cam.position.constructor(...pt).project(v.cam); return [r.left+(p.x+1)/2*r.width, r.top+(1-p.y)/2*r.height]; } }"""
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width':1440,'height':900}); logs=[]
    pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
    pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type=='error' and 'ERR_TUNNEL' not in m.text else None)
    pg.goto('http://localhost:5174/')
    pg.wait_for_function("document.querySelector('#status') && /Rebuilt|error/.test(document.querySelector('#status').textContent)", timeout=60000); time.sleep(1); time.sleep(0.5)
    # sketch on the front face of upright: find planar face with normal -Y near y=14
    face = pg.evaluate("""() => { const v=window.__app.viewer; const f=v.faces.find(f=>f.normal && f.normal[1]<-0.99 && Math.abs(f.center[1]-14)<0.01); const p=new v.cam.position.constructor(...f.center).project(v.cam); const r=v.canvas.getBoundingClientRect(); return [r.left+(p.x+1)/2*r.width, r.top+(1-p.y)/2*r.height+40]; }""")
    pg.mouse.click(face[0], face[1]); time.sleep(0.3)
    pg.click('.tab:has-text("Sketch")'); pg.click('[data-cmd="sketch"]'); wait_rebuilt(pg); time.sleep(0.5)
    pg.click('[data-cmd="circle"]')
    vp = pg.locator('#vp').bounding_box(); cx, cy = vp['x']+vp['width']/2, vp['y']+vp['height']/2
    pg.mouse.move(cx-120, cy+40); pg.mouse.down(); pg.mouse.move(cx-100, cy+40, steps=5); pg.mouse.up(); wait_rebuilt(pg)
    pg.screenshot(path='/tmp/f1.png')
    pg.click('#sbExit'); wait_rebuilt(pg)
    pg.click('[data-seg="op"][data-v="cut"]'); wait_rebuilt(pg)
    pg.click('[data-seg="end"][data-v="through"]'); wait_rebuilt(pg)
    pg.click('#ok'); wait_rebuilt(pg)
    # linear pattern of that cut along x
    pg.click('.tab:has-text("Solids")'); pg.click('[data-cmd="pattern"]'); wait_rebuilt(pg)
    pg.fill('[data-expr="spacing"]', '12'); pg.keyboard.press('Tab'); wait_rebuilt(pg)
    pg.fill('[data-expr="count"]', '4'); pg.keyboard.press('Tab'); wait_rebuilt(pg)
    print('pattern panel', pg.inner_text('#pm').replace('\n',' | ')[:300])
    pg.click('#ok'); wait_rebuilt(pg)
    # insert hole on top of plate
    pg.keyboard.press('Control+7'); time.sleep(0.6)
    pg.click('.tab:has-text("Print")'); pg.click('[data-cmd="insert"]')
    top = pg.evaluate("""() => { const v=window.__app.viewer; const f=v.faces.find(f=>f.normal && f.normal[2]>0.99 && Math.abs(f.center[2]-6)<0.01); const p=new v.cam.position.constructor(f.center[0]-8, -12, 6).project(v.cam); const r=v.canvas.getBoundingClientRect(); return [r.left+(p.x+1)/2*r.width, r.top+(1-p.y)/2*r.height]; }""")
    pg.mouse.click(top[0], top[1]); wait_rebuilt(pg)
    print('hole panel', pg.inner_text('#pm').replace('\n',' | ')[:400])
    pg.click('#ok'); wait_rebuilt(pg)
    # mirror whole body is trivial; mirror features across YZ: select insert hole
    pg.click('.tab:has-text("Solids")'); pg.click('[data-cmd="mirror"]'); wait_rebuilt(pg)
    pg.click('[data-seg="mwhat"][data-v="features"]'); time.sleep(0.3)
    boxes = pg.locator('[data-pf]'); n = boxes.count()
    boxes.nth(n-1).check(); wait_rebuilt(pg)
    pg.click('#ok'); wait_rebuilt(pg)
    pg.screenshot(path='/tmp/f2.png')
    print('tree', pg.inner_text('.tree').replace('\n',' | '))
    print('status', pg.inner_text('#status').replace('\n',' '))
    # navigation: middle-drag rotate (SolidWorks), wheel zoom
    pg.mouse.move(cx, cy); pg.mouse.down(button='middle'); pg.mouse.move(cx+120, cy+40, steps=10); pg.mouse.up(button='middle')
    pg.mouse.wheel(0, -300); time.sleep(0.4)
    pg.screenshot(path='/tmp/f3.png')
    # settings dialog
    pg.click('#navPill'); pg.click('[data-preset="Fusion"]'); time.sleep(0.3); pg.screenshot(path='/tmp/f4.png'); pg.click('#closeDlg')
    print('nav pill', pg.inner_text('#navPill'))
    # search
    pg.keyboard.press('s'); pg.keyboard.type('fil'); time.sleep(0.2); pg.screenshot(path='/tmp/f5.png'); pg.keyboard.press('Escape')
    # edit existing feature: double-click Extrude 1 change depth to 8
    pg.dblclick('[data-row="ex1"]'); wait_rebuilt(pg)
    pg.fill('[data-expr="depth"]', 'plate+2'); pg.keyboard.press('Tab'); wait_rebuilt(pg); pg.click('#ok'); wait_rebuilt(pg)
    print('after edit status', pg.inner_text('#status').replace('\n',' '))
    # variables tab
    pg.click('[data-side="vars"]'); time.sleep(0.2); pg.fill('[data-vexpr="width"]', '80'); pg.keyboard.press('Tab'); wait_rebuilt(pg)
    pg.screenshot(path='/tmp/f6.png')
    print('vars status', pg.inner_text('#status').replace('\n',' '))
    print('\n'.join(logs[-15:]))
    b.close()
