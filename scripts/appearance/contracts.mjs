import assert from 'node:assert/strict';
import postcss from 'postcss';
import sharp from 'sharp';

// Deliberately accept a small selector grammar: a positive owner at the start,
// then descendants/children. A substring search would accept :not(owner), an
// unscoped comma branch, or a sibling that escapes the owner's subtree.
export function assertThemeCss(css, id) {
  assert.match(id, /^[a-z][a-z0-9-]*$/);
  const root = postcss.parse(css);
  const owner = new RegExp(`^(?:html)?\\[data-appearance=(?:"${id}"|'${id}')\\](?=[\\s.#:[>]|$)`);
  root.walkAtRules(rule => assert.ok(['media', 'supports', 'container'].includes(rule.name), `${id}: put global @${rule.name} rules in shared styles`));
  root.walkDecls(decl => assert.ok(!['--theme-frame-slice','--theme-corner-background-size','--theme-corner-background-position','--theme-corner-flip'].includes(decl.prop), `${id}: declare artwork geometry in the catalog so rendering and validation agree`));
  // The top-left bracket draws its top and left sides, the bottom-right its
  // bottom and right. One width for both reaches all four sides of each and
  // draws closed boxes, as Forge's 2px once did.
  root.walkRules(rule => {
    const selectors = postcss.list.comma(rule.selector);
    if (!selectors.some(s => /\.ornate::before$/.test(s)) || !selectors.some(s => /\.ornate::after$/.test(s))) return;
    rule.walkDecls(/^border(-width)?$/, decl => assert.fail(`${id}: give .ornate::before and ::after their own border widths, not one for both: ${decl.prop}: ${decl.value}`));
  });
  root.walkRules(rule => {
    assert.notEqual(rule.parent.type, 'rule', `${id}: use full scoped selectors instead of CSS nesting`);
    for (const selector of postcss.list.comma(rule.selector)) {
      assert.ok(owner.test(selector), `${id}: unscoped selector ${selector}`);
      assert.ok(!/[+~]/.test(selector), `${id}: sibling selectors can escape the theme: ${selector}`);
    }
  });
}

export function assertSharedCss(css, file) {
  postcss.parse(css).walkRules(rule => {
    assert.ok(!/\[data-appearance\s*[~|^$*]?=/.test(rule.selector), `${file}: move theme-specific selector into its registered stylesheet: ${rule.selector}`);
  });
}

export async function assertArtAsset(input, slot, cornerScale = 1, frameSlice = 22) {
  assert.ok(Number.isFinite(cornerScale) && cornerScale >= 1 && cornerScale <= 8, 'Corner scale must be between 1 and 8');
  assert.ok(Number.isFinite(frameSlice) && frameSlice > 0 && frameSlice < 50, 'Frame slice must be greater than 0 and below 50 percent');
  const {data, info} = await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  const alpha = (x,y) => data[(y * info.width + x) * info.channels + info.channels - 1];
  if (slot === 'frame' || slot === 'corner') {
    assert.equal(info.width, info.height, `${slot}: use a square source image`);
    let visible = 0;
    // A corner can crop a larger frame. Artwork outside that displayed crop
    // must not let an invisible corner pass the nonempty check.
    const displayedWidth = Math.floor(info.width / (slot === 'corner' ? cornerScale : 1));
    const displayedHeight = Math.floor(info.height / (slot === 'corner' ? cornerScale : 1));
    for (let y=0;y<displayedHeight;y++) for (let x=0;x<displayedWidth;x++) if (alpha(x,y)>16) visible++;
    assert.ok(visible / (displayedWidth * displayedHeight) > .01, `${slot}: the displayed ornament is empty`);
    const inset=frameSlice/100;
    const bounds = slot === 'frame' ? [inset,inset,1-inset,1-inset] : [.6/cornerScale,.6/cornerScale,1/cornerScale,1/cornerScale];
    let total = 0, covered = 0;
    for (let y=Math.floor(info.height*bounds[1]);y<Math.floor(info.height*bounds[3]);y++) {
      for (let x=Math.floor(info.width*bounds[0]);x<Math.floor(info.width*bounds[2]);x++) {total++; if(alpha(x,y)>16) covered++;}
    }
    assert.ok(total > 0 && covered / total <= .005, `${slot}: painted pixels cover ${(100*covered/total).toFixed(2)}% of the required transparent interior (limit 0.5%)`);
  } else {
    for (let i=info.channels-1;i<data.length;i+=info.channels) assert.ok(data[i]>=250, `${slot}: the material/scenery must be opaque`);
  }
}
