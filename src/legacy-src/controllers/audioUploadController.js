const UserAudio = require('../models/UserAudio');
const { validateAudioUpload, resolveAudioMimeType, AUDIO_LIMITS } = require('../utils/audioPolicy');
const { uploadAudio, deleteFile } = require('../utils/cloudinary');
const { probeMediaDuration } = require('../utils/videoProcessing');

const AUDIO_FOLDER = 'gaming-social/audio/user-uploads';

// Bound a free-text field the client supplies; never trust it verbatim.
// Strips control characters (incl. newlines/DEL); keeps normal printable text.
const cleanText = (v, max = 200) =>
  (typeof v === 'string' ? v : '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, max);

// String 'true'/'1' (multipart form fields arrive as strings) or a real boolean.
const isTruthyFlag = (v) => v === true || v === 'true' || v === '1' || v === 1;

/**
 * Canonical audio payload returned to clients. Published content references
 * `id` (the UserAudio row) rather than a raw client URL. `streamUrl` mirrors
 * `url` for the current public-S3 setup; kept distinct so a future signed-URL
 * playback path can diverge without a contract change.
 */
const toAudioPayload = (doc) => ({
  id: String(doc._id),
  url: doc.url,
  streamUrl: doc.url,
  waveformUrl: doc.waveformUrl || '',
  title: doc.title || '',
  artistName: doc.artistName || '',
  duration: doc.duration || 0,
  mimeType: doc.mimeType || '',
  fileSize: doc.fileSize || 0,
  sourceType: doc.sourceType, // always 'user_upload'
  status: doc.status,
  copyrightConfirmedAt: doc.copyrightConfirmedAt || null,
});

/**
 * POST /api/music/upload  (auth required)
 * Multipart: field `music` = the audio file. Optional body: title, artistName,
 * duration (client-derived, seconds), copyrightConfirmed.
 *
 * Server is the authority: MIME + size are re-validated from the multer-parsed
 * upload (not the client's word), storage failure never leaves an orphaned row,
 * and the response is the canonical audio contract.
 */
const uploadUserAudio = async (req, res) => {
  try {
    const file = req.file;
    if (!file || !file.buffer || !file.buffer.length) {
      return res.status(400).json({ success: false, code: 'no_file', message: 'No audio file provided' });
    }

    // Server-side validation — allow-listed MIME + size first, then ffprobe-based
    // readability/duration verification. Extension is only a recovery path for
    // generic OS/browser MIME; ffprobe remains the actual-media authority.
    const resolvedMimeType = resolveAudioMimeType(file.originalname, file.mimetype);
    const metadataCheck = validateAudioUpload({
      mimeType: resolvedMimeType,
      size: file.size ?? file.buffer.length,
    });
    if (!metadataCheck.ok) {
      return res.status(400).json({ success: false, code: metadataCheck.code, message: metadataCheck.message });
    }

    let verifiedDurationSec;
    try {
      verifiedDurationSec = await probeMediaDuration(file);
    } catch (probeErr) {
      console.error('Audio duration probe failed:', probeErr?.message);
      return res.status(422).json({
        success: false,
        code: 'unreadable',
        message: 'Audio file could not be read',
      });
    }

    const durationCheck = validateAudioUpload({
      mimeType: resolvedMimeType,
      size: file.size ?? file.buffer.length,
      durationSec: verifiedDurationSec,
    });
    if (!durationCheck.ok) {
      return res.status(400).json({ success: false, code: durationCheck.code, message: durationCheck.message });
    }

    // Upload to storage first; only persist a row if storage succeeded, so a
    // storage failure can never orphan a DB record pointing nowhere.
    let stored;
    try {
      stored = await uploadAudio(
        { buffer: file.buffer, mimetype: resolvedMimeType, originalname: file.originalname },
        AUDIO_FOLDER
      );
    } catch (storageErr) {
      console.error('Audio upload to storage failed:', storageErr?.message);
      return res.status(502).json({ success: false, code: 'storage_failed', message: 'Upload failed. Try again' });
    }

    if (!stored || !stored.url) {
      return res.status(502).json({ success: false, code: 'storage_failed', message: 'Upload failed. Try again' });
    }

    let doc;
    try {
      doc = await UserAudio.create({
        owner: req.user._id,
        publicId: stored.publicId || '',
        url: stored.url,
        title: cleanText(req.body.title),
        artistName: cleanText(req.body.artistName),
        mimeType: resolvedMimeType,
        fileSize: file.size ?? file.buffer.length,
        duration: verifiedDurationSec || 0,
        sourceType: 'user_upload',
        status: 'ready',
        copyrightConfirmedAt: isTruthyFlag(req.body.copyrightConfirmed) ? new Date() : null,
      });
    } catch (dbErr) {
      // Persisting failed after the object landed in storage — clean up the
      // orphaned object so we don't leak storage. Best-effort.
      console.error('Persisting UserAudio failed:', dbErr?.message);
      if (stored.publicId) {
        deleteFile(stored.publicId).catch(() => {});
      }
      return res.status(500).json({ success: false, code: 'persist_failed', message: 'Upload failed. Try again' });
    }

    return res.status(201).json({ success: true, audio: toAudioPayload(doc) });
  } catch (err) {
    console.error('uploadUserAudio error:', err?.message);
    return res.status(500).json({ success: false, code: 'server_error', message: 'Upload failed. Try again' });
  }
};

/**
 * GET /api/music/upload/mine — the caller's own uploads (composer "recent" list).
 */
const listMyAudio = async (req, res) => {
  try {
    const docs = await UserAudio.find({ owner: req.user._id, removed: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(50);
    return res.json({ success: true, tracks: docs.map(toAudioPayload) });
  } catch (err) {
    console.error('listMyAudio error:', err?.message);
    return res.status(500).json({ success: false, message: 'Could not load your audio.' });
  }
};

/**
 * DELETE /api/music/upload/:id — owner-only soft removal (moderation/removal
 * path). Soft-delete keeps already-published posts resolvable while hiding the
 * source from reuse.
 */
const removeUserAudio = async (req, res) => {
  try {
    const doc = await UserAudio.findById(req.params.id);
    if (!doc || doc.removed) {
      return res.status(404).json({ success: false, message: 'Audio not found' });
    }
    if (String(doc.owner) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You can only remove your own audio' });
    }
    doc.removed = true;
    doc.removedAt = new Date();
    await doc.save();
    return res.json({ success: true });
  } catch (err) {
    console.error('removeUserAudio error:', err?.message);
    return res.status(500).json({ success: false, message: 'Could not remove audio.' });
  }
};

module.exports = { uploadUserAudio, listMyAudio, removeUserAudio, toAudioPayload, AUDIO_LIMITS };
