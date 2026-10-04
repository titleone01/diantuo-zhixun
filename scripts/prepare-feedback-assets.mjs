import { readFile, writeFile } from "node:fs/promises";

// Reuse original vector artwork. These derived assets are teaching illustrations.
const asset = name => new URL(`../public/sim-assets/${name}.svg`, import.meta.url);
const body = svg => svg.replace(/^\s*<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const fuse = body(await readFile(asset("fuse3"),"utf8")).replace(/rgb\((255, 93, 93|255, 223, 93|124, 227, 153)\)/g,"rgb(160, 168, 178)");
await writeFile(asset("fuse2"),`<svg xmlns="http://www.w3.org/2000/svg" width="100.5" height="187.5" viewBox="0 0 100.5 187.5"><title>双联熔断器：原站素材派生教学示意</title>${fuse}</svg>\n`);
const terminal = body(await readFile(asset("terminal"),"utf8"));
const cells = Array.from({length:16},(_,i)=>`<svg x="${i*45.5625}" y="0" width="45.5625" height="76.125" viewBox="0 0 60.75 101.5">${terminal}</svg><text x="${i*45.5625+24.37275}" y="40" text-anchor="middle" fill="#fff" font-size="9">${i+1}</text>`).join("");
await writeFile(asset("terminal-strip16"),`<svg xmlns="http://www.w3.org/2000/svg" width="729" height="76.125" viewBox="0 0 729 76.125"><title>16位端子排：原站素材派生教学示意</title>${cells}</svg>\n`);
console.log("Prepared derived teaching fuse and terminal strip assets");
