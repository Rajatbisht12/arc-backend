import { Router } from "express";
import { Notification, protect } from "./notifications.legacy-adapters";

const router = Router();

router.get("/", protect, async (req, res) => {
  try {
    const userId = (req as { user?: { _id?: string } }).user?._id;
    const page = Number.parseInt(String(req.query.page ?? "1"), 10) || 1;
    const limit = Number.parseInt(String(req.query.limit ?? "20"), 10) || 20;
    const skip = (page - 1) * limit;
    const isRead = req.query.isRead;

    const filter: Record<string, unknown> = { recipient: userId };
    if (isRead !== undefined) {
      filter.isRead = String(isRead) === "true";
    }

    const notifications = await Notification.find(filter)
      .populate("sender", "username profile.displayName profile.avatar")
      .populate("data.postId", "content.text")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({ recipient: userId, isRead: false });

    return res.status(200).json({
      success: true,
      data: {
        notifications,
        unreadCount,
        pagination: {
          current: page,
          total: Math.ceil(total / limit),
          count: notifications.length,
          totalNotifications: total
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

router.put("/:id/read", protect, async (req, res) => {
  try {
    const userId = (req as { user?: { _id?: string } }).user?._id;
    const { id } = req.params;
    const notification = await Notification.findOne({ _id: id, recipient: userId });
    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }
    await notification.markAsRead();
    return res.status(200).json({ success: true, message: "Notification marked as read" });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to mark notification as read",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

router.put("/read-all", protect, async (req, res) => {
  try {
    const userId = (req as { user?: { _id?: string } }).user?._id;
    await Notification.updateMany({ recipient: userId, isRead: false }, { isRead: true, readAt: new Date() });
    return res.status(200).json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to mark all notifications as read",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

router.delete("/:id", protect, async (req, res) => {
  try {
    const userId = (req as { user?: { _id?: string } }).user?._id;
    const { id } = req.params;
    const notification = await Notification.findOne({ _id: id, recipient: userId });
    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }
    await notification.deleteOne();
    return res.status(200).json({ success: true, message: "Notification deleted" });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete notification",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
