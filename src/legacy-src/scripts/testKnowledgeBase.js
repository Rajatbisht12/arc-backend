const mongoose = require('mongoose');
const { retrieveKnowledge, formatKnowledgeContext } = require('../utils/knowledgeRetrieval');
require('dotenv').config();

// Connect to database
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Test queries
const testQueries = [
  {
    query: "Aim kaise improve karu?",
    language: "roman_hindi",
    topic: "aim",
    game: "bgmi"
  },
  {
    query: "BGMI mein sensitivity kaise set karein?",
    language: "roman_hindi",
    topic: "aim",
    game: "bgmi"
  },
  {
    query: "How to improve aim in BGMI?",
    language: "english",
    topic: "aim",
    game: "bgmi"
  },
  {
    query: "BGMI mein rank kaise badhau?",
    language: "roman_hindi",
    topic: "rank",
    game: "bgmi"
  },
  {
    query: "BGMI mein recoil control kaise karein?",
    language: "roman_hindi",
    topic: "aim",
    game: "bgmi"
  }
];

// Test function
const testKnowledgeBase = async () => {
  try {
    await connectDB();
    
    console.log('\n🧪 Testing Knowledge Base Retrieval...\n');
    
    for (let i = 0; i < testQueries.length; i++) {
      const test = testQueries[i];
      console.log(`\n📝 Test ${i + 1}: "${test.query}"`);
      console.log(`   Language: ${test.language}, Topic: ${test.topic}, Game: ${test.game}`);
      
      const knowledge = await retrieveKnowledge(
        test.query,
        test.language,
        test.topic,
        test.game,
        3
      );
      
      if (knowledge.length > 0) {
        console.log(`   ✅ Found ${knowledge.length} relevant knowledge items:`);
        knowledge.forEach((item, idx) => {
          console.log(`      ${idx + 1}. [Score: ${item.relevanceScore}] ${item.question.substring(0, 60)}...`);
        });
        
        const context = formatKnowledgeContext(knowledge, test.language);
        console.log(`\n   📄 Formatted Context (first 200 chars):`);
        console.log(`      ${context.substring(0, 200)}...`);
      } else {
        console.log(`   ❌ No knowledge found for this query`);
      }
    }
    
    console.log('\n✅ Testing Complete!\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Test error:', error);
    process.exit(1);
  }
};

// Run test
testKnowledgeBase();

