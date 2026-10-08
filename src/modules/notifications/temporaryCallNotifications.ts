// Call inbox rows (including a DM invitation transitioned to missed) are
// ephemeral once read. Chat call history and all other notifications remain.
export const TEMPORARY_CALL_EVENT_TYPES = ["incoming_call", "incoming_group_call", "missed_call"] as const;

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
