/**
 * Read-only script to list a small sample of existing users.
 * Usage:  node scripts/check-users.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function main() {
  try {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // List first 10 users (email + username only)
    const users = await User.find({}, 'username email userType isActive').limit(10).lean();
    
    if (users.length === 0) {
      console.log('⚠️  No users found in the database!\n');
    } else {
      console.log(`Found ${users.length} user(s):\n`);
      users.forEach((u, i) => {
        const [localPart = '', domain = ''] = String(u.email || '').split('@');
        const maskedEmail = domain
          ? `${localPart.slice(0, 2)}***@${domain}`
          : '(none)';
        console.log(`  ${i + 1}. username: ${u.username}  |  email: ${maskedEmail}  |  type: ${u.userType}  |  active: ${u.isActive}`);
      });
      console.log('');
    }

  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('\nDone.');
  }
}

main();
