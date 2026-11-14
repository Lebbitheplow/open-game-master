import assert from 'node:assert/strict';
import {register} from 'node:module';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {assertThemeCss, assertSharedCss, assertArtAsset} from './appearance/contracts.mjs';
register('./lib/register-alias.mjs', import.meta.url);
const {APPEARANCE_THEMES} = await import('../src/lib/appearance-themes.ts');
const repo = fileURLToPath(new URL('../', import.meta.url));
let passed=0;
async function test(name, fn) {await fn();passed++;console.log(`ok: ${name}`);}

await test('every theme owns one scoped stylesheet, including its material overrides', () => {
  const owned = new Set(APPEARANCE_THEMES.map(theme=>theme.stylesheet));
  for (const theme of APPEARANCE_THEMES) assertThemeCss(readFileSync(path.join(repo,theme.stylesheet),'utf8'),theme.id);
  const styles=path.join(repo,'src/app/styles');
  for (const file of readdirSync(styles,{recursive:true}).filter(file=>file.endsWith('.css'))) {
    const relative='src/app/styles/'+file.replaceAll('\\','/');
    if (!owned.has(relative)) assertSharedCss(readFileSync(path.join(styles,file),'utf8'),relative);
    if (relative.startsWith('src/app/styles/themes/')) assert.ok(owned.has(relative), `${relative}: register the stylesheet in the catalog`);
  }
});
await test('scoping guard rejects leaks rather than merely finding an owner substring', () => {
  for (const selector of ['body', '[data-appearance="probe"], body', ':not([data-appearance="probe"])', ':is([data-appearance="probe"], body)', '[data-appearance="probe"] + body', '[data-appearance="probe"] .a ~ .b', '[data-appearance="other"]']) {
    assert.throws(()=>assertThemeCss(`${selector} {color:red}`, 'probe'));
  }
  assert.throws(()=>assertThemeCss('@font-face {font-family: global;src:url(x)}','probe'));
  assert.throws(()=>assertThemeCss('[data-appearance="probe"] {--theme-frame-slice: 40%}','probe'),/catalog/);
  assert.throws(()=>assertThemeCss('[data-appearance="probe"] {body {color:red}}','probe'));
  assert.throws(()=>assertSharedCss('[data-appearance="probe"] {color:red}','shared.css'));
  assertThemeCss('@media (width < 40rem) {html[data-appearance="probe"] :is(.a,.b), [data-appearance="probe"] > .c {color:red}}','probe');
});
await test('shipped art satisfies transparent frame/corner and opaque surface contracts', async () => {
  for (const theme of APPEARANCE_THEMES) for (const [slot,asset] of Object.entries(theme.art??{})) {
    try {await assertArtAsset(path.join(repo,'public',asset),slot,theme.cornerScale??1,theme.frameSlice??22);}
    catch(error){throw new Error(`${theme.id}/${slot}: ${error.message}`,{cause:error});}
  }
});
await test('art guard rejects opaque and empty borders, and translucent surfaces', async () => {
  const solid=await sharp({create:{width:100,height:100,channels:4,background:'#ffffffff'}}).png().toBuffer();
  const empty=await sharp({create:{width:100,height:100,channels:4,background:'#ffffff00'}}).png().toBuffer();
  await assert.rejects(()=>assertArtAsset(solid,'frame'),/transparent interior/);
  await assert.rejects(()=>assertArtAsset(solid,'corner'),/transparent interior/);
  await assert.rejects(()=>assertArtAsset(empty,'frame'),/empty/);
  await assert.rejects(()=>assertArtAsset(empty,'texture'),/opaque/);
  await assert.rejects(()=>assertArtAsset(empty,'backdrop'),/opaque/);
});
await test('corner contract reads the displayed crop rather than the whole frame', async () => {
  // A thin L inside the top-left 25px crop, plus opaque art elsewhere.
  const pixels=Buffer.alloc(100*100*4);
  for(let y=0;y<100;y++)for(let x=0;x<100;x++) if(x<3||y<3||x>=25||y>=25) pixels[(y*100+x)*4+3]=255;
  const png=await sharp(pixels,{raw:{width:100,height:100,channels:4}}).png().toBuffer();
  await assertArtAsset(png,'corner',4);
  await assert.rejects(()=>assertArtAsset(png,'corner',1),/transparent interior/);
  // Paint elsewhere in the source must not disguise an entirely empty crop.
  for(let y=0;y<25;y++)for(let x=0;x<25;x++) pixels[(y*100+x)*4+3]=0;
  const invisibleCrop=await sharp(pixels,{raw:{width:100,height:100,channels:4}}).png().toBuffer();
  await assert.rejects(()=>assertArtAsset(invisibleCrop,'corner',4),/empty/);
});
console.log(`${passed} appearance contract checks passed`);
