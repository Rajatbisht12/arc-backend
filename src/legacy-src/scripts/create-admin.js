const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const createAdminUser = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gaming-social-platform');
    console.log('Connected to database');

    // Check if admin already exists
    const existingAdmin = await User.findOne({ userType: 'admin' });
    if (existingAdmin) {
      console.log('Admin user already exists:', existingAdmin.username);
      process.exit(0);
    }

    // Create admin user
    const adminUser = new User({
      username: 'admin',
      email: 'admin@arcgaming.com',
      password: 'admin123', // Change this in production
      userType: 'admin',
      isSuperUser: true, // Grant superuser rights
      profile: {
        displayName: 'Administrator',
        bio: 'Platform Administrator',
        location: 'Global'
      },
      isActive: true,
      isVerified: true
    });

    await adminUser.save();
    console.log('Admin user created successfully!');
    console.log('Username: admin');
    console.log('Email: admin@arcgaming.com');
    console.log('Password: admin123');
    console.log('\n⚠️  IMPORTANT: Change the admin password after first login!');

  } catch (error) {
    console.error('Error creating admin user:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

createAdminUser();
