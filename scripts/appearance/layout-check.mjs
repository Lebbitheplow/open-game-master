import assert from 'node:assert/strict';
import {checkTableMaterials} from './material-check.mjs';

// Read actual text fragments: a nonzero heading box can still show only "T",
// and a page can fit the viewport while its back link covers a wrapped line.
export async function checkSharedLayout({evaluate, dimensions, go, storyId, combatId, run, shot, click, waitFor, settleOverlay}) {
  let activeId;
  const show=async id=>{if(activeId!==id){await go(id);activeId=id;}};
  for (const mode of ['dark','light']) {
    for (const [view,id,width,height] of [['story',storyId,320,640],['story',storyId,390,844],['combat',combatId,1024,900],['combat',combatId,1360,900],['combat',combatId,1920,1080]]) {
      await run(`Readable ${view} header ${width}px ${mode} enlarged text`, async () => {
        await dimensions(width,height,mode,1.25);
        await show(id);
        if(view==='combat') await waitFor(`!!document.querySelector('.board-view')`);
        await waitFor(`[...document.images].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}).every(e=>e.complete&&e.naturalWidth>0)`);
        if(view==='story'&&width===390) await checkTableMaterials({evaluate,run});
        const result=await evaluate(`(() => {
          const header=document.querySelector('.cine-header'), title=header.querySelector('.session-title');
          const bounds=title.getBoundingClientRect();
          const back=header.querySelector('a[href]');
          const backBox=back?.getBoundingClientRect();
          const visibleBack=backBox && backBox.width>0 && backBox.height>0;
          const range=document.createRange(), text=title.firstChild;
          let readable=0, overlaps=0;
          for(let i=0;i<text.length;i++) {
            if(!text.textContent[i].trim()) continue;
            range.setStart(text,i);range.setEnd(text,i+1);
            const r=range.getBoundingClientRect();
            // Font ascent/descent can exceed CSS line-height. The line's centre
            // must be visible; horizontal clipping still requires the full glyph.
            if(r.left>=bounds.left-1&&r.right<=bounds.right+1&&(r.top+r.bottom)/2>=bounds.top&&(r.top+r.bottom)/2<=bounds.bottom) {
              readable++;
              if(visibleBack && r.left<backBox.right && r.right>backBox.left && r.top<backBox.bottom && r.bottom>backBox.top) overlaps++;
            }
          }
          const outside=[...header.querySelectorAll('button,a')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(r.left<0||r.right>innerWidth+1);}).map(e=>e.getAttribute('aria-label')||e.textContent);
          return {readable,required:Math.min(12,title.textContent.replace(/\\s/g,'').length),overlaps,outside,title:bounds.toJSON(),pageWidth:document.documentElement.scrollWidth};
        })()`);
        assert.ok(result.readable>=result.required,'Session title collapsed: '+JSON.stringify(result));
        assert.equal(result.overlaps,0,'Back link overlaps title glyphs: '+JSON.stringify(result));
        assert.deepEqual(result.outside,[],'Header controls leave the viewport');
        assert.ok(result.pageWidth<=width+1,'Header causes horizontal overflow');
        await shot(`header-${view}-${width}-${mode}-large`);
        return result;
      });
    }
    for (const width of [390,1360]) await run(`Enlarged map content clears frame ${width}px ${mode}`,async()=>{
      await dimensions(width,width===390?844:900,mode,1);
      await show(combatId);
      if(width<1024) {
        await click('.cine-bottombar [data-tour="tab-battle"]');
        await waitFor(`[...document.querySelectorAll('button[aria-label="Enlarge battle map"]')].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.top>=0&&r.bottom<=innerHeight})`);
      }
      await waitFor(`[...document.querySelectorAll('button[aria-label="Enlarge battle map"]')].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.top>=0&&r.bottom<=innerHeight})`);
      await click('button[aria-label="Enlarge battle map"]');
      await waitFor(`!!document.querySelector('.theme-overlay')`);
      try {
        await settleOverlay();
        const result=await evaluate(`(() => {
          const overlay=document.querySelector('.theme-overlay'), ornament=overlay.querySelector('.theme-ornaments');
          const r=ornament.getBoundingClientRect(), style=getComputedStyle(ornament,'::before');
          const frame=parseFloat(style.borderImageWidth);
          const safe={left:r.left+parseFloat(style.left)+frame,right:r.right-parseFloat(style.right)-frame};
          const elements=[...overlay.querySelectorAll('.cine-order-row,.cine-tabletop-head')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0});
          return {safe,rows:overlay.querySelectorAll('.cine-order-row').length,boxes:elements.map(e=>({name:e.className,...e.getBoundingClientRect().toJSON()}))};
        })()`);
        assert.ok(result.boxes.length>0,'Overlay contains visible content');
        if(width===1360) assert.ok(result.rows>0,'Desktop fixture includes initiative rows');
        for(const box of result.boxes) assert.ok(box.x>=result.safe.left-1&&box.right<=result.safe.right+1,'Content enters the painted frame: '+JSON.stringify({box,safe:result.safe}));
        await shot(`frame-clearance-${width}-${mode}`);
        return result;
      } finally { await click('button[aria-label="Close the board"]');await waitFor(`!document.querySelector('.theme-overlay')`); }
    });
  }
}
