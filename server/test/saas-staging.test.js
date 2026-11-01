const { test } = require('node:test');
const assert = require('node:assert/strict');
const staging = require('../src/config/saas-staging');
const { foundationAvailable, foundationDatabaseAllowed } = require('../src/config/saas-foundation');
const valid = { NODE_ENV: 'production', VERCEL: '1', VERCEL_PROJECT_ID: staging.PROJECT,
  SAAS_STAGING_ENABLED: 'true', SAAS_LEGACY_WORKSPACE_AUTH: 'false',
  VERCEL_URL: 'golden-batch-saas-test-abc-owner.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'golden-batch-saas-test.vercel.app',
  SAAS_STAGING_MONGODB_URI: `mongodb+srv://test:FAKE@${staging.HOST}/${staging.DATABASE}?retryWrites=true&w=majority&authSource=admin` };
test('staging requires the exact separate project, database and explicit flag', () => {
  assert.equal(staging.stagingAvailable(valid), true);
  assert.equal(foundationAvailable(valid), true);
  for (const change of [{ SAAS_STAGING_ENABLED: 'false' }, { VERCEL_PROJECT_ID: 'live-project' }, { VERCEL: '' }, { NODE_ENV: 'development' }, { SAAS_LEGACY_WORKSPACE_AUTH: 'true' }]) {
    assert.equal(staging.stagingAvailable({ ...valid, ...change }), false);
    assert.throws(() => staging.stagingUri({ ...valid, ...change }));
  }
  assert.equal(staging.stagingUri(valid), valid.SAAS_STAGING_MONGODB_URI);
  for (const uri of [valid.SAAS_STAGING_MONGODB_URI.replace(staging.HOST, 'production.mongodb.net'), valid.SAAS_STAGING_MONGODB_URI.replace('/saas_staging', '/production'), valid.SAAS_STAGING_MONGODB_URI + '&tls=false', valid.SAAS_STAGING_MONGODB_URI.replace('mongodb+srv:', 'mongodb:'), undefined]) {
    assert.throws(() => staging.stagingUri({ ...valid, SAAS_STAGING_MONGODB_URI: uri }), error => !error.message.includes('FAKE'));
  }
  for (const host of staging.SHARDS) assert.equal(staging.stagingDatabaseAllowed({ readyState: 1, name: 'saas_staging', host }, valid), true);
  for (const connection of [{ readyState: 1, name: 'live', host: staging.SHARDS[0] }, { readyState: 1, name: 'saas_staging', host: 'production.mongodb.net' }, { readyState: 0, name: 'saas_staging', host: staging.SHARDS[0] }]) assert.equal(staging.stagingDatabaseAllowed(connection, valid), false);
  assert.equal(foundationAvailable({ NODE_ENV: 'production', SAAS_FOUNDATION_ENABLED: 'true' }), false);
  assert.equal(foundationDatabaseAllowed({ readyState: 1, name: 'saas_staging', host: staging.SHARDS[0] }), false);
});
test('only trusted Vercel deployment hosts form staging origins', () => {
  assert.equal(staging.stagingOrigin({ get: () => valid.VERCEL_URL }, valid), `https://${valid.VERCEL_URL}`);
  for (const host of ['attacker.vercel.app', 'golden-batch-saas-test.vercel.app.evil.test', 'localhost', valid.VERCEL_URL + ':443']) assert.equal(staging.stagingOrigin({ get: () => host }, valid), null);
  assert.deepEqual(staging.stagingOrigins({ ...valid, VERCEL_URL: 'evil.test', VERCEL_PROJECT_PRODUCTION_URL: 'evil.vercel.app' }), []);
});
test('staging cookies require HTTPS and workspace mutations reject a different origin', t => {
  const previous = Object.fromEntries(Object.keys(valid).map(key => [key, process.env[key]]));
  Object.assign(process.env, valid);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const access = require('../src/saas/account-access');
  const customer = require('../src/saas/customer-access');
  assert.deepEqual(access.options(), { httpOnly: true, sameSite: 'strict', secure: true, path: '/api/saas' });
  assert.equal(customer.cookieOptions({ slug: 'sample-bakery' }).secure, true);
  const request = origin => ({ get: key => ({ 'X-Saas-Workspace': '1', host: valid.VERCEL_URL, Origin: origin }[key]) });
  assert.doesNotThrow(() => access.intent(request(`https://${valid.VERCEL_URL}`), 'X-Saas-Workspace'));
  assert.throws(() => access.intent(request('https://other.vercel.app'), 'X-Saas-Workspace'), error => error.statusCode === 403);
});
test('staging entry never exposes legacy APIs or connects with missing configuration', async () => {
  const mongoose = require('mongoose');
  const app = require('../src/saas-staging-app');
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of ['/api/auth/me', '/api/admin/orders', '/api/orders', '/api/payments']) assert.equal((await fetch(base + path)).status, 404);
    const denied = await fetch(base + '/api/saas/account/me');
    assert.equal(denied.status, 503); assert.match(denied.headers.get('cache-control'), /no-store/);
    assert.equal(mongoose.connection.readyState, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
