const mongoose = require('mongoose');

const rosterInviteSchema = new mongoose.Schema({
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  player: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  game: {
    type: String,
    enum: ['BGMI', 'Valorant', 'Free Fire', 'Call of Duty Mobile'],
    required: true
  },
  role: {
    type: String,
    enum: [
      // General roles
      'Captain', 'Player', 'Substitute', 'Coach', 'Manager',
      // BGMI roles
      'IGL', 'Assaulter', 'Support', 'Sniper', 'Fragger',
      // Valorant roles
      'Duelist', 'Controller', 'Initiator', 'Sentinel',
      // Free Fire roles
      'Rusher',
      // Call of Duty Mobile roles
      'Assault'
    ],
    default: 'Player'
  },
  inGameName: String,
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined', 'cancelled'],
    default: 'pending'
  },
  message: String,
  expiresAt: {
    type: Date,
    default: function() {
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
    }
  }
}, {
  timestamps: true
});

// Index for efficient queries
rosterInviteSchema.index({ team: 1, player: 1, game: 1, status: 1 });
rosterInviteSchema.index({ player: 1, status: 1 });
rosterInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RosterInvite', rosterInviteSchema);
