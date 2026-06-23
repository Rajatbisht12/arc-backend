const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const clearAllTeamHistory = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gaming-social-platform');
    console.log('Connected to database');

    // Find all players
    const players = await User.find({ userType: 'player' });
    console.log(`Found ${players.length} players`);

    let clearedCount = 0;
    let totalTeamsCleared = 0;

    // Clear joinedTeams for each player
    for (const player of players) {
      if (player.playerInfo && player.playerInfo.joinedTeams && player.playerInfo.joinedTeams.length > 0) {
        const teamsCount = player.playerInfo.joinedTeams.length;
        player.playerInfo.joinedTeams = [];
        await player.save();
        clearedCount++;
        totalTeamsCleared += teamsCount;
        console.log(`Cleared ${teamsCount} team(s) for player: ${player.username}`);
      }
    }

    console.log('\n✅ Team history cleared successfully!');
    console.log(`Total players processed: ${clearedCount}`);
    console.log(`Total team memberships deleted: ${totalTeamsCleared}`);

  } catch (error) {
    console.error('❌ Error clearing team history:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Database connection closed');
    process.exit(0);
  }
};

// Confirm before running
console.log('⚠️  WARNING: This will delete ALL team history for ALL players!');
console.log('This action cannot be undone.\n');

// Run the script
clearAllTeamHistory();

