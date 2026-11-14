// Run against npm run theme:preview with the same --theme and --port.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { theme, definition, origin, output, browserPath } from './options.mjs';
import { themeArtStyle, APPEARANCE_THEME_IDS } from '../../src/lib/appearance-themes.ts';
import { openBrowser, pause } from './browser.mjs';
import { writeReview } from './review.mjs';
const browser = await openBrowser({browserPath,output});
const {send,evaluate}=browser;
try {
  const checks = [], failures = [], screenshots = [];
  const interactionsOnly = process.argv.includes('--interactions-only');
  const waitFor = async (expression, timeout = 20000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await evaluate(expression)) return; await pause(200); }
    throw new Error('Timed out: ' + expression);
  };
  const click = async selector => {
    const point = await evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height); if (!el) throw new Error('Missing control: ' + ${JSON.stringify(selector)}); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  };
  const escape = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await pause(250);
  };
  const shot = async name => {
    const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const filename = 'validation-' + name + '.png';
    await fs.writeFile(path.join(output, filename), Buffer.from(image.data, 'base64'));
    screenshots.push(filename);
  };
  const run = async (label, fn) => {
    try { const detail = await fn(); checks.push({ label, detail }); console.log('PASS: ' + label); }
    catch (error) { failures.push({ label, error: error.message }); console.log('FAIL: ' + label + ': ' + error.message); await shot('failure-' + failures.length); }
  };
  const dimensions = async (width, height, mode, scale) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await evaluate(`localStorage.setItem('odm.theme', ${JSON.stringify(mode)}); localStorage.setItem('odm.ui-scale', '${scale}'); window.dispatchEvent(new StorageEvent('storage', { key: null }));`);
    await pause(650);
  };
  const geometry = () => evaluate(`(() => {
    const visible = e => e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
    const box = e => { if (!visible(e)) return null; const r = e.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
    return { width:innerWidth, height:innerHeight, pageWidth:document.documentElement.scrollWidth, pageHeight:document.documentElement.scrollHeight, textSize:getComputedStyle(document.documentElement).fontSize, composer:box([...document.querySelectorAll('.cine-desk textarea')].find(visible)), story:box(document.querySelector('.session-transcript')), hand:box(document.querySelector('.hand')), map:box([...document.querySelectorAll('[aria-label^="Board view"]')].find(visible)), dialog:box([...document.querySelectorAll('[role="dialog"]')].find(visible)) };
  })()`);
  const fitsPage = g => { assert.ok(g.pageWidth <= g.width + 1, 'horizontal page overflow: ' + JSON.stringify(g)); assert.ok(g.pageHeight <= g.height + 1, 'vertical page overflow: ' + JSON.stringify(g)); };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: origin });
  await pause(1500);
  const campaigns = await evaluate(`(async () => {
    const login = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:'theme_preview',password:'ThemePreview2026!'}) });
    if (!login.ok) throw new Error('Fixture login failed');
    localStorage.removeItem('odm.appearance'); localStorage.setItem('odm:tour:table-player','done'); localStorage.setItem('odm:tour:table-dm','done'); localStorage.setItem('odm:dice3d','off');
    return (await (await fetch('/api/campaigns')).json()).campaigns;
  })()`);
  const storyId = campaigns.find(c => c.title === 'The Verdant Archive · In play').id;
  const combatId = campaigns.find(c => c.title === 'Theme validation · Combat').id;
  const lobbyId = campaigns.find(c => c.title === 'Theme validation · Lobby')?.id;
  assert.ok(lobbyId, 'Use the disposable theme:preview server, with the same --theme and --port');
  const go = async id => {
    await send('Page.navigate', { url: origin + '/campaigns/' + id });
    await waitFor(`!!document.querySelector('.theme-table') && document.documentElement.dataset.appearance === ${JSON.stringify(theme)}`);
    await evaluate('document.fonts.ready.then(() => true)');
    await pause(900);
  };
  await send('Page.navigate', {url:origin+'/campaigns/'+lobbyId});
  await waitFor(`!!document.querySelector('.theme-lobby-shell') && document.documentElement.dataset.appearance === ${JSON.stringify(theme)}`);
  await evaluate('document.fonts.ready.then(() => true)');
  if (!interactionsOnly) for (const width of [1360,390]) for (const mode of ['dark','light']) {
    await run(`Lobby ${width}px ${mode}`, async () => {
      await dimensions(width, width===1360?1000:844, mode, 1);
      await evaluate(`Promise.all(${JSON.stringify(Object.values(definition.art ?? {}))}.map(src=>new Promise((resolve,reject)=>{const img=new Image();img.onload=resolve;img.onerror=reject;img.src=src})))`);
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Lobby fits horizontally');
      await shot(`lobby-${width}-${mode}`);
    });
  }
  await go(storyId);
  await waitFor(`getComputedStyle(document.documentElement).getPropertyValue('--theme-art-frame').trim() === ${JSON.stringify(themeArtStyle(theme)['--theme-art-frame'])}`);
  await evaluate(`Promise.all(${JSON.stringify(Object.values(definition.art ?? {}))}.map(name=>new Promise((resolve,reject)=>{const img=new Image();img.onload=resolve;img.onerror=reject;img.src=name})))`);
  await waitFor(`document.querySelector('.session-transcript')?.textContent.includes('Archive entry 125')`);
  if (!interactionsOnly && !process.argv.includes('--dice-only')) for (const [width,height] of [[1360,900],[390,844],[320,640]]) for (const mode of ['dark','light']) for (const scale of [1,1.25]) {
    await run(`Long story ${width}px ${mode} scale ${scale}`, async () => {
      await dimensions(width,height,mode,scale);
      const g = await geometry(); fitsPage(g);
      assert.ok(g.composer && g.composer.bottom <= height && g.composer.width >= 80, 'Composer clipped: ' + JSON.stringify(g));
      assert.ok(g.story && g.story.height >= 140, 'Reading area collapsed: ' + JSON.stringify(g));
      const scroll = await evaluate(`(() => { const e=document.querySelector('.session-transcript'); e.scrollTop=0; return { total:e.scrollHeight, visible:e.clientHeight, top:e.scrollTop }; })()`);
      assert.ok(scroll.total > scroll.visible * 10 && scroll.top === 0, 'Long history scrolls to top');
      await evaluate(`(() => { const e=document.querySelector('.session-transcript'); e.scrollTop=e.scrollHeight; })()`);
      if (scale === 1.25 && width !== 320) await shot(`story-${width}-${mode}-large`);
      return g;
    });
  }
  await run('Registered themes replace or clear shared artwork', async () => {
    await dimensions(1360,900,'dark',1);
    for (const id of APPEARANCE_THEME_IDS) {
      await evaluate(`localStorage.setItem('odm.appearance',${JSON.stringify(id)});window.dispatchEvent(new StorageEvent('storage',{key:'odm.appearance'}))`);
      await waitFor(`document.documentElement.dataset.appearance===${JSON.stringify(id)}`);
      for (const [key,value] of Object.entries(themeArtStyle(id))) {
        assert.equal(await evaluate(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(key)}).trim()`),value);
      }
      const corner=await evaluate(`getComputedStyle(document.querySelector('.theme-ornaments[data-surface="table"]>span')).backgroundImage`);
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),`${id}: artwork does not widen the page`);
      const expected=themeArtStyle(id)['--theme-art-corner'];
      if(expected==='none') assert.equal(corner,'none');
      else assert.ok(corner.includes(expected.slice(5,-2)), 'Corner art reaches the shared renderer');
    }
    await evaluate(`localStorage.removeItem('odm.appearance');window.dispatchEvent(new StorageEvent('storage',{key:'odm.appearance'}))`);
    await waitFor(`document.documentElement.dataset.appearance===${JSON.stringify(theme)}`);
    await send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.theme-ornaments')).display`),'none');
    await send('Emulation.setEmulatedMedia',{features:[]});
  });
  if (!interactionsOnly) for (const [width,height] of [[1360,900],[390,844],[320,640]]) for (const mode of ['dark','light']) {
    await run(`Dice dialog ${width}px ${mode} large text`, async () => {
      await dimensions(width,height,mode,1.25);
      await click('button[aria-label="Dice"]');
      await waitFor(`!!document.querySelector('[role="menuitem"]')`);
      await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.includes('Roll dice')).click()`);
      await waitFor(`[...document.querySelectorAll('[role="dialog"] .dice-tray')].some(e=>e.getBoundingClientRect().width>0 && e.getBoundingClientRect().height>0)`);
      await pause(600);
      const g = await geometry();
      if (!g.dialog) console.log(await evaluate(`JSON.stringify([...document.querySelectorAll('[role="dialog"], .dice-tray')].map(e=>({tag:e.tagName,cls:e.className,rect:e.getBoundingClientRect().toJSON(),display:getComputedStyle(e).display})))`));
      assert.ok(g.dialog && g.dialog.x >= 0 && g.dialog.right <= width && g.dialog.y >= 0 && g.dialog.bottom <= height, 'Dialog outside viewport: ' + JSON.stringify(g.dialog));
      const contentFits = await evaluate(`(() => {const d=[...document.querySelectorAll('[role="dialog"]')].find(e=>e.getBoundingClientRect().width>0);return {width:d.clientWidth,scroll:d.scrollWidth};})()`);
      assert.ok(contentFits.scroll <= contentFits.width + 1, 'Dice content overflows horizontally: ' + JSON.stringify(contentFits));
      await click('.dice-tray button[aria-label^="Add a d20"]');
      if (width === 390) await shot(`dice-${mode}-large`);
      if (width === 1360 && mode === 'dark') {
        await click('.dice-tray-roll');
        await waitFor(`!!document.querySelector('.dice-tray-results li')`);
      }
      await escape();
      await waitFor(`![...document.querySelectorAll('[role="dialog"]')].some(e=>e.getBoundingClientRect().width>0 && e.getBoundingClientRect().height>0)`);
      return contentFits;
    });
    if (await evaluate(`[...document.querySelectorAll('[role="dialog"]')].some(e=>e.getBoundingClientRect().width>0 && e.getBoundingClientRect().height>0)`)) await escape();
  }
  await dimensions(1360,900,'dark',1);
  if (!process.argv.includes('--dice-only')) {
  await go(combatId);
  await waitFor(`!!document.querySelector('[aria-label^="Board view"]')`);
  if (!interactionsOnly) for (const [width,height] of [[1360,900],[390,844],[320,640]]) for (const mode of ['dark','light']) for (const scale of [1,1.25]) {
    await run(`Combat map ${width}px ${mode} scale ${scale}`, async () => {
      await dimensions(width,height,mode,scale);
      if (width < 1024) {
        await click('.cine-bottombar [data-tour="tab-battle"]');
        await pause(650);
      }
      const g = await geometry(); fitsPage(g);
      if (width >= 1024) assert.ok(g.composer && g.composer.bottom <= height - 8, 'Desktop combat composer clipped: ' + JSON.stringify(g));
      assert.ok(g.map && g.map.width >= 180 && g.map.height >= 160 && g.map.bottom <= height, 'Map collapsed or clipped: ' + JSON.stringify(g));
      if (scale === 1.25 && width !== 320) await shot(`combat-${width}-${mode}-large`);
      if (width < 1024) {
        await click('.cine-bottombar button'); await pause(300);
        const chat = await geometry(); fitsPage(chat);
        assert.ok(chat.composer && chat.composer.bottom <= height && chat.composer.width >= 80, 'Combat composer clipped: ' + JSON.stringify(chat));
        if (width === 390 && scale === 1.25) await shot(`combat-hand-${mode}-large`);
      }
      return g;
    });
  }
  }
  if (!process.argv.includes('--dice-only')) {
    await dimensions(1360,900,'dark',1);
    await run('Map keyboard zoom and enlarged board', async () => {
      const board='[aria-label^="Board view"]';
      await waitFor(`!!document.querySelector('.board-view')`);
      await click(board);
      const transform=()=>evaluate(`document.querySelector('.board-view [style*="translate"]')?.style.transform`);
      const before=await transform();
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'+',code:'Equal',windowsVirtualKeyCode:187});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'+',code:'Equal',windowsVirtualKeyCode:187});
      await pause(300);
      assert.notEqual(await transform(),before,'Keyboard zoom changes map camera');
      await click('button[aria-label="Enlarge battle map"]');
      await waitFor(`!!document.querySelector('button[aria-label="Close the board"]')`);
      await pause(500);
      const g=await geometry();
      assert.ok(g.dialog && g.dialog.right<=1360 && g.dialog.bottom<=900,'Enlarged map fits');
      await shot('map-enlarged');
      await click('button[aria-label="Close the board"]');
      await pause(650);
      return g;
    });
    await run('Combat hand opens a card', async () => {
      if (await evaluate(`!!document.querySelector('[aria-label="Close the hand tutorial"]')`)) await click('[aria-label="Close the hand tutorial"]');
      await waitFor(`!document.querySelector('.hand[data-tutorial="true"]')`);
      await pause(400);
      // A fanned card may overlap its neighbour. Keyboard activation tests the
      // named card rather than accidentally pressing the neighbour's face.
      await evaluate(`document.querySelector('.hand-card[aria-label^="Longbow"]').focus()`);
      await pause(300);
      assert.ok(await evaluate(`document.activeElement?.getAttribute('aria-label')?.startsWith('Longbow')`),'Longbow has keyboard focus');
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
      await waitFor(`!!document.querySelector('.hand-card[data-picked="true"]')`);
      assert.ok(await evaluate(`document.querySelector('.hand-card[data-picked="true"]').getAttribute('aria-label').startsWith('Longbow')`));
      await pause(400);
      const g=await geometry();
      assert.ok(g.composer && g.composer.bottom<=892,'Card selection keeps the composer visible: '+JSON.stringify(g));
      await shot('combat-card');
      return await evaluate(`document.querySelector('.hand-card[data-picked="true"]').getAttribute('aria-label')`);
    });
  }
  await fs.writeFile(path.join(output,interactionsOnly?'results-interactions.json':'results.json'), JSON.stringify({theme,createdAt:new Date().toISOString(),checks,failures},null,2));
  if (!interactionsOnly) await writeReview(output, theme, screenshots);
  if (failures.length) process.exitCode=1;
  console.log(JSON.stringify({passed:checks.length,failed:failures.length}));
} finally { await browser.close(); }
