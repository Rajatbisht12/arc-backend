/**
 * Eligibility Calculation Engine for creator monetization.
 * Runs on profile load and daily cron. Eligibility ≠ approval.
 */

const User = require('../models/User');
const Post = require('../models/Post');
const Story = require('../models/Story');
const Report = require('../models/Report');
const PostEngagement = require('../models/PostEngagement');
const MonetizationEligibility = require('../models/MonetizationEligibility');
const CreatorEligibilityHistory = require('../models/CreatorEligibilityHistory');
const CreatorDailyActivity = require('../models/CreatorDailyActivity');
const Follow = require('../models/Follow');
const mongoose = require('mongoose');
const { buildUniquePostViewPipeline } = require('./postEngagementAnalytics');

// Configurable thresholds (short-form clip creator monetization)
const THRESHOLDS = {
  minFollowers: 1000,
  minTotalClipViews45d: 100000,
  minClipsWith3kViews45d: 5,
  minActiveDays45d: 25
};

function toObjectId(id) {
  return id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id);
}

function dateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function rollingWindow() {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd);
  windowStart.setDate(windowStart.getDate() - 45);
  return { windowStart, windowEnd };
}

async function persistEligibilityHistory(userId, result, reason = 'scheduled_recalculation') {
  const { windowStart, windowEnd } = rollingWindow();
  await CreatorEligibilityHistory.create({
    user: userId,
    windowStart,
    windowEnd,
    isEligible: result.isEligible,
    progressPercent: result.progressPercent,
    requirements: result.requirements || [],
    failedConditions: result.failedConditions || [],
    metrics: result.metrics || {},
    reason,
    calculatedAt: new Date()
  });
}

async function refreshDailyActivitySnapshots(userId, sinceDate) {
  const authorObjectId = toObjectId(userId);
  const [engagementRows, postRows, storyRows] = await Promise.all([
    PostEngagement.aggregate([
      {
        $match: {
          user: authorObjectId,
          createdAt: { $gte: sinceDate },
          eventType: { $in: ['like', 'comment', 'share', 'save', 'dwell', 'watch'] }
        }
      },
      {
        $project: {
          day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          eventType: 1
        }
      },
      {
        $group: {
          _id: '$day',
          comments: { $sum: { $cond: [{ $eq: ['$eventType', 'comment'] }, 1, 0] } },
          likes: { $sum: { $cond: [{ $eq: ['$eventType', 'like'] }, 1, 0] } },
          shares: { $sum: { $cond: [{ $eq: ['$eventType', 'share'] }, 1, 0] } },
          saves: { $sum: { $cond: [{ $eq: ['$eventType', 'save'] }, 1, 0] } },
          meaningfulEngagements: { $sum: 1 }
        }
      }
    ]),
    Post.aggregate([
      {
        $match: {
          author: authorObjectId,
          createdAt: { $gte: sinceDate },
          isActive: true,
          hiddenByAdmin: { $ne: true }
        }
      },
      {
        $project: {
          day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          isClip: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: { $ifNull: ['$content.media', []] },
                    as: 'media',
                    cond: { $eq: ['$$media.type', 'video'] }
                  }
                }
              },
              0
            ]
          }
        }
      },
      {
        $group: {
          _id: '$day',
          postsCreated: { $sum: 1 },
          clipsCreated: { $sum: { $cond: ['$isClip', 1, 0] } }
        }
      }
    ]),
    Story.aggregate([
      {
        $match: {
          author: authorObjectId,
          createdAt: { $gte: sinceDate }
        }
      },
      {
        $project: {
          day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }
        }
      },
      {
        $group: {
          _id: '$day',
          storiesCreated: { $sum: 1 }
        }
      }
    ])
  ]);

  const activityByDay = new Map();
  const merge = (row) => {
    const current = activityByDay.get(row._id) || {
      postsCreated: 0,
      clipsCreated: 0,
      storiesCreated: 0,
      comments: 0,
      likes: 0,
      shares: 0,
      saves: 0,
      meaningfulEngagements: 0
    };
    activityByDay.set(row._id, { ...current, ...row });
  };
  engagementRows.forEach(merge);
  postRows.forEach(merge);
  storyRows.forEach(merge);

  await Promise.all(Array.from(activityByDay.entries()).map(([day, values]) => {
    const date = new Date(`${day}T00:00:00.000Z`);
    return CreatorDailyActivity.findOneAndUpdate(
      { user: userId, day },
      {
        user: userId,
        day,
        date,
        postsCreated: values.postsCreated || 0,
        clipsCreated: values.clipsCreated || 0,
        storiesCreated: values.storiesCreated || 0,
        comments: values.comments || 0,
        likes: values.likes || 0,
        shares: values.shares || 0,
        saves: values.saves || 0,
        meaningfulEngagements: values.meaningfulEngagements || 0,
        lastCalculatedAt: new Date()
      },
      { upsert: true, new: true }
    );
  }));
}

