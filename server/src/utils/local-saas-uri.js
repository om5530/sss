function validateLocalUri(value) {
  const uri = new URL(value);
  if (uri.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost', '[::1]'].includes(uri.hostname) || uri.username || uri.password || uri.hash
    || !/^\/saas_[a-z0-9_]+$/.test(uri.pathname) || [...uri.searchParams.keys()].some(key => key !== 'replicaSet') || uri.searchParams.getAll('replicaSet').length > 1) throw new Error('Only a disposable loopback saas_* URI is allowed');
}
module.exports = { validateLocalUri };
