import assert from 'node:assert/strict';
import {APPEARANCE_THEMES, themeArt, themeArtStyle} from '../../src/lib/appearance-themes.ts';

export async function checkPicker({send,evaluate,click,waitFor,dimensions,run,shot,origin}) {
  await send('Page.navigate',{url:origin});
  await waitFor(`!!document.querySelector('button[aria-label="Account"]')`);
  await dimensions(1360,1000,'dark',1);
  await click('button[aria-label="Account"]');
  await waitFor(`[...document.querySelectorAll('[role="menuitem"]')].some(e=>e.textContent.trim()==='Appearance')`);
  await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim()==='Appearance').click()`);
  await waitFor(`!!document.querySelector('.appearance-picker')`);
  const previews = () => evaluate(`Object.fromEntries([...document.querySelectorAll('.appearance-preview')].map(e=>{const s=getComputedStyle(e);return [e.dataset.appearance,{background:s.getPropertyValue('--background'),ink:s.getPropertyValue('--color-stone-200'),frame:s.getPropertyValue('--theme-art-frame'),slice:getComputedStyle(e.querySelector('.appearance-preview-frame')).borderImageSlice,cornerSize:s.getPropertyValue('--theme-corner-background-size')}]}))`);
  const layout = () => evaluate(`(()=>{
    const d=document.querySelector('.appearance-picker').closest('[role="dialog"]');const r=d.getBoundingClientRect();
    const grid=document.querySelector('.appearance-grid');
    return {dialog:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},client:d.clientWidth,scroll:d.scrollWidth,columns:getComputedStyle(grid).gridTemplateColumns,
      rail:{client:grid.clientWidth,scroll:grid.scrollWidth,overflow:getComputedStyle(grid).overflowX},modal:d.getAttribute('aria-modal'),overlay:!!document.querySelector('.dialog-overlay'),
      cards:[...grid.children].map(e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,row:e.offsetTop,width:b.width,height:b.height}})};
  })()`);
  const fits = (g,width,height) => {
    assert.ok(g.dialog.x>=-1 && g.dialog.y>=-1 && g.dialog.right<=width+1 && g.dialog.bottom<=height+1, 'Picker dialog must fit the viewport');
    assert.ok(g.scroll<=g.client+1,'Picker must not scroll horizontally');
    assert.ok(g.cards.every(card=>card.width>=40 && card.height>=40),'Every theme card remains a finger-sized target');
    // The panel is beside the page, not over it: no dimming layer, and the
    // page keeps half the width of a desktop or the top of a phone.
    assert.ok(!g.overlay && g.modal!=='true','The theme panel must not dim or trap the page');
    const rows=Object.values(Object.groupBy(g.cards,card=>card.row));
    if(width>540) {
      assert.ok(g.dialog.x>=width/2,`The panel keeps to the right half of a desktop: ${JSON.stringify(g.dialog)}`);
      assert.ok(rows.every(row=>row.length===1) && g.cards.every(card=>card.x>=-1 && card.x+card.width<=width+1),`One card to a row beside the page: ${JSON.stringify(g)}`);
    } else {
      assert.ok(g.dialog.y>=height*0.3,`The sheet leaves the top of a phone to the page: ${JSON.stringify(g.dialog)}`);
      // One row that scrolls sideways inside the sheet, never the sheet itself.
      assert.ok(rows.length===1 && g.rail.overflow==='auto' && g.rail.scroll>=g.rail.client,`The cards form one sideways row: ${JSON.stringify(g.rail)} rows ${rows.length}`);
    }
  };
  try {
    for (const [width,height,mode,scale] of [[1360,1000,'dark',1],[1360,1000,'light',1],[390,844,'dark',1],[390,844,'light',1],[320,640,'light',1.25]]) {
      await run(`Appearance picker ${width}px ${mode} scale ${scale}`,async()=>{
        await dimensions(width,height,mode,scale);
        await evaluate('document.fonts.ready.then(()=>true)');
        // CSS URL equality does not mean its image has decoded. A cold profile
        // otherwise captures empty frames while reporting a passing preview.
        const previewArt = [...new Set(APPEARANCE_THEMES.flatMap(theme => Object.values(themeArt(theme.id, mode) ?? {})))];
        await evaluate(`Promise.all(${JSON.stringify(previewArt)}.map(src=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>img.decode().then(resolve,reject);img.onerror=()=>reject(new Error('Preview artwork failed: '+src));img.src=src})))`);
        assert.equal(await evaluate(`document.querySelectorAll('.appearance-option').length`),APPEARANCE_THEMES.length);
        assert.equal(await evaluate(`document.querySelector('.appearance-follow').getAttribute('aria-pressed')`),'true','Picker starts by following the campaign');
        const baseline=await previews();
        for (const definition of APPEARANCE_THEMES) {
          // Each preview shows the artwork of the brightness it previews.
          const expected=themeArtStyle(definition.id,mode)['--theme-art-frame'];
          assert.equal(baseline[definition.id].frame.trim(),expected,`${definition.id}: preview frame in ${mode} mode`);
          if(themeArt(definition.id,mode)?.frame) assert.equal(baseline[definition.id].slice,themeArtStyle(definition.id,mode)['--theme-frame-slice'],'Thumbnail uses the registered frame geometry');
        }
        fits(await layout(),width,height);
        await shot(`picker-${width}-${mode}-${scale}`);
        if(width===1360 && mode==='dark') {
          for(const definition of APPEARANCE_THEMES) {
            const selector=`.appearance-option:has([data-appearance="${definition.id}"])`;
            await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
            await waitFor(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`);
            await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
            await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
            await waitFor(`document.documentElement.dataset.appearance===${JSON.stringify(definition.id)}`);
            await waitFor(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-pressed')==='true'`);
            assert.deepEqual(await previews(),baseline,'Changing the page theme must not recolor neighboring previews');
          }
          // Past nine themes the last card scrolls the panel, and the nearest
          // scroll back leaves this button under the panel's sticky title.
          await evaluate(`document.querySelector('.appearance-follow').scrollIntoView({block:'center'})`);
          await click('.appearance-follow');
          await waitFor(`document.querySelector('.appearance-follow').getAttribute('aria-pressed')==='true'`);
          assert.equal(await evaluate(`localStorage.getItem('odm.appearance')`),null);
        }
        return await layout();
      });
    }
    // Sizes ahead of the catalog: a fixed list ran nothing once the catalog
    // passed its largest entry (six, with seven themes shipped).
    const ahead=[1,3,5].map(extra=>APPEARANCE_THEMES.length+extra);
    await run(`Picker layout accommodates ${ahead.join(', ')} themes`,async()=>{
      // Layout-only fixture cards exercise future catalog sizes without adding
      // fake saved theme IDs or mutating the application's registry.
      for(const count of ahead) {
        for(const [width,height,scale] of [[1360,1000,1],[390,844,1],[320,640,1.25]]) {
          await evaluate(`(()=>{const g=document.querySelector('.appearance-grid');g.querySelectorAll('[data-layout-fixture]').forEach(e=>e.remove());while(g.children.length<${count}){const c=g.firstElementChild.cloneNode(true);c.dataset.layoutFixture='true';c.disabled=true;g.append(c)}})()`);
          await dimensions(width,height,'light',scale);
          const g=await layout();fits(g,width,height);
          assert.equal(g.cards.length,count,`${count} choices at ${width}px`);
          if(width===1360) await shot(`picker-layout-${count}`);
        }
      }
    });
  } finally {
    await evaluate(`document.querySelectorAll('[data-layout-fixture]').forEach(e=>e.remove());localStorage.removeItem('odm.appearance');window.dispatchEvent(new StorageEvent('storage',{key:null}))`);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  }
}