/**
 * Compute eligibility for a user. Returns { isEligible, failedConditions, progress_percent, metrics }.
 * @param {string|ObjectId} userId
 * @returns {Promise<{ isEligible: boolean, failedConditions: array, progressPercent: number, metrics: object }>}
 */
async function calculateEligibility(userId) {
  const user = await User.findById(userId).select('createdAt membership userType role').lean();
  if (!user) {
    return {
      isEligible: false,
      failedConditions: [{ condition: 'account', current: null, required: 'exists', progressPercent: 0 }],
      progressPercent: 0,
      metrics: {}
    };
  }
  if (user.userType !== 'player' && user.role !== 'player') {
    return {
      isEligible: false,
      failedConditions: [{
        condition: 'individual_user_account',
        current: user.userType || user.role || 'unknown',
        required: 'player',
        progressPercent: 0,
        isMet: false
      }],
      progressPercent: 0,
      metrics: { accountType: user.userType || user.role || 'unknown' },
      requirements: [{
        condition: 'individual_user_account',
        current: user.userType || user.role || 'unknown',
        required: 'player',
        progressPercent: 0,
        isMet: false
      }]
    };
  }

  // Follow is the canonical relationship collection. User.followers remains a
  // bounded compatibility projection and can lag during migrations, so it
  // must not decide financial eligibility.
  const followersCount = await Follow.getFollowerCount(userId);
  const membershipTier = user.membership?.tier || 'free';
  const membershipValidUntil = user.membership?.validUntil || null;
  const membershipExpired = membershipValidUntil ? new Date(membershipValidUntil) < new Date() : false;
  const hasActivePremiumMembership = membershipTier !== 'free' && !membershipExpired;

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 45);

  const authorObjectId = toObjectId(userId);

  // All active clips. The 45-day window applies to view/activity events, not
  // only to upload date; older clips can still earn current organic views.
  const clips = await Post.find({
    author: userId,
    isActive: true,
    hiddenByAdmin: { $ne: true },
    'content.media': { $elemMatch: { type: 'video' } }
  })
    .select('content.text createdAt')
    .lean();

  const clipIds = clips.map((clip) => clip._id);
  const [organicViewRows, boostedViewRows] = clipIds.length > 0
    ? await Promise.all([
        PostEngagement.aggregate(buildUniquePostViewPipeline({
          postIds: clipIds,
          source: 'organic',
          sinceDate,
          groupBy: 'post'
        })),
        PostEngagement.aggregate(buildUniquePostViewPipeline({
          postIds: clipIds,
          source: 'boost',
          sinceDate,
          groupBy: 'post'
        }))
      ])
    : [[], []];

  const organicViewsByPost = new Map(organicViewRows.map((row) => [String(row._id), row.views]));
  const boostedViewsByPost = new Map(boostedViewRows.map((row) => [String(row._id), row.views]));
  const viewCounts = clips.map((clip) => organicViewsByPost.get(String(clip._id)) || 0);
  const totalClipViews45d = viewCounts.reduce((sum, val) => sum + val, 0);
  const totalBoostedClipViews45d = clips.reduce((sum, clip) => sum + (boostedViewsByPost.get(String(clip._id)) || 0), 0);
  const clipsWith3kViews45d = viewCounts.filter((v) => v >= 3000).length;

  const [activeEngagementDays, uploadedPosts, uploadedStories] = await Promise.all([
    PostEngagement.aggregate([
      {
        $match: {
          user: authorObjectId,
          createdAt: { $gte: sinceDate },
          eventType: { $in: ['view', 'watch', 'like', 'comment', 'share', 'save', 'dwell'] }
        }
      },
      {
        $project: {
          day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }
        }
      },
      { $group: { _id: '$day' } }
    ]),
    Post.find({
      author: userId,
      createdAt: { $gte: sinceDate },
      isActive: true,
      hiddenByAdmin: { $ne: true }
    })
      .select('createdAt')
      .lean(),
    Story.find({ author: userId, createdAt: { $gte: sinceDate } })
      .select('createdAt')
      .lean()
  ]);

  const activeDaysSet = new Set([
    ...activeEngagementDays.map((row) => row._id),
    ...uploadedPosts.map((post) => dateKey(post.createdAt)),
    ...uploadedStories.map((story) => dateKey(story.createdAt))
  ]);
  const activeDays45d = activeDaysSet.size;
  await refreshDailyActivitySnapshots(userId, sinceDate);

  // Creator health: penalize policy violations, reused captions, and low-quality captions
  const userPostIds = await Post.find({ author: userId }).select('_id').lean().then(p => p.map(x => x._id));
  const violationReports = await Report.countDocuments({
    targetType: { $in: ['post', 'comment'] },
    status: 'action_taken',
    targetId: { $in: userPostIds }
  });
  const userReported = await Report.countDocuments({
    targetType: 'user',
    targetId: userId,
    status: 'action_taken'
  });
  const totalPolicyViolations = violationReports + userReported;

  const normalizedTexts = clips
    .map((clip) => (clip.content?.text || '').toLowerCase().replace(/\s+/g, ' ').trim())
    .filter((text) => text.length > 0);
  const textCounts = normalizedTexts.reduce((acc, text) => {
    acc[text] = (acc[text] || 0) + 1;
    return acc;
  }, {});
  const duplicateCount = Object.values(textCounts).reduce((sum, count) => sum + (count > 1 ? count - 1 : 0), 0);
  const duplicateRatio = normalizedTexts.length > 0 ? duplicateCount / normalizedTexts.length : 0;

  const lowQualityCount = clips.filter((clip) => (clip.content?.text || '').trim().length < 10).length;
  const lowQualityRatio = clips.length > 0 ? lowQualityCount / clips.length : 0;

  let creatorHealthScore = 100;
  creatorHealthScore -= Math.min(60, totalPolicyViolations * 20);
  if (duplicateRatio >= 0.3) creatorHealthScore -= 20;
  else if (duplicateRatio >= 0.15) creatorHealthScore -= 10;
  if (lowQualityRatio >= 0.3) creatorHealthScore -= 15;
  else if (lowQualityRatio >= 0.15) creatorHealthScore -= 8;
  creatorHealthScore = Math.max(0, Math.min(100, Math.round(creatorHealthScore)));

  const sortedViews = [...viewCounts].sort((a, b) => a - b);
  const medianView = sortedViews.length
    ? sortedViews[Math.floor(sortedViews.length / 2)]
    : 0;
  const maxView = viewCounts.length ? Math.max(...viewCounts) : 0;
  const suspiciousViewSpike =
    viewCounts.length >= 3 &&
    maxView >= 20000 &&
    (medianView > 0 ? maxView >= medianView * 10 : maxView >= 50000) &&
    (totalClipViews45d > 0 ? maxView / totalClipViews45d >= 0.7 : false);

  const metrics = {
    followersCount,
    hasActivePremiumMembership,
    totalOrganicClipViews45d: totalClipViews45d,
    totalBoostedClipViews45d,
    totalClipViews45d,
    clipsWith3kViews45d,
    clipsWith3kOrganicViews45d: clipsWith3kViews45d,
    activeDays45d,
    creatorHealthScore,
    suspiciousViewSpike,
    policyViolations: totalPolicyViolations,
    lowQualityRatio: Math.round(lowQualityRatio * 100) / 100,
    duplicateRatio: Math.round(duplicateRatio * 100) / 100
  };

  const requirements = [];
  const addRequirement = (condition, current, required, progressPercent, isMet) => {
    requirements.push({
      condition,
      current,
      required,
      progressPercent: Math.round(progressPercent),
      isMet
    });
  };
  let progressSum = 0;
  const numConditions = 5;

  // Active premium membership
  const membershipProgress = hasActivePremiumMembership ? 100 : 0;
  if (!hasActivePremiumMembership) {
    addRequirement('active_premium_membership', hasActivePremiumMembership ? 1 : 0, 1, membershipProgress, false);
  } else {
    addRequirement('active_premium_membership', 1, 1, membershipProgress, true);
  }
  progressSum += membershipProgress;

  // Followers
  const followerProgress = Math.min(100, (followersCount / THRESHOLDS.minFollowers) * 100);
  if (followersCount < THRESHOLDS.minFollowers) {
    addRequirement('min_followers', followersCount, THRESHOLDS.minFollowers, followerProgress, false);
  } else {
    addRequirement('min_followers', followersCount, THRESHOLDS.minFollowers, followerProgress, true);
  }
  progressSum += followerProgress;

  // Total clip views (last 45 days)
  const totalViewsProgress = Math.min(100, (totalClipViews45d / THRESHOLDS.minTotalClipViews45d) * 100);
  if (totalClipViews45d < THRESHOLDS.minTotalClipViews45d) {
    addRequirement('min_total_clip_views_45d', totalClipViews45d, THRESHOLDS.minTotalClipViews45d, totalViewsProgress, false);
  } else {
    addRequirement('min_total_clip_views_45d', totalClipViews45d, THRESHOLDS.minTotalClipViews45d, totalViewsProgress, true);
  }
  progressSum += totalViewsProgress;

  // High-performing clips (>= 3k views each, last 45 days)
  const highClipProgress = Math.min(100, (clipsWith3kViews45d / THRESHOLDS.minClipsWith3kViews45d) * 100);
  if (clipsWith3kViews45d < THRESHOLDS.minClipsWith3kViews45d) {
    addRequirement('min_high_performing_clips_45d', clipsWith3kViews45d, THRESHOLDS.minClipsWith3kViews45d, highClipProgress, false);
  } else {
    addRequirement('min_high_performing_clips_45d', clipsWith3kViews45d, THRESHOLDS.minClipsWith3kViews45d, highClipProgress, true);
  }
  progressSum += highClipProgress;

  // Active days (last 45 days)
  const activeDaysProgress = Math.min(100, (activeDays45d / THRESHOLDS.minActiveDays45d) * 100);
  if (activeDays45d < THRESHOLDS.minActiveDays45d) {
    addRequirement('min_active_days_45d', activeDays45d, THRESHOLDS.minActiveDays45d, activeDaysProgress, false);
  } else {
    addRequirement('min_active_days_45d', activeDays45d, THRESHOLDS.minActiveDays45d, activeDaysProgress, true);
  }
  progressSum += activeDaysProgress;

  const progressPercent = Math.round(progressSum / numConditions);
  const failedConditions = requirements.filter((requirement) => !requirement.isMet);
  const isEligible = failedConditions.length === 0;

  return {
    isEligible,
    failedConditions,
    progressPercent,
    metrics,
    requirements
  };
}

