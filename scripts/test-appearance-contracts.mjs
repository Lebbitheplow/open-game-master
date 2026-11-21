import assert from 'node:assert/strict';
import {register} from 'node:module';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {assertThemeCss, assertSharedCss, assertArtAsset, assertThemeArt, themeArtAssets} from './appearance/contracts.mjs';
register('./lib/register-alias.mjs', import.meta.url);
const {APPEARANCE_THEMES, themeStylesheet} = await import('../src/lib/appearance-themes.ts');
const repo = fileURLToPath(new URL('../', import.meta.url));
let passed=0;
async function test(name, fn) {await fn();passed++;console.log(`ok: ${name}`);}

await test('every theme owns one scoped stylesheet, including its material overrides', () => {
  const owned = new Set(APPEARANCE_THEMES.map(theme=>themeStylesheet(theme.id)));
  for (const theme of APPEARANCE_THEMES) assertThemeCss(readFileSync(path.join(repo,themeStylesheet(theme.id)),'utf8'),theme.id);
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
  assert.throws(()=>assertThemeCss('[data-appearance="probe"] {--theme-corner-flip: 1}','probe'),/catalog/);
  assert.throws(()=>assertThemeCss('html[data-appearance="probe"] .ornate::before,\nhtml[data-appearance="probe"] .ornate::after { width: 18px; border-width: 2px; }','probe'),/own border widths/);
  assertThemeCss('html[data-appearance="probe"] .ornate::before,\nhtml[data-appearance="probe"] .ornate::after { width: 18px; }\nhtml[data-appearance="probe"] .ornate::before { border-width: 2px 0 0 2px; }','probe');
  // A closed box written for one bracket alone, or through the shorthand.
  assert.throws(()=>assertThemeCss('html[data-appearance="probe"] .ornate::after { border-width: 2px; }','probe'),/bottom-right bracket.*closed box/);
  assert.throws(()=>assertThemeCss('html[data-appearance="probe"] .ornate::before { border: 2px solid gold; }','probe'),/own border widths/);
  assert.throws(()=>assertThemeCss('html[data-appearance="probe"] .ornate::before { border-right-width: 1px; }','probe'),/closed box/);
  // A double line at the shared 1px draws one stroke; 3px per side draws two.
  assert.throws(()=>assertThemeCss('html[data-appearance="probe"] .ornate::before,\nhtml[data-appearance="probe"] .ornate::after { border-style: double; }','probe'),/double line/);
  assertThemeCss('html[data-appearance="probe"] .ornate::before,\nhtml[data-appearance="probe"] .ornate::after { border-style: double; }\nhtml[data-appearance="probe"] .ornate::before { border-width: 3px 0 0 3px; }\nhtml[data-appearance="probe"] .ornate::after { border-width: 0 3px 3px 0; }','probe');
  assert.throws(()=>assertThemeCss('[data-appearance="probe"] {body {color:red}}','probe'));
  assert.throws(()=>assertSharedCss('[data-appearance="probe"] {color:red}','shared.css'));
  assertThemeCss('@media (width < 40rem) {html[data-appearance="probe"] :is(.a,.b), [data-appearance="probe"] > .c {color:red}}','probe');
});
await test('no stylesheet puts a pseudo-element inside :is() or :where(), where it matches nothing', () => {
  // :is(.ornate::before, .ornate::after) is invalid; the build compiled six
  // theme rules to an empty :is() and none of them ever applied.
  const styles=path.join(repo,'src/app/styles');
  for (const file of readdirSync(styles,{recursive:true}).filter(file=>file.endsWith('.css'))) {
    const css=readFileSync(path.join(styles,file),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
    assert.doesNotMatch(css,/:(?:is|where)\([^)]*::/,`src/app/styles/${file}: write each pseudo-element as its own selector`);
  }
});
await test('shipped art satisfies transparent frame/corner and opaque surface contracts', async () => {
  for (const theme of APPEARANCE_THEMES) await assertThemeArt(theme,asset=>path.join(repo,'public',asset));
});
await test('day artwork meets the same contracts as the set it replaces', async () => {
  const solid=await sharp({create:{width:100,height:100,channels:4,background:'#ffffffff'}}).png().toBuffer();
  const clear=await sharp({create:{width:100,height:100,channels:4,background:'#ffffff00'}}).png().toBuffer();
  // A sound border: opaque rails around a transparent centre, and for the
  // corner an L along the top and left.
  const rails=Buffer.alloc(100*100*4), bracket=Buffer.alloc(100*100*4), thick=Buffer.alloc(100*100*4);
  for(let y=0;y<100;y++)for(let x=0;x<100;x++) {
    if(x<10||y<10||x>=90||y>=90) rails[(y*100+x)*4+3]=255;
    if(x<10||y<10) bracket[(y*100+x)*4+3]=255;
    if(x<20||y<20) thick[(y*100+x)*4+3]=255;
  }
  const frame=await sharp(rails,{raw:{width:100,height:100,channels:4}}).png().toBuffer();
  const corner=await sharp(bracket,{raw:{width:100,height:100,channels:4}}).png().toBuffer();
  const images={frame,corner,solid,clear,thick:await sharp(thick,{raw:{width:100,height:100,channels:4}}).png().toBuffer()};
  const open=name=>images[name];
  const night={texture:'solid',frame:'frame',corner:'corner',backdrop:'solid'};
  await assertThemeArt({id:'probe',art:night,artDay:{...night}},open);
  assert.deepEqual(themeArtAssets({art:{frame:'a'},artDay:{frame:'b',texture:'c'}}),[{set:'art',slot:'frame',asset:'a'},{set:'artDay',slot:'frame',asset:'b'},{set:'artDay',slot:'texture',asset:'c'}]);
  await assert.rejects(()=>assertThemeArt({id:'probe',art:night,artDay:{frame:'solid'}},open),/probe\/artDay\.frame: .*transparent interior/);
  await assert.rejects(()=>assertThemeArt({id:'probe',art:night,artDay:{corner:'solid'}},open),/probe\/artDay\.corner: .*transparent interior/);
  await assert.rejects(()=>assertThemeArt({id:'probe',art:night,artDay:{frame:'clear'}},open),/probe\/artDay\.frame: .*empty/);
  await assert.rejects(()=>assertThemeArt({id:'probe',art:night,artDay:{texture:'clear'}},open),/probe\/artDay\.texture: .*opaque/);
  await assert.rejects(()=>assertThemeArt({id:'probe',art:night,artDay:{backdrop:'clear'}},open),/probe\/artDay\.backdrop: .*opaque/);
  // The declared corner crop serves both sets: a day corner that only fits
  // uncropped is refused under the theme's scale.
  await assertThemeArt({id:'probe',art:{corner:'thick'},artDay:{corner:'thick'}},open);
  await assert.rejects(()=>assertThemeArt({id:'probe',cornerScale:4,art:{corner:'corner'},artDay:{corner:'thick'}},open),/probe\/artDay\.corner: .*transparent interior/);
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
