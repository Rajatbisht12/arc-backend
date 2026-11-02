const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const multer = require('multer');
const fs = require('node:fs');
// Explicit local binary only: never download MongoDB or connect to a configured production URI.
const binary = process.env.MONGOMS_SYSTEM_BINARY;
const hasLocalMongo = !!binary && fs.existsSync(binary);
let uploads = 0;
// Real controller/parser/schema/lean read and loopback multipart HTTP. Only
// external media transfer/transcoding are stubbed; no cloud call is permitted.
const external = require.resolve('./cloudinary');
require.cache[external] = { id: external, filename: external, loaded: true, exports: {
  uploadMultipleFiles: async () => { uploads++; return [{url:'https://fixture.example/story.jpg',publicId:'local-story-fixture'}]; },
  uploadAudio: async () => { throw Error('No external audio in this test'); },
} };
const previousBucket = process.env.AWS_S3_BUCKET;
process.env.AWS_S3_BUCKET = 'isolated-test-only';
process.env.STORY_DEBUG = 'false';
const Story = require('../models/Story');
const User = require('../models/User');
// Exercise the real response mapper with a local signer; never load the AWS client.
const mediaDelivery = require('./privateMediaDelivery');
const resolveMedia = mediaDelivery.resolveClientMediaPayload;
mediaDelivery.resolveClientMediaPayload = value => resolveMedia(value, process.env, async key => `https://fixture.example/private/${encodeURIComponent(key)}`);
const controller = require('../controllers/storyController');
const { parseStoryOverlays } = require('./storyOverlays');
const text = { id:'caption',type:'text',version:2,coordinateSpace:'media',text:'Android black caption',font:'Lobster',color:'#000000',
  x:.24,y:.73,scale:1.25,fontSize:37.5,textAlign:'center' };
const link = { ...text,id:'sticker',type:'link',text:'Watch now',label:'Watch now',url:'https://www.youtube.com/watch?v=fixture',x:.65,y:.42 };
let db, server, origin, owner;
test.before(async()=>{
  if (!hasLocalMongo) return;
  db = await MongoMemoryServer.create({binary:{systemBinary:binary,version:process.env.MONGOMS_VERSION || '8.3.7'},instance:{storageEngine:'wiredTiger'}});
  await mongoose.connect(db.getUri(), { autoIndex: false });
  // Seed only this isolated fixture; signup hooks are outside the Story contract test.
  owner = new User({username:'story_fixture',email:'story_fixture@example.invalid',password:'LocalFixture!123',userType:'player',isActive:true,profile:{displayName:'Local Story Fixture'}});
  await owner.validate();
  await User.collection.insertOne(owner.toObject());
  // Keep production indexes untouched. This test exercises serial replay, not index concurrency.
  await Story.createCollection();
  const app=express();
  app.use((req,_res,next)=>{req.user=owner;next();});
  app.post('/api/stories',multer({storage:multer.memoryStorage()}).single('media'),controller.createStory);
  app.get('/api/stories/user/:userId',controller.getUserStories);
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  origin=`http://127.0.0.1:${server.address().port}`;
});
test.after(async()=>{ if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await mongoose.disconnect();if(db)await db.stop();
  mediaDelivery.resolveClientMediaPayload = resolveMedia;
  if(previousBucket===undefined)delete process.env.AWS_S3_BUCKET;else process.env.AWS_S3_BUCKET=previousBucket; });
const create=async(overlays,key='fixture-upload')=>{
  const form=new FormData();form.append('media',new Blob(['synthetic image'],{type:'image/jpeg'}),'fixture.jpg');
  form.append('overlays',JSON.stringify(overlays));form.append('clientUploadId',key);
  return fetch(`${origin}/api/stories`,{method:'POST',body:form,headers:{'X-Idempotency-Key':key},signal:AbortSignal.timeout(10000)});
};
test('Android serialized overlays survive multipart create -> Mongo record -> user Story read exactly, including replay',{skip:!hasLocalMongo && 'Set MONGOMS_SYSTEM_BINARY to an installed local mongod'},async()=>{
  const submitted=[text,link];
  const response=await create(submitted);assert.equal(response.status,201);const ack=await response.json();
  assert.deepEqual(ack.data.story.overlays,submitted);
  const raw=await Story.collection.findOne({_id:new mongoose.Types.ObjectId(ack.data.story._id)});
  assert.deepEqual(raw.overlays,submitted);
  const read=await fetch(`${origin}/api/stories/user/${owner._id}`, {signal:AbortSignal.timeout(10000)});assert.equal(read.status,200);
  const readPayload=(await read.json()).data;assert.equal(readPayload.overlayVersion,2);
  const rows=readPayload.stories;assert.deepEqual(rows[0].overlays,submitted);
  const replay=await create(submitted);assert.equal(replay.status,200);assert.deepEqual((await replay.json()).data.story.overlays,submitted);
  assert.equal(await Story.countDocuments({}),1);assert.equal(uploads,1);
});
test('unsafe schemes and mismatched font sizes fail before any external media operation',{skip:!hasLocalMongo && 'Set MONGOMS_SYSTEM_BINARY to an installed local mongod'},async()=>{
  const before=uploads;
  for(const patch of [{url:'javascript:alert(1)'},{url:'https://user:password@example.com/'},{fontSize:90},{version:3},{coordinateSpace:'viewport'}]){
    const response=await create([{...link,...patch}],`invalid-${Math.random()}`);assert.equal(response.status,400);assert.equal((await response.json()).code,'STORY_OVERLAYS_INVALID');
  }
  assert.equal(uploads,before);
});
test('legacy text-only records retain their original shape and clickable destination',()=>{
  const old={id:'old',type:'text',text:'https://example.com/path',font:'Montserrat',color:'#FFFFFF',x:.5,y:.5,scale:1};
  assert.deepEqual(parseStoryOverlays([old]),[old]);
  assert.deepEqual(new Story({author:new mongoose.Types.ObjectId(),media:{type:'image',url:'https://example.com/i.jpg',publicId:'old'},overlays:[old]}).toObject().overlays,[old]);
});
