const Story = require('../models/Story');
const User = require('../models/User');
const { uploadMultipleFiles } = require('../utils/cloudinary');
const log = require('../utils/logger');

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// Create story (single image or video, max 30s for video; optional music)
const createStory = async (req, res) => {
  try {
    const mediaFile = req.files?.media?.[0] || req.file;
    if (!mediaFile) {
      return res.status(400).json({ success: false, message: 'Image or video is required' });
    }
    if (!process.env.AWS_S3_BUCKET) {
      return res.status(500).json({
        success: false,
        message: 'Media upload is not configured. Please set AWS_S3_BUCKET in environment.'
      });
    }
    const isVideo = mediaFile.mimetype.startsWith('video/');
    const results = await uploadMultipleFiles([mediaFile], 'gaming-social/stories');
    const mediaUrl = results[0].url;
    const rawDuration = isVideo && results[0].duration ? results[0].duration : 30;
    const media = {
      type: isVideo ? 'video' : 'image',
      url: mediaUrl,
      publicId: results[0].publicId
    };
    const duration = isVideo ? Math.min(30, Math.ceil(rawDuration)) : 30;
    let musicData;
    const musicFile = req.files?.music?.[0];
    if (musicFile) {
      const { uploadAudio } = require('../utils/cloudinary');
      const musicResult = await uploadAudio(musicFile, 'gaming-social/stories/music');
      musicData = { url: musicResult.url, publicId: musicResult.publicId };
    }
    const story = await Story.create({
      author: req.user._id,
      media,
      duration,
      ...(musicData && { music: musicData })
    });
    await story.populate('author', 'username profile.displayName profile.avatar');
    return res.status(201).json({
      success: true,
      data: { story }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to create story'
    });
  }
};

// Feed: current user + followed users who have at least one story in last 24h
const getStoriesFeed = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    const mongoose = require('mongoose');
    const since = new Date(Date.now() - TWENTY_FOUR_HOURS_MS);
    const myId = req.user._id;
    const myIdStr = myId.toString();
    const followingIds = (req.user.following || []).map((id) => (typeof id === 'string' ? id : id.toString()));
    const allowedIds = [myIdStr];
    followingIds.forEach((id) => {
      if (!id || id === myIdStr) return;
      try {
        if (mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id) {
          allowedIds.push(id);
        }
      } catch (_) { /* skip invalid id */ }
    });
    const allowedObjectIds = allowedIds.map((id) => new mongoose.Types.ObjectId(id));

    const usersWithStories = await Story.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$author',
          count: { $sum: 1 },
          latestStoryId: { $first: '$_id' },
          latestMedia: { $first: '$media' },
          latestCreatedAt: { $first: '$createdAt' }
        }
      },
      { $match: { _id: { $in: allowedObjectIds } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'userDoc' } },
      { $unwind: '$userDoc' },
      {
        $project: {
          _id: 1,
          count: 1,
          latestStoryId: 1,
          latestMedia: 1,
          latestCreatedAt: 1,
          author: {
            _id: '$userDoc._id',
            username: '$userDoc.username',
            profile: '$userDoc.profile'
          }
        }
      },
      { $sort: { latestCreatedAt: -1 } }
    ]);

    // Ensure current user's story is included and first, with string _id (only remove+replace when we have their story)
    const myLatest = await Story.findOne({ author: myId, createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(1)
      .lean();
    let finalUsers;
    if (myLatest) {
      const me = await User.findById(myId).select('username profile').lean();
      const myEntry = {
        _id: myIdStr,
        count: await Story.countDocuments({ author: myId, createdAt: { $gte: since } }),
        latestStoryId: myLatest._id,
        latestMedia: myLatest.media,
        latestCreatedAt: myLatest.createdAt,
        author: me ? { _id: me._id, username: me.username, profile: me.profile } : { _id: myId, username: '', profile: {} }
      };
      const others = usersWithStories.filter((u) => (u._id && u._id.toString()) !== myIdStr);
      finalUsers = [myEntry, ...others];
    } else {
      finalUsers = usersWithStories;
    }
    // Normalize _id to string for every entry so frontend always gets consistent format (safe for JSON)
    const toIdStr = (v) => (v == null ? '' : typeof v === 'string' ? v : (v.toString && v.toString()) || String(v));
    finalUsers = finalUsers.map((u) => ({
      _id: toIdStr(u._id),
      count: u.count,
      latestStoryId: u.latestStoryId,
      latestMedia: u.latestMedia,
      latestCreatedAt: u.latestCreatedAt,
      author: u.author ? {
        _id: toIdStr(u.author._id),
        username: u.author.username,
        profile: u.author.profile
      } : { _id: toIdStr(u._id), username: '', profile: {} }
    }));

    return res.json({
      success: true,
      data: { users: finalUsers }
    });
  } catch (err) {
    console.error('getStoriesFeed error:', err.message || err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to fetch stories feed'
    });
  }
};

// Get all stories of one user (last 24h)
const getUserStories = async (req, res) => {
  try {
    const { userId } = req.params;
    const since = new Date(Date.now() - TWENTY_FOUR_HOURS_MS);
    const stories = await Story.find({
      author: userId,
      createdAt: { $gte: since }
    })
      .sort({ createdAt: 1 })
      .populate('author', 'username profile.displayName profile.avatar');
    return res.json({
      success: true,
      data: { stories }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to fetch stories'
    });
  }
};

// Mark story as viewed
const viewStory = async (req, res) => {
  try {
    const { storyId } = req.params;
    const story = await Story.findById(storyId);
    if (!story) {
      return res.status(404).json({ success: false, message: 'Story not found' });
    }
    const userId = req.user._id.toString();
    if (!story.views.some(v => v.user.toString() === userId)) {
      story.views.push({ user: req.user._id });
      await story.save();
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to record view'
    });
  }
};

// Delete own story
const deleteStory = async (req, res) => {
  try {
    const story = await Story.findById(req.params.storyId);
    if (!story) {
      return res.status(404).json({ success: false, message: 'Story not found' });
    }
    if (story.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not allowed to delete this story' });
    }
    await Story.findByIdAndDelete(req.params.storyId);
    return res.json({ success: true, message: 'Story deleted' });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to delete story'
    });
  }
};

module.exports = {
  createStory,
  getStoriesFeed,
  getUserStories,
  viewStory,
  deleteStory
};
