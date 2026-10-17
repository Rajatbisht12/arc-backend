const crypto = require('crypto');
const mongoose = require('mongoose');

const objectIdNumber = (value) => BigInt(`0x${String(value)}`);

const withIdRange = (filter, comparison) => ({
  ...filter,
  $and: [...(filter.$and || []), { _id: comparison }],
});

// A random _id seek rotates through the whole eligible catalog without an
// unbounded $sample aggregation or a deep skip. Wrap once to fill small tails.
const sampleSuggestedUsers = async (User, filter, limit, projection, randomBytes = crypto.randomBytes, random = Math.random) => {
  const [first, last] = await Promise.all([
    User.findOne(filter).select('_id').sort({ _id: 1 }).lean(),
    User.findOne(filter).select('_id').sort({ _id: -1 }).lean(),
  ]);
  if (!first || !last) return [];

  const minimum = objectIdNumber(first._id);
  const maximum = objectIdNumber(last._id);
  const randomValue = BigInt(`0x${randomBytes(12).toString('hex')}`);
  const pivotValue = minimum + randomValue % (maximum - minimum + 1n);
  const pivot = new mongoose.Types.ObjectId(pivotValue.toString(16).padStart(24, '0'));
  const ascending = random() < 0.5;
  const direction = ascending ? 1 : -1;
  const firstRange = ascending ? { $gte: pivot } : { $lte: pivot };
  const wrapRange = ascending ? { $lt: pivot } : { $gt: pivot };
  const firstPage = await User.find(withIdRange(filter, firstRange))
    .select(projection).sort({ _id: direction }).limit(limit);
  const wrapped = firstPage.length < limit
    ? await User.find(withIdRange(filter, wrapRange))
      .select(projection).sort({ _id: direction }).limit(limit - firstPage.length)
    : [];
  const users = [...firstPage, ...wrapped];
  for (let index = users.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [users[index], users[swap]] = [users[swap], users[index]];
  }
  return users;
};

module.exports = { sampleSuggestedUsers };
