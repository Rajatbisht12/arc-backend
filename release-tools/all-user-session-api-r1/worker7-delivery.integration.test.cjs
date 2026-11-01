'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),run=promisify(execFile);
const V=require('./verify.cjs'),ROOT=path.resolve(__dirname,'../..'),G=require('./runtime/postVideoFormatGate');
const evidence=path.join(ROOT,'docs/evidence/all-user-session-r1-release-followup-2026-11-01');
const probe=async p=>JSON.parse((await run('ffprobe',['-v','error','-show_streams','-of','json',p],{timeout:30000,maxBuffer:1048576})).stdout).streams;
const ffmpeg=args=>run('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y',...args],{timeout:120000,maxBuffer:1048576});
let worker,workerRoot;
test.before(async()=>{
 const b=await fs.readFile(path.join(ROOT,'release-tools/video-ready-recovery-beta/backend.zip')),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
 a.equal(sha(b),'a4dcaf31918a18a2c606792088d297a9b1f53ffa8b4ba9545ea7749a23f8c7ce');
 const wanted=new Map(Object.entries({'src/legacy-src/utils/clipHlsProcessing.js':'24e77b9a8dc718fbcdb9a5a63de3dd040c6e7cad89b0f840e1f712be55c65fad','src/legacy-src/utils/videoProcessing.js':'c183478fcd1390bd3a5e2989b44bb6c5ebc7c6fe47cd564ad85ed368d2c853c2','src/legacy-src/utils/logger.js':'0ed7ca243949ec527f8882697a6204b2e947f9280e32aac21e15a301c6708148'}));
 workerRoot=await fs.mkdtemp(path.join(os.tmpdir(),'arc-frozen-worker7-'));let end=b.length-22;
 while(end>=Math.max(0,b.length-65557)&&b.readUInt32LE(end)!==0x06054b50)end--;a.ok(end>=0);let at=b.readUInt32LE(end+16),found=0;
 for(let n=0;n<b.readUInt16LE(end+10);n++){
  a.equal(b.readUInt32LE(at),0x02014b50);const len=b.readUInt16LE(at+28),name=b.toString('utf8',at+46,at+46+len),packed=b.readUInt32LE(at+20),offset=b.readUInt32LE(at+42),method=b.readUInt16LE(at+10);
  if(wanted.has(name)){const start=offset+30+b.readUInt16LE(offset+26)+b.readUInt16LE(offset+28),raw=method===0?b.subarray(start,start+packed):require('node:zlib').inflateRawSync(b.subarray(start,start+packed),{maxOutputLength:1048576});a.equal(sha(raw),wanted.get(name));const file=path.join(workerRoot,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,raw);found++;}
  at+=46+len+b.readUInt16LE(at+30)+b.readUInt16LE(at+32);
 }
 a.equal(found,3);await fs.symlink(path.join(ROOT,'node_modules'),path.join(workerRoot,'node_modules'),'dir');worker=require(path.join(workerRoot,'src/legacy-src/utils/clipHlsProcessing.js'));
 a.equal(V.verify().records.get('src/legacy-src/utils/postVideoFormatGate.js').toString(),await fs.readFile(path.join(__dirname,'runtime/postVideoFormatGate.js'),'utf8'));
 process.env.POST_VIDEO_SOURCE_REUSE_ENABLED='false';process.env.POST_VIDEO_INTERMEDIATE_ENABLED='false';process.env.POST_VIDEO_HLS_LADDER_PROFILE='standard';
 await fs.mkdir(evidence,{recursive:true});
});
test.after(async()=>{if(workerRoot)await fs.rm(workerRoot,{recursive:true,force:true});});
for(const[name,w,h,codec]of[['1080p-hevc',1920,1080,'hevc'],['4k-hevc',3840,2160,'hevc'],['ultrawide-h264',3840,1080,'h264'],['tall-hevc',1080,3840,'hevc'],['fallback-only',7680,360,'h264']])test('real worker7 plus API delivery: '+name,{timeout:180000},async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'arc-worker7-delivery-'));
 try{
  const input=path.join(tmp,'input.mov'),out=path.join(tmp,'outputs');
  await ffmpeg(['-f','lavfi','-i',`testsrc2=size=${w}x${h}:rate=24`,'-f','lavfi','-i','sine=frequency=800:sample_rate=48000','-t','0.8','-c:v',codec==='hevc'?'libx265':'libx264','-preset','ultrafast','-threads','2','-pix_fmt','yuv420p',...(codec==='hevc'?['-x265-params','pools=1:frame-threads=1:log-level=error','-tag:v','hvc1']:[]),'-c:a','aac',input]);
  a.equal((await probe(input)).find(s=>s.codec_type==='video').codec_name,codec);
  const r=await worker.generateClipHls({inputPath:input,outputDir:out}),prefix=`post-video-playback/${'b'.repeat(24)}/${'c'.repeat(24)}/fixture`;
  const o={prefix,hlsKey:`${prefix}/master.m3u8`,fallbackKey:`${prefix}/fallback.mp4`,thumbnailKey:`${prefix}/thumbnail.jpg`,renditions:r.renditions.map(x=>({name:x.name,width:x.width,height:x.height,bandwidth:Math.ceil((x.maxRate+(x.hasAudio?x.audioBitrate:0))*1.1),averageBandwidth:x.videoBitrate+(x.hasAudio?x.audioBitrate:0),playlistUrl:`${prefix}/${x.name}/index.m3u8`,playlistPublicId:`${prefix}/${x.name}/index.m3u8`}))};
  const selected=G.selectOutput(o),measured=[];
  if(selected.hlsKey){
   const original=await fs.readFile(path.join(out,'master.m3u8'),'utf8'),filtered=G.filterManifest(original,o.hlsKey,o);
   for(const x of o.renditions){a.equal(filtered.includes(`${x.name}/index.m3u8`),G.bounded(x));if(!G.bounded(x))a.throws(()=>G.assertManifestKey(x.playlistUrl,o));}
   await fs.writeFile(path.join(out,'bounded-master.m3u8'),filtered);
  }else{a.equal(name,'fallback-only');a.throws(()=>G.assertManifestKey(o.hlsKey,o));}
  for(const x of [...selected.renditions.map(x=>({name:x.name,file:path.join(out,x.name,'index.m3u8'),key:x.playlistUrl})),{name:'fallback',file:path.join(out,'fallback.mp4')}]){
   if(x.key)G.filterManifest(await fs.readFile(x.file,'utf8'),x.key,o);
   const streams=await probe(x.file),v=streams.find(s=>s.codec_type==='video'),audio=streams.find(s=>s.codec_type==='audio');
   a.equal(v.codec_name,'h264');a.equal(v.pix_fmt,'yuv420p');a.equal(audio.codec_name,'aac');a.ok(G.bounded(v));a.ok(v.width<=w&&v.height<=h);a.ok(Math.abs(v.width/v.height-w/h)<=Math.max(4/v.height,0.01));
   await ffmpeg(['-i',x.file,'-f','null','-']);measured.push({name:x.name,codec:v.codec_name,width:v.width,height:v.height,pixelFormat:v.pix_fmt,audio:audio.codec_name,fullDecode:true});
  }
  a.ok(measured.length);await fs.writeFile(path.join(evidence,`worker7-bounded-delivery-${name}.json`),JSON.stringify({kind:'LOCAL_ACTUAL_FFMPEG_SYNTHETIC_NOT_FARGATE_CAMERA',source:{codec,width:w,height:h},workerUnchanged:true,unusedOversizedRenditionsRemainPrivate:o.renditions.filter(x=>!G.bounded(x)).map(x=>({name:x.name,width:x.width,height:x.height})),hlsSelected:Boolean(selected.hlsKey),measured,nativePrivateDeliveryQualified:false},null,2)+'\n');
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
