/**
 * Redis Cache Utility
 * 
 * Provides a simple interface for caching data using Redis.
 * Three Redis clients are available:
 * - redisCacheClient: For general caching operations
 * - redisPubClient: For publishing messages
 * - redisSubClient: For subscribing to messages
 */

import { redisCacheClient, redisPubClient, redisSubClient } from "../infrastructure/cache/redis";

/**
 * Set a cache value with optional TTL
 * @param key The cache key
 * @param value The value to cache (will be JSON stringified)
 * @param ttlSeconds Optional time to live in seconds
 */
export async function setCache<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  try {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds) {
      await redisCacheClient.setEx(key, ttlSeconds, stringValue);
    } else {
      await redisCacheClient.set(key, stringValue);
    }
  } catch (error) {
    console.error(`Failed to set cache for key: ${key}`, error);
    throw error;
  }
}

/**
 * Get a cache value
 * @param key The cache key
 * @returns The cached value parsed as JSON, or null if not found
 */
export async function getCache<T = unknown>(key: string): Promise<T | null> {
  try {
    const value = await redisCacheClient.get(key);
    if (!value) return null;
    
    try {
      return JSON.parse(value) as T;
    } catch {
      // If JSON parsing fails, return as string
      return value as unknown as T;
    }
  } catch (error) {
    console.error(`Failed to get cache for key: ${key}`, error);
    return null;
  }
}

/**
 * Delete a cache value
 * @param key The cache key
 */
export async function deleteCache(key: string): Promise<void> {
  try {
    await redisCacheClient.del(key);
  } catch (error) {
    console.error(`Failed to delete cache for key: ${key}`, error);
    throw error;
  }
}

/**
 * Clear all cache values matching a pattern
 * @param pattern The pattern to match (e.g., "user:*")
 */
export async function clearCachePattern(pattern: string): Promise<void> {
  try {
    const keys = await redisCacheClient.keys(pattern);
    if (keys.length > 0) {
      await redisCacheClient.del(keys);
    }
  } catch (error) {
    console.error(`Failed to clear cache pattern: ${pattern}`, error);
    throw error;
  }
}

/**
 * Increment a counter
 * @param key The counter key
 * @param increment The amount to increment by (default 1)
 * @returns The new counter value
 */
export async function incrementCounter(key: string, increment: number = 1): Promise<number> {
  try {
    return await redisCacheClient.incrBy(key, increment);
  } catch (error) {
    console.error(`Failed to increment counter for key: ${key}`, error);
    throw error;
  }
}

/**
 * Publish a message to a channel
 * @param channel The channel name
 * @param message The message to publish
 */
export async function publishMessage(channel: string, message: string | object): Promise<void> {
  try {
    const messageString = typeof message === 'string' ? message : JSON.stringify(message);
    await redisPubClient.publish(channel, messageString);
  } catch (error) {
    console.error(`Failed to publish message to channel: ${channel}`, error);
    throw error;
  }
}

/**
 * Subscribe to a channel
 * @param channel The channel name
 * @param callback Function to call when a message is received
 * @returns Unsubscribe function
 */
export async function subscribeToChannel(
  channel: string,
  callback: (message: string, channel: string) => void
): Promise<() => Promise<void>> {
  try {
    // Subscribe using the subscription client
    await redisSubClient.subscribe(channel, (message) => {
      callback(message, channel);
    });

    // Return unsubscribe function
    return async () => {
      await redisSubClient.unsubscribe(channel);
    };
  } catch (error) {
    console.error(`Failed to subscribe to channel: ${channel}`, error);
    throw error;
  }
}

/**
 * Example usage in a module or service:
 * 
 * // Setting cache
 * await setCache('user:123', { id: 123, name: 'John' }, 3600); // 1 hour TTL
 * 
 * // Getting cache
 * const user = await getCache<{ id: number; name: string }>('user:123');
 * 
 * // Publishing a message
 * await publishMessage('notifications:user:123', {
 *   type: 'notification',
 *   message: 'You have a new message'
 * });
 * 
 * // Subscribing to a channel
 * const unsubscribe = await subscribeToChannel('notifications:user:123', (message) => {
 *   console.log('Received:', message);
 * });
 * 
 * // Unsubscribe when done
 * await unsubscribe();
 */
