import { redisCacheClient } from "../../infrastructure/cache/redis";
import { chatRepository } from "./chat.repository";

const RECENT_MESSAGES_CACHE_TTL_SECONDS = 30;

export const chatService = {
  async getRecentMessages(chatId: string) {
    const cacheKey = `chat:${chatId}:recent`;
    const cached = await redisCacheClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as unknown[];
    }

    const messages = await chatRepository.listRecentMessages(chatId);
    await redisCacheClient.setEx(cacheKey, RECENT_MESSAGES_CACHE_TTL_SECONDS, JSON.stringify(messages));
    return messages;
  },

  async postMessage(payload: { chatId: string; senderId: string; text: string }) {
    const message = await chatRepository.sendMessage(payload);
    await redisCacheClient.del(`chat:${payload.chatId}:recent`);
    return message;
  }
};
