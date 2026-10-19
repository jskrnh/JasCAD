import time, sys, os
from playwright.sync_api import sync_playwright
sys.path.insert(0, 'scripts')
from h import *

def pick(pg, js_filter, point_js='f.center'):
    """Simulate a viewport click on the first face matching js_filter (f => bool)."""
    return pg.evaluate(f"""(() => {{ const a = window.__app; const f = a.viewer.faces.find({js_filter}); if (!f) return false;
      a.onPick({{ kind: 'face', id: f.id, point: {point_js}, face: f, shift: false, ctrl: false }}); return true; }})()""")
def select(pg, js_filter):
    return pg.evaluate(f"""(() => {{ const a = window.__app; const f = a.viewer.faces.find({js_filter}); if (!f) return false; a.viewer.selected = new Set(['f:' + f.id]); return true; }})()""")
def box(pg, w=40, d=30, h=20):
    newsketch(pg, 'XY', zoom=0.3); pg.click('[data-cmd="rect"]'); click(pg, -w/2, -d/2); click(pg, w/2, d/2); wait(pg)
    pg.click('#sbExit'); wait(pg); pg.fill('[data-expr="depth"]', str(h)); pg.keyboard.press('Tab'); wait(pg); pg.click('#ok'); wait(pg)
def nbodies(pg): return pg.evaluate("(window.__app.result.bodies||[]).length")
def ok(pg, label, t=90000):
    pg.click('#ok'); wait(pg, t); print(f'{label:28s} vol', vol(pg), 'bodies', nbodies(pg), 'errors', errs(pg))
TOP = "f => f.type === 'PLANE' && f.normal[2] > 0.99"

with sync_playwright() as p:
    b, pg = boot(p)
    # ---------- external thread on a shaft
    newpart(pg)
    newsketch(pg, 'XY'); pg.click('[data-cmd="circle"]'); click(pg, 0, 0); click(pg, 4, 0); wait(pg)
    pg.click('#sbExit'); wait(pg); pg.fill('[data-expr="depth"]', '16'); pg.keyboard.press('Tab'); wait(pg); pg.click('#ok'); wait(pg)
    select(pg, "f => f.type === 'CYLINDRE'")
    pg.click('.tab:has-text("Solids")'); pg.click('[data-cmd="threadF"]'); wait(pg, 90000)
    print('thread panel:', pg.inner_text('#pm').replace('\n', ' | ')[:220])
    ok(pg, 'M8 external thread')
    pg.keyboard.press('Control+7'); time.sleep(0.4); pg.evaluate("window.__app.viewer.fit()"); time.sleep(0.4); pg.screenshot(path='/tmp/b2_thread.png')

    # ---------- box: text, boss, snap, split, combine, move, 3MF
    newpart(pg); box(pg)
    select(pg, TOP); pg.click('[data-cmd="textF"]'); wait(pg); ok(pg, 'text emboss')
    pg.click('.tab:has-text("Print")'); pg.click('[data-cmd="bossP"]'); wait(pg)
    pick(pg, TOP, '[-12, -8, 20]'); wait(pg); pick(pg, TOP, '[12, -8, 20]'); wait(pg)
    print('boss panel:', pg.inner_text('#pm').replace('\n', ' | ')[:160]); ok(pg, '2 insert bosses')
    pg.click('[data-cmd="snap"]'); wait(pg); pick(pg, TOP, '[0, 10, 20]'); wait(pg)
    print('snap panel:', pg.inner_text('#pm').replace('\n', ' | ')[:240]); ok(pg, 'snap-fit')
    pg.keyboard.press('Control+7'); time.sleep(0.4); pg.screenshot(path='/tmp/b2_box.png')
    pg.click('[data-cmd="split"]'); wait(pg); print('split panel:', pg.inner_text('#pm').replace('\n', ' | ')[:200]); ok(pg, 'split + dowels')
    pg.keyboard.press('Control+7'); time.sleep(0.3); pg.evaluate("window.__app.viewer.fit()"); time.sleep(0.4); pg.screenshot(path='/tmp/b2_split.png')
    pg.click('[data-side="bodies"]'); time.sleep(0.3); pg.screenshot(path='/tmp/b2_bodies.png')
    print('bodies tab:', pg.inner_text('#side').replace('\n', ' | ')[:200])
    with pg.expect_download() as dl:
        pg.click('.tab:has-text("Mesh")'); pg.click('[data-cmd="exp3mf"]')
    d = dl.value; d.save_as('/tmp/b2.3mf'); print('3mf', d.suggested_filename, os.path.getsize('/tmp/b2.3mf'), 'bytes')
    pg.click('[data-bact="copy:1"]'); wait(pg); ok(pg, 'copy body 2')
    pg.click('[data-bact="combine:0"]'); wait(pg); print('combine panel:', pg.inner_text('#pm').replace('\n', ' | ')[:200]); ok(pg, 'combine union')
    with pg.expect_download() as dl:
        pg.click('[data-cmd="expstep"]')
    dl.value.save_as('/tmp/b2.step')

    # ---------- STEP import
    newpart(pg)
    with pg.expect_file_chooser() as fc:
        pg.click('[data-cmd="impstep"]')
    fc.value.set_files('/tmp/b2.step'); wait(pg, 60000); time.sleep(1); wait(pg)
    print('STEP import                  vol', vol(pg), 'bodies', nbodies(pg), 'errors', errs(pg))

    # ---------- lip + groove on a shelled box
    newpart(pg); box(pg, 40, 30, 20)
    select(pg, TOP); pg.click('.tab:has-text("Solids")'); pg.click('[data-cmd="shell"]'); wait(pg); ok(pg, 'shell')
    pg.click('.tab:has-text("Print")'); pg.click('[data-cmd="lipP"]'); wait(pg)
    print('lip pick:', pick(pg, TOP, '[0, -14, 20]')); wait(pg); ok(pg, 'lip')
    pg.keyboard.press('Control+7'); time.sleep(0.4); pg.screenshot(path='/tmp/b2_lip.png')
    pg.click('[data-side="tree"]'); time.sleep(0.3); print('tree:', pg.inner_text('.tree').replace('\n', ' | '))
    print('page errors:', pg._logs)
    b.close()
