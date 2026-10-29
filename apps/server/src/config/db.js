const mongoose = require('mongoose');

async function connectDB(uri, dbName) {
  if (!uri) throw new Error('MONGODB_URI is missing. Set it in environment variables.');
  await mongoose.connect(uri, {
    dbName,
    autoIndex: process.env.NODE_ENV !== 'production',
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
  });
  console.log(`[MongoDB] connected: ${mongoose.connection.name}`);
}

async function closeDB() {
  await mongoose.connection.close(false);
}

module.exports = { connectDB, closeDB };
