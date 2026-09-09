process.env.RESEND_API_KEY = '';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const env = require('../src/config/env');
const Notification = require('../src/models/Notification');
const { enqueueEmail, processDue } = require('../src/services/notification-queue.service');
let db;
before(async () => { db = await MongoMemoryServer.create(); await mongoose.connect(db.getUri()); await Notification.init(); });
beforeEach(async () => { await Notification.deleteMany({}); env.notify.resendApiKey = 'test-provider-key'; });
after(async () => { await mongoose.disconnect(); await db.stop(); });
const email = { key: 'test-event', to: 'qa@example.com', subject: 'Test notification', html: '<p>Test</p>' };

test('event deduplication and concurrent workers deliver a queued email once', async () => {
  await Promise.all([enqueueEmail(email), enqueueEmail(email)]);
  assert.equal(await Notification.countDocuments(), 1);
  let sends = 0;
  const send = async () => { sends++; return new Response('{}', { status: 200 }); };
  await Promise.all([processDue({ send, limit: 1 }), processDue({ send, limit: 1 })]);
  assert.equal(sends, 1);
  assert.equal((await Notification.findOne()).status, 'sent');
});

test('temporary failures persist backoff and reuse the same provider idempotency key', async () => {
  await enqueueEmail(email);
  const keys = [];
  await processDue({ send: async (_, options) => { keys.push(options.headers['Idempotency-Key']); return new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }); } });
  let job = await Notification.findOne();
  assert.equal(job.status, 'pending');
  assert.equal(job.attempts, 1);
  assert.ok(job.nextAttemptAt.getTime() > Date.now() + 110_000);
  await Notification.updateOne({ _id: job._id }, { nextAttemptAt: new Date(0) });
  await processDue({ send: async (_, options) => { keys.push(options.headers['Idempotency-Key']); return new Response('{}', { status: 200 }); } });
  job = await Notification.findOne();
  assert.equal(job.status, 'sent');
  assert.equal(job.attempts, 2);
  assert.equal(keys[0], keys[1]);
});

test('permanent failures and ambiguous deliveries outside the safe retry window stop', async () => {
  await enqueueEmail(email);
  await processDue({ send: async () => new Response('{}', { status: 403 }) });
  assert.equal((await Notification.findOne()).status, 'failed');
  await enqueueEmail({ ...email, key: 'old-send' });
  await Notification.updateOne({ key: 'old-send' }, { status: 'sending', firstAttemptAt: new Date(Date.now() - 24 * 60 * 60_000), leaseUntil: new Date(0) });
  let sends = 0;
  await processDue({ send: async () => { sends++; return new Response('{}', { status: 200 }); } });
  assert.equal(sends, 0);
  assert.equal((await Notification.findOne({ key: 'old-send' })).status, 'failed');
});

test('a worker crash is recovered through an expired lease', async () => {
  await enqueueEmail(email);
  await Notification.updateOne({ key: email.key }, { status: 'sending', lease: 'crashed-worker', leaseUntil: new Date(0), firstAttemptAt: new Date(), attempts: 1 });
  await processDue({ send: async () => new Response('{}', { status: 200 }) });
  assert.equal((await Notification.findOne()).status, 'sent');
});
