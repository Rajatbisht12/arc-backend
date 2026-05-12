const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 30000, // Keep trying to send operations for 30 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      retryWrites: true,
      w: 'majority',
      // Additional recommended options for stability
      minPoolSize: 1, // Minimum number of connections in the pool
      maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
      connectTimeoutMS: 30000, // Give up initial connection after 30 seconds
      heartbeatFrequencyMS: 10000, // Send a heartbeat every 10 seconds
      bufferCommands: true // Enable mongoose buffering to prevent connection issues
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);
    
    // Cleanup old indexes after connection is established
    try {
      const LeaveRequest = require('../models/LeaveRequest');
      LeaveRequest.collection.getIndexes().then(indexes => {
        if (indexes.hasOwnProperty('team_1_staffMember_1_status_1')) {
          console.log('Removing old LeaveRequest index: team_1_staffMember_1_status_1');
          LeaveRequest.collection.dropIndex('team_1_staffMember_1_status_1').then(() => {
            console.log('✅ Old index removed successfully');
          }).catch(err => {
            if (err.code !== 27) { // Ignore "index not found" error
              console.log('Old index already removed or never existed');
            }
          });
        }
      }).catch(err => {
        // Ignore if collection doesn't exist yet
        console.log('Could not check indexes:', err.message);
      });
    } catch (err) {
      // Ignore errors during index cleanup
      console.log('Index cleanup skipped:', err.message);
    }
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      try {
        await mongoose.connection.close();
        console.log('MongoDB connection closed through app termination');
        process.exit(0);
      } catch (err) {
        console.error('Error closing MongoDB connection:', err);
        process.exit(1);
      }
    });

  } catch (error) {
    console.error('Database connection error:', error.message);
    console.error('Full error details:', error);
    
    // Check if it's a connection string issue
    if (error.message.includes('Invalid connection string')) {
      console.error('Please check your MONGODB_URI environment variable');
    }
    
    // Retry connection after 5 seconds
    setTimeout(() => {
      console.log('Retrying database connection...');
      connectDB();
    }, 5000);
  }
};

module.exports = connectDB;
