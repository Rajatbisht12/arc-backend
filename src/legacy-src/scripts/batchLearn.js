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
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gaming-social-platform');
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    process.exit(1);
  }
};

const runBatchLearning = async () => {
  try {
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

