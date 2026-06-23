const mongoose = require('mongoose');

const staffInviteSchema = new mongoose.Schema({
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
    enum: ['BGMI', 'Valorant', 'Free Fire', 'Call of Duty Mobile', 'General'],
    required: true
  },
  role: {
    type: String,
    enum: ['Owner', 'Manager', 'Coach', 'Analyst', 'Content Creator'],
    required: true
  },
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
staffInviteSchema.index({ team: 1, player: 1, game: 1, status: 1 });
staffInviteSchema.index({ player: 1, status: 1 });
staffInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('StaffInvite', staffInviteSchema);
