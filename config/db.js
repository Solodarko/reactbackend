const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Check if MONGODB_URI is defined
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not defined');
    }

    console.log('🔄 Connecting to MongoDB...');
    console.log('📍 Database URI:', process.env.MONGODB_URI.replace(/:([^:@]{8})[^:@]*@/, ':****@')); // Hide password in logs
    
    // MongoDB connection options - increased timeouts for better connectivity
    const options = {
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 30000, // Keep trying to send operations for 30 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      connectTimeoutMS: 30000, // How long to wait for initial connection
      retryWrites: true, // Retry writes on network errors
      retryReads: true, // Retry reads on network errors
    };

    await mongoose.connect(process.env.MONGODB_URI, options);
    
    console.log('✅ MongoDB connected successfully');
    console.log('📊 Database Name:', mongoose.connection.db.databaseName);
    console.log('🌐 Host:', mongoose.connection.host);
    console.log('📡 Port:', mongoose.connection.port);
    
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    
    // Log specific error types
    if (error.name === 'MongoNetworkError') {
      console.error('🌐 Network Error: Unable to reach MongoDB server. Check your connection.');
    } else if (error.name === 'MongooseServerSelectionError') {
      console.error('⏱️ Server Selection Error: MongoDB server selection timed out.');
    } else if (error.name === 'MongoParseError') {
      console.error('🔗 Parse Error: Invalid MongoDB connection string.');
    }
    
    console.error('🔧 Troubleshooting tips:');
    console.error('   1. Check if MongoDB service is running');
    console.error('   2. Verify MONGODB_URI in .env file');
    console.error('   3. Ensure network connectivity');
    console.error('   4. Check MongoDB Atlas whitelist (if using Atlas)');
    
    process.exit(1); // Exit the process with failure
  }
};

// Handle connection events
mongoose.connection.on('connected', () => {
  console.log('🔗 Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('❌ Mongoose disconnected from MongoDB');
});

// Handle process termination
process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    console.log('🔒 MongoDB connection closed through app termination');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error closing MongoDB connection:', error);
    process.exit(1);
  }
});

module.exports = connectDB;
