#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const Post = require('../src/legacy-src/models/Post');
const { analyzePostHashtags } = require('../src/legacy-src/utils/postHashtagBackfill');

const apply = process.argv.includes('--apply');
const verify = process.argv.includes('--verify');
if (apply && verify) throw new Error('Use either --apply or --verify, not both');
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');

const BATCH_SIZE = Math.max(25, Math.min(1000, Number(process.env.HASHTAG_BACKFILL_BATCH_SIZE) || 250));

const connect = () => mongoose.connect(process.env.MONGODB_URI, {
  autoIndex: false,
  autoCreate: false,
  retryWrites: process.env.MONGODB_TLS === 'true' ? false : true,
  serverSelectionTimeoutMS: 15_000,
  ...(process.env.MONGODB_TLS === 'true' ? {
    tls: true,
    ...(process.env.MONGODB_TLS_CA_FILE && fs.existsSync(process.env.MONGODB_TLS_CA_FILE)
      ? { tlsCAFile: process.env.MONGODB_TLS_CA_FILE }
      : {}),
  } : {}),
});

const main = async () => {
  await connect();

  const stats = {
    mode: apply ? 'apply' : verify ? 'verify' : 'audit-only',
    scannedPosts: 0,
    affectedPosts: 0,
    postsMissingCaptionHashtags: 0,
    missingHashtagRelationships: 0,
    normalizationOnlyPosts: 0,
    updatedPosts: 0,
    sampleAffectedPostIds: [],
  };

  let afterId = null;
  while (true) {
    const query = afterId ? { _id: { $gt: afterId } } : {};
    const posts = await Post.find(query)
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .select('_id content.text tags')
      .lean();
    if (posts.length === 0) break;

    const operations = [];
    for (const post of posts) {
      stats.scannedPosts += 1;
      const analysis = analyzePostHashtags(post);
      if (!analysis.changed) continue;

      stats.affectedPosts += 1;
      if (analysis.missingCaptionTags.length > 0) {
        stats.postsMissingCaptionHashtags += 1;
        stats.missingHashtagRelationships += analysis.missingCaptionTags.length;
      }
      if (analysis.normalizationOnly) stats.normalizationOnlyPosts += 1;
      if (stats.sampleAffectedPostIds.length < 20) {
        stats.sampleAffectedPostIds.push(String(post._id));
      }
      if (apply) {
        operations.push({
          updateOne: {
            filter: { _id: post._id },
            update: { $set: { tags: analysis.expectedTags } },
          },
        });
      }
    }

    if (operations.length > 0) {
      // Use the collection directly so repairing an index relationship does
      // not rewrite a post's user-visible updatedAt timestamp.
      const result = await Post.collection.bulkWrite(operations, { ordered: false });
      stats.updatedPosts += result.modifiedCount || 0;
    }

    afterId = posts[posts.length - 1]._id;
  }

  stats.compliant = stats.affectedPosts === 0 || (apply && stats.updatedPosts === stats.affectedPosts);
  console.log(JSON.stringify(stats, null, 2));
  if (!apply) console.log('No post data was changed. Run with --apply only after reviewing this audit.');
  if (verify && stats.affectedPosts > 0) process.exitCode = 2;
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect().catch(() => undefined));
