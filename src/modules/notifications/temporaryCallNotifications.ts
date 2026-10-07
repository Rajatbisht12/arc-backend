// Only incoming-call invitations have an ephemeral inbox lifecycle. Call
// history in chats and every other notification type remain untouched.
export const TEMPORARY_CALL_EVENT_TYPES = ["incoming_call", "incoming_group_call"] as const;

export const temporaryCallNotificationFilter = {
  type: "call",
  "data.customData.eventType": { $in: [...TEMPORARY_CALL_EVENT_TYPES] }
};

export const isTemporaryCallNotification = (notification: {
  type?: unknown;
  data?: { customData?: { eventType?: unknown } };
}) => notification.type === "call" && TEMPORARY_CALL_EVENT_TYPES.includes(
  notification.data?.customData?.eventType as typeof TEMPORARY_CALL_EVENT_TYPES[number]
);
