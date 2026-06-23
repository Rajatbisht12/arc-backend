const User = require('../models/User');
const RandomConnection = require('../models/RandomConnection');
const ConnectionQueue = require('../models/ConnectionQueue');
const { v4: uuidv4 } = require('uuid');
const log = require('../utils/logger');

// Free users: daily match limit. Premium: unlimited matches.
const FREE_DAILY_MATCH_LIMIT = 5;

const isPremiumUser = (user) => {
  if (!user) return false;
  if (user.isPremium === true) return true;
  const tier = user.membership?.tier || 'free';
  return ['player_pro', 'player_pro_plus', 'team_pro', 'team_org'].includes(tier);
};

// Random Connect: for PLAYERS only. Matches 2 players who share at least one tag → video call.
// Join the random connection queue with tags support
const joinQueue = async (req, res) => {
  try {
    const { selectedGame, tags = [], videoEnabled = true, preferredGender } = req.body;
    const userId = req.user._id;
    const isPremium = isPremiumUser(req.user);
    const userGender = req.user.profile?.gender || '';

    // Only players can use Random Connect (teams cannot)
    if (req.user.userType !== 'player') {
      console.warn(`[RandomConnect] join-queue forbidden (not player): user=${req.user.username} id=${userId} type=${req.user.userType}`);
      return res.status(403).json({
        success: false,
        message: 'Random Connect is only for players. Teams cannot use this feature.'
      });
    }

    // Free users: daily limit (5) only when using gender filter (Male/Female). Default "Any" = unlimited.
    const usingGenderFilter = preferredGender === 'male' || preferredGender === 'female';
    if (!isPremium && usingGenderFilter) {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const todayGenderFilterMatchCount = await RandomConnection.countDocuments({
        'participants.userId': userId,
        status: { $in: ['active', 'disconnected', 'ended'] },
        startTime: { $gte: startOfToday },
        usedGenderFilter: true
      });
      if (todayGenderFilterMatchCount >= FREE_DAILY_MATCH_LIMIT) {
        console.warn(`[RandomConnect] join-queue daily limit (gender filter): user=${req.user.username} count=${todayGenderFilterMatchCount}/${FREE_DAILY_MATCH_LIMIT}`);
        return res.status(403).json({
          success: false,
          message: `Daily limit reached (${FREE_DAILY_MATCH_LIMIT} matches per day when using Male/Female filter). Use "Any" for unlimited or upgrade to Premium.`,
          dailyLimitReached: true,
          limit: FREE_DAILY_MATCH_LIMIT
        });
      }
    }

    // Allow join with or without tags – without tags = random match with any waiting player
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Normalize tags - remove duplicates, trim, lowercase
    const normalizedTags = [...new Set(tags.map(tag => tag.trim().toLowerCase()).filter(tag => tag.length > 0))];

    if (process.env.NODE_ENV === 'development') { console.log(`User ${userId} attempting to join queue - Game: ${selectedGame || 'none'}, Tags: ${normalizedTags.join(', ')}`);
}
    // Clean up any existing connections first
    await cleanupExistingConnections(userId, req.app.get('io'));

    // Check if user is already in queue
    const existingInQueue = await ConnectionQueue.findOne({
      userId,
      status: 'waiting'
    });

    const queuePreferredGender = (preferredGender === 'male' || preferredGender === 'female') ? preferredGender : '';
    if (existingInQueue) {
      if (process.env.NODE_ENV === 'development') { console.log(`User ${userId} already in queue, updating preferences`);}
      existingInQueue.selectedGame = selectedGame || null;
      existingInQueue.tags = normalizedTags;
      existingInQueue.videoEnabled = videoEnabled;
      existingInQueue.gender = userGender;
      existingInQueue.preferredGender = queuePreferredGender;
      existingInQueue.updatedAt = new Date();
      await existingInQueue.save();
    } else {
      await ConnectionQueue.create({
        userId,
        username: req.user.username,
        displayName: req.user.profile?.displayName,
        avatar: req.user.profile?.avatar,
        selectedGame: selectedGame || null,
        tags: normalizedTags,
        videoEnabled,
        gender: userGender,
        preferredGender: queuePreferredGender
      });
      if (process.env.NODE_ENV === 'development') { console.log(`User ${userId} added to queue`);}
    }

    // Gender filter: Male/Female only (free: 5/day when used; Any = unlimited)
    const matchOptions = { preferredGender: null };
    if (preferredGender === 'male' || preferredGender === 'female') {
      matchOptions.preferredGender = preferredGender;
    }

    // Try to find a match immediately
    const match = await findMatch(userId, selectedGame, normalizedTags, matchOptions);
    
    if (match) {
      if (process.env.NODE_ENV === 'development') { console.log(`✅ Instant match found for ${userId} with ${match.userId}`);
      }
      // Create connection immediately
      const roomId = uuidv4();
      const usedGenderFilter = preferredGender === 'male' || preferredGender === 'female';
      const connection = await RandomConnection.create({
        roomId,
        participants: [
          {
            userId,
            username: req.user.username,
            displayName: req.user.profile?.displayName,
            avatar: req.user.profile?.avatar,
            videoEnabled
          },
          {
            userId: match.userId,
            username: match.username,
            displayName: match.displayName,
            avatar: match.avatar,
            videoEnabled: match.videoEnabled
          }
        ],
        selectedGame: selectedGame || null,
        tags: normalizedTags,
        status: 'active',
        createdBy: userId,
        usedGenderFilter: usedGenderFilter
      });

      if (process.env.NODE_ENV === 'development') { console.log(`✅ Connection created with room ID: ${roomId}`);
}
      // Remove both users from queue
      await ConnectionQueue.deleteMany({
        userId: { $in: [userId, match.userId] }
      });

      // Prepare connection data
      const userIdStr = userId.toString();
      const matchUserIdStr = match.userId.toString();
      
      const connectionData = {
        roomId: connection.roomId,
        sessionId: connection.roomId,
        participants: [
          {
            userId: userIdStr,
            username: req.user.username,
            displayName: req.user.profile?.displayName,
            avatar: req.user.profile?.avatar,
            videoEnabled
          },
          {
            userId: matchUserIdStr,
            username: match.username,
            displayName: match.displayName,
            avatar: match.avatar,
            videoEnabled: match.videoEnabled
          }
        ],
        selectedGame: selectedGame || null,
        tags: normalizedTags
      };

      // CRITICAL: Emit socket events for BOTH users
      const io = req.app.get('io');
      if (io) {
        if (process.env.NODE_ENV === 'development') { console.log(`📤 Emitting connection-matched events to both users...`);}
        await emitConnectionMatched(io, userIdStr, matchUserIdStr, connectionData, roomId);
      } else {
        console.warn('⚠️ Socket.io not available, cannot emit events');
      }

      // Return connection data in API response - BOTH users can use this
      // Use connectionData which has properly formatted participants
      return res.status(200).json({
        success: true,
        message: 'Connection established!',
        connection: {
          roomId: connectionData.roomId,
          participants: connectionData.participants, // Already properly formatted
          selectedGame: connectionData.selectedGame,
          tags: connectionData.tags,
          status: 'active',
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt
        },
        matched: true,
        roomId: connection.roomId
      });
    }

    // No immediate match found, user is in queue
    res.status(200).json({
      success: true,
      message: 'Added to queue. Waiting for match...',
      matched: false
    });

  } catch (error) {
    log.error('Join queue error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to join queue',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Find another player with at least one same tag → exactly 2 players for video call
// options: { preferredGender } — premium-only filter (male | female | other)
const findMatch = async (userId, selectedGame, tags = [], options = {}) => {
  try {
    const userIdStr = userId.toString();
    const { preferredGender } = options;

    const query = {
      userId: { $ne: userId },
      status: 'waiting'
    };

    if (preferredGender) {
      query.gender = preferredGender;
      if (process.env.NODE_ENV === 'development') { console.log(`🔍 Random Connect (Premium): filter by gender ${preferredGender}`);}
    }

    if (tags.length > 0) {
      // Same-tag matching: find queue entries that have at least one tag in common
      query.tags = { $in: tags };
      if (process.env.NODE_ENV === 'development') { console.log(`🔍 Random Connect: looking for another player with tags: ${tags.join(', ')}`);}
    } else if (selectedGame) {
      query.selectedGame = selectedGame;
    } else {
      if (process.env.NODE_ENV === 'development') { console.log(`🔍 Random Connect: matching with any waiting player`);}
    }

    const potentialMatches = await ConnectionQueue.find(query)
      .sort({ createdAt: 1 }); // FIFO

    if (potentialMatches.length > 0) {
      // Pick first waiting player (FIFO) - exactly 2 players per room
      const match = potentialMatches[0];
      
      // Count common tags for logging
      const commonTags = tags.length > 0 && match.tags 
        ? tags.filter(tag => match.tags.includes(tag))
        : [];
      
      if (process.env.NODE_ENV === 'development') { console.log(`✅ Matched user ${userIdStr} with ${match.userId}`);}
      if (process.env.NODE_ENV === 'development') { console.log(`   Common tags: ${commonTags.join(', ') || 'none'}`);
      }
      return {
        userId: match.userId,
        username: match.username,
        displayName: match.displayName,
        avatar: match.avatar,
        videoEnabled: match.videoEnabled,
        tags: match.tags || [],
        selectedGame: match.selectedGame
      };
    }

    if (process.env.NODE_ENV === 'development') { console.log(`❌ No match found for user ${userIdStr} with tags: ${tags.join(', ')}`);}
    return null;
  } catch (error) {
    log.error('Find match error:', { error: String(error) });
    return null;
  }
};

// Match users from queue (used by periodic matcher)
const matchUsersFromQueue = async (io) => {
  try {
    // Get all waiting users
    const waitingUsers = await ConnectionQueue.find({ status: 'waiting' })
      .sort({ createdAt: 1 })
      .limit(50); // Process up to 50 users at a time

    if (waitingUsers.length < 2) {
      return; // Need at least 2 users to match
    }

    if (process.env.NODE_ENV === 'development') { console.log(`🔍 Periodic matching: Found ${waitingUsers.length} users in queue`);
}
    const matchedPairs = [];
    const processedUserIds = new Set();

    // Try to match each user with another
    for (let i = 0; i < waitingUsers.length; i++) {
      if (processedUserIds.has(waitingUsers[i].userId.toString())) {
        continue; // Already matched
      }

      const user1 = waitingUsers[i];
      const matchOptions = (user1.preferredGender === 'male' || user1.preferredGender === 'female')
        ? { preferredGender: user1.preferredGender }
        : {};
      const match = await findMatch(
        user1.userId,
        user1.selectedGame || null,
        user1.tags || [],
        matchOptions
      );

      if (match && !processedUserIds.has(match.userId.toString())) {
        // Found a match!
        const user2 = waitingUsers.find(u => u.userId.toString() === match.userId.toString());
        
        if (user2 && user2.status === 'waiting') {
          matchedPairs.push({ user1, user2, match });
          processedUserIds.add(user1.userId.toString());
          processedUserIds.add(user2.userId.toString());
        }
      }
    }

    // Create connections for matched pairs
    for (const { user1, user2, match } of matchedPairs) {
      try {
        // Double-check both users are still waiting
        const user1Check = await ConnectionQueue.findOne({
          userId: user1.userId,
          status: 'waiting'
        });
        const user2Check = await ConnectionQueue.findOne({
          userId: user2.userId,
          status: 'waiting'
        });

        if (!user1Check || !user2Check) {
          if (process.env.NODE_ENV === 'development') { console.log(`⚠️ One user already matched, skipping pair ${user1.userId} <-> ${user2.userId}`);}
          continue;
        }

        const usedGenderFilter = (user1.preferredGender === 'male' || user1.preferredGender === 'female' ||
          user2.preferredGender === 'male' || user2.preferredGender === 'female');
        const roomId = uuidv4();
        const connection = await RandomConnection.create({
          roomId,
          participants: [
            {
              userId: user1.userId,
              username: user1.username,
              displayName: user1.displayName,
              avatar: user1.avatar,
              videoEnabled: user1.videoEnabled
            },
            {
              userId: user2.userId,
              username: user2.username,
              displayName: user2.displayName,
              avatar: user2.avatar,
              videoEnabled: user2.videoEnabled
            }
          ],
          selectedGame: user1.selectedGame || null,
          tags: user1.tags || [],
          status: 'active',
          createdBy: user1.userId,
          usedGenderFilter: usedGenderFilter
        });

        if (process.env.NODE_ENV === 'development') { console.log(`✅ Periodic match: Created connection ${roomId} for users ${user1.userId} <-> ${user2.userId}`);
}
        // Remove both users from queue
        await ConnectionQueue.deleteMany({
          userId: { $in: [user1.userId, user2.userId] }
        });

        // Prepare connection data
        const userId1Str = user1.userId.toString();
        const userId2Str = user2.userId.toString();
        
        const connectionData = {
          roomId: connection.roomId,
          sessionId: connection.roomId,
          participants: [
            {
              userId: userId1Str,
              username: user1.username,
              displayName: user1.displayName,
              avatar: user1.avatar,
              videoEnabled: user1.videoEnabled
            },
            {
              userId: userId2Str,
              username: user2.username,
              displayName: user2.displayName,
              avatar: user2.avatar,
              videoEnabled: user2.videoEnabled
            }
          ],
          selectedGame: user1.selectedGame || null,
          tags: user1.tags || []
        };

        // Emit socket events with improved delivery
        if (io) {
          await emitConnectionMatched(io, userId1Str, userId2Str, connectionData, roomId);
        }
      } catch (error) {
        console.error(`❌ Error creating periodic match for ${user1.userId} <-> ${user2.userId}:`, error);
      }
    }

    if (matchedPairs.length > 0) {
      if (process.env.NODE_ENV === 'development') { console.log(`✅ Periodic matching: Successfully matched ${matchedPairs.length} pairs`);}
    }
  } catch (error) {
    log.error('❌ Periodic matching error:', { error: String(error) });
  }
};

// Improved socket event emission with retry and verification
const emitConnectionMatched = async (io, userId1Str, userId2Str, connectionData, roomId) => {
  try {
    // Find sockets for both users - improved detection
    const allSockets = Array.from(io.sockets.sockets.values());
    
    // Normalize userId strings for comparison
    const userId1Normalized = String(userId1Str).trim();
    const userId2Normalized = String(userId2Str).trim();
    
    // Try multiple ways to match userId
    const userSockets1 = allSockets.filter(s => {
      const socketUserId = String(s.authUser?.userId ?? '').trim();
      return socketUserId !== '' && socketUserId === userId1Normalized;
    });

    const userSockets2 = allSockets.filter(s => {
      const socketUserId = String(s.authUser?.userId ?? '').trim();
      return socketUserId !== '' && socketUserId === userId2Normalized;
    });
    
    // Also check user rooms for sockets
    const room1 = io.sockets.adapter.rooms.get(`user-${userId1Str}`);
    const room2 = io.sockets.adapter.rooms.get(`user-${userId2Str}`);
    
    if (process.env.NODE_ENV === 'development') { console.log(`📤 Emitting connection-matched:`);}
    if (process.env.NODE_ENV === 'development') { console.log(`   User1 (${userId1Str}): ${userSockets1.length} direct socket(s), ${room1?.size || 0} socket(s) in room`);}
    if (process.env.NODE_ENV === 'development') { console.log(`   User2 (${userId2Str}): ${userSockets2.length} direct socket(s), ${room2?.size || 0} socket(s) in room`);
    }
    // Debug: Log all socket userIds for troubleshooting
    if (userSockets1.length === 0 || userSockets2.length === 0) {
      log.debug('🔍 Debug: All connected socket userIds:', 
        allSockets.map(s => ({ 
          socketId: s.id, 
          userId: s.userId?.toString(),
          connected: s.connected,
          rooms: Array.from(s.rooms || [])
        })).slice(0, 10)
      );
      if (process.env.NODE_ENV === 'development') { console.log(`🔍 Looking for userIds: "${userId1Normalized}" and "${userId2Normalized}"`);}
    }
    
    // Join sockets to random room first
    userSockets1.forEach(socket => {
      socket.join(`random-room-${roomId}`);
      if (process.env.NODE_ENV === 'development') { console.log(`✓ Socket ${socket.id} (user ${userId1Str}) joined random-room-${roomId}`);}
    });
    userSockets2.forEach(socket => {
      socket.join(`random-room-${roomId}`);
      if (process.env.NODE_ENV === 'development') { console.log(`✓ Socket ${socket.id} (user ${userId2Str}) joined random-room-${roomId}`);}
    });
    
    // Small delay to ensure room joins are processed
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Emit to user rooms (primary method) - multiple times to ensure delivery
    const emitToRooms = () => {
      io.to(`user-${userId1Str}`).emit('connection-matched', connectionData);
      io.to(`user-${userId2Str}`).emit('connection-matched', connectionData);
    };
    
    // Immediate emit
    emitToRooms();
    
    // Emit directly to sockets as backup
    userSockets1.forEach(socket => {
      socket.emit('connection-matched', connectionData);
      if (process.env.NODE_ENV === 'development') { console.log(`  ✓ Direct emit to socket ${socket.id} (user ${userId1Str})`);}
    });
    userSockets2.forEach(socket => {
      socket.emit('connection-matched', connectionData);
      if (process.env.NODE_ENV === 'development') { console.log(`  ✓ Direct emit to socket ${socket.id} (user ${userId2Str})`);}
    });
    
    // CRITICAL: Multiple retry emits to ensure BOTH users receive the event
    // This is essential because one user might receive it but the other might miss it
    setTimeout(() => {
      if (process.env.NODE_ENV === 'development') { console.log(`📤 Retry emit #1 (500ms delay) - ensuring both users receive`);}
      emitToRooms();
      userSockets1.forEach(socket => socket.emit('connection-matched', connectionData));
      userSockets2.forEach(socket => socket.emit('connection-matched', connectionData));
    }, 500);
    
    setTimeout(() => {
      if (process.env.NODE_ENV === 'development') { console.log(`📤 Retry emit #2 (1000ms delay) - ensuring both users receive`);}
      emitToRooms();
      userSockets1.forEach(socket => socket.emit('connection-matched', connectionData));
      userSockets2.forEach(socket => socket.emit('connection-matched', connectionData));
    }, 1000);
    
    setTimeout(() => {
      if (process.env.NODE_ENV === 'development') { console.log(`📤 Retry emit #3 (2000ms delay) - ensuring both users receive`);}
      emitToRooms();
      userSockets1.forEach(socket => socket.emit('connection-matched', connectionData));
      userSockets2.forEach(socket => socket.emit('connection-matched', connectionData));
    }, 2000);
    
    setTimeout(() => {
      if (process.env.NODE_ENV === 'development') { console.log(`📤 Retry emit #4 (3000ms delay) - ensuring both users receive`);}
      emitToRooms();
      userSockets1.forEach(socket => socket.emit('connection-matched', connectionData));
      userSockets2.forEach(socket => socket.emit('connection-matched', connectionData));
    }, 3000);
    
    // Final retry after 5 seconds
    setTimeout(() => {
      if (process.env.NODE_ENV === 'development') { console.log(`📤 Final retry emit #5 (5000ms delay) - ensuring both users receive`);}
      emitToRooms();
      userSockets1.forEach(socket => socket.emit('connection-matched', connectionData));
      userSockets2.forEach(socket => socket.emit('connection-matched', connectionData));
    }, 5000);
    
    // Also emit to random room as backup (users will join this room when they get the event)
    io.to(`random-room-${roomId}`).emit('connection-matched', connectionData);
    if (process.env.NODE_ENV === 'development') { console.log(`📤 Also emitted to random-room-${roomId}`);
    }
    // CRITICAL: Also join sockets from rooms to random room (in case they're in room but not found directly)
    if (room1 && room1.size > 0) {
      room1.forEach(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.connected) {
          socket.join(`random-room-${roomId}`);
          socket.emit('connection-matched', connectionData);
          if (process.env.NODE_ENV === 'development') { console.log(`  ✓ Emitted to socket ${socketId} from room (user ${userId1Str})`);}
        }
      });
    }
    
    if (room2 && room2.size > 0) {
      room2.forEach(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.connected) {
          socket.join(`random-room-${roomId}`);
          socket.emit('connection-matched', connectionData);
          if (process.env.NODE_ENV === 'development') { console.log(`  ✓ Emitted to socket ${socketId} from room (user ${userId2Str})`);}
        }
      });
    }
    
    // Log warnings if no sockets found
    if (userSockets1.length === 0 && (!room1 || room1.size === 0)) {
      console.warn(`⚠️ No sockets found for user ${userId1Str} - event sent to room only`);
      console.warn(`   User will receive event via fallback check or when socket connects`);
    }
    if (userSockets2.length === 0 && (!room2 || room2.size === 0)) {
      console.warn(`⚠️ No sockets found for user ${userId2Str} - event sent to room only`);
      console.warn(`   User will receive event via fallback check or when socket connects`);
    }
    
    // Important: Even if no sockets found, the event is sent to user rooms
    // Frontend fallback check will pick it up via current-connection API
    if (process.env.NODE_ENV === 'development') { console.log(`✅ Connection-matched event emitted via multiple channels for BOTH users`);}
  } catch (error) {
    log.error('❌ Error emitting connection-matched event:', { error: String(error) });
  }
};

