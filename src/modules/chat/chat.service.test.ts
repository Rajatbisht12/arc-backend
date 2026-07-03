import assert from "node:assert/strict";
import { chatRepository } from "./chat.repository";
import { chatService } from "./chat.service";

const CHAT_ID = "507f1f77bcf86cd799439010";
const USER_ID = "507f1f77bcf86cd799439011";

const run = async (): Promise<void> => {
  const repository = chatRepository as unknown as Record<string, unknown>;
  const originals = {
    findById: repository.findById,
    listRecentMessages: repository.listRecentMessages,
    sendMessage: repository.sendMessage
  };

  let findCalls = 0;
  try {
    repository.findById = async () => {
      findCalls += 1;
      return { _id: CHAT_ID, kind: "group", participantIds: [USER_ID] };
    };
    repository.listRecentMessages = async () => [{ _id: "message-1", text: "cached independently" }];
    repository.sendMessage = async (payload: unknown) => ({ _id: "message-2", ...(payload as object) });

    await assert.rejects(
      () => chatService.resolveParticipant("not-an-object-id", USER_ID),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 403
    );
    assert.strictEqual(findCalls, 0, "invalid identifiers must be rejected before MongoDB casting");

    // Redis clients are intentionally disconnected in this contract test. The
    // service must fall back to MongoDB instead of throwing ClientClosedError.
    const messages = await chatService.getRecentMessages(CHAT_ID, USER_ID);
    assert.deepStrictEqual(messages, [{ _id: "message-1", text: "cached independently" }]);

    const created = await chatService.postMessage({ chatId: CHAT_ID, senderId: USER_ID, text: "hello" });
    assert.strictEqual((created as { text?: string }).text, "hello");
  } finally {
    repository.findById = originals.findById;
    repository.listRecentMessages = originals.listRecentMessages;
    repository.sendMessage = originals.sendMessage;
  }

  console.log("Chat identifier and cache-fallback contracts passed");
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
