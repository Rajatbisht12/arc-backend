/**
 * Quick script to list existing users and optionally create a test user.
 * Usage:  node scripts/check-users.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // List first 10 users (email + username only)
    const users = await User.find({}, 'username email userType isActive').limit(10).lean();
    
    if (users.length === 0) {
      console.log('⚠️  No users found in the database!\n');
    } else {
      console.log(`Found ${users.length} user(s):\n`);
      users.forEach((u, i) => {
        console.log(`  ${i + 1}. username: ${u.username}  |  email: ${u.email}  |  type: ${u.userType}  |  active: ${u.isActive}`);
      });
      console.log('');
    }

    // Check if test user already exists
    const testEmail = 'test@test.com';
    const existing = await User.findOne({ email: testEmail });
    
    if (existing) {
      console.log(`✅ Test user already exists: ${existing.username} (${testEmail})`);
      // Reset the password for the test user
      existing.password = 'test1234';
      await existing.save();
      console.log('   Password has been reset to: test1234');
    } else {
      // Create a test user
      const testUser = await User.create({
        username: 'testuser',
        email: testEmail,
        password: 'test1234',
        userType: 'player',
        profile: {
          displayName: 'Test User',
        },
        playerInfo: {
          games: [],
          achievements: [],
          lookingForTeam: false,
          preferredRoles: [],
          skillLevel: 'beginner'
        }
      });
      console.log(`✅ Created test user!`);
      console.log(`   Email:    ${testEmail}`);
      console.log(`   Username: testuser`);
      console.log(`   Password: test1234`);
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('\nDone.');
  }
}

main();
