// Local foundation remains development-only. Hosted tests require their own
// exact project/database guard and a SaaS-only entry point.
function foundationAvailable(environment = process.env) {
  if (require('./saas-staging').stagingAvailable(environment)) return true;
  return environment.SAAS_FOUNDATION_ENABLED === 'true'
    && ['development', 'test'].includes(environment.NODE_ENV || 'development')
    && !environment.VERCEL;
}

// A development flag must not make a copied cloud/production URI writable.
// The isolated staging branch checks its exact database and shard hosts.
function foundationDatabaseAllowed(connection) {
  if (require('./saas-staging').stagingAvailable()) return require('./saas-staging').stagingDatabaseAllowed(connection);
  return connection?.readyState === 1
    && ['127.0.0.1', 'localhost', '::1'].includes(connection.host)
    && typeof connection.name === 'string' && /^saas_[a-z0-9_]+$/.test(connection.name);
}

module.exports = { foundationAvailable, foundationDatabaseAllowed };
