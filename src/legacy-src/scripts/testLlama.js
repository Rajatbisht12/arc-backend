/**
 * Test Llama Integration via Groq API
 * Run: node scripts/testLlama.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gaming-social-platform');
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    process.exit(1);
  }
};

// Test Llama
const testLlama = async () => {
  try {
    console.log('\n🦙 Testing Llama Integration...\n');
    
    // Check API key
    if (!process.env.GROQ_API_KEY) {
      console.error('❌ GROQ_API_KEY not found in .env file');
      console.log('💡 Add this to your .env file:');
      console.log('   GROQ_API_KEY=gsk_your_key_here\n');
      process.exit(1);
    }
    
    console.log('✅ GROQ_API_KEY found');
    console.log(`   Key: ${process.env.GROQ_API_KEY.substring(0, 10)}...\n`);
    
    // Test message
    const testMessage = "How to improve aim in BGMI?";
    const conversationHistory = [];
    const detectedLanguage = 'english';
    const userPreferences = null;
    const knowledgeContext = ''; // Can add knowledge context here for testing
    
    console.log('📤 Sending test query...');
    console.log(`   Query: "${testMessage}"\n`);
    
    const systemPrompt = `You are an expert AI Gaming Coach. You help gamers improve their skills, strategies, and performance across various games like BGMI, Valorant, CS:GO, Free Fire, Call of Duty Mobile, etc.

Your personality:
- Enthusiastic and encouraging
- Knowledgeable about gaming strategies and esports
- Supportive and constructive
- Use gaming terminology naturally
- Provide actionable advice
- Be conversational and friendly

IMPORTANT: Respond in English.

Response Format:
- Use bullet points with dashes (-) for lists
- Use emojis appropriately (🎯🔥🎮💰🔫📈🏆)
- Keep responses detailed but concise (200-400 words)
- Ask follow-up questions to engage the user
- Provide specific, actionable tips`;

    const messages = [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: testMessage
      }
    ];

    console.log('⏳ Calling Groq API (Llama 3.1 8B Instant)...\n');
    
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.1-8b-instant', // Fast and reliable
      messages: messages,
      temperature: 0.7,
      max_tokens: 1000
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const responseText = response.data.choices[0]?.message?.content;
    
    if (!responseText) {
      console.error('❌ Empty response from Llama API');
      process.exit(1);
    }
    
    console.log('✅ Llama Response Received!\n');
    console.log('📥 Response:');
    console.log('─'.repeat(60));
    console.log(responseText);
    console.log('─'.repeat(60));
    console.log('\n✅ Llama Integration Test PASSED!\n');
    
  } catch (error) {
    console.error('\n❌ Llama Test FAILED!\n');
    console.error('Error:', error.message);
    
    if (error.response?.status === 401) {
      console.error('\n💡 API Key is invalid. Please check your GROQ_API_KEY in .env file');
    } else if (error.response?.status === 429) {
      console.error('\n💡 Rate limit exceeded. Please try again later.');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Connection refused. Check your internet connection.');
    }
    
    console.error('\nFull error:', error.response?.data || error);
    process.exit(1);
  }
};

// Run test
(async () => {
  try {
    console.log('Starting test...');
    await connectDB();
    await testLlama();
    await mongoose.connection.close();
    console.log('✅ Test completed. MongoDB connection closed.');
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
})();

