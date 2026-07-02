// Vercel serverless entry — wraps the Express app from server/src.
// server/src/server.js (app.listen) remains the entry point for long-running
// hosts; on Vercel every /api/* request is rewritten here (see vercel.json)
// and handled by the same Express app.
const { findProdConfigProblems } = require('../server/src/config/assertProdConfig');
const { connectDB, mongoose } = require('../server/src/config/db');
const app = require('../server/src/app');

// Same backstop as server.js. Throwing at cold start fails every request
// loudly instead of quietly serving with forgeable sessions or no database.
const problems = findProdConfigProblems();
if (problems.length) {
  throw new Error(`Refusing to serve with insecure production configuration:\n - ${problems.join('\n - ')}`);
}

// The dbReady middleware 503s until readyState === 1, so unlike server.js we
// must finish connecting before letting a cold-start request through. The
// promise is cached at module scope — warm invocations skip straight to the
// app — and re-created only if the last attempt failed (connectDB swallows
// errors, so a failed attempt leaves readyState at 0).
let dbReady;

module.exports = async (req, res) => {
  if (!dbReady || mongoose.connection.readyState === 0) dbReady = connectDB();
  await dbReady;
  return app(req, res);
};
