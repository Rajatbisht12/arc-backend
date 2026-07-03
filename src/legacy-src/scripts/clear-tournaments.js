const mongoose = require('mongoose');
const Tournament = require('../models/Tournament');

require('dotenv').config();

const clearAllTournaments = async () => {
  try {
    if (!process.argv.includes('--apply') || process.env.CONFIRM_DESTRUCTIVE_OPERATION !== 'CLEAR_TOURNAMENTS') {
      throw new Error('Requires --apply and CONFIRM_DESTRUCTIVE_OPERATION=CLEAR_TOURNAMENTS');
    }
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to database');

    // Delete all tournaments
    const result = await Tournament.deleteMany({});
    console.log(`\n✅ Deleted ${result.deletedCount} tournament(s) successfully!`);

  } catch (error) {
    console.error('❌ Error clearing tournaments:', error.message);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    console.log('Database connection closed');
  }
};

// Confirm before running
console.log('⚠️  WARNING: This will delete ALL tournaments from the database!');
clearAllTournaments();

