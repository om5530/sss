const mongoose = require('mongoose');
const env = require('./env');

mongoose.set('strictQuery', true);

async function connectDB() {
  try {
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 8000 });
    console.log(`[db] Connected to MongoDB (${mongoose.connection.name})`);
  } catch (err) {
    console.error(`[db] MongoDB connection failed: ${err.message}`);
    console.error('[db] The API will still start, but database-backed routes return 503 until MongoDB is reachable.');
    console.error('[db] Fix: start a local mongod, or set MONGODB_URI in server/.env to a MongoDB Atlas connection string.');
  }

  mongoose.connection.on('disconnected', () => console.warn('[db] MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => console.log('[db] MongoDB reconnected'));
}

// mongoose is re-exported for entry points outside server/ (api/index.js);
// requiring it there directly would resolve against the repo root, which has
// no node_modules of its own.
module.exports = { connectDB, mongoose };
