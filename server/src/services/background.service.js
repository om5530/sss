const { AsyncLocalStorage } = require('node:async_hooks');
const { waitUntil } = require('@vercel/functions');
const context = new AsyncLocalStorage();

function backgroundContext(req, res, next) {
  context.run({ res, requestId: req.requestId, scheduled: false }, next);
}

function afterResponse(task) {
  const state = context.getStore();
  if (!state || state.scheduled) return;
  state.scheduled = true;
  const responseFinished = new Promise((resolve) => {
    if (state.res.writableEnded) resolve();
    else { state.res.once('finish', resolve); state.res.once('close', resolve); }
  });
  const work = responseFinished.then(task).catch((err) => {
    console.error('[background]', { requestId: state.requestId, message: err.message });
  });
  // Vercel keeps the invocation alive; on a local Node server the promise
  // continues normally. Durable queue records survive a forced termination.
  waitUntil(work);
}

module.exports = { backgroundContext, afterResponse };
