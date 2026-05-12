import type { Server, Socket } from "socket.io";
import { logger } from "../../config/logger";

/**
 * Call Socket Handlers
 * --------------------
 * Handles real-time call signaling via Socket.IO.
 *
 * Events (client → server):
 *   call:offer     — Caller sends an offer to a target user
 *   call:answer    — Callee accepts the call
 *   call:reject    — Callee rejects the call
 *   call:end       — Either party ends the call
 *   call:busy      — Callee is already on another call
 *   call:candidate — ICE candidate relay (for WebRTC fallback)
 *
 * Events (server → client):
 *   call:offer     — Relayed to the callee
 *   call:answer    — Relayed to the caller
 *   call:rejected  — Relayed to the caller
 *   call:ended     — Relayed to the other party
 *   call:busy      — Relayed to the caller
 */

type CallOfferPayload = {
  targetUserId: string;
  roomId: string;
  callType: "voice" | "video";
  callerInfo?: {
    username?: string;
    displayName?: string;
    avatar?: string;
  };
};

type CallAnswerPayload = {
  callerId: string;
  roomId: string;
};

type CallRejectPayload = {
  callerId: string;
  roomId: string;
  reason?: string;
};

type CallEndPayload = {
  participantId: string;
  roomId: string;
  durationSeconds?: number;
};

type CallBusyPayload = {
  callerId: string;
  roomId: string;
};

export const registerCallSocketHandlers = (io: Server, socket: Socket): void => {
  const userId = socket.authUser?.userId;
  if (!userId) return;

  // ── Call Offer ──
  socket.on("call:offer", (payload: CallOfferPayload) => {
    if (!payload.targetUserId || !payload.roomId || !payload.callType) return;

    logger.info("Call offer", {
      from: userId,
      to: payload.targetUserId,
      roomId: payload.roomId,
      callType: payload.callType
    });

    io.to(`user-${payload.targetUserId}`).emit("call:offer", {
      roomId: payload.roomId,
      callType: payload.callType,
      caller: {
        userId,
        ...payload.callerInfo
      },
      timestamp: Date.now()
    });
  });

  // ── Call Answer ──
  socket.on("call:answer", (payload: CallAnswerPayload) => {
    if (!payload.callerId || !payload.roomId) return;

    logger.info("Call answered", {
      by: userId,
      caller: payload.callerId,
      roomId: payload.roomId
    });

    io.to(`user-${payload.callerId}`).emit("call:answer", {
      roomId: payload.roomId,
      calleeId: userId,
      accepted: true,
      timestamp: Date.now()
    });
  });

  // ── Call Reject ──
  socket.on("call:reject", (payload: CallRejectPayload) => {
    if (!payload.callerId || !payload.roomId) return;

    logger.info("Call rejected", {
      by: userId,
      caller: payload.callerId,
      roomId: payload.roomId
    });

    io.to(`user-${payload.callerId}`).emit("call:rejected", {
      roomId: payload.roomId,
      calleeId: userId,
      reason: payload.reason || "declined",
      timestamp: Date.now()
    });
  });

  // ── Call End ──
  socket.on("call:end", (payload: CallEndPayload) => {
    if (!payload.participantId || !payload.roomId) return;

    logger.info("Call ended", {
      by: userId,
      participant: payload.participantId,
      roomId: payload.roomId,
      duration: payload.durationSeconds
    });

    io.to(`user-${payload.participantId}`).emit("call:ended", {
      roomId: payload.roomId,
      endedBy: userId,
      durationSeconds: payload.durationSeconds || 0,
      timestamp: Date.now()
    });
  });

  // ── Call Busy ──
  socket.on("call:busy", (payload: CallBusyPayload) => {
    if (!payload.callerId || !payload.roomId) return;

    io.to(`user-${payload.callerId}`).emit("call:busy", {
      roomId: payload.roomId,
      calleeId: userId,
      timestamp: Date.now()
    });
  });
};