// Clean up existing connections for a user
const cleanupExistingConnections = async (userId, io) => {
  try {
    const activeConnection = await RandomConnection.findOne({
      'participants.userId': userId,
      status: { $in: ['waiting', 'active'] }
    });

    if (activeConnection) {
      if (process.env.NODE_ENV === 'development') { console.log(`Cleaning up existing connection for user ${userId}`);
      }
      activeConnection.status = 'disconnected';
      activeConnection.endTime = new Date();
      activeConnection.duration = Math.floor((activeConnection.endTime - activeConnection.startTime) / 1000);
      
      const participant = activeConnection.participants.find(p => p.userId.toString() === userId.toString());
      if (participant) {
        participant.leftAt = new Date();
      }

      await activeConnection.save();

      // Notify other participants
      if (io) {
        const userIdStr = userId.toString();
        const otherParticipants = activeConnection.participants.filter(p => p.userId.toString() !== userIdStr);
        otherParticipants.forEach(participant => {
          const participantUserIdStr = participant.userId.toString();
          io.to(`user-${participantUserIdStr}`).emit('partner-disconnected', {
            roomId: activeConnection.roomId,
            disconnectedUserId: userIdStr,
            reason: 'User left'
          });
        });
      }
    }

    // Remove user from any existing queue entries
    await ConnectionQueue.deleteMany({ userId });
    
  } catch (error) {
    log.error('Cleanup existing connections error:', { error: String(error) });
  }
};

