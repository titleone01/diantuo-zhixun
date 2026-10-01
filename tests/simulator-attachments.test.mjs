import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundle=await build({stdin:{contents:'export * from "./validation";export * from "./types";',resolveDir:fileURLToPath(new URL('../app/simulator/core/',import.meta.url))},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {validateDocument,documentMediaIds}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const base=()=>({schemaVersion:1,title:'成对图纸边界',components:[],wires:[],drawingKind:'schematic',drawingMediaId:'schematic-id',drawingMediaType:'image/png',projectDrawings:{schematic:{mediaId:'schematic-id',type:'image/png'},layout:{mediaId:'layout-id',type:'application/pdf'}}});
test('attachment snapshot carries both tabs, including a non-visible attachment',()=>{
  const document=base();assert.equal(validateDocument(document).valid,true);assert.deepEqual(documentMediaIds(document),['schematic-id','layout-id']);
  document.drawingKind='layout';document.drawingMediaId='layout-id';assert.deepEqual(new Set(documentMediaIds(document)),new Set(['schematic-id','layout-id']));
});
test('malformed hidden diagram metadata is rejected at the same document boundary',()=>{
  for(const modify of [doc=>{doc.projectDrawings.layout.mediaId='../private';},doc=>{doc.projectDrawings.layout.type='text/html';},doc=>{doc.projectDrawings.extra={mediaId:'extra',type:'image/png'};},doc=>{doc.projectDrawings.layout.remoteUrl='https://other.invalid/private';},doc=>{doc.drawingKind='unknown';}]){
    const document=base();modify(document);assert.equal(validateDocument(document).valid,false);
  }
});
