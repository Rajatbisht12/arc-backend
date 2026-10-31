'use strict';
const{test}=require('node:test'),a=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),{execFileSync}=require('child_process'),A=require('../lib/worker-artifact');
test('exact candidate generates real local four-rung HLS with relative private-object layout and unchanged storage source',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'r5-hls-'));try{const context=A.extract(temp+'/context'),input=temp+'/input.mp4',output=temp+'/hls';
 execFileSync('/opt/homebrew/bin/ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=1920x1080:rate=30','-f','lavfi','-i','sine=frequency=440','-t','2','-c:v','libx264','-threads','2','-preset','ultrafast','-b:v','8M','-maxrate','8M','-bufsize','16M','-c:a','aac','-b:a','96k','-movflags','+faststart',input],{timeout:30000});
 const H=require(context+'/src/legacy-src/utils/clipHlsProcessing'),result=await H.generateClipHls({inputPath:input,outputDir:output});const master=fs.readFileSync(output+'/master.m3u8','utf8');
 for(const rung of ['360p','540p','720p','1080p']){a(master.includes(rung+'/index.m3u8'),rung);const variant=fs.readFileSync(output+'/'+rung+'/index.m3u8','utf8');a(variant.includes('#EXT-X-ENDLIST'));a(!/https?:|s3:|\.\.\//.test(variant));const segments=variant.split('\n').filter(x=>x&&!x.startsWith('#'));a(segments.length>0);for(const s of segments)a(fs.statSync(output+'/'+rung+'/'+s).size>0);}
 a(!/https?:|s3:|\.\.\//.test(master));
 const source=A.source(),storage=source.manifest.files.find(x=>x.path==='src/infrastructure/storage/s3.ts');a(storage);a(!source.manifest.files.some(x=>x.path==='.env'));
 if(process.env.R5_HLS_RESULT)fs.writeFileSync(process.env.R5_HLS_RESULT,JSON.stringify({scope:'REAL_LOCAL_HLS_BYTES_NOT_PRODUCTION_S3_OR_JWT_PROOF',renditions:['360p','540p','720p','1080p'],relativePlaylistPaths:true,segmentsPresent:true,sourceStorageSha256:storage.sha256,providerCalls:0},null,2)+'\n');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
