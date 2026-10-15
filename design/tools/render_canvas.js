'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');
const S = path.resolve(__dirname, '..');
const SCREENS = [
  ['popup-light', 'Main', 'Popup, light', 360, 560, 'surface'],
  ['popup-dark', 'PopupDark', 'Popup, dark', 360, 560, 'surface'],
  ['popup-paused-light', 'PopupPaused', 'Popup, paused', 360, 560, 'surface'],
  ['dashboard-week-light', 'DashboardWeek', 'Dashboard, week, light', 1280, 900, 'page'],
  ['dashboard-week-dark', 'DashboardWeekDark', 'Dashboard, week, dark', 1280, 900, 'page'],
  ['dashboard-day-light', 'DashboardDay', 'Dashboard, day, light', 1280, 900, 'page'],
];
const FONTS = 'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300..700&family=IBM+Plex+Mono:wght@400;500&display=swap';

function block(css, selectorStart) {
  const i = css.indexOf(selectorStart);
  if (i < 0) throw new Error('missing ' + selectorStart);
  let depth = 0, j = css.indexOf('{', i);
  for (let k = j; k < css.length; k++) {
    if (css[k] === '{') depth++;
    else if (css[k] === '}') { depth--; if (depth === 0) return { start: i, end: k + 1, body: css.slice(j + 1, k) }; }
  }
  throw new Error('unbalanced ' + selectorStart);
}
function transformCss(raw, dark) {
  const light = block(raw, ':root {');
  const darkB = block(raw, ':root[data-theme="dark"] {');
  const media = block(raw, '@media (prefers-color-scheme: dark) {');
  let css = raw;
  // remove in reverse document order
  const removals = [light, media, darkB, block(raw, ':root { padding-top')].sort((a, b) => b.start - a.start);
  for (const r of removals) css = css.slice(0, r.start) + css.slice(r.end);
  css = css.replace(/html, body \{/g, '.dc-root {').replace(/\nbody \{/g, '\n.dc-root {').replace(/body\.artboard/g, '.dc-root.artboard');
  const vars = light.body + (dark ? '\n' + darkB.body : '');
  return '.dc-root {' + vars + '\n}\n' + css;
}
(async () => {
  const browser = await chromium.launch();
  const boards = {}, order = [];
  let rowY = 0, rowH = 0, x = 0, lastRow = null;
  for (const [file, name, title, w, minH, bg] of SCREENS) {
    const page = await browser.newPage({ viewport: { width: w, height: minH }, deviceScaleFactor: 1 });
    await page.goto('file://' + path.join(S, 'screens', file + '.html'), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ html: document.getElementById('app').innerHTML, h: document.getElementById('app').scrollHeight, theme: document.documentElement.getAttribute('data-theme') }));
    await page.close();
    const src = fs.readFileSync(path.join(S, 'screens', file + '.html'), 'utf8');
    const rawCss = src.slice(src.indexOf('<style>') + 7, src.indexOf('</style>'));
    const dark = r.theme === 'dark';
    const h = w === 360 ? 560 : Math.max(minH, r.h);
    if (r.html.includes('{{')) throw new Error('template braces in ' + file);
    const css = transformCss(rawCss, dark);
    const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="${FONTS}">
<style>
body{margin:0}
a{color:#0A6B63}a:hover{color:#0E877D}
${css}
</style>
</helmet>
<div class="dc-root artboard" data-theme="${dark ? 'dark' : 'light'}" style="width: ${w}px; height: ${h}px; overflow: hidden; background: var(--${bg}); color: var(--ink); font-family: var(--f-sans); font-size: 0.875rem; line-height: 1.45">
${r.html}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${w},"height":${h}}}'>
class Component extends DCLogic {
renderVals() {
return {};
}
}
</script>
</body>
</html>
`;
    fs.writeFileSync(path.join(S, 'canvas/project', name + '.dc.html'), doc);
    const row = w === 360 ? 'popup' : 'dash';
    if (row !== lastRow && lastRow) { rowY += rowH + 120; x = 0; rowH = 0; }
    if (row === 'dash' && x > 0 && name === 'DashboardDay') { rowY += rowH + 120; x = 0; rowH = 0; }
    lastRow = row;
    boards[name + '.dc.html'] = { x, y: rowY, w, h, title };
    order.push(name + '.dc.html');
    x += w + 80; rowH = Math.max(rowH, h);
    console.log(file, '->', name, w + 'x' + h, 'at', boards[name + '.dc.html'].x, rowY, 'html', r.html.length);
  }
  await browser.close();
  const dashY = boards['DashboardWeek.dc.html'].y, dayY = boards['DashboardDay.dc.html'].y;
  const canvas = {
    v: 3, createdOnFiles: { v: 1, at: new Date().toISOString() }, title: 'Dwell Screen Time Design', launch: { view: 'canvas' }, pages: [],
    boards, order,
    notes: {
      n1: { x: 0, y: -260, text: 'Popup, 360 x 560', kind: 'title1', maxW: 1240 },
      n2: { x: 0, y: dashY - 260, text: 'Dashboard, week', kind: 'title1', maxW: 2640 },
      n3: { x: 0, y: dayY - 260, text: 'Dashboard, day view', kind: 'title1', maxW: 1280 },
    },
    designSystems: [],
  };
  fs.writeFileSync(path.join(S, 'canvas/project/canvas.json'), JSON.stringify(canvas, null, 1));
  console.log('canvas.json written');
})().catch(e => { console.error(e); process.exit(1); });
