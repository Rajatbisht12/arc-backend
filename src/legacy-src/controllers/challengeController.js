const Challenge = require('../models/Challenge');
const ChallengeParticipation = require('../models/ChallengeParticipation');
const User = require('../models/User');
const safeAsyncHandler = require('../utils/safeAsyncHandler');
const log = require('../utils/logger');

// Create a new challenge (Creator only)
const createChallenge = safeAsyncHandler(async (req, res) => {
  const {
    title,
    description,
    challengeType,
    game,
    category,
    requirements,
    rewards,
    startDate,
    endDate,
    visibility,
    tags,
    creatorSettings,
    media
  } = req.body;

  const creatorId = req.user._id;

  // Validate creator permissions
  if (req.user.userType !== 'creator' && !req.user.isCreator) {
    return res.status(403).json({
      success: false,
      message: 'Only creators can create challenges'
    });
  }

  // Validate dates
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (start >= end) {
    return res.status(400).json({
      success: false,
      message: 'End date must be after start date'
    });
  }

  if (start < new Date()) {
    return res.status(400).json({
      success: false,
      message: 'Start date cannot be in the past'
    });
  }

  // Create challenge
  const challenge = new Challenge({
    creator: creatorId,
    title,
    description,
    challengeType,
    game,
    category,
    requirements,
    rewards,
    startDate: start,
    endDate: end,
    visibility,
    tags: tags || [],
    creatorSettings: creatorSettings || {},
    media: media || {}
  });

  await challenge.save();
  await challenge.populate('creator', 'username profile.displayName profile.avatar');

  res.status(201).json({
    success: true,
    message: 'Challenge created successfully',
    data: challenge
  });
});

// Get all challenges with filters
const getChallenges = safeAsyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    game,
    category,
    challengeType,
    status = 'active',
    creator,
    search,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  const query = {};

  // Apply filters
  if (game) query.game = game;
  if (category) query.category = category;
  if (challengeType) query.challengeType = challengeType;
  if (status) query.status = status;
  if (creator) query.creator = creator;

  // Search functionality
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { tags: { $in: [new RegExp(search, 'i')] } }
    ];
  }

  // Visibility filter (only show public challenges or user's own)
  if (req.user) {
    query.$or = [
      { visibility: 'public' },
      { creator: req.user._id },
      { 
        visibility: 'followers',
        creator: { $in: req.user.following || [] }
      }
    ];
  } else {
    query.visibility = 'public';
  }

  const sortOptions = {};
  sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

  const challenges = await Challenge.find(query)
    .populate('creator', 'username profile.displayName profile.avatar')
    .sort(sortOptions)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await Challenge.countDocuments(query);

  res.json({
    success: true,
    data: {
      challenges,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalChallenges: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    }
  });
});

// Get single challenge
const getChallenge = safeAsyncHandler(async (req, res) => {
  const { id } = req.params;

  const challenge = await Challenge.findById(id)
    .populate('creator', 'username profile.displayName profile.avatar')
    .populate('participants.user', 'username profile.displayName profile.avatar');

  if (!challenge) {
    return res.status(404).json({
      success: false,
      message: 'Challenge not found'
    });
  }

  // Check visibility
  if (challenge.visibility === 'private' && 
      (!req.user || challenge.creator._id.toString() !== req.user._id.toString())) {
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }

  // Increment view count
  challenge.stats.views += 1;
  await challenge.save();

  res.json({
    success: true,
    data: challenge
  });
});

