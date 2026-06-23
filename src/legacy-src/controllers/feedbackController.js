const Feedback = require('../models/Feedback');
const log = require('../utils/logger');

// Submit feedback
const submitFeedback = async (req, res) => {
  try {

    const { feedback } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent') || '';

    const newFeedback = new Feedback({
      feedback: feedback.trim(),
      ipAddress,
      userAgent
    });

    await newFeedback.save();

    res.status(201).json({
      success: true,
      message: 'Feedback submitted successfully',
      data: {
        id: newFeedback._id,
        timestamp: newFeedback.timestamp
      }
    });
  } catch (error) {
    log.error('Error submitting feedback:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get all feedback (admin only)
const getAllFeedback = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, sortBy = 'timestamp', sortOrder = 'desc' } = req.query;
    
    const query = {};
    if (status) {
      query.status = status;
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const feedback = await Feedback.find(query)
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-ipAddress -userAgent');

    const total = await Feedback.countDocuments(query);

    res.json({
      success: true,
      data: {
        feedback,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });
  } catch (error) {
    log.error('Error fetching feedback:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update feedback status (admin only)
const updateFeedbackStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    if (!['pending', 'reviewed', 'addressed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be pending, reviewed, or addressed'
      });
    }

    const feedback = await Feedback.findByIdAndUpdate(
      id,
      { 
        status,
        adminNotes: adminNotes || ''
      },
      { new: true }
    );

    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    res.json({
      success: true,
      message: 'Feedback status updated successfully',
      data: feedback
    });
  } catch (error) {
    log.error('Error updating feedback status:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Delete feedback (admin only)
const deleteFeedback = async (req, res) => {
  try {
    const { id } = req.params;

    const feedback = await Feedback.findByIdAndDelete(id);

    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    res.json({
      success: true,
      message: 'Feedback deleted successfully'
    });
  } catch (error) {
    log.error('Error deleting feedback:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get feedback statistics (admin only)
const getFeedbackStats = async (req, res) => {
  try {
    const total = await Feedback.countDocuments();
    const pending = await Feedback.countDocuments({ status: 'pending' });
    const reviewed = await Feedback.countDocuments({ status: 'reviewed' });
    const addressed = await Feedback.countDocuments({ status: 'addressed' });

    // Get recent feedback (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recent = await Feedback.countDocuments({
      timestamp: { $gte: sevenDaysAgo }
    });

    res.json({
      success: true,
      data: {
        total,
        pending,
        reviewed,
        addressed,
        recent
      }
    });
  } catch (error) {
    log.error('Error fetching feedback stats:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  submitFeedback,
  getAllFeedback,
  updateFeedbackStatus,
  deleteFeedback,
  getFeedbackStats
};
