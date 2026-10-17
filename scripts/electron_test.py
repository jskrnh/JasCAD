import time, subprocess
from playwright.sync_api import sync_playwright
proc = subprocess.Popen(['node_modules/electron/dist/electron', '--no-sandbox', '--remote-debugging-port=9333', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'desktop'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(10)
try:
    with sync_playwright() as p:
        b = p.chromium.connect_over_cdp('http://127.0.0.1:9333')
        w = b.contexts[0].pages[0]; logs=[]
        w.on('pageerror', lambda e: logs.append(str(e)))
        w.wait_for_function("document.querySelector('#status') && /Rebuilt|error/.test(document.querySelector('#status').textContent)", timeout=90000)
        time.sleep(1.5); w.screenshot(path='/tmp/electron.png')
        print('url', w.url, '| status', w.inner_text('#status').replace('\n',' '), '| hid', w.evaluate("'hid' in navigator"), '| secure', w.evaluate("isSecureContext"))
        print(logs)
finally:
    proc.kill()
