const { getJson, setJson, del, getRedisClient } = require('./redisCache');

// ── Prefix for all AI-coach response cache keys ──
const CACHE_PREFIX = 'airc:';

/**
 * Generate cache key from message and language
 * @param {string} message - User's message
 * @param {string} language - Detected language
 * @returns {string} Cache key
 */
const generateCacheKey = (message, language) => {
  const normalizedMessage = message.toLowerCase().trim()
    .replace(/\s+/g, ' ') // Normalize spaces
    .substring(0, 200); // Limit key length
  
  return `${CACHE_PREFIX}${language}:${normalizedMessage}`;
};

/**
 * Get cached response
 * @param {string} message - User's message
 * @param {string} language - Detected language
 * @returns {Promise<object|null>} Cached response or null
 */
const getCachedResponse = async (message, language) => {
  try {
    const key = generateCacheKey(message, language);
    const cached = await getJson(key);
    
    if (cached) {
      if (process.env.NODE_ENV === 'development') console.log(`✅ Cache HIT for language: ${language}`);
      return cached;
    }
    
    if (process.env.NODE_ENV === 'development') console.log(`❌ Cache MISS for language: ${language}`);
    return null;
  } catch (error) {
    console.error('Cache get error:', error);
    return null;
  }
};

/**
 * Set cached response
 * @param {string} message - User's message
 * @param {string} language - Detected language
 * @param {object} response - Response to cache
 * @param {number} ttl - Custom TTL in seconds (optional, default 3600)
 */
const setCachedResponse = async (message, language, response, ttl = 3600) => {
  try {
    const key = generateCacheKey(message, language);
    
    const cacheData = {
      response,
      cachedAt: new Date().toISOString(),
      language,
      originalMessage: message.substring(0, 100) // Store snippet for debugging
    };
    
    await setJson(key, cacheData, ttl);
    
    if (process.env.NODE_ENV === 'development') console.log(`💾 Cached response for language: ${language}`);
  } catch (error) {
    console.error('Cache set error:', error);
  }
};

/**
 * Clear cache for specific language (uses SCAN for safety at scale)
 * @param {string} language - Language to clear cache for
 */
const clearLanguageCache = async (language) => {
  try {
    const client = getRedisClient();
    if (!client) return;
    
    const pattern = `${CACHE_PREFIX}${language}:*`;
    let cursor = 0;
    let deletedCount = 0;
    
    do {
      const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = result.cursor;
      if (result.keys.length > 0) {
        await client.del(result.keys);
        deletedCount += result.keys.length;
      }
    } while (cursor !== 0);
    
    if (process.env.NODE_ENV === 'development') console.log(`🗑️ Cleared ${deletedCount} cache entries for ${language}`);
  } catch (error) {
    console.error('Cache clear error:', error);
  }
};

/**
 * Clear all AI response cache
 */
const clearAllCache = async () => {
  try {
    const client = getRedisClient();
    if (!client) return;
    
    let cursor = 0;
    do {
      const result = await client.scan(cursor, { MATCH: `${CACHE_PREFIX}*`, COUNT: 100 });
      cursor = result.cursor;
      if (result.keys.length > 0) {
        await client.del(result.keys);
      }
    } while (cursor !== 0);
    
    if (process.env.NODE_ENV === 'development') console.log('🗑️ Cleared all AI response cache');
  } catch (error) {
    console.error('Cache clear all error:', error);
  }
};

/**
 * Get cache statistics (basic – Redis doesn't expose per-prefix stats trivially)
 * @returns {Promise<object>} Cache stats
 */
const getCacheStats = async () => {
  try {
    const client = getRedisClient();
    if (!client) return { keys: 0, hits: 'N/A', misses: 'N/A' };
    
    let keyCount = 0;
    let cursor = 0;
    do {
      const result = await client.scan(cursor, { MATCH: `${CACHE_PREFIX}*`, COUNT: 100 });
      cursor = result.cursor;
      keyCount += result.keys.length;
    } while (cursor !== 0);
    
    return { keys: keyCount };
  } catch {
    return { keys: 0 };
  }
};

/**
 * Should cache this response?
 * Some responses shouldn't be cached (errors, personal data, etc.)
 * @param {string} message - User's message
 * @param {string} response - AI response
 * @returns {boolean}
 */
const shouldCache = (message, response) => {
  // Don't cache if message is too short (likely not useful)
  if (message.trim().length < 5) return false;
  
  // Don't cache if response is too short (likely error)
  if (response.trim().length < 20) return false;
  
  // Don't cache if response contains error indicators
  const errorIndicators = ['sorry', 'error', 'unavailable', 'failed'];
  const lowerResponse = response.toLowerCase();
  if (errorIndicators.some(indicator => lowerResponse.includes(indicator))) {
    return false;
  }
  
  return true;
};

module.exports = {
  getCachedResponse,
  setCachedResponse,
  clearLanguageCache,
  clearAllCache,
  getCacheStats,
  shouldCache,
  generateCacheKey
};
