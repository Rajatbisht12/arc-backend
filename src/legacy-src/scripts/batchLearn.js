/**
 * Batch Learning Script
 * Learns from high-rated interactions and adds to knowledge base
 * Run: npm run batch-learn
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { batchLearn } = require('../utils/autoLearning');

const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    process.exit(1);
  }
};

const runBatchLearning = async () => {
  try {
    if (!process.argv.includes('--apply')) throw new Error('Refusing to mutate the knowledge base without --apply');
    await connectDB();
    
    console.log('\n🧠 Starting Batch Learning Process...\n');
    
    const result = await batchLearn(100); // Learn from top 100 high-rated interactions
    
    console.log('\n📊 Batch Learning Summary:');
    console.log(`   ✅ Learned: ${result.learned}`);
    console.log(`   ⏭️  Skipped: ${result.skipped}`);
    console.log('\n✅ Batch learning complete!\n');
    
    await mongoose.connection.close();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Batch learning error:', error);
    process.exit(1);
  }
};

runBatchLearning();

