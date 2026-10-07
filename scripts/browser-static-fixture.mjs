import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Serve the built Pages output on a temporary loopback port, without an API. */
export async function createStaticFixture(root) {
  const directory=path.resolve(root,'docs'),prefix='/diantuo-zhixun/';
  const server=createServer(async(request,response)=>{
    try {
      const pathname=new URL(request.url,'http://127.0.0.1').pathname;
      if(!pathname.startsWith(prefix)){response.writeHead(404).end();return;}
      const file=path.resolve(directory,decodeURIComponent(pathname.slice(prefix.length))||'index.html');
      if(!file.startsWith(`${directory}${path.sep}`)){response.writeHead(404).end();return;}
      const bytes=await readFile(file),extension=path.extname(file);
      response.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.wasm':'application/wasm'})[extension]??'application/octet-stream'}).end(bytes);
    }catch{response.writeHead(404).end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}${prefix}`,stop:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})};
}
