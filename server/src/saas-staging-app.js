const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const staging = require('./config/saas-staging');
let connectionPromise;
async function connect() {
  const uri = staging.stagingUri();
  if (mongoose.connection.readyState === 1) {
    if (!staging.stagingDatabaseAllowed(mongoose.connection)) throw new Error('Database guard failed');
    return;
  }
  if (!connectionPromise) connectionPromise = mongoose.connect(uri, {
    maxPoolSize: 5, minPoolSize: 0, serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000, socketTimeoutMS: 20000,
  }).catch(() => { connectionPromise = undefined; throw new Error('Test database unavailable'); });
  await connectionPromise;
  if (!staging.stagingDatabaseAllowed(mongoose.connection)) throw new Error('Database guard failed');
}
const app = express();
app.disable('x-powered-by');
// Vercel supplies the final trusted proxy hop; never trust an arbitrary chain.
app.set('trust proxy', 1);
app.use(helmet());
app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
// Neither legacy APIs nor provider webhooks are mounted in this app.
app.use('/api/saas', async (req, res, next) => {
  if (!staging.stagingAvailable() || !staging.stagingOrigin(req)) return res.status(503).json({ success: false, message: 'Test deployment configuration is pending' });
  if (req.get('Origin') && req.get('Origin') !== staging.stagingOrigin(req)) return res.status(403).json({ success: false, message: 'Use the test application on this origin' });
  try { await connect(); next(); }
  catch { res.status(503).json({ success: false, message: 'Test database connection is pending. Production data is not used.' }); }
}, express.json({ limit: '2mb' }), cookieParser(), (req, res, next) => {
  if (/\/media(?:\/|$)/.test(req.path)) return res.status(503).json({ success: false, message: 'Image storage is not enabled on this test deployment' });
  require('./routes/saas-foundation.routes')(req, res, next);
});
app.use((_req, res) => res.status(404).json({ success: false, message: 'Route not found' }));
app.use((error, _req, res, _next) => {
  let status = error.statusCode || error.status || 500;
  if (status >= 500) console.error('[saas-staging]', {
    name: /^[A-Za-z]+$/.test(error.name || '') ? error.name : 'Error',
    code: /^[A-Za-z0-9_]+$/.test(String(error.code || '')) ? error.code : undefined,
  });
  let message = status >= 500 ? 'Test request failed. Please try again.' : error.message;
  if (error.code === 11000) { status = 409; message = 'This record already exists'; }
  if (error.name === 'ValidationError' || error.name === 'CastError') { status = 400; message = 'Check the supplied fields'; }
  res.status(status).json({ success: false, message, ...(status < 500 && error.details ? { details: error.details } : {}) });
});
module.exports = app;
