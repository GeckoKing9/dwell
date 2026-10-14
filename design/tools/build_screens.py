"""Generate fixed-size standalone artboards from prototype.html (CSS and JS copied in, no imports)."""
import json, sys, os
D = sys.argv[1]
src = open(os.path.join(D, 'prototype.html')).read()
BOARDS = [
    ('popup-light.html', 'Dwell Popup Light', 360, 560, dict(view='popup', state='normal', theme='light')),
    ('popup-dark.html', 'Dwell Popup Dark', 360, 560, dict(view='popup', state='normal', theme='dark')),
    ('popup-paused-light.html', 'Dwell Popup Paused', 360, 560, dict(view='popup', state='paused', theme='light')),
    ('dashboard-week-light.html', 'Dwell Week Light', 1280, 900, dict(view='dashboard', theme='light')),
    ('dashboard-week-dark.html', 'Dwell Week Dark', 1280, 900, dict(view='dashboard', theme='dark')),
    ('dashboard-day-light.html', 'Dwell Day Light', 1280, 900, dict(view='dashboard', theme='light', dash='day')),
]
os.makedirs(os.path.join(D, 'screens'), exist_ok=True)
for fn, title, w, h, boot in BOARDS:
    boot = dict(boot, artboard=True)
    out = src.replace('<title>Dwell Site Time</title>', f'<title>{title}</title>', 1)
    size_css = f'<style>/* artboard: fixed {w}x{h} */ html, body {{ width: {w}px; height: {h}px; overflow: hidden; }} :root {{ padding: 0; }}</style>\n</head>'
    out = out.replace('</head>', size_css, 1)
    out = out.replace('<script>\n\'use strict\';', '<script>window.DWELL_BOOT = ' + json.dumps(boot) + ';</script>\n<script>\n\'use strict\';', 1)
    assert 'DWELL_BOOT = ' in out
    open(os.path.join(D, 'screens', fn), 'w').write(out)
    print(fn, len(out))
