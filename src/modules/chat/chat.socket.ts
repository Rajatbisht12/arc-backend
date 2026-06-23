import type { Server, Socket } from "socket.io";
import { chatService } from "./chat.service";

type MessageEventPayload = {
  chatId: string;
  text: string;
};

export const registerChatSocketHandlers = (io: Server, socket: Socket): void => {
  socket.on("join-chat-room", (chatRoomId: string) => {
    if (!chatRoomId) {
      return;
    }
    socket.join(`chat-${String(chatRoomId)}`);
  });

  socket.on("leave-chat-room", (chatRoomId: string) => {
    if (chatRoomId === "all") {
      for (const room of socket.rooms) {
        if (room.startsWith("chat-")) {
          socket.leave(room);
        }
      }
      return;
    }

    if (chatRoomId) {
      socket.leave(`chat-${String(chatRoomId)}`);
    }
  });

  socket.on("send-message", async (payload: MessageEventPayload) => {
    try {
      if (!socket.authUser?.userId) {
        return;
      }

      const message = await chatService.postMessage({
        chatId: payload.chatId,
        senderId: socket.authUser.userId,
        text: payload.text
      });

      io.to(`chat-${payload.chatId}`).emit("newMessage", {
        chatId: payload.chatId,
        message
      });
    } catch (error) {
      socket.emit("chat:error", { message: String(error) });
    }
  });
};
