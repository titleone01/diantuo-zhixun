import { readFile, writeFile } from "node:fs/promises";

// Reuse original vector artwork. These derived assets are teaching illustrations.
const asset = name => new URL(`../public/sim-assets/${name}.svg`, import.meta.url);
const body = svg => svg.replace(/^\s*<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const fuse = body(await readFile(asset("fuse3"),"utf8")).replace(/rgb\((255, 93, 93|255, 223, 93|124, 227, 153)\)/g,"rgb(160, 168, 178)");
await writeFile(asset("fuse2"),`<svg xmlns="http://www.w3.org/2000/svg" width="100.5" height="187.5" viewBox="0 0 100.5 187.5"><title>双联熔断器：原站素材派生教学示意</title>${fuse}</svg>\n`);
const terminal = body(await readFile(asset("terminal"),"utf8"));
for (const count of [10,16,20]) {
  const cells = Array.from({length:count},(_,i)=>`<svg x="${i*45.5625}" y="0" width="45.5625" height="76.125" viewBox="0 0 60.75 101.5">${terminal}</svg>`).join("");
  const width=count*45.5625;
  await writeFile(asset(`terminal-strip${count}`),`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="76.125" viewBox="0 0 ${width} 76.125"><title>${count}位端子排：原站素材派生教学示意</title>${cells}</svg>\n`);
}
// Remove the original third pole, shorten its shared handle, and keep the first
// two pole drawings and screw centers intact. This is a derived teaching asset.
let index = 0;
const breaker = body(await readFile(asset("breaker3"), "utf8")).replace(/<path\b[\s\S]*?\/>/g, path => {
  const current = index++;
  if (current >= 9 && current <= 17) return "";
  if (current >= 22 && current <= 25) return path.replace(/d="([^"]+)"/, (_, d) => {
    if (/[^MLCZmlcz\d\s.,-]/.test(d)) throw new Error("Unexpected breaker path commands");
    let coordinate = 0;
    return `d="${d.replace(/-?\d+(?:\.\d+)?/g, number => coordinate++ % 2 === 0 && Number(number) > 100 ? String(Number(number) - 49) : number)}"`;
  });
  return path;
});
if (index !== 31) throw new Error("Original breaker artwork changed");
await writeFile(asset("breaker2"), `<svg xmlns="http://www.w3.org/2000/svg" width="100.5" height="187.5" viewBox="0 0 100.5 187.5"><title>两极同步空气开关：原站素材派生教学示意</title>${breaker}</svg>\n`);
console.log("Prepared derived teaching fuse and terminal strip assets");
