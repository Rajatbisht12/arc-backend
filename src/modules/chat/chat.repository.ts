import { Types } from "mongoose";
import { ChatMessageModel, ChatModel } from "./chat.model";

export type SendMessageInput = {
  chatId: string;
  senderId: string;
  text: string;
};

export const chatRepository = {
  async findById(chatId: string) {
    return ChatModel.findById(chatId).lean();
  },

  async listRecentMessages(chatId: string, limit = 50) {
    return ChatMessageModel.find({ chatId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  },

  async sendMessage(input: SendMessageInput) {
    const message = await ChatMessageModel.create({
      chatId: new Types.ObjectId(input.chatId),
      senderId: new Types.ObjectId(input.senderId),
      text: input.text
    });

    return message.toObject();
  }
};
