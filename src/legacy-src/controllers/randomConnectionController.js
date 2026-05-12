const User = require('../models/User');
const RandomConnection = require('../models/RandomConnection');
const ConnectionQueue = require('../models/ConnectionQueue');
const { v4: uuidv4 } = require('uuid');
const log = require('../utils/logger');

// Join the random connection queue
const joinQueue = async (req, res) => {
  try {
    const { selectedGame, videoEnabled = true, preferredGender, tags } = req.body;
    const userId = req.user._id;

    // Validate input - selectedGame is optional for random matching
    if (selectedGame === undefined) {
      // Allow null/empty selectedGame for "any game" matching
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    if (process.env.NODE_ENV === 'development') { console.log(`User ${userId} attempting to join queue for ${selectedGame}`);
}
    // Clean up any existing connections first
    await cleanupExistingConnections(userId, req.app.get('io'));

    // Check if user is already in queue
    const existingInQueue = await ConnectionQueue.findOne({
      userId,
      status: 'waiting'
    });

    if (existingInQueue) {
      if (process.env.NODE_ENV === 'development') { console.log(`User ${userId} already in queue, updating preferences`);}
      existingInQueue.selectedGame = selectedGame;
      existingInQueue.videoEnabled = videoEnabled;
      if (preferredGender) existingInQueue.preferredGender = preferredGender;
      if (tags) existingInQueue.tags = tags;
      existingInQueue.updatedAt = new Date();
      await existingInQueue.save();
    } else {
      // Get user's gender from profile
      const userDoc = await User.findById(userId).select('profile.gender');
      const userGender = userDoc?.profile?.gender || '';
      // Add user to queue
      await ConnectionQueue.create({
        userId,
        username: req.user.username,
        displayName: req.user.profile.displayName,
        avatar: req.user.profile.avatar,
        selectedGame,
        videoEnabled,
        gender: userGender,
        ...(preferredGender && { preferredGender }),
        ...(tags && { tags })
      });
      if (process.env.NODE_ENV === 'development') { console.log(`User ${userId} added to queue for game ${selectedGame}`);}
    }

    // Try to find a match immediately
    const match = await findMatch(userId, selectedGame, preferredGender);
    
    if (match) {
      if (process.env.NODE_ENV === 'development') { console.log(`Instant match found for ${userId} with ${match.userId}`);
      }
      // Create connection immediately
      const roomId = uuidv4();
      const connection = await RandomConnection.create({
        roomId,
        participants: [
          {
            userId,
            username: req.user.username,
            displayName: req.user.profile.displayName,
            avatar: req.user.profile.avatar,
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
        selectedGame,
        status: 'active',
        createdBy: userId
      });

      if (process.env.NODE_ENV === 'development') { console.log(`Connection created with room ID: ${roomId}`);
}
      // Remove both users from queue
      await ConnectionQueue.deleteMany({
        userId: { $in: [userId, match.userId] }
      });

      // Prepare connection data
      const connectionData = {
        roomId: connection.roomId,
        participants: [
          {
            userId,
            username: req.user.username,
            displayName: req.user.profile.displayName,
            avatar: req.user.profile.avatar,
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
        selectedGame
      };

      // Emit socket events for both users with retry mechanism
      const io = req.app.get('io');
      if (io) {
        // Convert userIds to strings for room names (ensure consistency)
        const userIdStr = userId.toString();
        const matchUserIdStr = match.userId.toString();
        
        const connectionData = {
          roomId: connection.roomId,
          participants: [
            {
              userId: userIdStr,
              username: req.user.username,
              displayName: req.user.profile.displayName,
              avatar: req.user.profile.avatar,
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
          selectedGame
        };
        
        // Function to emit connection-matched event with retry logic
        const emitConnectionMatched = (retryCount = 0, maxRetries = 10) => {
          const allSockets = Array.from(io.sockets.sockets.values());
          
          // Find sockets for both users
          const userSockets1 = allSockets.filter(s => {
            if (!s.userId) return false;
            const socketUserIdStr = s.userId.toString();
            return socketUserIdStr === userIdStr || 
                   socketUserIdStr === userId.toString() ||
                   String(socketUserIdStr) === String(userIdStr);
          });
          
          const userSockets2 = allSockets.filter(s => {
            if (!s.userId) return false;
            const socketUserIdStr = s.userId.toString();
            return socketUserIdStr === matchUserIdStr || 
                   socketUserIdStr === match.userId.toString() ||
                   String(socketUserIdStr) === String(matchUserIdStr);
          });
          
          // Check room sizes
          const userRoom1 = io.sockets.adapter.rooms.get(`user-${userIdStr}`);
          const userRoom2 = io.sockets.adapter.rooms.get(`user-${matchUserIdStr}`);
          const room1Size = userRoom1?.size || 0;
          const room2Size = userRoom2?.size || 0;
          
          if (process.env.NODE_ENV === 'development') { console.log(`📤 Emit attempt ${retryCount + 1}/${maxRetries + 1}: Found ${userSockets1.length} socket(s) for user ${userIdStr} (room size: ${room1Size})`);}
          if (process.env.NODE_ENV === 'development') { console.log(`📤 Emit attempt ${retryCount + 1}/${maxRetries + 1}: Found ${userSockets2.length} socket(s) for user ${matchUserIdStr} (room size: ${room2Size})`);
          }
          // If sockets are found or rooms have sockets, emit immediately
          if ((userSockets1.length > 0 || room1Size > 0) && (userSockets2.length > 0 || room2Size > 0)) {
            if (process.env.NODE_ENV === 'development') { console.log(`✅ Sockets available, emitting connection-matched event`);
            }
            // Emit to user rooms (most reliable method)
            io.to(`user-${userIdStr}`).emit('connection-matched', connectionData);
            io.to(`user-${matchUserIdStr}`).emit('connection-matched', connectionData);
            
            // Also emit directly to sockets if found (as backup)
            userSockets1.forEach(socket => {
              socket.emit('connection-matched', connectionData);
              socket.join(`random-room-${connection.roomId}`);
              if (process.env.NODE_ENV === 'development') { console.log(`✓ Socket ${socket.id} (user ${userIdStr}) joined random-room-${connection.roomId}`);}
            });
            
            userSockets2.forEach(socket => {
              socket.emit('connection-matched', connectionData);
              socket.join(`random-room-${connection.roomId}`);
              if (process.env.NODE_ENV === 'development') { console.log(`✓ Socket ${socket.id} (user ${matchUserIdStr}) joined random-room-${connection.roomId}`);}
            });
            
            // Also join sockets that are in user rooms but not found directly
            if (userRoom1 && userRoom1.size > 0) {
              userRoom1.forEach(socketId => {
                const socket = io.sockets.sockets.get(socketId);
                if (socket && !userSockets1.includes(socket)) {
                  socket.join(`random-room-${connection.roomId}`);
                  if (process.env.NODE_ENV === 'development') { console.log(`✓ Socket ${socket.id} from room (user ${userIdStr}) joined random-room-${connection.roomId}`);}
                }
              });
            }
            
            if (userRoom2 && userRoom2.size > 0) {
              userRoom2.forEach(socketId => {
                const socket = io.sockets.sockets.get(socketId);
                if (socket && !userSockets2.includes(socket)) {
                  socket.join(`random-room-${connection.roomId}`);
                  if (process.env.NODE_ENV === 'development') { console.log(`✓ Socket ${socket.id} from room (user ${matchUserIdStr}) joined random-room-${connection.roomId}`);}
                }
              });
            }
            
            if (process.env.NODE_ENV === 'development') { console.log(`✅ Connection-matched event emitted successfully`);
            }
            // Emit redundant events after delays to ensure delivery
            setTimeout(() => {
              io.to(`user-${userIdStr}`).emit('connection-matched', connectionData);
              io.to(`user-${matchUserIdStr}`).emit('connection-matched', connectionData);
              if (process.env.NODE_ENV === 'development') { console.log(`📤 Second emit (redundancy) to user-${userIdStr} and user-${matchUserIdStr}`);}
            }, 1000);
            
            setTimeout(() => {
              io.to(`user-${userIdStr}`).emit('connection-matched', connectionData);
              io.to(`user-${matchUserIdStr}`).emit('connection-matched', connectionData);
              if (process.env.NODE_ENV === 'development') { console.log(`📤 Third emit (final redundancy) to user-${userIdStr} and user-${matchUserIdStr}`);}
            }, 3000);
            
          } else if (retryCount < maxRetries) {
            // Retry after delay if sockets not found yet
            if (process.env.NODE_ENV === 'development') { console.log(`⏳ No sockets found yet, retrying in 500ms... (attempt ${retryCount + 1}/${maxRetries})`);}
            setTimeout(() => {
              emitConnectionMatched(retryCount + 1, maxRetries);
            }, 500);
          } else {
            // Max retries reached, emit anyway (sockets might connect later)
            console.warn(`⚠️ Max retries reached, emitting to rooms anyway (sockets may connect later)`);
            io.to(`user-${userIdStr}`).emit('connection-matched', connectionData);
            io.to(`user-${matchUserIdStr}`).emit('connection-matched', connectionData);
            
            // Log warning
            if (userSockets1.length === 0) {
              console.warn(`⚠️ No sockets found for user ${userIdStr}. Room user-${userIdStr} has ${room1Size} socket(s) - event sent to room only`);
            }
            if (userSockets2.length === 0) {
              console.warn(`⚠️ No sockets found for user ${matchUserIdStr}. Room user-${matchUserIdStr} has ${room2Size} socket(s) - event sent to room only`);
            }
          }
        };
        
        // Start emitting with retry logic
        emitConnectionMatched();
      }

      // Return response with connection data
      // Include string userIds in response for frontend consistency
      const responseData = {
        success: true,
        message: 'Connection established!',
        connection: {
          ...connection.toObject(),
          participants: connection.participants.map(p => ({
            ...p,
            userId: p.userId.toString()
          }))
        },
        matched: true,
        roomId: connection.roomId
      };
      
      if (process.env.NODE_ENV === 'development') { console.log(`✅ Connection established. Response sent with roomId: ${connection.roomId}`);
      }
      return res.status(200).json(responseData);
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

// Clean up existing connections for a user
const cleanupExistingConnections = async (userId, io) => {
  try {
    // Check if user is already in an active connection
    const activeConnection = await RandomConnection.findOne({
      'participants.userId': userId,
      status: { $in: ['waiting', 'active'] }
    });

    if (activeConnection) {
      if (process.env.NODE_ENV === 'development') { console.log(`Cleaning up existing connection for user ${userId}`);
      }
      // Update connection status
      activeConnection.status = 'disconnected';
      activeConnection.endTime = new Date();
      activeConnection.duration = Math.floor((activeConnection.endTime - activeConnection.startTime) / 1000);
      
      // Mark user as left
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

// Find a suitable match
const findMatch = async (userId, selectedGame, preferredGender) => {
  try {
    const query = {
      userId: { $ne: userId },
      status: 'waiting'
    };
    if (selectedGame) {
      query.selectedGame = selectedGame;
    }
    // Gender filter: match users who have the same preferredGender
    if (preferredGender) {
      query['preferredGender'] = preferredGender;
    }
    const potentialMatches = await ConnectionQueue.find(query).sort({ createdAt: 1 });

    if (potentialMatches.length > 0) {
      // Return the first available match (FIFO)
      const match = potentialMatches[0];
      if (process.env.NODE_ENV === 'development') { console.log(`Matched user ${userId} with ${match.userId} for ${selectedGame}`);
      }
      return {
        userId: match.userId,
        username: match.username,
        displayName: match.displayName,
        avatar: match.avatar,
        videoEnabled: match.videoEnabled
      };
    }

    return null;
  } catch (error) {
    log.error('Find match error:', { error: String(error) });
    return null;
  }
};

// Leave the queue
const leaveQueue = async (req, res) => {
  try {
    const userId = req.user._id;

    if (process.env.NODE_ENV === 'development') { console.log(`User ${userId} leaving queue`);
}
    // Remove user from queue
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

// Get current connection
const getCurrentConnection = async (req, res) => {
  try {
    const userId = req.user._id;

    const connection = await RandomConnection.findOne({
      'participants.userId': userId,
      status: { $in: ['waiting', 'active'] }
    }).populate('participants.userId', 'username profile.displayName profile.avatar');

    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'No active connection found'
      });
    }

    res.status(200).json({
      success: true,
      connection
    });

  } catch (error) {
    log.error('Get current connection error:', { error: String(error) });
    res.status(500).json({
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
    
    // Mark user as left
    const participant = connection.participants.find(p => p.userId.toString() === userId.toString());
    if (participant) {
      participant.leftAt = new Date();
    }

    await connection.save();
    if (process.env.NODE_ENV === 'development') { console.log(`Connection ${roomId} marked as disconnected for user ${userId}`);
}
    // Get other participants before cleanup
    const userIdStr = userId.toString();
    const otherParticipants = connection.participants.filter(p => p.userId.toString() !== userIdStr);

    // Notify other participants immediately
    const io = req.app.get('io');
    if (io) {
      otherParticipants.forEach(participant => {
        const participantUserIdStr = participant.userId.toString();
        if (process.env.NODE_ENV === 'development') { console.log(`Notifying user ${participantUserIdStr} about disconnect`);}
        io.to(`user-${participantUserIdStr}`).emit('partner-disconnected', {
          roomId,
          disconnectedUserId: userIdStr,
          reason: 'User disconnected'
        });
        
        // Debug: Check if user room exists
        const userRoom = io.sockets.adapter.rooms.get(`user-${participantUserIdStr}`);
        if (process.env.NODE_ENV === 'development') { console.log(`User room user-${participantUserIdStr} has ${userRoom?.size || 0} socket(s)`);
}
        // Auto-rejoin remaining user to queue with better error handling
        setTimeout(async () => {
          try {
            if (process.env.NODE_ENV === 'development') { console.log(`Auto-rejoining user ${participant.userId} to queue after disconnect`);
            }
            // Check if user is already in queue to prevent duplicates
            const existingQueueEntry = await ConnectionQueue.findOne({
              userId: participant.userId,
              status: 'waiting'
            });
            
            if (existingQueueEntry) {
              if (process.env.NODE_ENV === 'development') { console.log(`User ${participant.userId} already in queue, skipping auto-rejoin`);}
              return;
            }
            
            // Get user data for re-queue
            const user = await User.findById(participant.userId);
            if (!user) {
              console.error(`User ${participant.userId} not found for auto-rejoin`);
              return;
            }

            // Add user back to queue with camera OFF by default
            await ConnectionQueue.create({
              userId: participant.userId,
              username: user.username,
              displayName: user.profile.displayName,
              avatar: user.profile.avatar,
              selectedGame: connection.selectedGame,
              videoEnabled: false // Camera off by default after disconnect
            });

            if (process.env.NODE_ENV === 'development') { console.log(`User ${participant.userId} automatically added back to queue for ${connection.selectedGame}`);
}
            // Try to find a new match immediately
            const newMatch = await findMatch(participant.userId, connection.selectedGame);
            
            if (newMatch) {
              if (process.env.NODE_ENV === 'development') { console.log(`Auto-match found for ${participant.userId} with ${newMatch.userId}`);
              }
              // Create new connection
              const newRoomId = uuidv4();
              const newConnection = await RandomConnection.create({
                roomId: newRoomId,
                participants: [
                  {
                    userId: participant.userId,
                    username: user.username,
                    displayName: user.profile.displayName,
                    avatar: user.profile.avatar,
                    videoEnabled: participant.videoEnabled
                  },
                  {
                    userId: newMatch.userId,
                    username: newMatch.username,
                    displayName: newMatch.displayName,
                    avatar: newMatch.avatar,
                    videoEnabled: newMatch.videoEnabled
                  }
                ],
                selectedGame: connection.selectedGame,
                status: 'active',
                startTime: new Date()
              });

              // Remove both users from queue
              await ConnectionQueue.deleteMany({
                userId: { $in: [participant.userId, newMatch.userId] }
              });

              // Notify both users about new connection
              const participantUserIdStr = participant.userId.toString();
              const newMatchUserIdStr = newMatch.userId.toString();
              
              const autoRejoinConnectionData = {
                roomId: newConnection.roomId,
                participants: [
                  {
                    userId: participantUserIdStr,
                    username: user.username,
                    displayName: user.profile.displayName,
                    avatar: user.profile.avatar,
                    videoEnabled: participant.videoEnabled
                  },
                  {
                    userId: newMatchUserIdStr,
                    username: newMatch.username,
                    displayName: newMatch.displayName,
                    avatar: newMatch.avatar,
                    videoEnabled: newMatch.videoEnabled
                  }
                ],
                selectedGame: connection.selectedGame
              };
              
              if (process.env.NODE_ENV === 'development') { console.log(`Auto-rejoin: Emitting connection-matched to user-${participantUserIdStr} and user-${newMatchUserIdStr}`);}
              io.to(`user-${participantUserIdStr}`).emit('connection-matched', autoRejoinConnectionData);
              io.to(`user-${newMatchUserIdStr}`).emit('connection-matched', autoRejoinConnectionData);

              if (process.env.NODE_ENV === 'development') { console.log(`Auto-connection ${newConnection.roomId} created successfully for ${participant.userId} and ${newMatch.userId}`);}
            } else {
              if (process.env.NODE_ENV === 'development') { console.log(`No immediate match found for ${participant.userId}, added to queue for future matching`);
              }
              // Notify user they're back in queue
              const participantUserIdStr = participant.userId.toString();
              io.to(`user-${participantUserIdStr}`).emit('rejoined-queue', {
                selectedGame: connection.selectedGame,
                message: 'Looking for next random user...'
              });
            }
          } catch (autoRejoinError) {
            console.error(`Error during auto-rejoin for user ${participant.userId}:`, autoRejoinError);
            // Don't retry auto-rejoin to prevent infinite loops
          }
        }, 2000); // Increased delay to ensure disconnect event is processed first
      });
    }

    if (process.env.NODE_ENV === 'development') { console.log(`User ${userId} disconnected from room ${roomId}, auto-queue initiated for remaining users`);
}
    res.status(200).json({
      success: true,
      message: 'Disconnected successfully, remaining users automatically queued for new matches'
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

// Auto-rejoin queue for remaining user when partner disconnects
const autoRejoinQueue = async (userId, selectedGame, videoEnabled, io) => {
  try {
    if (process.env.NODE_ENV === 'development') { console.log(`Auto-rejoining user ${userId} to queue for ${selectedGame}`);
    }
    // Check if user is already in queue to prevent duplicates
    const existingQueueEntry = await ConnectionQueue.findOne({
      userId,
      status: 'waiting'
    });
    
    if (existingQueueEntry) {
      if (process.env.NODE_ENV === 'development') { console.log(`User ${userId} already in queue, skipping auto-rejoin`);}
      return;
    }
    
    // Get user data first
    const user = await User.findById(userId);
    if (!user) {
      console.error(`User ${userId} not found for auto-rejoin`);
      return;
    }
    
    // Add user back to queue with camera OFF by default
    await ConnectionQueue.create({
      userId,
      username: user.username,
      displayName: user.profile.displayName,
      avatar: user.profile.avatar,
      selectedGame,
      videoEnabled: false // Camera off by default after disconnect
    });

    // Try to find a new match immediately
    const match = await findMatch(userId, selectedGame);
    
    if (match) {
      if (process.env.NODE_ENV === 'development') { console.log(`Auto-match found for ${userId} with ${match.userId}`);
      }
      // Create new connection
      const roomId = uuidv4();
      const connection = await RandomConnection.create({
        roomId,
        participants: [
          {
            userId,
            username: user.username,
            displayName: user.profile.displayName,
            avatar: user.profile.avatar,
            videoEnabled: false // Camera off by default after disconnect
          },
          {
            userId: match.userId,
            username: match.username,
            displayName: match.displayName,
            avatar: match.avatar,
            videoEnabled: match.videoEnabled
          }
        ],
        selectedGame,
        status: 'active',
        createdBy: userId
      });

      // Remove both users from queue
      await ConnectionQueue.deleteMany({
        userId: { $in: [userId, match.userId] }
      });

      // Emit socket events
      if (io) {
        const userIdStr = userId.toString();
        const matchUserIdStr = match.userId.toString();
        
        const autoRejoinData = {
          roomId: connection.roomId,
          participants: [
            {
              userId: userIdStr,
              username: user.username,
              displayName: user.profile.displayName,
              avatar: user.profile.avatar,
              videoEnabled: false
            },
            {
              userId: matchUserIdStr,
              username: match.username,
              displayName: match.displayName,
              avatar: match.avatar,
              videoEnabled: match.videoEnabled
            }
          ],
          selectedGame
        };
        
        if (process.env.NODE_ENV === 'development') { console.log(`Auto-rejoin: Emitting connection-matched to user-${userIdStr} and user-${matchUserIdStr}`);}
        io.to(`user-${userIdStr}`).emit('connection-matched', autoRejoinData);
        io.to(`user-${matchUserIdStr}`).emit('connection-matched', autoRejoinData);
        
        // Join both users to the random room
        // Find all sockets for each user (in case of multiple connections)
        const userSockets1 = Array.from(io.sockets.sockets.values()).filter(s => 
          s.userId && s.userId.toString() === userId.toString()
        );
        const userSockets2 = Array.from(io.sockets.sockets.values()).filter(s => 
          s.userId && s.userId.toString() === match.userId.toString()
        );
        
        // Join all sockets for user 1 to the room
        userSockets1.forEach(socket => {
          socket.join(`random-room-${connection.roomId}`);
          if (process.env.NODE_ENV === 'development') { console.log(`Auto-rejoin: Socket ${socket.id} (user ${userId}) joined random-room-${connection.roomId}`);}
        });
        
        // Join all sockets for user 2 to the room
        userSockets2.forEach(socket => {
          socket.join(`random-room-${connection.roomId}`);
          if (process.env.NODE_ENV === 'development') { console.log(`Auto-rejoin: Socket ${socket.id} (user ${match.userId}) joined random-room-${connection.roomId}`);}
        });
        
        if (process.env.NODE_ENV === 'development') { console.log(`Auto-rejoin: Joined ${userSockets1.length} socket(s) for user ${userId} and ${userSockets2.length} socket(s) for user ${match.userId} to room ${connection.roomId}`);}
      }
    } else {
      // No immediate match, notify user they're back in queue
      if (io) {
        const userIdStr = userId.toString();
        if (process.env.NODE_ENV === 'development') { console.log(`Notifying user ${userIdStr} they're back in queue`);}
        io.to(`user-${userIdStr}`).emit('rejoined-queue', {
          selectedGame,
          message: 'Looking for next random user...'
        });
      }
    }
    
  } catch (error) {
    log.error('Auto-rejoin queue error:', { error: String(error) });
    // Don't retry to prevent infinite loops
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

    // Emit message to other participants
    const io = req.app.get('io');
    if (io) {
      const userIdStr = userId.toString();
      const otherParticipants = connection.participants.filter(p => p.userId.toString() !== userIdStr);
      otherParticipants.forEach(participant => {
        const participantUserIdStr = participant.userId.toString();
        io.to(`user-${participantUserIdStr}`).emit('random-connection-message', {
          roomId,
          sender: userIdStr,
          message,
          timestamp: new Date()
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

// Get connection history
const getConnectionHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10 } = req.query;

    const connections = await RandomConnection.find({
      'participants.userId': userId,
      status: { $in: ['ended', 'disconnected'] }
    })
    .populate('participants.userId', 'username profile.displayName profile.avatar')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

    const total = await RandomConnection.countDocuments({
      'participants.userId': userId,
      status: { $in: ['ended', 'disconnected'] }
    });

    res.status(200).json({
      success: true,
      connections,
      totalPages: Math.ceil(total / limit),
      currentPage: page
    });

  } catch (error) {
    log.error('Get connection history error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to get connection history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Cleanup all active connections for a user (used on logout)
const cleanupUserConnections = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find all active connections for the user
    const activeConnections = await RandomConnection.find({
      'participants.userId': userId,
      status: { $in: ['waiting', 'active'] }
    });

    // Update each connection and notify other participants
    for (const connection of activeConnections) {
      connection.status = 'disconnected';
      connection.endTime = new Date();
      connection.duration = Math.floor((connection.endTime - connection.startTime) / 1000);
      
      // Mark user as left
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
            roomId: connection.roomId,
            disconnectedUserId: userIdStr,
            reason: 'User logged out'
          });
        });
      }
    }

    // Remove user from any queue
    await ConnectionQueue.deleteMany({ userId });

    res.status(200).json({
      success: true,
      message: 'All connections cleaned up successfully',
      cleanedConnections: activeConnections.length
    });

  } catch (error) {
    log.error('Cleanup connections error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup connections'
    });
  }
};

// Debug endpoint to check queue status
const getQueueStatus = async (req, res) => {
  try {
    const queueEntries = await ConnectionQueue.find({ status: 'waiting' }).sort({ createdAt: 1 });
    const activeConnections = await RandomConnection.find({ status: 'active' });
    
    res.status(200).json({
      success: true,
      queueEntries: queueEntries.map(entry => ({
        userId: entry.userId,
        username: entry.username,
        selectedGame: entry.selectedGame,
        videoEnabled: entry.videoEnabled,
        createdAt: entry.createdAt
      })),
      activeConnections: activeConnections.map(conn => ({
        roomId: conn.roomId,
        participants: conn.participants.map(p => ({
          userId: p.userId,
          username: p.username
        })),
        selectedGame: conn.selectedGame,
        createdAt: conn.createdAt
      })),
      queueCount: queueEntries.length,
      activeConnectionCount: activeConnections.length
    });
  } catch (error) {
    log.error('Get queue status error:', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to get queue status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Cleanup user's current connection (used when user refreshes or navigates away)
const cleanupCurrentConnection = async (req, res) => {
  try {
    const userId = req.user._id;
    if (process.env.NODE_ENV === 'development') { console.log(`Cleaning up current connection for user ${userId}`);
}
    // Find and cleanup any active connections
    const activeConnection = await RandomConnection.findOne({
      'participants.userId': userId,
      status: { $in: ['waiting', 'active'] }
    });

    if (activeConnection) {
      if (process.env.NODE_ENV === 'development') { console.log(`Found active connection ${activeConnection.roomId} for user ${userId}`);
      }
      // Update connection status
      activeConnection.status = 'disconnected';
      activeConnection.endTime = new Date();
      activeConnection.duration = Math.floor((activeConnection.endTime - activeConnection.startTime) / 1000);
      
      // Mark user as left
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

module.exports = {
  joinQueue,
  leaveQueue,
  getCurrentConnection,
  disconnectConnection,
  sendMessage,
  getConnectionHistory,
  cleanupUserConnections,
  autoRejoinQueue,
  getQueueStatus,
  cleanupCurrentConnection
};
