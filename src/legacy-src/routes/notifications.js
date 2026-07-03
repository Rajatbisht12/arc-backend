const express = require('express');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const Notification = require('../models/Notification');
const { sanitizeNotificationsForViewer } = require('../utils/notificationPrivacy');
const { normalizePagination } = require('../utils/pagination');

const router = express.Router();

// Get user's notifications
const getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page, limit, skip } = normalizePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100
    });
    const { isRead } = req.query;

    if (isRead !== undefined && isRead !== 'true' && isRead !== 'false') {
      return res.status(400).json({
        success: false,
        message: 'isRead must be true or false'
      });
    }

    const filter = { recipient: userId };
    if (isRead !== undefined) {
      filter.isRead = isRead === 'true';
    }

    const notificationDocuments = await Notification.find(filter)
      .populate('sender', 'username profile.displayName profile.avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();
    const notifications = await sanitizeNotificationsForViewer(notificationDocuments, req.user);

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({ recipient: userId, isRead: false });

    res.status(200).json({
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
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
};

// Mark notification as read
const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid notification identifier' });
    }

    const notification = await Notification.findOne({ _id: id, recipient: userId });
    
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    await notification.markAsRead();

    res.status(200).json({
      success: true,
      message: 'Notification marked as read'
    });

  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
};

// Mark all notifications as read
const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user._id;

    await Notification.updateMany(
      { recipient: userId, isRead: false },
      { 
        isRead: true, 
        readAt: new Date() 
      }
    );

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });

  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read'
    });
  }
};

// Delete notification
const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid notification identifier' });
    }

    const notification = await Notification.findOne({ _id: id, recipient: userId });
    
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    await notification.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Notification deleted'
    });

  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification'
    });
  }
};

// Routes
router.get('/', protect, getNotifications);
router.put('/:id/read', protect, markAsRead);
router.put('/read-all', protect, markAllAsRead);
router.delete('/:id', protect, deleteNotification);

module.exports = router;
