/**
 * One-time fix: Set isVerifiedHost=true for all users
 * whose HostVerificationApplication status is 'approved'
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const HostVerificationApplication = require('../models/HostVerificationApplication');

async function fixVerifiedHosts() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  // Find all approved applications
  const approvedApps = await HostVerificationApplication.find({ status: 'approved' }).lean();
  console.log(`Found ${approvedApps.length} approved application(s)`);

  if (approvedApps.length === 0) {
    console.log('Nothing to fix.');
    await mongoose.disconnect();
    return;
  }

  let fixed = 0;
  for (const app of approvedApps) {
    const user = await User.findById(app.user).select('username isVerifiedHost');
    if (!user) {
      console.log(`  ⚠️  User not found for application ${app._id}`);
      continue;
    }
    if (user.isVerifiedHost) {
      console.log(`  ✓  @${user.username} already has isVerifiedHost=true`);
      continue;
    }
    await User.findByIdAndUpdate(app.user, { isVerifiedHost: true });
    console.log(`  🔧 Fixed @${user.username} → isVerifiedHost=true`);
    fixed++;
  }

  console.log(`\nDone. Fixed ${fixed} user(s).`);
  await mongoose.disconnect();
}

fixVerifiedHosts().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