/**
 * Get or compute and cache eligibility for a user.
 * @param {string|ObjectId} userId
 * @param {boolean} forceRecalculate - if true, recompute and update cache
 */
async function getOrComputeEligibility(userId, forceRecalculate = false) {
  if (!userId) return null;

  const cached = await MonetizationEligibility.findOne({ user: userId }).lean();
  const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours
  const isStale = !cached || (Date.now() - new Date(cached.lastCalculatedAt).getTime() > maxAgeMs);

  if (cached && !forceRecalculate && !isStale) {
    return {
      isEligible: cached.isEligible,
      failedConditions: cached.failedConditions || [],
      progressPercent: cached.progressPercent ?? 0,
      metrics: cached.metrics || {},
      requirements: cached.requirements || [],
      lastCalculatedAt: cached.lastCalculatedAt
    };
  }

  const result = await calculateEligibility(userId);
  await MonetizationEligibility.findOneAndUpdate(
    { user: userId },
    {
      user: userId,
      isEligible: result.isEligible,
      failedConditions: result.failedConditions,
      progressPercent: result.progressPercent,
      metrics: result.metrics,
      requirements: result.requirements,
      lastCalculatedAt: new Date()
    },
    { upsert: true, new: true }
  );
  await persistEligibilityHistory(userId, result, forceRecalculate ? 'manual_recalculation' : 'profile_load');

  return {
    ...result,
    lastCalculatedAt: new Date()
  };
}

