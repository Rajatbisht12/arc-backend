const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const createAdminUser = async () => {
  try {
    if (!process.argv.includes('--apply')) {
      throw new Error('Refusing to create an admin without the explicit --apply flag');
    }
    const mongoUri = process.env.MONGODB_URI;
    const username = String(process.env.ADMIN_USERNAME || '').trim();
    const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = String(process.env.ADMIN_PASSWORD || '');
    if (!mongoUri) throw new Error('MONGODB_URI is required');
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) throw new Error('ADMIN_USERNAME is invalid');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ADMIN_EMAIL is invalid');
    if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      throw new Error('ADMIN_PASSWORD must be at least 12 characters and include upper, lower, number, and symbol');
    }

    // Connect to database
    await mongoose.connect(mongoUri);
    console.log('Connected to database');

    // Check if admin already exists
    const existingAdmin = await User.findOne({ $or: [{ username }, { email }] });
    if (existingAdmin) {
      throw new Error('An account already exists with ADMIN_USERNAME or ADMIN_EMAIL');
    }

    // Create admin user
    const adminUser = new User({
      username,
      email,
      password,
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
    console.log(`Username: ${username}`);
    console.log(`Email: ${email}`);

  } catch (error) {
    console.error('Error creating admin user:', error.message);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
};

createAdminUser();
