#!/usr/bin/env node
// No dotenv or application boot. An operator must explicitly select a local URI.
const fs = require('node:fs');
const { foundationAvailable } = require('../config/saas-foundation');
function argumentsOf(args) {
  const result = { apply: false };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--apply' && !result.apply) { result.apply = true; continue; }
    if (!['--uri', '--bakery-id', '--actor-id', '--input'].includes(key) || result[key] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid local subscription arguments');
    result[key] = args[++i];
  }
  if (!['--uri', '--bakery-id', '--actor-id', '--input'].every(key => result[key])) throw new Error('Explicit uri, bakery-id, actor-id and input are required');
  require('./local-saas-uri').validateLocalUri(result['--uri']);
  return result;
}
async function main(args) {
  if (!foundationAvailable()) throw new Error('Enable the local-only SaaS development guard explicitly');
  const options = argumentsOf(args), stat = fs.lstatSync(options['--input']);
  if (!stat.isFile() || stat.size > 16384) throw new Error('Input must be a regular JSON file under 16 KiB');
  const body = JSON.parse(fs.readFileSync(options['--input'], 'utf8'));
  const mongoose = require('mongoose');
  try {
    // One local operator invocation: direct connection prevents discovery of
    // other hosts; dry runs disable collection/index initialization. Fail fast
    // after five seconds if the explicitly selected local server is absent.
    await mongoose.connect(options['--uri'], { directConnection: true, serverSelectionTimeoutMS: 5000, autoCreate: options.apply, autoIndex: options.apply });
    if (!require('../config/saas-foundation').foundationDatabaseAllowed(mongoose.connection)) throw new Error('Local database guard failed');
    const { changeSubscription } = require('../saas/subscription-change');
    const result = await changeSubscription({ bakeryId: options['--bakery-id'], actorId: options['--actor-id'], body, apply: options.apply });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { process.stderr.write(`Local subscription command failed: ${error.statusCode || error.code || error.name}\n`); process.exitCode = 1; });
module.exports = { main, argumentsOf };
