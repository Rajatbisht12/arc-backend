import { redisCacheClient } from "../../infrastructure/cache/redis";
import { chatRepository } from "./chat.repository";
import path from "path";
import { backendModelPath, backendRootPath } from "../legacy/legacy.paths";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const User = require(path.join(backendModelPath, "User.js")) as any;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolvePrivacyAccess } = require(path.join(backendRootPath, "utils", "privacyPolicy.js")) as any;

const RECENT_MESSAGES_CACHE_TTL_SECONDS = 30;
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

const readRecentMessagesCache = async (key: string): Promise<unknown[] | null> => {
  if (!redisCacheClient.isReady) return null;
  try {
    const cached = await redisCacheClient.get(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    // Redis is an optional cache. Corrupt entries or a cache outage must not
    // turn an otherwise healthy MongoDB request into HTTP 500.
    return null;
  }
};

const writeRecentMessagesCache = async (key: string, messages: unknown[]): Promise<void> => {
  if (!redisCacheClient.isReady) return;
  try {
    await redisCacheClient.setEx(key, RECENT_MESSAGES_CACHE_TTL_SECONDS, JSON.stringify(messages));
  } catch {
    // Best effort only; MongoDB remains authoritative.
  }
};

const invalidateRecentMessagesCache = async (key: string): Promise<void> => {
  if (!redisCacheClient.isReady) return;
  try {
    await redisCacheClient.del(key);
  } catch {
    // Best effort only; the entry also has a short TTL.
  }
};

const accessError = () => {
  const error = new Error("Chat not found or access denied") as Error & { statusCode?: number; code?: string };
  error.statusCode = 403;
  error.code = "CHAT_ACCESS_DENIED";
  return error;
};

export const chatService = {
  async resolveParticipant(chatId: string, userId: string) {
    if (!OBJECT_ID_PATTERN.test(chatId) || !OBJECT_ID_PATTERN.test(userId)) {
      throw accessError();
    }
    const chat = await chatRepository.findById(chatId);
    if (!chat) return null;
    const allowed = Boolean(chat?.participantIds?.some((participantId) => String(participantId) === String(userId)));
    if (!allowed) {
      throw accessError();
    }
    return chat;
  },

  async assertParticipant(chatId: string, userId: string) {
    const chat = await this.resolveParticipant(chatId, userId);
    if (!chat) {
      throw accessError();
    }
    return chat;
  },

  async assertRealtimeParticipant(chatId: string, userId: string) {
    const chat = await this.assertParticipant(chatId, userId);
    if (chat.kind !== "direct") return chat;

    const participantIds = (chat.participantIds || []).map(String);
    if (participantIds.length !== 2) throw accessError();
    const targetId = participantIds.find((participantId) => participantId !== String(userId));
    if (!targetId) throw accessError();

    const [actor, target] = await Promise.all([
      User.findOne({ _id: userId, isActive: true })
        .select("_id userType privacySettings blockedUsers isActive")
        .lean(),
      User.findOne({ _id: targetId, isActive: true })
        .select("_id userType privacySettings blockedUsers isActive")
        .lean()
    ]);
    if (!actor || !target) throw accessError();

    const relationship = await resolvePrivacyAccess({
      viewer: actor,
      targetUser: target,
      existingConversation: true
    });
    if (relationship.blocked) throw accessError();
    return chat;
  },

  async getRecentMessages(chatId: string, userId: string) {
    await this.assertParticipant(chatId, userId);
    const cacheKey = `chat:${chatId}:recent`;
    const cached = await readRecentMessagesCache(cacheKey);
    if (cached) return cached;

    const messages = await chatRepository.listRecentMessages(chatId);
    await writeRecentMessagesCache(cacheKey, messages);
    return messages;
  },

  async postMessage(payload: { chatId: string; senderId: string; text: string }) {
    await this.assertRealtimeParticipant(payload.chatId, payload.senderId);
    const message = await chatRepository.sendMessage(payload);
    await invalidateRecentMessagesCache(`chat:${payload.chatId}:recent`);
    return message;
  }
};
