const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const updateAdminUser = async () => {
  try {
    if (!process.argv.includes('--apply')) throw new Error('Refusing to update an admin without --apply');
    const mongoUri = process.env.MONGODB_URI;
    const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const newUsername = String(process.env.ADMIN_USERNAME || '').trim();
    const newPassword = String(process.env.ADMIN_PASSWORD || '');
    if (!mongoUri) throw new Error('MONGODB_URI is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new Error('ADMIN_EMAIL is invalid');
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(newUsername)) throw new Error('ADMIN_USERNAME is invalid');
    if (newPassword.length < 12 || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      throw new Error('ADMIN_PASSWORD must be at least 12 characters and include upper, lower, number, and symbol');
    }

    // Connect to database
    await mongoose.connect(mongoUri);
    console.log('Connected to database');

    // Find admin user
    const adminUser = await User.findOne({ email: adminEmail, userType: 'admin' });
    
    if (!adminUser) {
      throw new Error('Admin user not found');
    }

    console.log('Found admin user:', adminUser.username);
    console.log('Updating credentials...');

    // Update username and password
    adminUser.username = newUsername;
    adminUser.password = newPassword;
    
    await adminUser.save();
    
    console.log('✅ Admin credentials updated successfully!');
    console.log(`Username: ${newUsername}`);

  } catch (error) {
    console.error('❌ Error updating admin user:', error.message);
    if (error.code === 11000) {
      console.error('Username "Admin" already exists. Please choose a different username.');
    }
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
};

updateAdminUser();

