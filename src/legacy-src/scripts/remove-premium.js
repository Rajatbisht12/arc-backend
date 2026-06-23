const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

/**
 * Script to manually remove premium status from a user by username
 * 
 * Usage:
 *   node scripts/remove-premium.js <username>
 * 
 * Example:
 *   node scripts/remove-premium.js john_doe
 */

const removePremium = async () => {
  try {
    // Get username from command line arguments
    const username = process.argv[2];

    if (!username) {
      console.error('❌ Error: Username is required!');
      console.log('\nUsage: node scripts/remove-premium.js <username>');
      console.log('Example: node scripts/remove-premium.js john_doe');
      process.exit(1);
    }

    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gaming-social-platform');
    console.log('✅ Connected to database');

    // Find user by username
    const user = await User.findOne({ username: username.trim() });

    if (!user) {
      console.error(`❌ Error: User with username "${username}" not found!`);
      await mongoose.disconnect();
      process.exit(1);
    }

    // Check current premium status
    const wasPremium = user.isPremium || false;
    const currentTier = user.membership?.tier || 'free';

    console.log('\n📋 Current User Information:');
    console.log(`   Username: ${user.username}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   User Type: ${user.userType}`);
    console.log(`   Current Premium Status: ${wasPremium ? '✅ Premium' : '❌ Not Premium'}`);
    console.log(`   Current Membership Tier: ${currentTier}`);

    if (!wasPremium && currentTier === 'free') {
      console.log('\n⚠️  User is already not premium. No changes needed.');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Remove premium status
    user.isPremium = false;
    
    // Reset membership tier to free
    if (!user.membership) {
      user.membership = {
        tier: 'free',
        validUntil: null,
        credits: 0
      };
    } else {
      user.membership.tier = 'free';
      user.membership.validUntil = null;
    }

    await user.save();

    console.log('\n✅ Premium status removed successfully!');
    console.log(`   Username: ${user.username}`);
    console.log(`   Premium Status: ❌ Not Premium`);
    console.log(`   Membership Tier: ${user.membership.tier}`);

  } catch (error) {
    console.error('❌ Error removing premium:', error.message);
    console.error('\nFull error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Database connection closed');
    process.exit(0);
  }
};

// Run the script
removePremium();
