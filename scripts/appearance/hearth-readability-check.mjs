// Run against the disposable preview: --theme hearth --port 3031.
// A long title exposed the shared phone grid's zero-width Back-link column;
// the day palette also darkened a label that stays over the map painting.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { theme, origin, output, browserPath } from './options.mjs';
import { openBrowser, pause } from './browser.mjs';

assert.equal(theme, 'hearth', 'This focused check owns only the Hearth treatment');
const browser = await openBrowser({ browserPath, output });
const { send, evaluate } = browser;
const checks = [];
const waitFor = async expression => {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await evaluate(expression)) return;
    await pause(200);
  }
  throw new Error(`Timed out: ${expression}`);
};
try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: origin });
  await pause(1000);
  const campaigns = await evaluate(`(async () => {
    const login = await fetch('/api/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body:JSON.stringify({username:'theme_preview',password:'ThemePreview2026!'}) });
    if (!login.ok) throw new Error('Fixture login failed');
    localStorage.setItem('odm.appearance','hearth');
    localStorage.setItem('odm:tour:table-player','done');
    localStorage.setItem('odm:tour:table-dm','done');
    return (await (await fetch('/api/campaigns')).json()).campaigns;
  })()`);
  for (const title of ['The Verdant Archive · In play', 'Theme validation · Combat']) {
    const campaign = campaigns.find(c => c.title === title);
    assert.ok(campaign, `Missing disposable fixture: ${title}`);
    await send('Page.navigate', { url: `${origin}/campaigns/${campaign.id}` });
    await waitFor(`!!document.querySelector('.theme-table header.cine-header')`);
    for (const width of [320, 390]) for (const mode of ['dark', 'light']) for (const scale of [1, 1.25]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: width === 320 ? 640 : 844, deviceScaleFactor: 1, mobile: false });
      await evaluate(`localStorage.setItem('odm.theme','${mode}');localStorage.setItem('odm.ui-scale','${scale}');window.dispatchEvent(new StorageEvent('storage',{key:null}));`);
      await pause(500);
      const geometry = await evaluate(`(() => {
        const header = document.querySelector('.theme-table header.cine-header');
        const box = e => { const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
        return {back:box(header.querySelector(':scope > a')),title:box(header.querySelector('.session-title')),controls:box(header.lastElementChild),header:box(header),pageWidth:document.documentElement.scrollWidth};
      })()`);
      assert.ok(geometry.back.width >= 40 && geometry.back.height >= 40, 'Back remains a finger-sized target');
      assert.ok(geometry.back.right <= geometry.title.x, 'Back link and wrapped title must have separate columns');
      assert.ok(geometry.title.right <= width - 4, 'Title stays inside the painted rail');
      assert.ok(geometry.controls.y >= geometry.title.bottom, 'Controls stay below the title');
      assert.ok(geometry.controls.right <= width && geometry.pageWidth <= width, 'Header has no horizontal overflow');
      checks.push({ title, width, mode, scale, geometry });
      console.log(`PASS: Hearth header ${title} ${width}px ${mode} scale ${scale}`);
      if (width === 390 && scale === 1.25) {
        const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        const view = title.includes('Combat') ? 'combat' : 'story';
        await fs.writeFile(path.join(output, `validation-hearth-header-${view}-${mode}.png`), Buffer.from(image.data, 'base64'));
      }
    }
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitFor(`!!document.querySelector('.cine-fight-hand [data-tour="battle-hand"] .hand-label')`);
  for (const mode of ['dark', 'light']) {
    await evaluate(`localStorage.setItem('odm.theme','${mode}');window.dispatchEvent(new StorageEvent('storage',{key:null}));`);
    await pause(500);
    const paint = await evaluate(`(() => {const s=getComputedStyle(document.querySelector('.cine-fight-hand [data-tour="battle-hand"] .hand-label'));return {ink:s.color,shadow:s.textShadow};})()`);
    const luminance = color => {
      const rgb = color.match(/rgba?\(([^)]+)\)/)?.[1].split(',').slice(0,3).map(Number);
      assert.ok(rgb?.length === 3, `Expected painted RGB color: ${color}`);
      const linear = rgb.map(v => v/255 <= .04045 ? v/255/12.92 : ((v/255+.055)/1.055)**2.4);
      return linear[0]*.2126 + linear[1]*.7152 + linear[2]*.0722;
    };
    const [high, low] = [luminance(paint.ink), luminance(paint.shadow)].sort((a,b)=>b-a);
    assert.ok((high+.05)/(low+.05) >= 4.5, 'Map hand label must contrast with its dark protective shadow in both modes');
    checks.push({title:'Map hand label',mode,paint});
    console.log(`PASS: Hearth map hand label ${mode}`);
  }
  await fs.writeFile(path.join(output, 'results-hearth-readability.json'), JSON.stringify({ theme, checks, failures: [] }, null, 2));
  console.log(`${checks.length} Hearth readability checks passed`);
} finally {
  await browser.close();
}
