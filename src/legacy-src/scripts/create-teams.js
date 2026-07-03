const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const createTeams = async () => {
  try {
    if (!process.argv.includes('--apply')) throw new Error('Refusing to seed teams without --apply');
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TEST_DATA_SEED !== 'true') {
      throw new Error('Test team seeding is disabled in production');
    }
    const mongoUri = process.env.MONGODB_URI;
    const password = String(process.env.TEAM_SEED_PASSWORD || '');
    const teamCount = Math.min(100, Math.max(1, Number.parseInt(process.env.TEAM_SEED_COUNT || '17', 10) || 17));
    const emailDomain = String(process.env.TEAM_SEED_EMAIL_DOMAIN || '').trim().toLowerCase();
    if (!mongoUri) throw new Error('MONGODB_URI is required');
    if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      throw new Error('TEAM_SEED_PASSWORD must be at least 12 characters and include upper, lower, number, and symbol');
    }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(emailDomain)) throw new Error('TEAM_SEED_EMAIL_DOMAIN is required');

    // Connect to database
    await mongoose.connect(mongoUri);
    console.log('Connected to database');

    const teams = [];

    for (let i = 1; i <= teamCount; i++) {
      const username = `teamtr${i}`;
      const email = `teamtr${i}@${emailDomain}`;
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
        id: team._id
      });

      console.log(`✓ Created team: ${username} (${email})`);
    }

    console.log('\n========================================');
    console.log('✅ Successfully created teams!');
    console.log('========================================\n');
    console.log('Created Teams:');
    console.log('-----------------');
    teams.forEach((team, index) => {
      console.log(`${index + 1}. Username: ${team.username}`);
      console.log(`   Email: ${team.email}`);
      console.log(`   ID: ${team.id}`);
      console.log('');
    });
    console.log('========================================\n');

  } catch (error) {
    console.error('Error creating teams:', error.message);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
};

createTeams();


