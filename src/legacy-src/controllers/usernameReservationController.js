const User = require('../models/User');
const UsernameRegistry = require('../models/UsernameRegistry');
const {
  normalizeUsernameInput, canonicalUsername, validateUsernameFormat, escapeUsernameRegex
} = require('../utils/usernamePolicy');

const serialize = (record) => ({
  _id: record._id,
  username: record.username,
  normalizedUsername: record.normalizedUsername,
  reason: record.reason || '',
  reservedBy: record.reservedBy || '',
  createdAt: record.createdAt
});

async function list(req, res) {
  try {
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
    const search = String(req.query.search || '').trim().toLowerCase();
    if (search && (!/^[a-z0-9_]+$/.test(search) || search.length > 20)) {
      return res.status(400).json({ success: false, message: 'Search must contain only username characters' });
    }
    const query = { kind: 'reservation', ...(search ? { normalizedUsername: new RegExp(`^${escapeUsernameRegex(search)}`) } : {}) };
    const [rows, total] = await Promise.all([
      UsernameRegistry.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      UsernameRegistry.countDocuments(query)
    ]);
    return res.json({ success: true, reservations: rows.map(serialize), pagination: { current: page, pages: Math.max(1, Math.ceil(total / limit)), total } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not load reserved usernames' });
  }
}

async function reserve(req, res) {
  const username = normalizeUsernameInput(req.body?.username);
  const validationError = validateUsernameFormat(username);
  if (validationError) return res.status(400).json({ success: false, code: 'INVALID_USERNAME', message: validationError });
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length > 500) return res.status(400).json({ success: false, message: 'Reason cannot exceed 500 characters' });
  try {
    const normalizedUsername = canonicalUsername(username);
    const matchingUser = await User.findOne({ username: { $regex: `^${escapeUsernameRegex(username)}$`, $options: 'i' } })
      .select('_id username userType email isSystemAccount').lean();
    if (matchingUser) {
      return res.status(409).json({ success: false, code: 'USERNAME_IN_USE', message: 'This username is currently in use by an existing account.', account: { _id: matchingUser._id, username: matchingUser.username, userType: matchingUser.userType, email: matchingUser.email, isSystemAccount: Boolean(matchingUser.isSystemAccount) } });
    }
    const record = await UsernameRegistry.create({
      username, normalizedUsername, kind: 'reservation', reason,
      reservedBy: String(req.user?.username || 'admin')
    });
    return res.status(201).json({ success: true, reservation: serialize(record) });
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await UsernameRegistry.findOne({ normalizedUsername: canonicalUsername(username) }).select('kind').lean();
      return res.status(409).json({ success: false, code: existing?.kind === 'user' ? 'USERNAME_IN_USE' : 'ALREADY_RESERVED', message: existing?.kind === 'user' ? 'This username is currently in use by an existing account.' : 'This username is already reserved.' });
    }
    return res.status(500).json({ success: false, message: 'Could not reserve username' });
  }
}

async function remove(req, res) {
  try {
    const record = await UsernameRegistry.findOne({ _id: req.params.id, kind: 'reservation' }).lean();
    if (!record) return res.status(404).json({ success: false, message: 'Reservation not found' });
    // The core system name remains protected by User validation and the
    // permanent server-side reserved-name policy even after removal.
    await UsernameRegistry.deleteOne({ _id: record._id, kind: 'reservation' });
    return res.json({ success: true, removed: { _id: record._id, normalizedUsername: record.normalizedUsername } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not remove reservation' });
  }
}

module.exports = { list, reserve, remove };
