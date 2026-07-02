/**
 * Grants (or revokes) the admin role for an existing account (AS-1.1).
 * Roles are only ever assigned here, server-side — never through the API.
 *
 *   npm run make-admin -- <phone-or-email>
 *   npm run make-admin -- <phone-or-email> --revoke
 */
const mongoose = require('mongoose');
const env = require('../config/env');
const User = require('../models/User');

async function run() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const identifier = args.find((a) => !a.startsWith('--'));
  const revoke = args.includes('--revoke');

  if (!identifier) {
    console.error('Usage: npm run make-admin -- <phone-or-email> [--revoke]');
    process.exit(1);
  }

  await mongoose.connect(env.mongoUri);

  const query = identifier.includes('@')
    ? { email: identifier.toLowerCase() }
    : { phone: identifier };
  const user = await User.findOne(query);

  if (!user) {
    console.error(`No account found for "${identifier}". The user must sign in once first.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  user.role = revoke ? 'customer' : 'admin';
  await user.save();
  console.log(`✔ ${user.name || identifier} is now ${revoke ? 'a customer' : 'an ADMIN'}.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
