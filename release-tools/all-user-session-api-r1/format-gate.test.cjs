'use strict';
const test = require('node:test'), a = require('node:assert/strict'), vm = require('node:vm');
const G = require('./runtime/postVideoFormatGate');
const prefix = `post-video-playback/${'b'.repeat(24)}/${'c'.repeat(24)}/fixture`;
const row = (name, width, height) => ({ name, width, height, bandwidth: 1000000, averageBandwidth: 900000, playlistUrl: `${prefix}/${name}/index.m3u8`, playlistPublicId: `${prefix}/${name}/index.m3u8` });
const output = rows => ({ prefix, hlsKey: `${prefix}/master.m3u8`, fallbackKey: `${prefix}/fallback.mp4`, thumbnailKey: `${prefix}/thumbnail.jpg`, renditions: rows });
const master = o => '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-INDEPENDENT-SEGMENTS\n' + o.renditions.map(r => `#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},AVERAGE-BANDWIDTH=${r.averageBandwidth},RESOLUTION=${r.width}x${r.height}\n${r.name}/index.m3u8\n`).join('');
const media = '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:3\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:0.8,\nsegment_00000.m4s\n#EXT-X-ENDLIST\n';
test('complete master is matched, safe landscape/portrait variants retained and oversized pairs removed', () => {
 for (const rows of [[row('360p',1280,360),row('540p',1920,540),row('720p',2560,720)],[row('360p',360,1280),row('540p',540,1920),row('720p',720,2560)]]) {
  const o=output(rows), copy=JSON.stringify(o), s=G.filterManifest(master(o),o.hlsKey,o);
  a.equal(G.selectOutput(o).renditions.length,2);a.ok(s.includes('540p/index.m3u8'));a.ok(!s.includes('720p/'));a.equal(JSON.stringify(o),copy);
 }
});
test('oversized direct child URI and unknown children are denied independently of master filtering',()=>{
 const o=output([row('360p',1280,360),row('720p',2560,720)]);
 for(const k of [o.renditions[1].playlistUrl,`${prefix}/unknown/index.m3u8`,`${prefix}/360p/../720p/index.m3u8`])a.throws(()=>G.assertManifestKey(k,o),/unavailable/);
 a.equal(G.filterManifest(media,o.renditions[0].playlistUrl,o),media);
});
test('no safe HLS rung selects only existing private fallback, never raw input',()=>{
 const o=output([row('360p',12000,360)]),s=G.selectOutput(o);a.equal(s.hlsKey,undefined);a.deepEqual(s.renditions,[]);a.equal(s.fallbackKey,`${prefix}/fallback.mp4`);a.throws(()=>G.filterManifest(master(o),o.hlsKey,o));
});
test('unknown or mismatched master metadata, omissions, duplicates and extra URI tags fail closed',()=>{
 const o=output([row('360p',640,360),row('720p',1280,720)]),m=master(o);
 for(const bad of [m.replace('640x360','1920x1080'),m.replace('360p/index','foreign/index'),m.replace('720p/index','360p/index'),m+'#EXT-X-MEDIA:URI="source.mov"\n',m.split('\n').slice(0,-3).join('\n')])a.throws(()=>G.filterManifest(bad,o.hlsKey,o));
});
test('malformed persisted rows/keys cannot be silently adopted',()=>{
 const o=output([row('360p',640,360)]);
 for(const bad of [{...o,fallbackKey:'post-video-sources/raw.mov'},{...o,renditions:[]},{...o,renditions:[...o.renditions,...o.renditions]},{...o,renditions:[{...o.renditions[0],width:641}]},{...o,renditions:[{...o.renditions[0],playlistUrl:'https://evil.invalid/index.m3u8'}]}])a.throws(()=>G.selectOutput(bad));
});
test('child manifests reject cross-rung, original, external/key and nested-playlist references',()=>{
 const o=output([row('360p',640,360)]),key=o.renditions[0].playlistUrl;
 for(const bad of [media.replace('segment_00000.m4s','../720p/segment_00000.m4s'),media.replace('segment_00000.m4s','source.mov'),media.replace('init.mp4','https://evil.invalid/init.mp4'),media.replace('segment_00000.m4s','other.m3u8'),media.replace('#EXT-X-ENDLIST','#EXT-X-KEY:URI="key"\n#EXT-X-ENDLIST'),media.replace('#EXT-X-MAP:URI="init.mp4"','')])a.throws(()=>G.filterManifest(bad,key,o));
});
test('manifest byte/line ceilings and incomplete media fail closed',()=>{
 const o=output([row('360p',640,360)]),key=o.renditions[0].playlistUrl;
 for(const bad of ['x'.repeat(524289),media.replace('#EXT-X-ENDLIST',''),media.replace('segment_00000.m4s',''),media.replace('#EXTINF:0.8,','#EXTINF:0,')])a.throws(()=>G.filterManifest(bad,key,o));
});
test('actual private-delivery signer emits only selected API child URLs and same-rung signed CMAF assets',()=>{
 const records=require('./verify.cjs').verify().records,context={module:{exports:{}},Buffer,URL,process,require:name=>name==='./postVideoPolicy'?{uploadError:(code,message,statusCode)=>Object.assign(Error(message),{code,statusCode})}:require(name)};
 vm.runInNewContext(records.get('src/legacy-src/utils/postVideoDelivery.js').toString(),context);
 const D=context.module.exports,privateKey=require('node:crypto').generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}),env={POST_VIDEO_PRIVATE_DELIVERY_ENABLED:'true',POST_VIDEO_CLOUDFRONT_URL:'https://media.example.invalid',POST_VIDEO_API_ORIGIN:'https://api.example.invalid',POST_VIDEO_CLOUDFRONT_KEY_PAIR_ID:'fixture',POST_VIDEO_CLOUDFRONT_PRIVATE_KEY:privateKey,POST_VIDEO_PLAYBACK_TOKEN_SECRET:'fixture-only-not-a-production-token-secret'};
 const o=output([row('360p',1280,360),row('720p',2560,720)]),token=D.tokenForPrefix(prefix+'/',Math.floor(Date.now()/1000)+240,env,'b'.repeat(24));
 const m=D.rewriteManifest(G.filterManifest(master(o),o.hlsKey,o),o.hlsKey,token,env);a.ok(m.includes('https://api.example.invalid/api/posts/video-playback/'));a.ok(!m.includes('720p/index'));a.ok(!m.includes('post-video-sources'));
 const c=D.rewriteManifest(G.filterManifest(media,o.renditions[0].playlistUrl,o),o.renditions[0].playlistUrl,token,env);const urls=[...c.matchAll(/https:\/\/[^"\s]+/g)].map(x=>new URL(x[0]));a.equal(urls.length,2);
 for(const u of urls){a.equal(u.origin,'https://media.example.invalid');a.ok(u.pathname.startsWith('/'+prefix+'/360p/'));a.ok(u.searchParams.has('Signature'));}
});
// Execute the actual archived controller with controlled data/storage interfaces.
test('candidate proxy authorizes viewer first and rejects unsafe child before object read/signing',async()=>{
 const records=require('./verify.cjs').verify().records,o=output([row('360p',1280,360),row('720p',2560,720)]);let allowed=true,reads=0,rewrites=0;
 const query=x=>({select:()=>({lean:async()=>x})}),delivery={assertDeliveryReady(){},verifyPlaybackToken:()=>({prefix:prefix+'/',viewerId:''}),normalizedPlaybackKey:x=>x,rewriteManifest:t=>{rewrites++;return t;}};
 const context={module:{exports:{}},require:name=>{
  if(name==='../utils/postVideoFormatGate')return G;if(name==='../utils/postVideoDelivery')return delivery;
  if(name==='../models/VideoUploadSession')return{findOne:()=>query({_id:'c'.repeat(24),postId:'d'.repeat(24),output:o})};
  if(name==='../models/Post')return{findOne:()=>query({author:'b'.repeat(24)})};if(name==='../utils/privacyPolicy')return{resolvePostAccess:async()=>({allowed})};
  if(name==='path')return require('node:path');if(name==='mongoose')return require('mongoose');return{};
 },process:{env:{}},__dirname:__dirname};vm.runInNewContext(records.get('src/legacy-src/controllers/videoUploadController.js').toString(),context);
 const c=context.module.exports;c.__setManifestReaderForTests(async()=>{reads++;return master(o);});
 const res=()=>({code:200,set(){return this;},status(n){this.code=n;return this;},end(){return this;},json(v){this.body=v;return this;},type(){return this;},send(v){this.body=v;return this;}});
 let r=res();await c.playbackManifest({query:{token:'fixture'},params:{0:o.renditions[1].playlistUrl.slice('post-video-playback/'.length)}},r);a.equal(r.code,503);a.equal(reads,0);a.equal(rewrites,0);
 allowed=false;r=res();await c.playbackManifest({query:{token:'fixture'},params:{0:o.hlsKey.slice('post-video-playback/'.length)}},r);a.equal(r.code,403);a.equal(reads,0);
 allowed=true;r=res();await c.playbackManifest({query:{token:'fixture'},params:{0:o.hlsKey.slice('post-video-playback/'.length)}},r);a.equal(r.code,200);a.equal(reads,1);a.equal(rewrites,1);a.ok(!r.body.includes('720p/index'));
});
test('actual READY publication retains ownership and fallback while persisting only bounded rungs',async()=>{
 const ts=require('typescript'),source=require('./verify.cjs').verify().records.get('src/legacy-src/services/videoPostPublicationService.js').toString(),ast=ts.createSourceFile('publication.js',source,ts.ScriptTarget.Latest,true);let handler;
 const walk=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='reserveReadyVideos')handler=n.initializer.getText(ast);ts.forEachChild(n,walk);};walk(ast);a.ok(handler);
 for(const rows of [[row('360p',1280,360),row('720p',2560,720)],[row('360p',7680,360)]]){
  const o=output(rows);let claims=0;const s={_id:'c'.repeat(24),size:1024,status:'READY',expiresAt:new Date(Date.now()+60000),output:o,metadata:{width:7680,height:360,duration:0.8}};
  const context={module:{exports:{}},assertDeliveryReady(){},MAX_POST_VIDEO_BYTES:1073741824,normalizedPlaybackKey:x=>x,selectOutput:G.selectOutput,uploadError:()=>Error('rejected'),Session:{find:filter=>{a.equal(filter.owner,'b'.repeat(24));return{select:async()=>[s]};},findOneAndUpdate:async filter=>{a.equal(filter.status,'READY');a.equal(filter.postId,null);claims++;return s;}}};vm.runInNewContext('module.exports='+handler,context);
  const result=await context.module.exports({owner:'b'.repeat(24),ids:['c'.repeat(24)],postId:'d'.repeat(24),claimToken:'fixture'});a.equal(claims,1);a.equal(result[0].url,o.fallbackKey);a.ok(result[0].playback.renditions.every(G.bounded));a.equal(Boolean(result[0].playback.hlsUrl),rows.some(G.bounded));a.equal(o.renditions.length,rows.length);
 }
});
test('actual READY publication refuses malformed derivative ownership before claiming',async()=>{
 const ts=require('typescript'),source=require('./verify.cjs').verify().records.get('src/legacy-src/services/videoPostPublicationService.js').toString(),ast=ts.createSourceFile('publication.js',source,ts.ScriptTarget.Latest,true);let handler;
 const walk=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='reserveReadyVideos')handler=n.initializer.getText(ast);ts.forEachChild(n,walk);};walk(ast);let claims=0;
 const context={module:{exports:{}},assertDeliveryReady(){},MAX_POST_VIDEO_BYTES:1073741824,normalizedPlaybackKey:x=>x,selectOutput:G.selectOutput,uploadError:()=>Error('rejected'),Session:{find:()=>({select:async()=>[{_id:'c'.repeat(24),size:1024,status:'READY',expiresAt:new Date(Date.now()+60000),output:{...output([row('360p',640,360)]),renditions:[]}}]}),findOneAndUpdate:async()=>{claims++;return{};}}};vm.runInNewContext('module.exports='+handler,context);
 await a.rejects(context.module.exports({owner:'b'.repeat(24),ids:['c'.repeat(24)],postId:'d'.repeat(24)}));a.equal(claims,0);
});
module.exports = { output, row, master };
