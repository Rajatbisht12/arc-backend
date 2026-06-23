import { Schema, model, Types } from "mongoose";

export type ChatKind = "direct" | "group";

export interface ChatDocument {
  _id: Types.ObjectId;
  kind: ChatKind;
  participantIds: Types.ObjectId[];
  name?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessageDocument {
  _id: Types.ObjectId;
  chatId: Types.ObjectId;
  senderId: Types.ObjectId;
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

const chatSchema = new Schema<ChatDocument>(
  {
    kind: { type: String, enum: ["direct", "group"], required: true },
    participantIds: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    name: { type: String }
  },
  { timestamps: true }
);

const messageSchema = new Schema<ChatMessageDocument>(
  {
    chatId: { type: Schema.Types.ObjectId, ref: "Chat", required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, maxlength: 1000 }
  },
  { timestamps: true }
);

export const ChatModel = model<ChatDocument>("Chat", chatSchema);
export const ChatMessageModel = model<ChatMessageDocument>("ChatMessage", messageSchema);
