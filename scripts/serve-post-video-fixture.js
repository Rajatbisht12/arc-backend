#!/usr/bin/env node
// Loopback-only, encoder-output smoke page. NOT SquadHunt UI or AWS validation.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = fs.realpathSync(process.argv[2] || '');
if (!root.includes(`${path.sep}squadhunt-video-benchmark-`) || !fs.statSync(root).isDirectory()) throw Error('Use only a generated local benchmark output directory');
const hlsLibrary = require.resolve('../../frontend/node_modules/hls.js/dist/hls.min.js');
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local video derivative check</title>
<style>body{font:16px system-ui;background:#10101c;color:#fff;margin:20px}video{display:block;max-width:100%;height:55vh;background:black;margin-top:12px}button{font:inherit;padding:12px;margin:8px}p{overflow-wrap:anywhere}</style>
<h1>Local video derivative check</h1><p>No AWS, upload, account or production API is used. This is not a full SquadHunt UI test.</p>
<button id="mp4">Play MP4 fallback</button><button id="hls">Play HLS</button><video id="video" controls playsinline muted preload="metadata" poster="/thumbnail.jpg"></video><p role="status" id="status">Ready for a local playback check</p>
<script src="/hls.js"></script><script>
const v=document.querySelector('video'),status=document.getElementById('status');let engine,mode='';
const update=()=>{status.textContent=mode+' '+(v.paused?'paused':'playing')+' time='+v.currentTime.toFixed(2)+' duration='+v.duration+' resolution='+v.videoWidth+'x'+v.videoHeight+' error='+(v.error?v.error.code:'none')};
for(const event of ['loadedmetadata','playing','timeupdate','pause','error'])v.addEventListener(event,update);
document.getElementById('mp4').onclick=()=>{if(engine){engine.destroy();engine=null}mode='MP4';v.src='/fallback.mp4';v.play().catch(e=>{status.textContent=e.message})};
document.getElementById('hls').onclick=()=>{if(engine)engine.destroy();mode='HLS';if(v.canPlayType('application/vnd.apple.mpegurl')){v.src='/master.m3u8';v.play().catch(e=>{status.textContent=e.message})}else if(Hls.isSupported()){engine=new Hls({maxBufferLength:6,maxMaxBufferLength:12});engine.on(Hls.Events.ERROR,(_,e)=>{if(e.fatal)status.textContent='HLS fatal '+e.details});engine.loadSource('/master.m3u8');engine.attachMedia(v);engine.on(Hls.Events.MANIFEST_PARSED,()=>v.play().catch(e=>{status.textContent=e.message}))}else status.textContent='HLS not supported by this local browser'};
window.addEventListener('pagehide',()=>{v.pause();if(engine)engine.destroy()});
</script></html>`;
let servedBytes = 0;
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end(page); return; }
  if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
  const relative = String(req.url).slice(1);
  if (!/^(?:fallback\.mp4|thumbnail\.jpg|master\.m3u8|(?:360p|540p|720p|1080p)\/(?:index\.m3u8|init\.mp4|segment_\d+\.m4s)|hls\.js)$/.test(relative)) { res.writeHead(404).end(); return; }
  const file = relative === 'hls.js' ? hlsLibrary : path.join(root, relative);
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  const size = fs.statSync(file).size;
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
  if (start > end || start >= size) { res.writeHead(416).end(); return; }
  const type = file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : file.endsWith('.jpg') ? 'image/jpeg' : file.endsWith('.js') ? 'text/javascript' : 'video/mp4';
  res.writeHead(range ? 206 : 200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-store', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  const stream = fs.createReadStream(file, { start, end });
  stream.on('data', chunk => { servedBytes += chunk.length; }); res.on('close', () => stream.destroy()); stream.pipe(res);
  console.log(JSON.stringify({ method: req.method, file: relative, status: range ? 206 : 200, requestedBytes: end - start + 1, servedBytes }));
});
server.listen(Number(process.argv[3] || 0), '127.0.0.1', () => console.log(`Local fixture only: http://localhost:${server.address().port}`));
const stop = () => server.close(() => process.exit(0)); process.on('SIGTERM', stop); process.on('SIGINT', stop);
