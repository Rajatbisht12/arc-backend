const mongoose = require('mongoose');

const storySchema = new mongoose.Schema({
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  media: {
    type: {
      type: String,
      enum: ['image', 'video'],
      required: true
    },
    url: { type: String, required: true, trim: true },
    publicId: { type: String, required: true, trim: true }
  },
  clientUploadId: {
    type: String,
    trim: true,
    select: false
  },
  duration: {
    type: Number,
    default: 30,
    min: 1,
    max: 30
  },
  views: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    viewedAt: { type: Date, default: Date.now }
  }],
  music: {
    sourceType: {
      type: String,
      enum: ['library', 'user_upload'],
      default: 'library'
    },
    trackId: { type: String, trim: true },
    audioId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserAudio', default: null },
    title: { type: String, trim: true, default: '' },
    artist: { type: String, trim: true, default: '' },
    url: { type: String, trim: true },
    coverUrl: { type: String, trim: true, default: '' },
    publicId: { type: String, trim: true },
    filename: { type: String, trim: true },
    mimeType: {
      type: String,
      enum: [
        'audio/mpeg',
        'audio/mp3',
        'audio/mp4',
        'audio/aac',
        'audio/x-aac',
        'audio/m4a',
        'audio/x-m4a',
        'audio/wav',
        'audio/x-wav',
        'audio/wave',
        'audio/vnd.wave',
        'audio/ogg',
        'application/ogg',
        'audio/flac',
        'audio/x-flac',
      ],
      trim: true,
    },
    size: { type: Number, min: 1 },
    duration: { type: Number, min: 0.01 },
    startTime: { type: Number, min: 0, default: 0 },
    endTime: { type: Number, min: 0 },
    playbackDuration: { type: Number, min: 0.01, max: 30 },
    copyrightConfirmedAt: { type: Date, default: null }
  }
}, { timestamps: true });

storySchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 }); // TTL: delete after 24 hours
storySchema.index({ author: 1, createdAt: -1 });
storySchema.index(
  { author: 1, clientUploadId: 1 },
  { unique: true, sparse: true, partialFilterExpression: { clientUploadId: { $type: 'string' } } }
);

module.exports = mongoose.model('Story', storySchema);
