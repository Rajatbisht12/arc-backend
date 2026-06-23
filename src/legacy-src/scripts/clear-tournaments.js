const mongoose = require('mongoose');
const Tournament = require('../models/Tournament');

require('dotenv').config();

const clearAllTournaments = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gaming-social-platform');
    console.log('✅ Connected to database');

    // Delete all tournaments
    const result = await Tournament.deleteMany({});
    console.log(`\n✅ Deleted ${result.deletedCount} tournament(s) successfully!`);

  } catch (error) {
    console.error('❌ Error clearing tournaments:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Database connection closed');
    process.exit(0);
  }
};

// Confirm before running
console.log('⚠️  WARNING: This will delete ALL tournaments from the database!');
console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');

setTimeout(() => {
  clearAllTournaments();
}, 3000);

