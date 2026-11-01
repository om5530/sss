// This entry is bound to one disposable test project, never the live app.
const PROJECT = 'prj_zDxs66Go3gVAi67hchKIsVbbPjr3';
const HOST = 'golden-batch-saas-test.scy3xst.mongodb.net';
const DATABASE = 'saas_staging';
const SHARDS = [0, 1, 2].map(i => `ac-9uxasyc-shard-00-0${i}.scy3xst.mongodb.net`);
function stagingAvailable(e = process.env) {
  return e.SAAS_STAGING_ENABLED === 'true' && e.NODE_ENV === 'production'
    && e.VERCEL === '1' && e.VERCEL_PROJECT_ID === PROJECT
    && e.SAAS_LEGACY_WORKSPACE_AUTH !== 'true';
}
function stagingUri(e = process.env) {
  if (!stagingAvailable(e)) throw new Error('Test deployment is not configured');
  try {
    const uri = new URL(e.SAAS_STAGING_MONGODB_URI);
    if (uri.protocol !== 'mongodb+srv:' || uri.hostname !== HOST || uri.port
      || uri.pathname !== `/${DATABASE}` || !uri.username || !uri.password || uri.hash
      || [...uri.searchParams.keys()].some(key => !['retryWrites', 'w', 'authSource'].includes(key))
      || uri.searchParams.get('authSource') !== 'admin'
      || uri.searchParams.get('retryWrites') !== 'true' || uri.searchParams.get('w') !== 'majority') throw new Error();
    return uri.href;
  } catch { throw new Error('The isolated test database is not configured'); }
}
function stagingDatabaseAllowed(connection, e = process.env) {
  return stagingAvailable(e) && connection?.readyState === 1
    && connection.name === DATABASE && SHARDS.includes(connection.host);
}
function stagingOrigins(e = process.env) {
  if (!stagingAvailable(e)) return [];
  return [...new Set([e.VERCEL_URL, e.VERCEL_PROJECT_PRODUCTION_URL]
    .filter(host => typeof host === 'string' && /^golden-batch-saas-test(?:-[a-z0-9-]+)?\.vercel\.app$/.test(host))
    .map(host => `https://${host}`))];
}
function stagingOrigin(req, e = process.env) {
  const origin = `https://${req.get('host')}`;
  return stagingOrigins(e).includes(origin) ? origin : null;
}
module.exports = { PROJECT, HOST, DATABASE, SHARDS, stagingAvailable, stagingUri, stagingDatabaseAllowed, stagingOrigins, stagingOrigin };
