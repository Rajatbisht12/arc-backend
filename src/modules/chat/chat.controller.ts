import type { Request, Response } from "express";
import { z } from "zod";
import { chatService } from "./chat.service";

const sendMessageSchema = z.object({
  chatId: z.string().min(1),
  text: z.string().trim().min(1).max(1000)
});

export const chatController = {
  async getRecentMessages(req: Request, res: Response) {
    const chatId = req.params.chatId;
    const messages = await chatService.getRecentMessages(chatId);
    res.json({ success: true, data: messages });
  },

  async sendMessage(req: Request, res: Response) {
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.flatten().fieldErrors });
    }

    const senderId = String((req as Request & { userId?: string }).userId ?? "");
    if (!senderId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const message = await chatService.postMessage({
      chatId: parsed.data.chatId,
      senderId,
      text: parsed.data.text
    });

    return res.status(201).json({ success: true, data: message });
  }
};
