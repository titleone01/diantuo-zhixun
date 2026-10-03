import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePdfAssets } from './prepare-pdf-assets.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function buildLocalApp(out=path.join(root,'.local','app')) {
await mkdir(out,{recursive:true});
await cp(path.join(root,'public','sim-assets'),path.join(out,'sim-assets'),{recursive:true});
await preparePdfAssets(root, path.join(out, 'sim-assets', 'pdfjs'));
const result=await build({entryPoints:[path.join(root,'github-pages/main.tsx')],outdir:out,bundle:true,splitting:true,chunkNames:'assets/chunks/[name]-[hash]',format:'esm',platform:'browser',conditions:['style'],target:['es2022'],define:{'import.meta.env.BASE_URL':'"/"','__STATIC_DEMO__':'false','process.env.NODE_ENV':'"production"'},entryNames:'assets/app-[hash]',assetNames:'assets/[name]-[hash]',metafile:true,minify:true,logLevel:'info'});
const [js,meta]=Object.entries(result.metafile.outputs).find(([,m])=>m.entryPoint && path.resolve(root,m.entryPoint)===path.join(root,'github-pages/main.tsx'));
const url=p=>'/'+path.relative(out,path.resolve(root,p)).replaceAll('\\','/');
let html=await readFile(path.join(root,'github-pages/index.html'),'utf8');
html=html.replace('</head>',`${meta.cssBundle?`<link rel="stylesheet" href="${url(meta.cssBundle)}">`:''}</head>`).replace('<script type="module" src="/main.tsx"></script>',`<script type="module" src="${url(js)}"></script>`);
await writeFile(path.join(out,'index.html'),html);
return out;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildLocalApp(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  console.log('Local full-stack UI built (real API, not static demonstration)');
}
