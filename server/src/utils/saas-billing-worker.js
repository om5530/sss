#!/usr/bin/env node
const { foundationAvailable, foundationDatabaseAllowed } = require('../config/saas-foundation');
const { validateLocalUri } = require('./local-saas-uri');
async function main(args) {
 if (!foundationAvailable()) throw new Error('Local SaaS guard required');
 const options = {}; for (let i = 0; i < args.length; i += 2) { if (!['--uri', '--limit'].includes(args[i]) || options[args[i]] || !args[i + 1]) throw new Error('Invalid worker arguments'); options[args[i]] = args[i + 1]; }
 validateLocalUri(options['--uri']); const limit = options['--limit'] === undefined ? 5 : Number(options['--limit']); if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Use limit 1–20');
 const mongoose = require('mongoose');
 try {
  // One local job, direct host only; no environment/default production URI.
  await mongoose.connect(options['--uri'], { directConnection: true, serverSelectionTimeoutMS: 5000 });
  if (!foundationDatabaseAllowed(mongoose.connection)) throw new Error('Local database required');
  const Event = require('../models/SaasBillingEvent'), billing = require('../saas/billing');
  require('../saas/billing-provider').configuration();
  const rows = await Event.aggregate([{ $match: { processedAt: null } }, { $sort: { _id: 1 } }, { $group: { _id: '$checkoutId' } }, { $limit: limit }]);
  let processed = 0, failed = 0;
  for (const row of rows) { try { await billing.synchronize(row._id); processed++; } catch { failed++; } }
  process.stdout.write(JSON.stringify({ processed, failed, pending: await Event.countDocuments({ processedAt: null }) }) + '\n'); if (failed) process.exitCode = 2;
 } finally { await mongoose.disconnect(); }
}
if (require.main === module) main(process.argv.slice(2)).catch(() => { process.stderr.write('Local test billing worker failed; verify configuration and pending events\n'); process.exitCode = 1; });
module.exports = { main };
