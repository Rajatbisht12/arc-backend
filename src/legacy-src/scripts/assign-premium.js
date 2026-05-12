const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

/**
 * Script to manually assign premium status to a user by username
 * 
 * Usage:
 *   node scripts/assign-premium.js <username> [plan]
 * 
 * Examples:
 *   node scripts/assign-premium.js john_doe
 *   node scripts/assign-premium.js john_doe pro
 *   node scripts/assign-premium.js john_doe pro+
 *   node scripts/assign-premium.js team_user org
 */

const assignPremium = async () => {
  try {
    // Get username and plan from command line arguments
    const username = process.argv[2];
    const planArg = (process.argv[3] || '').toLowerCase().trim();

    if (!username) {
      console.error('❌ Error: Username is required!');
      console.log('\nUsage: node scripts/assign-premium.js <username> [plan]');
      console.log('\nPlans:');
      console.log('  For Players: pro, pro+ (default: pro)');
      console.log('  For Teams: pro, org (default: pro)');
      console.log('\nExamples:');
      console.log('  node scripts/assign-premium.js john_doe');
      console.log('  node scripts/assign-premium.js john_doe pro');
      console.log('  node scripts/assign-premium.js john_doe pro+');
      console.log('  node scripts/assign-premium.js team_user org');
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

    // Determine appropriate membership tier
    let newTier;
    if (user.userType === 'player') {
      // Player plans
      if (planArg === 'pro+' || planArg === 'proplus' || planArg === 'pro_plus') {
        newTier = 'player_pro_plus';
      } else {
        newTier = 'player_pro'; // default
      }
    } else if (user.userType === 'team') {
      // Team plans
      if (planArg === 'org' || planArg === 'organization') {
        newTier = 'team_org';
      } else {
        newTier = 'team_pro'; // default
      }
    } else {
      console.error(`❌ Error: User type "${user.userType}" is not supported for premium assignment`);
      await mongoose.disconnect();
      process.exit(1);
    }

    // Set validUntil to far future date (10 years) for manual assignment
    // This ensures isActivePro check works correctly
    const validUntil = new Date();
    validUntil.setFullYear(validUntil.getFullYear() + 10);

    // Initialize credits based on plan
    let initialCredits = 0;
    if (newTier === 'player_pro') {
      // Player Pro gets 2 credits/week, give initial 2 credits
      initialCredits = 2;
    } else if (newTier === 'player_pro_plus') {
      // Player Pro+ gets 5 credits/week, give initial 5 credits
      initialCredits = 5;
    } else if (newTier === 'team_pro') {
      initialCredits = 25; // Monthly credits for team pro
    } else if (newTier === 'team_org') {
      initialCredits = 60; // Monthly credits for team org
    }

    // Update user to premium
    user.isPremium = true;
    
    // Update membership
    if (!user.membership) {
      user.membership = {
        tier: newTier,
        validUntil: validUntil,
        credits: initialCredits
      };
    } else {
      user.membership.tier = newTier;
      user.membership.validUntil = validUntil;
      // Only update credits if they're 0 or less (don't overwrite existing credits)
      if (!user.membership.credits || user.membership.credits <= 0) {
        user.membership.credits = initialCredits;
      }
    }

    await user.save();

    console.log('\n✅ Premium status assigned successfully!');
    console.log(`   Username: ${user.username}`);
    console.log(`   Premium Status: ✅ Premium`);
    console.log(`   Membership Tier: ${user.membership.tier}`);
    console.log(`   Valid Until: ${validUntil.toLocaleDateString()} (10 years)`);
    console.log(`   Credits: ${user.membership.credits}`);

  } catch (error) {
    console.error('❌ Error assigning premium:', error.message);
    if (error.code === 11000) {
      console.error('   Duplicate key error - username might already exist');
    }
    console.error('\nFull error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Database connection closed');
    process.exit(0);
  }
};

// Run the script
assignPremium();
