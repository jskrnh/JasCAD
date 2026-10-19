import time, math
from playwright.sync_api import sync_playwright
exec(open('scripts/e2e_sketch2.py').read().split('with sync_playwright()')[0])
def vol(pg): return pg.evaluate("window.__app.result.props ? +window.__app.result.props.volume.toFixed(1) : null")
def errs(pg): return pg.evaluate("window.__app.result.errors.map(e=>e.message)")
def esc(pg): pg.keyboard.press('Escape'); wait(pg)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width':1440,'height':900}); logs=[]
    pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
    pg.goto('http://localhost:5174/'); pg.wait_for_function("document.querySelector('#status') && /Rebuilt|error/.test(document.querySelector('#status').textContent)", timeout=60000); time.sleep(0.6)
    # ---------- SWEEP
    pg.once('dialog', lambda d: d.accept()); pg.click('#fileBtn'); pg.click('text=New part'); wait(pg)
    newsketch(pg, 'XZ'); pg.click('[data-cmd="line"]'); click(pg, 0, 0); click(pg, 0, 30); click(pg, 20, 40); pg.keyboard.press('Escape'); wait(pg)
    pg.click('#sbExit'); wait(pg)
    newsketch(pg, 'XY'); pg.click('[data-cmd="circle"]'); click(pg, 0, 0); click(pg, 3, 0); wait(pg)
    pg.click('#sbExit'); wait(pg); esc(pg)   # cancel auto extrude
    pg.click('.tab:has-text("Solids")'); pg.click('[data-cmd="sweep"]'); wait(pg)
    print('sweep panel:', pg.inner_text('#pm').replace('\n', ' | ')[:160])
    pg.click('#ok'); wait(pg)
    L = 30 + math.hypot(20, 10)
    print('sweep vol', vol(pg), 'approx expected', round(math.pi*9*L, 1), errs(pg))
    pg.keyboard.press('Control+7'); time.sleep(0.5); pg.screenshot(path='/tmp/f_sweep.png')
    # ---------- LOFT
    pg.once('dialog', lambda d: d.accept()); pg.click('#fileBtn'); pg.click('text=New part'); wait(pg)
    newsketch(pg, 'XY'); pg.click('[data-cmd="rect"]'); click(pg, -10, -10); click(pg, 10, 10); wait(pg); pg.click('#sbExit'); wait(pg); esc(pg)
    newsketch(pg, 'XY'); pg.fill('[data-expr="offset"]', '30'); pg.keyboard.press('Tab'); time.sleep(0.6)
    pg.click('[data-cmd="circle"]'); click(pg, 0, 0); click(pg, 6, 0); wait(pg); pg.click('#sbExit'); wait(pg); esc(pg)
    pg.click('.tab:has-text("Solids")'); pg.click('[data-cmd="loft"]'); wait(pg); pg.click('#ok'); wait(pg)
    print('loft vol', vol(pg), errs(pg))
    pg.keyboard.press('Control+7'); time.sleep(0.5); pg.screenshot(path='/tmp/f_loft.png')
    # ---------- RIB + DRAFT on the sample bracket
    pg.click('#fileBtn'); pg.click('text=Open sample bracket'); wait(pg)
    v0 = vol(pg)
    newsketch(pg, 'YZ'); pg.click('[data-cmd="line"]'); click(pg, 4, 6); click(pg, 13, 30); pg.keyboard.press('Escape'); wait(pg)
    pg.click('#sbExit'); wait(pg)
    pg.click('.tab:has-text("Solids")'); pg.click('[data-cmd="rib"]'); wait(pg); pg.click('#ok'); wait(pg)
    print('rib added vol', round(vol(pg) - v0, 1), errs(pg))
    pg.keyboard.press('Control+7'); time.sleep(0.5); pg.screenshot(path='/tmp/f_rib.png')
    # draft: pick the two side faces of the base plate via projection
    pg.click('[data-cmd="draft"]'); wait(pg)
    faces = pg.evaluate("""(() => { const v = window.__app.viewer; return v.faces.filter(f => f.normal && Math.abs(f.normal[0]) > 0.99).map(f => v.project(f.center)); })()""")
    for fx, fy in faces[:2]: pg.mouse.click(fx, fy); wait(pg)
    print('draft panel', pg.inner_text('#pm').replace('\n', ' | ')[:120]); v1 = vol(pg)
    pg.click('#ok'); wait(pg); print('draft vol change', round(vol(pg) - v1, 1), errs(pg))
    print('tree:', pg.inner_text('.tree').replace('\n', ' | ')[-200:])
    print(logs[-5:])
    b.close()
