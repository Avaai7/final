// Optional localhost preview. The site also works by opening index.html directly.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=__dirname,port=Number(process.env.MEDIAFIT_PORT)||4173;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.md':'text/plain; charset=utf-8'};
http.createServer((req,res)=>{
 let relative;try{relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch(e){res.writeHead(400).end('Bad path');return;}
 const file=path.resolve(root,'.'+(relative==='/'?'/index.html':relative));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end('Forbidden');return;}
 fs.stat(file,(err,stat)=>{if(err||!stat.isFile()){res.writeHead(404).end('Not found');return;}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);});
}).listen(port,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+port));
