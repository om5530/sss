#!/usr/bin/env node
// Offline JSON files only. No dotenv, application boot or MongoDB imports.
const fs = require('node:fs');
const { planMigration } = require('../saas/migration-manifest');

function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--input', '--bakery-id', '--output'].includes(key) || options[key] || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Usage: node src/utils/plan-saas-migration.js --input snapshot.json --bakery-id OBJECT_ID [--output new-manifest.json]');
    }
    options[key] = args[i + 1];
  }
  if (!options['--input'] || !options['--bakery-id']) throw new Error('--input and --bakery-id are required');
  const stat = fs.lstatSync(options['--input']);
  if (!stat.isFile() || stat.size > 50 * 1024 * 1024) throw new Error('Input must be a regular JSON file no larger than 50 MiB');
  const result = planMigration(JSON.parse(fs.readFileSync(options['--input'], 'utf8')), options['--bakery-id']);
  const output = JSON.stringify(result, null, 2) + '\n';
  // Exclusive create: never overwrite the input, previous manifests or symlinks.
  if (options['--output']) fs.writeFileSync(options['--output'], output, { flag: 'wx', mode: 0o600 });
  else process.stdout.write(output);
  if (result.status === 'blocked') process.exitCode = 2;
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`Migration plan failed: ${error.code || error.name}\n`); process.exitCode = 1; }
}
module.exports = { main };
