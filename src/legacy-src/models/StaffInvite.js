const mongoose = require('mongoose');
const {
  INVITE_STATUSES,
  STAFF_GAMES,
  TEAM_INVITE_TTL_MS,
  TEAM_ROLE_MAX_LENGTH,
  buildPendingInviteKey,
  isValidTeamRole
} = require('../utils/teamInvitationPolicy');

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
    enum: STAFF_GAMES,
    required: true
  },
  role: {
    type: String,
    trim: true,
    maxlength: TEAM_ROLE_MAX_LENGTH,
    validate: {
      validator: isValidTeamRole,
      message: `Role must be between 1 and ${TEAM_ROLE_MAX_LENGTH} characters`
    },
    required: true
  },
  status: {
    type: String,
    enum: INVITE_STATUSES,
    default: 'pending'
  },
  message: String,
  pendingKey: {
    type: String,
    select: false
  },
  respondedAt: Date,
  expiresAt: {
    type: Date,
    default: function() {
      return new Date(Date.now() + TEAM_INVITE_TTL_MS);
    }
  }
}, {
  timestamps: true
});

staffInviteSchema.pre('validate', function() {
  this.pendingKey = this.status === 'pending'
    ? buildPendingInviteKey({ type: 'staff', team: this.team, player: this.player, game: this.game })
    : undefined;
});

// Indexes enforce one live invite per team/player/game even under concurrent requests.
staffInviteSchema.index({ team: 1, player: 1, game: 1, status: 1 });
staffInviteSchema.index({ player: 1, status: 1 });
staffInviteSchema.index(
  { pendingKey: 1 },
  { unique: true, sparse: true, name: 'uniq_pending_staff_invite' }
);
staffInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('StaffInvite', staffInviteSchema);
