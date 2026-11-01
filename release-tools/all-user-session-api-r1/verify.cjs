const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function verify(p=JSON.parse(fs.readFileSync(path.join(__dirname,'artifact.PROPOSED.json')))){
 const root=path.join(__dirname,'release'),archive=path.join(root,'source.zip'),manifest=JSON.parse(fs.readFileSync(path.join(root,'source-manifest.json')));
 if(sha(fs.readFileSync(archive))!==p.sourceArchiveSha256||sha(JSON.stringify(manifest.files))!==p.sourceContentSha256||manifest.files.length!==757)throw Error('EXACT_NEW_SOURCE_REQUIRED');
 const expected=new Map([...manifest.files,{path:'.source-manifest.json',bytes:fs.statSync(path.join(root,'source-manifest.json')).size,sha256:sha(fs.readFileSync(path.join(root,'source-manifest.json')))}].map(x=>[x.path,x]));
 const b=fs.readFileSync(archive),records=new Map();let end=-1,total=0;
 for(let n=b.length-22;n>=Math.max(0,b.length-65557);n--)if(b.readUInt32LE(n)===0x06054b50){end=n;break;}
 if(end<0||b.length>4194304||b.readUInt16LE(end+4)!==0||b.readUInt16LE(end+6)!==0||b.readUInt16LE(end+10)!==758)throw Error('ZIP_LAYOUT');let at=b.readUInt32LE(end+16);
 for(let n=0;n<758;n++){
  if(b.readUInt32LE(at)!==0x02014b50)throw Error('ZIP_DIRECTORY');const flags=b.readUInt16LE(at+8),method=b.readUInt16LE(at+10),packed=b.readUInt32LE(at+20),size=b.readUInt32LE(at+24),len=b.readUInt16LE(at+28),extra=b.readUInt16LE(at+30),comment=b.readUInt16LE(at+32),offset=b.readUInt32LE(at+42),mode=b.readUInt32LE(at+38)>>>16,name=b.toString('utf8',at+46,at+46+len);
  if(flags&1||![0,8].includes(method)||size>16777216||!expected.has(name)||records.has(name)||path.isAbsolute(name)||path.win32.isAbsolute(name)||name.includes('\\')||name.split('/').includes('..')||(mode&0xf000)===0xa000||b.readUInt32LE(offset)!==0x04034b50)throw Error('ZIP_ENTRY');
  const ll=b.readUInt16LE(offset+26),le=b.readUInt16LE(offset+28),start=offset+30+ll+le;if(b.toString('utf8',offset+30,offset+30+ll)!==name||start+packed>b.length)throw Error('ZIP_EXTENT');const raw=method===0?b.subarray(start,start+packed):zlib.inflateRawSync(b.subarray(start,start+packed),{maxOutputLength:size});total+=raw.length;const e=expected.get(name);if(total>67108864||raw.length!==e.bytes||raw.length!==size||sha(raw)!==e.sha256)throw Error('SOURCE_FILE_CHANGED');records.set(name,raw);at+=46+len+extra+comment;
 }
 if(records.size!==expected.size)throw Error('SOURCE_INCOMPLETE');return{sourceArchive:archive,sourceFiles:757,archiveEntries:758,records};
}
module.exports={verify,sha};if(require.main===module){const {records,...result}=verify();console.log(JSON.stringify(result));}
