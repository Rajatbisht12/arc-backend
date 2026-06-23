const Post = require('../models/Post');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { uploadMultipleFiles } = require('../utils/cloudinary');
const { createLikeNotification, createCommentNotification, createMentionNotification } = require('../utils/notificationService');
const { formatPostDTO } = require('../utils/dto');
const log = require('../utils/logger');

// Create new post
const createPost = async (req, res) => {
  try {
    const { text, postType, tags, visibility, recruitmentInfo, achievementInfo, mentions } = req.body;
    const authorId = req.user._id;

    // Parse nested FormData fields for achievementInfo if sent as flat fields
    let parsedAchievementInfo = achievementInfo;
    if (postType === 'achievement' && !achievementInfo) {
      // Check if achievementInfo fields are sent as flat fields (achievementInfo[gameTitle], etc.)
      parsedAchievementInfo = {};
      if (req.body['achievementInfo[gameTitle]']) {
        parsedAchievementInfo.gameTitle = req.body['achievementInfo[gameTitle]'];
      }
      if (req.body['achievementInfo[achievementType]']) {
        parsedAchievementInfo.achievementType = req.body['achievementInfo[achievementType]'];
      }
      if (req.body['achievementInfo[description]']) {
        parsedAchievementInfo.description = req.body['achievementInfo[description]'];
      }
      if (req.body['achievementInfo[date]']) {
        parsedAchievementInfo.date = req.body['achievementInfo[date]'];
      }
    }

    // Parse nested FormData fields for recruitmentInfo if sent as flat fields
    let parsedRecruitmentInfo = recruitmentInfo;
    if (postType === 'recruitment' && !recruitmentInfo) {
      parsedRecruitmentInfo = {};
      if (req.body['recruitmentInfo[gameTitle]']) {
        parsedRecruitmentInfo.gameTitle = req.body['recruitmentInfo[gameTitle]'];
      }
      if (req.body['recruitmentInfo[positions]']) {
        parsedRecruitmentInfo.positions = req.body['recruitmentInfo[positions]'];
      }
      if (req.body['recruitmentInfo[requirements]']) {
        parsedRecruitmentInfo.requirements = req.body['recruitmentInfo[requirements]'];
      }
      if (req.body['recruitmentInfo[contactInfo]']) {
        parsedRecruitmentInfo.contactInfo = req.body['recruitmentInfo[contactInfo]'];
      }
      if (req.body['recruitmentInfo[deadline]']) {
        parsedRecruitmentInfo.deadline = req.body['recruitmentInfo[deadline]'];
      }
    }

    const mediaFiles = Array.isArray(req.files) ? req.files : (req.files?.media || []);
    const coverFile = Array.isArray(req.files) ? null : req.files?.cover?.[0];

    // Handle media uploads
    let mediaData = [];
    let coverData = null;
    if (mediaFiles.length > 0 || coverFile) {
      try {
        if (!process.env.AWS_S3_BUCKET) {
          return res.status(500).json({
            success: false,
            message: 'Media upload is not configured. Please set AWS_S3_BUCKET in environment.',
            error: 'S3 configuration missing'
          });
        }
        
        const uploadResults = mediaFiles.length > 0
          ? await uploadMultipleFiles(mediaFiles, 'gaming-social/posts')
          : [];
        mediaData = uploadResults.map(result => ({
          type: result.type,
          url: result.url,
          publicId: result.publicId
        }));
        if (coverFile) {
          const [coverUpload] = await uploadMultipleFiles([coverFile], 'gaming-social/post-covers');
          coverData = coverUpload ? {
            url: coverUpload.url,
            publicId: coverUpload.publicId
          } : null;
        }
      } catch (uploadError) {
        return res.status(400).json({
          success: false,
          message: 'Failed to upload media files',
          error: uploadError.message
        });
      }
    }

    if (coverData) {
      const videoMedia = mediaData.find(item => item.type === 'video');
      if (videoMedia) {
        videoMedia.coverUrl = coverData.url;
        videoMedia.coverPublicId = coverData.publicId;
      }
    }

    // Parse mentions if provided
    let mentionedUserIds = [];
    if (mentions) {
      try {
        mentionedUserIds = typeof mentions === 'string' ? JSON.parse(mentions) : mentions;
      } catch (e) {
        // If parsing fails, extract mentions from text using @username pattern
        const mentionRegex = /@(\w+)/g;
        const matches = (text && typeof text === 'string') ? text.match(mentionRegex) : null;
        if (matches) {
          const usernames = matches.map(m => m.substring(1));
          const users = await User.find({ username: { $in: usernames } }).select('_id');
          mentionedUserIds = users.map(u => u._id.toString());
        }
      }
    } else {
      // Extract mentions from text using @username pattern
      const mentionRegex = /@(\w+)/g;
      const matches = (text && typeof text === 'string') ? text.match(mentionRegex) : null;
      if (matches) {
        const usernames = matches.map(m => m.substring(1));
        const users = await User.find({ username: { $in: usernames } }).select('_id');
        mentionedUserIds = users.map(u => u._id.toString());
      }
    }

    // Parse attached music (Instagram-style) if provided
    let attachedMusic = null;
    if (req.body.attachedMusic) {
      try {
        const raw = typeof req.body.attachedMusic === 'string' ? req.body.attachedMusic : JSON.stringify(req.body.attachedMusic);
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.url || parsed.title)) {
          attachedMusic = {
            trackId: parsed.trackId || undefined,
            title: parsed.title || '',
            artist: parsed.artist || '',
            url: parsed.url || '',
            coverUrl: parsed.coverUrl || '',
            startTime: typeof parsed.startTime === 'number' ? parsed.startTime : 0,
            endTime: typeof parsed.endTime === 'number' ? parsed.endTime : undefined
          };
        }
      } catch (e) {
        // ignore invalid attachedMusic
      }
    }

    // Create post data (allow post with only media, no caption)
    const postData = {
      author: authorId,
      content: {
        text: typeof text === 'string' ? text : '',
        media: mediaData
      },
      postType: postType || 'general',
      tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
      mentions: mentionedUserIds,
      visibility: visibility || 'public'
    };
    if (attachedMusic) postData.attachedMusic = attachedMusic;

    // Add recruitment info if it's a recruitment post
    if (postType === 'recruitment' && parsedRecruitmentInfo && Object.keys(parsedRecruitmentInfo).length > 0) {
      postData.recruitmentInfo = {
        gameTitle: parsedRecruitmentInfo.gameTitle,
        positions: parsedRecruitmentInfo.positions ? (typeof parsedRecruitmentInfo.positions === 'string' ? parsedRecruitmentInfo.positions.split(',').map(pos => pos.trim()) : parsedRecruitmentInfo.positions) : [],
        requirements: parsedRecruitmentInfo.requirements,
        contactInfo: parsedRecruitmentInfo.contactInfo,
        deadline: parsedRecruitmentInfo.deadline ? new Date(parsedRecruitmentInfo.deadline) : null,
        isActive: true
      };
    }

    // Add achievement info if it's an achievement post
    if (postType === 'achievement' && parsedAchievementInfo && Object.keys(parsedAchievementInfo).length > 0) {
      postData.achievementInfo = {
        gameTitle: parsedAchievementInfo.gameTitle,
        achievementType: parsedAchievementInfo.achievementType,
        description: parsedAchievementInfo.description,
        date: parsedAchievementInfo.date ? new Date(parsedAchievementInfo.date) : new Date()
      };
      if (process.env.NODE_ENV === 'development') { console.log('Creating achievement post with info:', postData.achievementInfo);}
    }

    const post = await Post.create(postData);
    
    // Populate author info
    await post.populate('author', 'username profile.displayName profile.avatar userType');
    
    // Log the created post to verify postType and achievementInfo
    log.debug('Created post:', {
      _id: post._id,
      postType: post.postType,
      achievementInfo: post.achievementInfo,
      author: post.author?.username
    });

    // Add post to user's posts array
    await User.findByIdAndUpdate(authorId, {
      $push: { posts: post._id }
    });

    // Create mention notifications
    if (mentionedUserIds.length > 0) {
      for (const mentionedUserId of mentionedUserIds) {
        // Don't notify if user mentioned themselves
        if (mentionedUserId.toString() !== authorId.toString()) {
          try {
            await createMentionNotification(mentionedUserId, authorId, post._id);
          } catch (error) {
            console.error(`Error creating mention notification for user ${mentionedUserId}:`, error);
          }
        }
      }
    }

    const isGuest = req.user && req.user.userType === 'guest';
    const isAuthor = true; // The creator is the author

    res.status(201).json({
      success: true,
      message: 'Post created successfully',
      data: {
        post: formatPostDTO(post, isGuest, isAuthor)
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create post',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get clips feed (posts that have at least one video - Reels/Shorts style)
const getClips = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = {
      isActive: true,
      hiddenByAdmin: { $ne: true },
      'content.media': { $elemMatch: { type: 'video' } }
    };

    const isGuest = req.user && req.user.userType === 'guest';

    if (!req.user || isGuest) {
      filter.visibility = 'public';
    } else {
      const following = Array.isArray(req.user.following) ? req.user.following : [];
      filter.$or = [
        { visibility: 'public' },
        { author: req.user._id },
        { visibility: 'followers', author: { $in: following } }
      ];
    }

    const posts = await Post.find(filter)
      .populate('author', 'username profile.displayName profile.avatar userType')
      .populate('likes.user', 'username profile.displayName profile.avatar')
      .populate('comments.user', 'username profile.displayName profile.avatar')
      .sort({ boostExpiresAt: -1, boostedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Post.countDocuments(filter);

    // Prevent caching/ETag 304 issues for clients
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    res.status(200).json({
      success: true,
      data: {
        posts: posts.map(p => formatPostDTO(p, isGuest, req.user && req.user._id && !isGuest && p.author && p.author._id && p.author._id.toString() === req.user._id.toString())),
        pagination: {
          current: page,
          total: Math.ceil(total / limit),
          count: posts.length,
          totalClips: total
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch clips',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get all posts (feed)
const getPosts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const { postType, author, tags, visibility } = req.query;

    // Build filter object
    const filter = { isActive: true, hiddenByAdmin: { $ne: true } };
    
    if (postType) filter.postType = postType;
    if (author) filter.author = author;
    if (tags) filter.tags = { $in: tags.split(',') };
    if (visibility) filter.visibility = visibility;

    // If user is not authenticated, only show public posts
    const isGuest = req.user && req.user.userType === 'guest';
    
    if (!req.user || visibility === 'public' || isGuest) {
      filter.visibility = 'public';
    } else {
      // If user is authenticated, show public posts and their own posts
      if (!visibility) {
        const following = Array.isArray(req.user.following) ? req.user.following : [];
        filter.$or = [
          { visibility: 'public' },
          { author: req.user._id },
          { 
            visibility: 'followers',
            author: { $in: following }
          }
        ];
      }
    }

    const posts = await Post.find(filter)
      .populate('author', 'username profile.displayName profile.avatar userType')
      .populate('likes.user', 'username profile.displayName profile.avatar')
      .populate('comments.user', 'username profile.displayName profile.avatar')
      .sort({ boostExpiresAt: -1, boostedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Post.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: {
        posts: posts.map(p => formatPostDTO(p, isGuest, req.user && req.user._id && !isGuest && p.author && p.author._id && p.author._id.toString() === req.user._id.toString())),
        pagination: {
          current: page,
          total: Math.ceil(total / limit),
          count: posts.length,
          totalPosts: total
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch posts',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Boost post (demo: no payment, just set boost duration)
const boostPost = async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user._id;
    const durationHours = parseInt(req.body.durationHours) || 24;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }
    if (post.author.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'You can only boost your own posts' });
    }

    const now = new Date();
    const boostExpiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
    post.boostedAt = now;
    post.boostExpiresAt = boostExpiresAt;
    await post.save();

    res.status(200).json({
      success: true,
      message: `Post boosted for ${durationHours} hours`,
      data: { post: { _id: post._id, boostedAt: post.boostedAt, boostExpiresAt: post.boostExpiresAt } }
    });
  } catch (error) {
    log.error('Boost post error:', { error: String(error) });
    res.status(500).json({ success: false, message: 'Failed to boost post' });
  }
};

// Record unique view for a clip (1 user = 1 view per post, no manipulation)
const recordClipView = async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user._id;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    // Ensure viewedBy array exists
    if (!post.viewedBy) post.viewedBy = [];

    const alreadyViewed = post.viewedBy.some(
      (v) => v.user && v.user.toString() === userId.toString()
    );
    if (alreadyViewed) {
      return res.status(200).json({
        success: true,
        message: 'View already recorded',
        data: { viewCount: post.viewedBy.length }
      });
    }

    post.viewedBy.push({ user: userId, viewedAt: new Date() });
    post.views = post.viewedBy.length;
    await post.save();

    res.status(200).json({
      success: true,
      message: 'View recorded',
      data: { viewCount: post.viewedBy.length }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to record view',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get single post by ID
const getPost = async (req, res) => {
  try {
    const postId = req.params.id;

    const post = await Post.findById(postId)
      .populate('author', 'username profile.displayName profile.avatar userType')
      .populate('likes.user', 'username profile.displayName profile.avatar')
      .populate('comments.user', 'username profile.displayName profile.avatar');

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check visibility permissions
    if (post.visibility === 'private' && post.author._id.toString() !== req.user?._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this post'
      });
    }

    if (post.visibility === 'followers' && 
        !req.user?.following.includes(post.author._id) && 
        post.author._id.toString() !== req.user?._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this post'
      });
    }

    // Increment view count
    post.views += 1;
    await post.save();

    const isGuest = req.user && req.user.userType === 'guest';
    const isAuthor = Boolean(req.user && req.user._id && !isGuest && post.author && post.author._id && post.author._id.toString() === req.user._id.toString());

    res.status(200).json({
      success: true,
      data: {
        post: formatPostDTO(post, isGuest, isAuthor)
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch post',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Like/Unlike post
const toggleLike = async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user._id;

    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user already liked the post
    const likeIndex = post.likes.findIndex((like) => {
      const likeUser = like?.user?._id || like?.user;
      if (!likeUser) return false;
      return likeUser.toString() === userId.toString();
    });

    if (likeIndex > -1) {
      // Unlike the post (remove all duplicates for safety)
      post.likes = post.likes.filter((like) => {
        const likeUser = like?.user?._id || like?.user;
        return likeUser ? likeUser.toString() !== userId.toString() : true;
      });
    } else {
      // Like the post
      post.likes.push({ user: userId });

      // Create notification for post author (if not liking own post)
      if (post.author.toString() !== userId.toString()) {
        await createLikeNotification(post.author, userId, post._id);
      }
    }

    await post.save();

    res.status(200).json({
      success: true,
      message: likeIndex > -1 ? 'Post unliked' : 'Post liked',
      data: {
        likeCount: post.likes.length,
        isLiked: likeIndex === -1
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to toggle like',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Add comment to post
const addComment = async (req, res) => {
  try {
    const postId = req.params.id;
    const { text } = req.body;
    const userId = req.user._id;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Comment text is required'
      });
    }

    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Add comment
    const comment = {
      user: userId,
      text: text.trim(),
      likes: [],
      createdAt: new Date()
    };

    post.comments.push(comment);
    await post.save();

    // Populate the new comment
    await post.populate('comments.user', 'username profile.displayName profile.avatar');

    // Create notification for post author (if not commenting on own post)
    if (post.author.toString() !== userId.toString()) {
      await createCommentNotification(post.author, userId, post._id, text.trim());
    }

    const newComment = post.comments[post.comments.length - 1];

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      data: {
        post,
        comment: newComment,
        commentCount: post.comments.length
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to add comment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update post
const updatePost = async (req, res) => {
  try {
    const postId = req.params.id;
    const { text, tags, visibility, recruitmentInfo } = req.body;
    const userId = req.user._id;

    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user owns the post
    if (post.author.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own posts'
      });
    }

    // Update fields
    if (text !== undefined) post.content.text = text;
    if (tags !== undefined) post.tags = tags.split(',').map(tag => tag.trim());
    if (visibility !== undefined) post.visibility = visibility;

    // Update recruitment info if provided
    if (post.postType === 'recruitment' && recruitmentInfo) {
      post.recruitmentInfo = {
        ...post.recruitmentInfo,
        ...recruitmentInfo,
        positions: recruitmentInfo.positions ? recruitmentInfo.positions.split(',').map(pos => pos.trim()) : post.recruitmentInfo.positions
      };
    }

    await post.save();
    await post.populate('author', 'username profile.displayName profile.avatar userType');

    res.status(200).json({
      success: true,
      message: 'Post updated successfully',
      data: {
        post
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update post',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Delete post
const deletePost = async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user._id;

    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user owns the post
    if (post.author.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own posts'
      });
    }

    // Mark as inactive instead of actually deleting
    post.isActive = false;
    await post.save();

    // Remove from user's posts array
    await User.findByIdAndUpdate(userId, {
      $pull: { posts: postId }
    });

    res.status(200).json({
      success: true,
      message: 'Post deleted successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete post',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Report post
const reportPost = async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user._id;

    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user is trying to report their own post
    if (post.author.toString() === userId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot report your own post'
      });
    }

    // Check if user has already reported this post
    const existingReport = post.reports?.find(report => report.user.toString() === userId.toString());
    if (existingReport) {
      return res.status(400).json({
        success: false,
        message: 'You have already reported this post'
      });
    }

    // Add report to post
    if (!post.reports) post.reports = [];
    post.reports.push({
      user: userId,
      reason: req.body.reason || 'Inappropriate content',
      reportedAt: new Date()
    });

    await post.save();

    res.status(200).json({
      success: true,
      message: 'Post reported successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to report post',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get personalized feed using recommendation engine
const getPersonalizedFeed = async (req, res) => {
  try {
    // Fallback to regular feed since recommendation engine is not available
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const { postType, author, tags, visibility } = req.query;

    // Build filter object
    const filter = { isActive: true };
    
    if (postType) filter.postType = postType;
    if (author) filter.author = author;
    if (tags) filter.tags = { $in: tags.split(',') };
    if (visibility) filter.visibility = visibility;

    // If user is not authenticated, only show public posts
    if (!req.user) {
      filter.visibility = 'public';
    } else {
      // If user is authenticated, show public posts and their own posts
      if (!visibility) {
        filter.$or = [
          { visibility: 'public' },
          { author: req.user._id },
          { 
            visibility: 'followers',
            author: { $in: req.user.following }
          }
        ];
      }
    }

    const posts = await Post.find(filter)
      .populate('author', 'username profile.displayName profile.avatar userType')
      .populate('likes.user', 'username profile.displayName profile.avatar')
      .populate('comments.user', 'username profile.displayName profile.avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Post.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: {
        posts,
        pagination: {
          current: page,
          total: Math.ceil(total / limit),
          count: posts.length,
          totalPosts: total
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch personalized feed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Track user interaction with post
const trackInteraction = async (req, res) => {
  try {
    const { postId, interactionType, dwellTime, clickedElement, context } = req.body;
    const userId = req.user._id;

    // Validate interaction type
    const validTypes = ['view', 'like', 'comment', 'share', 'click', 'dwell_time', 'skip'];
    if (!validTypes.includes(interactionType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid interaction type'
      });
    }

    // Check if post exists
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Simple interaction tracking without recommendation engine
    // Just log the interaction for now
    if (process.env.NODE_ENV === 'development') { console.log(`User ${userId} ${interactionType} on post ${postId}`);
}
    res.status(200).json({
      success: true,
      data: {
        message: 'Interaction tracked successfully'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to track interaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update post analytics
const updatePostAnalytics = async (postId) => {
  try {
    const post = await Post.findById(postId);
    if (!post) return;

    // Simple analytics without UserInteraction model
    const totalViews = post.views || 0;
    const likes = post.likes ? post.likes.length : 0;
    const comments = post.comments ? post.comments.length : 0;
    const engagementScore = (likes * 3) + (comments * 5);

    // Update post analytics
    post.analytics = {
      totalViews,
      engagementScore,
      lastCalculated: new Date()
    };

    // Update content quality
    post.contentQuality = {
      hasMedia: post.content.media && post.content.media.length > 0,
      textLength: post.content.text ? post.content.text.length : 0,
      tagCount: post.tags ? post.tags.length : 0,
      qualityScore: calculateContentQualityScore(post)
    };

    await post.save();
  } catch (error) {
    log.error('Error updating post analytics:', { error: String(error) });
  }
};

// Calculate content quality score
const calculateContentQualityScore = (post) => {
  let score = 0;
  
  // Text length score (optimal range: 50-500 characters)
  const textLength = post.content.text ? post.content.text.length : 0;
  if (textLength >= 50 && textLength <= 500) score += 3;
  else if (textLength > 0) score += 1;
  
  // Media presence bonus
  if (post.content.media && post.content.media.length > 0) score += 2;
  
  // Tag presence bonus
  if (post.tags && post.tags.length > 0) score += 1;
  
  // Post type specific bonuses
  if (post.postType === 'achievement') score += 2;
  if (post.postType === 'recruitment') score += 1;
  
  return Math.min(score, 10); // Cap at 10
};

// Get user analytics
const getUserAnalytics = async (req, res) => {
  try {
    const userId = req.user._id;
    const days = parseInt(req.query.days) || 30;

    // Simple analytics without recommendation engine
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user's posts
    const posts = await Post.find({ author: userId, isActive: true });
    
    // Calculate basic analytics
    const totalPosts = posts.length;
    const totalLikes = posts.reduce((sum, post) => sum + (post.likes ? post.likes.length : 0), 0);
    const totalComments = posts.reduce((sum, post) => sum + (post.comments ? post.comments.length : 0), 0);
    const totalViews = posts.reduce((sum, post) => sum + (post.views || 0), 0);

    const analytics = {
      totalPosts,
      totalLikes,
      totalComments,
      totalViews,
      engagementRate: totalPosts > 0 ? (totalLikes + totalComments) / totalPosts : 0
    };

    res.status(200).json({
      success: true,
      data: analytics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  createPost,
  getPosts,
  getClips,
  getPost,
  recordClipView,
  getPersonalizedFeed,
  toggleLike,
  addComment,
  updatePost,
  deletePost,
  reportPost,
  boostPost,
  trackInteraction,
  getUserAnalytics
};
