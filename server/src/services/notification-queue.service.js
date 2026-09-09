const crypto = require('crypto');
const Notification = require('../models/Notification');
const env = require('../config/env');
const { afterResponse } = require('./background.service');

async function enqueueEmail({ to, subject, html, key }) {
  if (!to) return;
  if (!env.notify.resendApiKey) {
    console.log('[notify:mock] Email skipped; provider not configured');
    return;
  }
  try {
    const eventKey = key || crypto.createHash('sha256').update(JSON.stringify({ to, subject, html })).digest('hex');
    await Notification.updateOne({ key: eventKey }, { $setOnInsert: {
      from: env.notify.from, to, subject, html, status: 'pending', attempts: 0, nextAttemptAt: new Date(),
    } }, { upsert: true });
    afterResponse(() => processDue());
  } catch (err) {
    if (err.code !== 11000) console.error('[notify:enqueue] Failed to persist notification', { code: err.code, message: err.message });
    // Notification failures must not undo a customer's already-persisted order.
  }
}

// Atomic leases coordinate overlapping scheduler requests and multiple servers.
// Retry within Resend's 24h idempotency window; never automatically resend an
// ambiguous delivery after that window. No process-local queue or timers.
async function processDue({ send = fetch, limit = 3 } = {}) {
  if (!env.notify.resendApiKey) return { processed: 0, sent: 0, failed: 0 };
  const summary = { processed: 0, sent: 0, failed: 0 };
  for (let n = 0; n < Math.min(limit, 3); n++) {
    const now = new Date();
    const lease = crypto.randomUUID();
    const job = await Notification.findOneAndUpdate({ $or: [
      { status: 'pending', nextAttemptAt: { $lte: now } },
      { status: 'sending', leaseUntil: { $lte: now } },
    ] }, [{ $set: {
      status: 'sending', lease, leaseUntil: new Date(now.getTime() + 60_000),
      attempts: { $add: ['$attempts', 1] }, firstAttemptAt: { $ifNull: ['$firstAttemptAt', now] },
    } }], { new: true, sort: { nextAttemptAt: 1 } });
    if (!job) break;
    summary.processed++;
    let error = '';
    let retry = true;
    let delayMs = Math.min(30_000 * 2 ** (job.attempts - 1), 30 * 60_000);
    if (job.attempts > 8 || now.getTime() - job.firstAttemptAt.getTime() >= 23 * 60 * 60_000) {
      error = 'Retry window exhausted; check provider delivery logs before resending.';
      retry = false;
    } else {
      try {
        const response = await send('https://api.resend.com/emails', {
          method: 'POST', signal: AbortSignal.timeout(5_000),
          headers: { Authorization: `Bearer ${env.notify.resendApiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `notification/${job._id}` },
          body: JSON.stringify({ from: job.from, to: job.to, subject: job.subject, html: job.html }),
        });
        if (!response.ok) {
          error = `Email provider returned HTTP ${response.status}`;
          retry = response.status >= 500 || [408, 429].includes(response.status);
          if (response.status === 409) {
            const detail = await response.json().catch(() => ({}));
            retry = detail.name === 'concurrent_idempotent_requests';
          }
          const retryAfter = response.headers.get('retry-after');
          if (retryAfter) {
            const wait = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
            if (Number.isFinite(wait)) delayMs = Math.max(delayMs, wait);
          }
        }
      } catch {
        error = 'Email provider network error or timeout';
      }
    }
    const failed = Boolean(error) && (!retry || job.attempts >= 8);
    const status = error ? failed ? 'failed' : 'pending' : 'sent';
    await Notification.updateOne({ _id: job._id, lease, status: 'sending' }, { $set: {
      status, lastError: error, nextAttemptAt: new Date(Date.now() + delayMs),
      ...(status === 'sent' ? { sentAt: new Date() } : {}),
      ...(status !== 'pending' ? { purgeAt: new Date(Date.now() + 30 * 86400_000) } : {}),
    }, $unset: { lease: '', leaseUntil: '' } });
    if (error) console.error('[notify:delivery]', { notificationId: String(job._id), attempt: job.attempts, status, error });
    if (status === 'sent') summary.sent++;
    if (failed) summary.failed++;
  }
  return summary;
}

module.exports = { enqueueEmail, processDue };
