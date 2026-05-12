const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const createTeams = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gaming-social-platform');
    console.log('Connected to database');

    const teams = [];
    const password = '123456';

    // Create 17 teams
    for (let i = 1; i <= 17; i++) {
      const username = `teamtr${i}`;
      const email = `teamtr${i}@arcgaming.com`;
      const displayName = `Team TR${i}`;

      // Check if team already exists
      const existingTeam = await User.findOne({
        $or: [{ email }, { username }]
      });

      if (existingTeam) {
        console.log(`Team ${username} already exists, skipping...`);
        continue;
      }

      // Create team user
      const teamData = {
        username: username,
        email: email,
        password: password,
        userType: 'team',
        profile: {
          displayName: displayName,
          bio: `Tournament Team ${i}`,
          location: '',
          website: ''
        },
        teamInfo: {
          teamSize: 0,
          recruitingFor: [],
          requirements: '',
          teamType: 'casual',
          members: [],
          rosters: [],
          staff: []
        },
        isActive: true,
        isVerified: false
      };

      const team = await User.create(teamData);
      teams.push({
        username: username,
        email: email,
        password: password,
        id: team._id
      });

      console.log(`✓ Created team: ${username} (${email})`);
    }

    console.log('\n========================================');
    console.log('✅ Successfully created teams!');
    console.log('========================================\n');
    console.log('Team Credentials:');
    console.log('-----------------');
    teams.forEach((team, index) => {
      console.log(`${index + 1}. Username: ${team.username}`);
      console.log(`   Email: ${team.email}`);
      console.log(`   Password: ${team.password}`);
      console.log(`   ID: ${team.id}`);
      console.log('');
    });
    console.log('========================================\n');

  } catch (error) {
    console.error('Error creating teams:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

createTeams();


