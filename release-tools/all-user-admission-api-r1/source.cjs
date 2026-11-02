'use strict';
const V=require('./verify.cjs'),C=require('./release/candidate.json'),path=require('path');
module.exports={ROOT:path.resolve(__dirname,'../..'),candidate(){const records=new Map(V.verify().records);records.delete('.source-manifest.json');return{records,changes:C.changes};}};
