#!/usr/bin/env node
// Explicit local operator preview only. This command sends no email.
const { foundationAvailable, foundationDatabaseAllowed } = require('../config/saas-foundation');
const { validateLocalUri } = require('./local-saas-uri');
function argumentsOf(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--uri', '--bakery-id', '--email', '--purpose'].includes(key) || options[key] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid preview arguments');
    options[key] = args[i + 1];
  }
  if (!['--uri', '--bakery-id', '--email', '--purpose'].every(key => options[key])) throw new Error('Explicit local uri, bakery-id, email and purpose are required');
  validateLocalUri(options['--uri']);
  if (!/^[a-f0-9]{24}$/i.test(options['--bakery-id']) || !['email_verify', 'password_reset'].includes(options['--purpose']) || options['--email'].length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options['--email'])) throw new Error('Invalid preview context');
  return options;
}
async function main(args) {
  if (!foundationAvailable()) throw new Error('Enable the local SaaS development guard explicitly');
  const options = argumentsOf(args), mongoose = require('mongoose');
  try {
    // One operator read: no remote discovery or collection/index side effects.
    // Five seconds bounds an unavailable explicitly selected local database.
    await mongoose.connect(options['--uri'], { directConnection: true, autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 5000 });
    if (!foundationDatabaseAllowed(mongoose.connection)) throw new Error('Local database guard failed');
    const Customer = require('../models/SaasCustomer'), Action = require('../models/SaasCustomerAction'), Preview = require('../models/SaasCustomerMailPreview');
    const customer = await Customer.findOne({ bakeryId: options['--bakery-id'], email: options['--email'].toLowerCase(), active: true }).lean();
    if (!customer) throw new Error('No eligible preview');
    const action = await Action.findOne({ bakeryId: customer.bakeryId, customerId: customer._id, purpose: options['--purpose'], consumedAt: null, sessionVersion: customer.sessionVersion, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1, _id: -1 }).lean();
    if (!action) throw new Error('No eligible preview');
    const preview = await Preview.findOne({ bakeryId: customer.bakeryId, customerId: customer._id, actionId: action._id, expiresAt: { $gt: new Date() } }).select('+ciphertext +iv +tag').lean();
    if (!preview) throw new Error('No eligible preview');
    const token = require('../saas/customer-mail-preview').decryptToken(preview);
    process.stdout.write(JSON.stringify({ deliveryMode: 'local-preview', email: customer.email, purpose: action.purpose, token, expiresAt: action.expiresAt }, null, 2) + '\n');
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { process.stderr.write(`Local mail preview failed: ${error.statusCode || error.code || error.name}\n`); process.exitCode = 1; });
module.exports = { main, argumentsOf };
