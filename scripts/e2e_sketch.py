import time, json
from playwright.sync_api import sync_playwright
def wait(pg, t=30000):
    time.sleep(0.25); pg.wait_for_function("!document.querySelector('#rebuildBtn .busy')", timeout=t); time.sleep(0.35)
def scr(pg, x, y):  # sketch plane coords -> screen
    return pg.evaluate(f"(() => {{ const a = window.__app; return a.viewer.project(a.sk.to3([{x},{y}])); }})()")
def click(pg, x, y, **kw):
    sx, sy = scr(pg, x, y); pg.mouse.click(sx, sy, **kw); time.sleep(0.12)
def st(pg): return pg.evaluate("(() => { const s = window.__app.sk; return s ? {dof: s.dof, status: s.status, curves: s.geo.curves.length, pts: s.geo.points.length, cons: s.geo.constraints.map(k=>k.type+(k.value?('='+k.value):'')).join(',')} : null })()")
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width':1440,'height':900}); logs=[]
    pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
    pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type=='error' and 'ERR_TUNNEL' not in m.text else None)
    pg.goto('http://localhost:5174/'); pg.evaluate("localStorage.clear()"); pg.goto('http://localhost:5174/')
    pg.wait_for_function("document.querySelector('#status') && /Rebuilt|error/.test(document.querySelector('#status').textContent)", timeout=60000); time.sleep(0.6)
    pg.once('dialog', lambda d: d.accept()); pg.click('#fileBtn'); pg.click('text=New part'); wait(pg)
    pg.click('.tab:has-text("Sketch")'); pg.click('[data-cmd="sketch"]'); pg.click('[data-seg="plane"][data-v="XY"]'); time.sleep(1)
    print('pre', pg.evaluate("JSON.stringify({e: !!window.__app.edit, pend: window.__app.edit && window.__app.edit.pendingPlane, sk: !!window.__app.sk, t: window.__app.edit && window.__app.edit.draft.type})"))
    pg.evaluate("window.__app.viewer.zoom(1.6)"); time.sleep(0.3)
    # rectangle corner at origin, 20 x 12
    pg.click('[data-cmd="rect"]'); click(pg, 0, 0); pg.mouse.move(*scr(pg, 10, 6)); click(pg, 20, 12); wait(pg)
    print('after rect', st(pg))
    # dimensions: bottom line width, right line height
    pg.click('[data-cmd="dim"]')
    click(pg, 10, 0); click(pg, 10, -3); time.sleep(0.3); pg.keyboard.type('30'); pg.keyboard.press('Enter'); wait(pg)
    print('after width dim', st(pg))
    click(pg, 30, 6); click(pg, 33, 6); time.sleep(0.3); pg.keyboard.type('h'); pg.keyboard.press('Enter'); wait(pg)
    print('after bad expr', st(pg))
    click(pg, 30, 6); click(pg, 34, 6); time.sleep(0.3); pg.keyboard.press('Control+a'); pg.keyboard.type('15'); pg.keyboard.press('Enter'); wait(pg)
    print('after height dim', st(pg))
    # circle hole with diameter dim
    pg.click('[data-cmd="circle"]'); click(pg, 10, 7); click(pg, 13, 7); wait(pg)
    print('circle drawn', st(pg))
    pg.click('[data-cmd="dim"]'); click(pg, 13, 7); time.sleep(0.3); print('dim placed', st(pg), pg.evaluate("!!document.querySelector('.sk-dimedit')"), pg.evaluate("document.activeElement && document.activeElement.className")); time.sleep(0.3); pg.keyboard.press('Control+a'); pg.keyboard.type('6'); pg.keyboard.press('Enter'); wait(pg)
    print('after circle', st(pg))
    pg.screenshot(path='/tmp/sk1.png')
    print('panel status:', pg.inner_text('.skstat') if pg.locator('.skstat').count() else 'none')
    # exit -> extrude opens
    pg.click('#sbExit'); wait(pg)
    pg.fill('[data-expr="depth"]', '8'); pg.keyboard.press('Tab'); wait(pg); pg.click('#ok'); wait(pg)
    print('status after extrude', pg.inner_text('#status').split('\n')[0], pg.evaluate("window.__app.result.props && window.__app.result.props.volume.toFixed(1)"), '(expect 30*15*8 - pi*9*8 = %.1f)' % (30*15*8 - 3.14159265*9*8))
    pg.keyboard.press('Control+7'); time.sleep(0.6); pg.screenshot(path='/tmp/sk2.png')
    print('\n'.join(logs[-10:]))
    b.close()
