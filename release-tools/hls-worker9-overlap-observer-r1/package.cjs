'use strict';
const fs=require('fs'),path=require('path'),z=require('zlib'),C=require('./protocol.cjs');
const MODULES=['protocol.cjs','control-contract.cjs','database.cjs','progress-proof.cjs','proof.cjs','collector.cjs','native-entry.cjs'];
function sourceMap(){return Object.fromEntries(MODULES.map(n=>[n,fs.readFileSync(path.join(__dirname,n),'utf8')]));}
function raw(){return `(async()=>{const sources=${JSON.stringify(sourceMap())},cache={};function load(name){if(!Object.hasOwn(sources,name))throw Error('UNBUNDLED_MODULE');if(cache[name])return cache[name].exports;const module={exports:{}};cache[name]=module;new Function('require','module','exports',sources[name])(n=>n.startsWith('./')?load(n.slice(2)):require(n),module,module.exports);return module.exports;}return load('native-entry.cjs').main();})()`;}
function program(){const reasons=[...new Set([...Object.values(sourceMap()).join('\n').matchAll(/'([A-Z][A-Z0-9_]{3,100})'/g)].map(x=>x[1]))];return `require('vm').runInThisContext(require('zlib').brotliDecompressSync(Buffer.from('${z.brotliCompressSync(Buffer.from(raw())).toString('base64')}','base64')).toString()).catch(e=>{console.log(JSON.stringify({kind:'WORKER9_OBSERVER_HOLD',status:'HOLD',reason:new Set(${JSON.stringify(reasons)}).has(e?.message)?e.message:'SAFE_HELPER_FAILURE_NO_RETRY',errorType:['SyntaxError','TypeError','AbortError','TimeoutError','MongoNetworkError','MongoServerError'].includes(e?.name)?e.name:'OTHER'}));process.exitCode=1;})`;}

module.exports={MODULES,sourceMap,raw,program};