// Join a challenge
const joinChallenge = safeAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  const challenge = await Challenge.findById(id);
  if (!challenge) {
    return res.status(404).json({
      success: false,
      message: 'Challenge not found'
    });
  }

  // Check if challenge is active
  if (challenge.status !== 'active') {
    return res.status(400).json({
      success: false,
      message: 'Challenge is not active'
    });
  }

  // Check if challenge has started
  if (new Date() < challenge.startDate) {
    return res.status(400).json({
      success: false,
      message: 'Challenge has not started yet'
    });
  }

  // Check if challenge has ended
  if (new Date() > challenge.endDate) {
    return res.status(400).json({
      success: false,
      message: 'Challenge has ended'
    });
  }

  try {
    await challenge.addParticipant(userId);
    
    // Create participation record
    const participation = new ChallengeParticipation({
      challenge: challenge._id,
      participant: userId,
      progress: {
        targetValue: challenge.requirements.targetValue
      }
    });
    
    await participation.save();
    await participation.populate('participant', 'username profile.displayName profile.avatar');

    res.json({
      success: true,
      message: 'Successfully joined challenge',
      data: participation
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Update challenge progress
const updateProgress = safeAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const { progressValue } = req.body;
  const userId = req.user._id;

  const challenge = await Challenge.findById(id);
  if (!challenge) {
    return res.status(404).json({
      success: false,
      message: 'Challenge not found'
    });
  }

  const participation = await ChallengeParticipation.findOne({
    challenge: challenge._id,
    participant: userId
  });

  if (!participation) {
    return res.status(400).json({
      success: false,
      message: 'You are not participating in this challenge'
    });
  }

  try {
    await participation.updateProgress(progressValue, challenge);
    await challenge.updateProgress(userId, progressValue);

    res.json({
      success: true,
      message: 'Progress updated successfully',
      data: participation
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Get user's challenges (created by user)
const getMyChallenges = safeAsyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;
  const userId = req.user._id;

  const query = { creator: userId };
  if (status) query.status = status;

  const challenges = await Challenge.find(query)
    .populate('creator', 'username profile.displayName profile.avatar')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await Challenge.countDocuments(query);

  res.json({
    success: true,
    data: {
      challenges,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalChallenges: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    }
  });
});

// Get user's participations
const getMyParticipations = safeAsyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;
  const userId = req.user._id;

  const query = { participant: userId };
  if (status) query.status = status;

  const participations = await ChallengeParticipation.find(query)
    .populate('challenge', 'title description game challengeType rewards startDate endDate')
    .populate('challenge.creator', 'username profile.displayName profile.avatar')
    .sort({ joinedAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await ChallengeParticipation.countDocuments(query);

  res.json({
    success: true,
    data: {
      participations,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalParticipations: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    }
  });
});

// Update challenge (Creator only)
const updateChallenge = safeAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  const challenge = await Challenge.findById(id);
  if (!challenge) {
    return res.status(404).json({
      success: false,
      message: 'Challenge not found'
    });
  }

  // Check if user is the creator
  if (challenge.creator.toString() !== userId.toString()) {
    return res.status(403).json({
      success: false,
      message: 'Only the creator can update this challenge'
    });
  }

  // Whitelist fields to prevent NoSQL Mass Assignment / Injection
  const allowedGeneralUpdates = [
    'title', 'description', 'challengeType', 'game', 'category',
    'requirements', 'rewards', 'startDate', 'endDate', 'visibility',
    'tags', 'creatorSettings', 'media', 'status'
  ];
  
  const updateData = {};
  allowedGeneralUpdates.forEach(field => {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  });

  // Don't allow updating core fields if challenge has started and has participants
  if (challenge.status === 'active' && challenge.participants.length > 0) {
    const allowedActiveUpdates = ['description', 'media', 'creatorSettings'];
    const updateKeys = Object.keys(updateData);
    const hasRestrictedUpdate = updateKeys.some(key => !allowedActiveUpdates.includes(key));
    
    if (hasRestrictedUpdate) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update core challenge details after it has started with participants'
      });
    }
  }

  const updatedChallenge = await Challenge.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true, runValidators: true }
  ).populate('creator', 'username profile.displayName profile.avatar');

  res.json({
    success: true,
    message: 'Challenge updated successfully',
    data: updatedChallenge
  });
});

// Delete challenge (Creator only)
const deleteChallenge = safeAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  const challenge = await Challenge.findById(id);
  if (!challenge) {
    return res.status(404).json({
      success: false,
      message: 'Challenge not found'
    });
  }

  // Check if user is the creator
  if (challenge.creator.toString() !== userId.toString()) {
    return res.status(403).json({
      success: false,
      message: 'Only the creator can delete this challenge'
    });
  }

  // Don't allow deletion if challenge has participants
  if (challenge.participants.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Cannot delete challenge with active participants'
    });
  }

  await Challenge.findByIdAndDelete(id);
  await ChallengeParticipation.deleteMany({ challenge: id });

  res.json({
    success: true,
    message: 'Challenge deleted successfully'
  });
});

// Distribute rewards (Creator only)
const distributeRewards = safeAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  const challenge = await Challenge.findById(id);
  if (!challenge) {
    return res.status(404).json({
      success: false,
      message: 'Challenge not found'
    });
  }

  // Check if user is the creator
  if (challenge.creator.toString() !== userId.toString()) {
    return res.status(403).json({
      success: false,
      message: 'Only the creator can distribute rewards'
    });
  }

  // Check if challenge has ended
  if (new Date() < challenge.endDate) {
    return res.status(400).json({
      success: false,
      message: 'Challenge has not ended yet'
    });
  }

  try {
    await challenge.distributeRewards();
    
    // Update participation records
    await ChallengeParticipation.updateMany(
      { 
        challenge: challenge._id,
        'progress.completed': true,
        'rewards.claimed': false
      },
      { 
        'rewards.claimed': true,
        'rewards.claimedAt': new Date()
      }
    );

    res.json({
      success: true,
      message: 'Rewards distributed successfully',
      data: {
        totalRewardsDistributed: challenge.stats.totalRewardsDistributed
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = {
  createChallenge,
  getChallenges,
  getChallenge,
  joinChallenge,
  updateProgress,
  getMyChallenges,
  getMyParticipations,
  updateChallenge,
  deleteChallenge,
  distributeRewards
};