// Leave the queue
const leaveQueue = async (req, res) => {
  try {
    const userId = req.user._id;

    if (process.env.NODE_ENV === 'development') { console.log(`User ${userId} leaving queue`);
}
    const result = await ConnectionQueue.deleteOne({
      userId,
      status: 'waiting'
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'You are not in the queue'
      });
    }

    if (process.env.NODE_ENV === 'development') { console.log(`User ${userId} successfully left queue`);
}
    res.status(200).json({
      success: true,
      message: 'Left the queue successfully'
    });

  } catch (error) {
    log.error('Leave queue error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to leave queue',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get current connection - SIMPLE, return 200 with success:false instead of 404
const getCurrentConnection = async (req, res) => {
  try {
    const userId = req.user._id;

    const connection = await RandomConnection.findOne({
      'participants.userId': userId,
      status: { $in: ['waiting', 'active'] }
    }).populate('participants.userId', 'username profile.displayName profile.avatar');

    if (!connection) {
      return res.status(200).json({
        success: false,
        message: 'No active connection found'
      });
    }

    const connectionObj = connection.toObject ? connection.toObject() : connection;
    connectionObj.sessionId = connectionObj.roomId;
    if (connectionObj.participants) {
      connectionObj.participants = connectionObj.participants.map(p => ({
        ...p,
        userId: (p.userId && p.userId._id ? p.userId._id : p.userId).toString()
      }));
    }

    res.status(200).json({
      success: true,
      connection: connectionObj
    });

  } catch (error) {
    log.error('Get current connection error:', { error: String(error) });
    res.status(200).json({
      success: false,
      message: 'Failed to get current connection',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Disconnect from current connection
const disconnectConnection = async (req, res) => {
  try {
    const userId = req.user._id;
    const { roomId } = req.body;

    if (process.env.NODE_ENV === 'development') { console.log(`User ${userId} disconnecting from room ${roomId}`);
}
    const connection = await RandomConnection.findOne({
      roomId,
      'participants.userId': userId,
      status: { $in: ['waiting', 'active'] }
    });

    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found'
      });
    }

    // Update connection status
    connection.status = 'disconnected';
    connection.endTime = new Date();
    connection.duration = Math.floor((connection.endTime - connection.startTime) / 1000);
    
    const participant = connection.participants.find(p => p.userId.toString() === userId.toString());
    if (participant) {
      participant.leftAt = new Date();
    }

    await connection.save();

    // Notify other participants
    const io = req.app.get('io');
    if (io) {
      const userIdStr = userId.toString();
      const otherParticipants = connection.participants.filter(p => p.userId.toString() !== userIdStr);
      otherParticipants.forEach(participant => {
        const participantUserIdStr = participant.userId.toString();
        io.to(`user-${participantUserIdStr}`).emit('partner-disconnected', {
          roomId,
          disconnectedUserId: userIdStr,
          reason: 'User disconnected'
        });
      });
    }

    res.status(200).json({
      success: true,
      message: 'Disconnected successfully'
    });

  } catch (error) {
    log.error('Disconnect error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to disconnect',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Send message in random connection
const sendMessage = async (req, res) => {
  try {
    const userId = req.user._id;
    const { roomId, message } = req.body;

    if (!message || !roomId) {
      return res.status(400).json({
        success: false,
        message: 'Room ID and message are required'
      });
    }

    const connection = await RandomConnection.findOne({
      roomId,
      'participants.userId': userId,
      status: { $in: ['waiting', 'active'] }
    });

    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found'
      });
    }

    // Add message to connection
    connection.messages.push({
      sender: userId,
      message,
      timestamp: new Date()
    });

    await connection.save();

    // Emit message to other participants - multiple methods for reliability
    const io = req.app.get('io');
    if (io) {
      const userIdStr = userId.toString();
      const roomIdStr = String(roomId);
      const getParticipantId = (p) => (p.userId && p.userId._id ? p.userId._id : p.userId).toString();
      const otherParticipants = connection.participants.filter(p => getParticipantId(p) !== userIdStr);

      const messageData = {
        roomId: roomIdStr,
        sender: userIdStr,
        message,
        timestamp: new Date()
      };

      // Method 1: Emit to user rooms (primary)
      otherParticipants.forEach(participant => {
        const participantUserIdStr = getParticipantId(participant);
        io.to(`user-${participantUserIdStr}`).emit('random-connection-message', messageData);
        if (process.env.NODE_ENV === 'development') { console.log(`📤 Message emitted to user-${participantUserIdStr}`);}
      });

      // Method 2: Emit to random room (backup)
      io.to(`random-room-${roomIdStr}`).emit('random-connection-message', messageData);
      if (process.env.NODE_ENV === 'development') { console.log(`📤 Message emitted to random-room-${roomIdStr}`);
}
      // Method 3: Direct socket emit (fallback)
      const allSockets = Array.from(io.sockets.sockets.values());
      otherParticipants.forEach(participant => {
        const participantUserIdStr = getParticipantId(participant);
        const userSockets = allSockets.filter(s => String(s.authUser?.userId ?? '') === participantUserIdStr);
        userSockets.forEach(sock => {
          sock.emit('random-connection-message', messageData);
          if (process.env.NODE_ENV === 'development') { console.log(`📤 Direct message emit to socket ${sock.id}`);}
        });
      });
    }

    res.status(200).json({
      success: true,
      message: 'Message sent successfully'
    });

  } catch (error) {
    log.error('Send message error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Cleanup current connection (used when user refreshes or navigates away)
const cleanupCurrentConnection = async (req, res) => {
  try {
    const userId = req.user._id;
    if (process.env.NODE_ENV === 'development') { console.log(`Cleaning up current connection for user ${userId}`);
}
    const activeConnection = await RandomConnection.findOne({
      'participants.userId': userId,
      status: { $in: ['waiting', 'active'] }
    });

    if (activeConnection) {
      if (process.env.NODE_ENV === 'development') { console.log(`Found active connection ${activeConnection.roomId} for user ${userId}`);
      }
      activeConnection.status = 'disconnected';
      activeConnection.endTime = new Date();
      activeConnection.duration = Math.floor((activeConnection.endTime - activeConnection.startTime) / 1000);
      
      const participant = activeConnection.participants.find(p => p.userId.toString() === userId.toString());
      if (participant) {
        participant.leftAt = new Date();
      }

      await activeConnection.save();

      // Notify other participants
      const io = req.app.get('io');
      if (io) {
        const userIdStr = userId.toString();
        const otherParticipants = activeConnection.participants.filter(p => p.userId.toString() !== userIdStr);
        otherParticipants.forEach(participant => {
          const participantUserIdStr = participant.userId.toString();
          io.to(`user-${participantUserIdStr}`).emit('partner-disconnected', {
            roomId: activeConnection.roomId,
            disconnectedUserId: userIdStr,
            reason: 'User left'
          });
        });
      }

      if (process.env.NODE_ENV === 'development') { console.log(`Connection ${activeConnection.roomId} cleaned up for user ${userId}`);}
    }

    // Remove user from any queue
    await ConnectionQueue.deleteMany({ userId });

    res.status(200).json({
      success: true,
      message: 'Connection cleaned up successfully'
    });

  } catch (error) {
    log.error('Cleanup current connection error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup connection',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// List active sessions for monitoring (each session has unique sessionId = roomId)
const getActiveSessions = async (req, res) => {
  try {
    const sessions = await RandomConnection.find({ status: 'active' })
      .select('roomId startTime participants.username participants.displayName tags')
      .lean();

    const list = sessions.map(s => ({
      sessionId: s.roomId,
      roomId: s.roomId,
      usernames: (s.participants || []).map(p => p.username || p.displayName || '?').filter(Boolean),
      startedAt: s.startTime,
      tags: s.tags || []
    }));

    res.status(200).json({
      success: true,
      sessions: list,
      count: list.length
    });
  } catch (error) {
    log.error('Get active sessions error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to get active sessions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get remaining daily gender-filter matches (for free users: Male/Female filter = 5/day)
const getDailyGenderMatchesRemaining = async (req, res) => {
  try {
    const userId = req.user._id;
    const isPremium = isPremiumUser(req.user);
    const limit = FREE_DAILY_MATCH_LIMIT;

    if (isPremium) {
      return res.status(200).json({
        success: true,
        used: 0,
        limit,
        remaining: limit,
        isPremium: true
      });
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const used = await RandomConnection.countDocuments({
      'participants.userId': userId,
      status: { $in: ['active', 'disconnected', 'ended'] },
      startTime: { $gte: startOfToday },
      usedGenderFilter: true
    });
    const remaining = Math.max(0, limit - used);

    res.status(200).json({
      success: true,
      used,
      limit,
      remaining,
      isPremium: false
    });
  } catch (error) {
    log.error('Get daily gender matches remaining error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to get remaining matches',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  joinQueue,
  leaveQueue,
  getCurrentConnection,
  getActiveSessions,
  getDailyGenderMatchesRemaining,
  disconnectConnection,
  sendMessage,
  cleanupCurrentConnection,
  matchUsersFromQueue
};