/**
 * Run eligibility for all player users (for daily cron). Updates cache only.
 */
async function runEligibilityForAllPlayers() {
  const users = await User.find({ userType: 'player', isActive: true }).select('_id creatorMonetizationStatus').lean();
  let updated = 0;
  let newlyEligible = 0;
  let lostEligibility = 0;
  for (const u of users) {
    try {
      const previous = await MonetizationEligibility.findOne({ user: u._id }).select('isEligible').lean();
      const result = await calculateEligibility(u._id);
      await MonetizationEligibility.findOneAndUpdate(
        { user: u._id },
        {
          user: u._id,
          isEligible: result.isEligible,
      failedConditions: result.failedConditions,
      progressPercent: result.progressPercent,
      metrics: result.metrics,
      requirements: result.requirements,
      lastCalculatedAt: new Date()
        },
        { upsert: true }
      );
      await persistEligibilityHistory(u._id, result, 'scheduled_recalculation');
      if (previous && !previous.isEligible && result.isEligible) newlyEligible++;
      if (previous && previous.isEligible && !result.isEligible) lostEligibility++;

      const lockedStatuses = ['pending', 'approved', 'rejected', 'suspended', 'disabled', 'withdrawn'];
      if (!lockedStatuses.includes(u.creatorMonetizationStatus)) {
        await User.updateOne(
          { _id: u._id },
          { creatorMonetizationStatus: result.isEligible ? 'eligible' : 'not_eligible' }
        );
      }
      updated++;
    } catch (err) {
      console.error('Eligibility run error for user', u._id, err.message);
    }
  }
  const purgeBefore = new Date();
  purgeBefore.setDate(purgeBefore.getDate() - 60);
  await CreatorDailyActivity.deleteMany({ date: { $lt: purgeBefore } });
  return { processed: users.length, updated, newlyEligible, lostEligibility };
}

module.exports = {
  calculateEligibility,
  getOrComputeEligibility,
  runEligibilityForAllPlayers,
  THRESHOLDS
};
