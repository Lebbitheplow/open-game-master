import fs from "node:fs/promises";
import path from "node:path";
export async function writeReview(output, theme, shots) {
  const images = await Promise.all(shots.map(async name => ({ name, src: "data:image/png;base64," + (await fs.readFile(path.join(output, name))).toString("base64") })));
  const script = `const images=${JSON.stringify(images)};const select=document.querySelector('select'),img=document.querySelector('img');images.forEach((s,i)=>select.add(new Option(s.name,i)));function render(){const s=images[Number(select.value)];if(s){img.src=s.src;img.alt=s.name}}select.onchange=render;render();`;
  await fs.writeFile(path.join(output, "review.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${theme} theme review</title><style>body{margin:24px;background:#18231c;color:#f0f3e8;font:16px/1.5 system-ui}select{font:inherit;max-width:100%;padding:10px;margin:12px 0 24px}img{display:block;max-width:100%;height:auto;margin:auto}</style><h1>${theme} theme review</h1><p>Working app captures using fictional data. See results.json for checks and failures. These are screenshots, not interactive app controls.</p><label>View <select></select></label><img alt="Theme screenshot"><script>${script}</script></html>`);
}
