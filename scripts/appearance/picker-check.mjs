import assert from 'node:assert/strict';
import {APPEARANCE_THEMES, themeArtStyle} from '../../src/lib/appearance-themes.ts';

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
      cards:[...grid.children].map(e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,row:e.offsetTop,width:b.width,height:b.height}})};
  })()`);
  const fits = (g,width,height) => {
    assert.ok(g.dialog.x>=-1 && g.dialog.y>=-1 && g.dialog.right<=width+1 && g.dialog.bottom<=height+1, 'Picker dialog must fit the viewport');
    assert.ok(g.scroll<=g.client+1,'Picker must not scroll horizontally');
    assert.ok(g.cards.every(card=>card.width>=40 && card.height>=40 && card.x>=-1 && card.x+card.width<=width+1),'Every theme card fits horizontally and remains a finger-sized target');
  };
  try {
    for (const [width,height,mode,scale] of [[1360,1000,'dark',1],[1360,1000,'light',1],[390,844,'dark',1],[390,844,'light',1],[320,640,'light',1.25]]) {
      await run(`Appearance picker ${width}px ${mode} scale ${scale}`,async()=>{
        await dimensions(width,height,mode,scale);
        await evaluate('document.fonts.ready.then(()=>true)');
        assert.equal(await evaluate(`document.querySelectorAll('.appearance-option').length`),APPEARANCE_THEMES.length);
        assert.equal(await evaluate(`document.querySelector('.appearance-follow').getAttribute('aria-pressed')`),'true','Picker starts by following the campaign');
        const baseline=await previews();
        for (const definition of APPEARANCE_THEMES) {
          const expected=themeArtStyle(definition.id)['--theme-art-frame'];
          assert.equal(baseline[definition.id].frame.trim(),expected);
          if(definition.art?.frame) assert.equal(baseline[definition.id].slice,themeArtStyle(definition.id)['--theme-frame-slice'],'Thumbnail uses the registered frame geometry');
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
          await click('.appearance-follow');
          await waitFor(`document.querySelector('.appearance-follow').getAttribute('aria-pressed')==='true'`);
          assert.equal(await evaluate(`localStorage.getItem('odm.appearance')`),null);
        }
        return await layout();
      });
    }
    await run('Picker layout accommodates four and six themes',async()=>{
      // Layout-only fixture cards exercise future catalog sizes without adding
      // fake saved theme IDs or mutating the application's registry.
      for(const count of [4,6].filter(count=>count>=APPEARANCE_THEMES.length)) {
        for(const [width,height,scale] of [[1360,1000,1],[390,844,1],[320,640,1.25]]) {
          await evaluate(`(()=>{const g=document.querySelector('.appearance-grid');g.querySelectorAll('[data-layout-fixture]').forEach(e=>e.remove());while(g.children.length<${count}){const c=g.firstElementChild.cloneNode(true);c.dataset.layoutFixture='true';c.disabled=true;g.append(c)}})()`);
          await dimensions(width,height,'light',scale);
          const g=await layout();fits(g,width,height);
          // Hover lifts a button without moving its grid row.
          const rows=Object.values(Object.groupBy(g.cards,card=>card.row));
          const expectedColumns=width===1360?(count===4?2:3):1;
          assert.ok(rows.every(row=>row.length===expectedColumns),`${count} choices at ${width}px: balanced rows with ${expectedColumns} columns: ${JSON.stringify(g)}`);
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
