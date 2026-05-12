/**
 * Test Web Search Integration
 * Run: node scripts/testWebSearch.js
 */

require('dotenv').config();
const { getWebSearchResults, formatSearchResults, shouldSearchWeb } = require('../utils/webSearch');

const testWebSearch = async () => {
  try {
    console.log('\n🔍 Testing Web Search Integration...\n');
    
    // Check API keys
    if (!process.env.GOOGLE_SEARCH_API_KEY) {
      console.error('❌ GOOGLE_SEARCH_API_KEY not found in .env file');
      return;
    }
    
    if (!process.env.GOOGLE_SEARCH_ENGINE_ID) {
      console.error('❌ GOOGLE_SEARCH_ENGINE_ID not found in .env file');
      return;
    }
    
    console.log('✅ API Key found');
    console.log(`   Key: ${process.env.GOOGLE_SEARCH_API_KEY.substring(0, 10)}...`);
    console.log(`   Engine ID: ${process.env.GOOGLE_SEARCH_ENGINE_ID}\n`);
    
    // Test query
    const testQuery = "latest BGMI update 2024";
    
    console.log('📤 Testing query:', testQuery);
    console.log('   Should search web?', shouldSearchWeb(testQuery) ? '✅ Yes' : '❌ No');
    console.log('\n⏳ Searching web...\n');
    
    const results = await getWebSearchResults(testQuery);
    
    if (!results || results.length === 0) {
      console.error('❌ No search results found');
      console.log('\n💡 Possible issues:');
      console.log('   1. API key invalid');
      console.log('   2. Search Engine ID invalid');
      console.log('   3. Daily quota exceeded (100 queries/day)');
      console.log('   4. Network issue');
      return;
    }
    
    console.log(`✅ Found ${results.length} search results!\n`);
    console.log('📥 Results:');
    console.log('─'.repeat(60));
    
    results.forEach((result, index) => {
      console.log(`\n[${index + 1}] ${result.title}`);
      console.log(`   ${result.snippet}`);
      console.log(`   Source: ${result.displayLink || result.link}`);
    });
    
    console.log('\n' + '─'.repeat(60));
    
    // Test formatting
    const formatted = formatSearchResults(results);
    console.log('\n📝 Formatted for AI context:');
    console.log(formatted.substring(0, 300) + '...\n');
    
    console.log('✅ Web Search Test PASSED!\n');
    
  } catch (error) {
    console.error('\n❌ Web Search Test FAILED!\n');
    console.error('Error:', error.message);
    
    if (error.response?.status === 400) {
      console.error('\n💡 Bad Request - Check API key and Engine ID');
    } else if (error.response?.status === 403) {
      console.error('\n💡 Forbidden - API key invalid or quota exceeded');
    } else if (error.response?.status === 429) {
      console.error('\n💡 Rate limit exceeded - Daily quota (100 queries) used');
    }
    
    console.error('\nFull error:', error.response?.data || error);
  }
};

testWebSearch();

