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
  assertBrackets(root, id);
  root.walkRules(rule => {
    assert.notEqual(rule.parent.type, 'rule', `${id}: use full scoped selectors instead of CSS nesting`);
    for (const selector of postcss.list.comma(rule.selector)) {
      assert.ok(owner.test(selector), `${id}: unscoped selector ${selector}`);
      assert.ok(!/[+~]/.test(selector), `${id}: sibling selectors can escape the theme: ${selector}`);
    }
  });
}

// A flat panel's corner brackets (globals.css): ::before draws its top and
// left sides at 1px, ::after its bottom and right. Each theme's rules are
// applied over those in order and the result must still be an L per corner.
// A width that reaches the other two sides draws a closed box, as Forge's
// shared 2px once did, whether it is written for both brackets or for one;
// and a double line under 3px draws one stroke, as Gothic's and Hearth's did.
const BRACKETS = {
  before: {name: 'top-left', drawn: [0, 3], width: [1, 0, 0, 1], example: '2px 0 0 2px'},
  after: {name: 'bottom-right', drawn: [1, 2], width: [0, 1, 1, 0], example: '0 2px 2px 0'},
};
const SIDES = ['top', 'right', 'bottom', 'left'];

function bracketWidth(value, id) {
  if (value === '0') return 0;
  const px = /^(\d+(?:\.\d+)?)px$/.exec(value);
  assert.ok(px, `${id}: write corner bracket widths in px or 0, not ${value}`);
  return Number(px[1]);
}

function assertBrackets(root, id) {
  const state = Object.fromEntries(Object.entries(BRACKETS).map(([pseudo, b]) => [pseudo, {width: [...b.width], style: 'solid'}]));
  root.walkRules(rule => {
    const pseudos = Object.keys(BRACKETS).filter(pseudo => postcss.list.comma(rule.selector).some(s => new RegExp(`\\s\\.ornate::${pseudo}$`).test(s)));
    if (!pseudos.length) return;
    rule.walkDecls(decl => {
      for (const pseudo of pseudos) {
        const bracket = state[pseudo];
        if (decl.prop === 'border') assert.fail(`${id}: the border shorthand sets all four sides of .ornate::${pseudo}; give it its own border widths, as ${BRACKETS[pseudo].example}`);
        else if (decl.prop === 'border-width') {
          const values = postcss.list.space(decl.value).map(value => bracketWidth(value, id));
          const [top, right = top, bottom = top, left = right] = values;
          bracket.width = [top, right, bottom, left];
        } else if (/^border-(top|right|bottom|left)-width$/.test(decl.prop)) {
          bracket.width[SIDES.indexOf(decl.prop.split('-')[1])] = bracketWidth(decl.value, id);
        } else if (decl.prop === 'border-style') bracket.style = decl.value;
      }
    });
  });
  for (const [pseudo, {width, style}] of Object.entries(state)) {
    const {name, drawn, example} = BRACKETS[pseudo];
    const open = SIDES.filter((_, i) => !drawn.includes(i) && width[i] > 0);
    assert.deepEqual(open, [], `${id}: the ${name} bracket (.ornate::${pseudo}) draws a closed box; give it its own border widths, as ${example}`);
    assert.ok(drawn.every(i => width[i] > 0), `${id}: the ${name} bracket (.ornate::${pseudo}) lost a side of its L`);
    if (/\bdouble\b/.test(style)) assert.ok(drawn.every(i => width[i] >= 3), `${id}: the ${name} bracket asks for a double line at under 3px, which draws one stroke`);
  }
}

export function assertSharedCss(css, file) {
  postcss.parse(css).walkRules(rule => {
    assert.ok(!/\[data-appearance\s*[~|^$*]?=/.test(rule.selector), `${file}: move theme-specific selector into its registered stylesheet: ${rule.selector}`);
  });
}

// Every image a theme registers: its base set (`art`) and its day set
// (`artDay`). Each check that reads artwork walks this list, so a day image
// meets the same contracts as the image it replaces.
export function themeArtAssets(theme) {
  return ['art', 'artDay'].flatMap(set => Object.entries(theme[set] ?? {}).map(([slot, asset]) => ({set, slot, asset})));
}

// `open` turns a registered asset into what sharp reads (a path or a buffer).
export async function assertThemeArt(theme, open) {
  for (const {set, slot, asset} of themeArtAssets(theme)) {
    try { await assertArtAsset(open(asset), slot, theme.cornerScale ?? 1, theme.frameSlice ?? 22); }
    catch (error) { throw new Error(`${theme.id}/${set}.${slot}: ${error.message}`, {cause: error}); }
  }
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
