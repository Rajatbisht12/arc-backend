/**
 * Web Search Integration for Real-time Information
 * Uses Google Custom Search API or SerpAPI for real-time gaming info
 */

const axios = require('axios');

/**
 * Search Google for real-time gaming information
 * Uses Google Custom Search API (free tier: 100 queries/day)
 */
const searchGoogle = async (query, maxResults = 5) => {
  try {
    // Check if API key is configured
    if (!process.env.GOOGLE_SEARCH_API_KEY || !process.env.GOOGLE_SEARCH_ENGINE_ID) {
      console.log('⚠️ Google Search API not configured');
      return null;
    }

    // Enhance query for Liquipedia if mentioned
    let enhancedQuery = query;
    if (query.toLowerCase().includes('liquipedia')) {
      enhancedQuery = `site:liquipedia.net ${query}`;
    } else if (query.toLowerCase().includes('pmgc') || query.toLowerCase().includes('tournament') || query.toLowerCase().includes('result')) {
      // Add Liquipedia to search for tournament results
      enhancedQuery = `${query} liquipedia`;
    }

    const searchUrl = 'https://www.googleapis.com/customsearch/v1';
    
    const response = await axios.get(searchUrl, {
      params: {
        key: process.env.GOOGLE_SEARCH_API_KEY,
        cx: process.env.GOOGLE_SEARCH_ENGINE_ID,
        q: enhancedQuery,
        num: maxResults,
        safe: 'active'
      },
      timeout: 5000
    });

    if (response.data && response.data.items) {
      const results = response.data.items.map(item => ({
        title: item.title,
        snippet: item.snippet,
        link: item.link,
        displayLink: item.displayLink
      }));

      console.log(`🔍 Google Search: Found ${results.length} results for "${query}"`);
      return results;
    }

    return null;

  } catch (error) {
    console.error('❌ Google Search error:', error.message);
    return null;
  }
};

/**
 * Search using SerpAPI (Alternative - more reliable, paid)
 */
const searchSerpAPI = async (query, maxResults = 5) => {
  try {
    if (!process.env.SERP_API_KEY) {
      console.log('⚠️ SerpAPI key not configured');
      return null;
    }

    const response = await axios.get('https://serpapi.com/search', {
      params: {
        engine: 'google',
        q: query,
        api_key: process.env.SERP_API_KEY,
        num: maxResults
      },
      timeout: 5000
    });

    if (response.data && response.data.organic_results) {
      const results = response.data.organic_results.map(item => ({
        title: item.title,
        snippet: item.snippet,
        link: item.link
      }));

      console.log(`🔍 SerpAPI Search: Found ${results.length} results for "${query}"`);
      return results;
    }

    return null;

  } catch (error) {
    console.error('❌ SerpAPI error:', error.message);
    return null;
  }
};

/**
 * Format search results for AI context
 */
const formatSearchResults = (searchResults) => {
  if (!searchResults || searchResults.length === 0) {
    return '';
  }

  let context = '\n\n📡 CRITICAL: REAL-TIME WEB SEARCH RESULTS - USE THESE FOR YOUR ANSWER:\n';
  context += '─'.repeat(60) + '\n';
  context += 'IMPORTANT: User asked a specific question that requires real-time information.\n';
  context += 'You MUST answer their question directly using the information below.\n';
  context += 'DO NOT ask irrelevant questions or suggest other topics.\n';
  context += 'FOCUS on answering their specific question first.\n';
  context += '─'.repeat(60) + '\n';
  
  searchResults.forEach((result, index) => {
    context += `\n[Result ${index + 1}]\n`;
    context += `Title: ${result.title}\n`;
    context += `Content: ${result.snippet}\n`;
    context += `Source: ${result.displayLink || result.link}\n`;
    if (result.link) {
      context += `URL: ${result.link}\n`;
    }
  });
  
  context += '\n' + '─'.repeat(60) + '\n';
  context += 'CRITICAL INSTRUCTIONS:\n';
  context += '1. Answer the user\'s specific question using the information above\n';
  context += '2. If information is available, provide it directly\n';
  context += '3. If information is not available, say so clearly\n';
  context += '4. DO NOT ask irrelevant follow-up questions\n';
  context += '5. DO NOT suggest other topics unless user asks\n';
  context += '6. Focus on answering what was asked\n';
  context += '─'.repeat(60) + '\n';
  
  return context;
};

/**
 * Smart search - determines if web search is needed
 */
const shouldSearchWeb = (query) => {
  const lowerQuery = query.toLowerCase();
  
  // Search for real-time information queries
  const realTimeKeywords = [
    'latest', 'recent', 'new', 'update', 'patch', 'meta', 'current',
    'today', 'now', '2024', '2025', 'season', 'event',
    'tournament', 'championship', 'pro', 'esports', 'competitive',
    'result', 'results', 'score', 'scores', 'match', 'matches',
    'liquipedia', 'pmgc', 'group stage', 'day 1', 'day 2', 'day 3',
    'standings', 'leaderboard', 'bracket', 'schedule'
  ];
  
  // Check if query needs real-time info
  const needsRealTime = realTimeKeywords.some(keyword => lowerQuery.includes(keyword));
  
  // Check for game-specific real-time queries
  const gameSpecific = lowerQuery.includes('patch notes') || 
                       lowerQuery.includes('update') ||
                       lowerQuery.includes('meta') ||
                       lowerQuery.includes('tier list') ||
                       lowerQuery.includes('pro players') ||
                       lowerQuery.includes('tournament') ||
                       lowerQuery.includes('liquipedia') ||
                       lowerQuery.includes('pmgc') ||
                       lowerQuery.includes('group stage') ||
                       lowerQuery.includes('match result');
  
  return needsRealTime || gameSpecific;
};

/**
 * Get web search results for query (tries multiple sources)
 * Priority: Google Custom Search first, then SerpAPI (only if Google fails or not configured)
 * Only ONE API will be used per request
 */
/**
 * Get web search results for query (tries multiple sources)
 * Priority: Google Custom Search first, then SerpAPI (only if Google fails or not configured)
 * Only ONE API will be used per request
 */
const getWebSearchResults = async (query) => {
  try {
    // First try Google Custom Search (if configured)
    if (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID) {
      const googleResults = await searchGoogle(query);
      if (googleResults && googleResults.length > 0) {
        return { results: googleResults, source: 'google' };
      }
      // If Google fails, try SerpAPI as fallback
      console.log('⚠️ Google Search failed, trying SerpAPI...');
    }
    
    // Fallback to SerpAPI (only if Google not configured or Google failed)
    if (process.env.SERP_API_KEY) {
      const serpResults = await searchSerpAPI(query);
      if (serpResults && serpResults.length > 0) {
        return { results: serpResults, source: 'serpapi' };
      }
    }
    
    return null;
  } catch (error) {
    console.error('❌ Web search error:', error);
    return null; // Return null on error, don't crash
  }
};

module.exports = {
  searchGoogle,
  searchSerpAPI,
  formatSearchResults,
  shouldSearchWeb,
  getWebSearchResults
};

