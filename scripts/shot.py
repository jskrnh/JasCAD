import sys, time, json
from playwright.sync_api import sync_playwright
url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5174/'
out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/shot.png'
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1440, 'height': 900})
    logs = []
    pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
    pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
    pg.goto(url)
    pg.wait_for_function("document.querySelector('#status') && /Rebuilt|error/.test(document.querySelector('#status').textContent)", timeout=60000)
    time.sleep(1.2)
    pg.screenshot(path=out)
    print('status:', pg.inner_text('#status'))
    print('\n'.join(l for l in logs if 'Download the' not in l)[-3000:])
    b.close()
