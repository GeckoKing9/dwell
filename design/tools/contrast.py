"""Compute WCAG contrast for every shipped text/surface and graphics/surface pair,
parsing the token values straight out of prototype.html (single source of truth)."""
import re, sys
src = open(sys.argv[1]).read()
def block(sel_regex):
    m = re.search(sel_regex + r'\s*\{([^}]*)\}', src)
    return dict(re.findall(r'--([\w-]+):\s*(#[0-9A-Fa-f]{6})', m.group(1)))
light = block(r'(?m)^:root')
dark = block(r':root\[data-theme="dark"\]')
media = block(r':root:not\(\[data-theme="light"\]\)')
assert dark == media, 'dark blocks differ'
def lum(h):
    r, g, b = [int(h[i:i+2], 16) / 255 for i in (1, 3, 5)]
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
def cr(a, b):
    x, y = sorted([lum(a), lum(b)], reverse=True); return (x + 0.05) / (y + 0.05)
# (foreground, background, kind) pairs actually used in the UI
TEXT = [(t, s) for t in ('ink', 'ink-2', 'ink-3') for s in ('page', 'surface', 'surface-2', 'surface-3')]
TEXT += [('accent-text', s) for s in ('page', 'surface', 'surface-2', 'surface-3')]
TEXT += [('inverse-fg', 'inverse-bg'), ('stage-ink', 'stage')]
GFX = [('bar', s) for s in ('surface', 'surface-3')] + [('bar-hover', 'surface'), ('accent', 'surface'), ('accent', 'surface-2'), ('accent', 'page'), ('bar', 'surface-2')]
ok = True; worst = {}
print(f"{'mode':5} {'kind':4} {'foreground':12} {'background':10} {'ratio':>6}  need  result")
for mode, P in (('light', light), ('dark', dark)):
    for kind, pairs, need in (('text', TEXT, 4.5), ('gfx', GFX, 3.0)):
        for fg, bg in pairs:
            r = cr(P[fg], P[bg]); res = 'pass' if r >= need else 'FAIL'
            ok &= r >= need
            print(f"{mode:5} {kind:4} {fg:12} {bg:10} {r:6.2f}  {need:>4}  {res}")
            k = (mode, kind)
            if k not in worst or r < worst[k][0]: worst[k] = (r, fg, bg)
def rgba(name, P_src):
    m = re.search(r'--' + name + r':\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)', P_src); return [int(m.group(i)) for i in (1,2,3)] + [float(m.group(4))]
def blend(over, base):
    r,g,b,a = over; bb = [int(base[i:i+2],16) for i in (1,3,5)]
    return '#' + ''.join(f'{round(a*c + (1-a)*d):02X}' for c, d in zip((r,g,b), bb))
light_src = re.search(r'(?m)^:root\s*\{([^}]*)\}', src).group(1); dark_src = re.search(r':root\[data-theme="dark"\]\s*\{([^}]*)\}', src).group(1)
for mode, P, S_ in (('light', light, light_src), ('dark', dark, dark_src)):
    for fg, over, base in (('ink', 'accent-wash', 'surface'), ('accent-text', 'accent-wash', 'surface'), ('inverse-fg', 'inverse-btn', 'inverse-bg')):
        bg = blend(rgba(over, S_), P[base]); r = cr(P[fg], bg); ok &= r >= 4.5
        print(f"{mode:5} text {fg:12} {over+'/'+base:22} {r:6.2f}   4.5  {'pass' if r >= 4.5 else 'FAIL'}")
print('\nworst per mode:')
for k, v in worst.items(): print(' ', k, f'{v[1]} on {v[2]} = {v[0]:.2f}')
print('\nDecorative (no requirement): dot', {m: round(cr(P['dot'], P['surface']), 2) for m, P in (('light', light), ('dark', dark))})
print('ALL PASS' if ok else 'SOME FAIL'); sys.exit(0 if ok else 1)
