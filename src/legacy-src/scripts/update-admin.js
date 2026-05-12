const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const updateAdminUser = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gaming-social-platform');
    console.log('Connected to database');

    // Find admin user
    const adminUser = await User.findOne({ userType: 'admin' });
    
    if (!adminUser) {
      console.log('❌ Admin user not found. Please create an admin user first using create-admin.js');
      process.exit(1);
    }

    console.log('Found admin user:', adminUser.username);
    console.log('Updating credentials...');

    // Update username and password
    adminUser.username = 'Admin';
    adminUser.password = 'admin123'; // Will be automatically hashed by pre-save hook
    
    await adminUser.save();
    
    console.log('✅ Admin credentials updated successfully!');
    console.log('Username: Admin');
    console.log('Password: admin123');
    console.log('\n⚠️  IMPORTANT: Change the admin password after first login!');

  } catch (error) {
    console.error('❌ Error updating admin user:', error);
    if (error.code === 11000) {
      console.error('Username "Admin" already exists. Please choose a different username.');
    }
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

updateAdminUser();

