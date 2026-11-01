const mongoose = require('mongoose');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { foundationAvailable, foundationDatabaseAllowed } = require('../config/saas-foundation');
const ApiError = require('../utils/ApiError');
function configuration() {
 const e = process.env, keyId = e.SAAS_RAZORPAY_TEST_KEY_ID, secret = e.SAAS_RAZORPAY_TEST_KEY_SECRET, webhookSecret = e.SAAS_RAZORPAY_TEST_WEBHOOK_SECRET, accountId = e.SAAS_RAZORPAY_TEST_ACCOUNT_ID;
 const plans = { starter: e.SAAS_RAZORPAY_TEST_STARTER_PLAN, growth: e.SAAS_RAZORPAY_TEST_GROWTH_PLAN };
 if (!foundationAvailable() || !foundationDatabaseAllowed(mongoose.connection) || e.SAAS_RAZORPAY_TEST_ENABLED !== 'true' || !/^rzp_test_[a-zA-Z0-9]+$/.test(keyId || '') || typeof secret !== 'string' || secret.length < 16 || typeof webhookSecret !== 'string' || webhookSecret.length < 32 || !/^acc_[a-zA-Z0-9]+$/.test(accountId || '') || Object.values(plans).some(id => !/^plan_[a-zA-Z0-9]+$/.test(id || '')) || plans.starter === plans.growth) throw new ApiError(503, 'Separate Razorpay test billing is not configured');
 return { keyId, secret, webhookSecret, accountId, plans };
}
function configured() { try { configuration(); return true; } catch { return false; } }
async function request(method, path, data) {
 const config = configuration();
 try {
  const response = await fetch(`https://api.razorpay.com/v1/${path}`, { method, headers: { Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.secret}`).toString('base64')}`, 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new Error('Provider rejected request');
  return await response.json();
 } catch { throw new ApiError(503, 'Razorpay test request was not confirmed. Refresh or recover the existing attempt before trying another subscription', { code: 'BILLING_PROVIDER_UNCERTAIN' }); }
}
const idOf = (id, prefix) => { if (typeof id !== 'string' || !new RegExp(`^${prefix}_[a-zA-Z0-9]+$`).test(id)) throw ApiError.badRequest('Invalid billing reference'); return id; };
function safeLink(value) { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'rzp.io' && !url.username && !url.password && !url.port ? url.href : null; } catch { return null; } }
async function plan(planId) {
 const id = configuration().plans[planId]; if (!id) throw ApiError.badRequest('Unknown billing plan');
 const value = await request('GET', `plans/${id}`);
 if (value.id !== id || value.period !== 'monthly' || value.interval !== 1 || value.item?.currency !== 'INR' || !Number.isSafeInteger(value.item?.amount) || value.item.amount < 1 || value.item.amount > 100000000) throw ApiError.conflict('Test plan price or billing period requires review');
 return { planId, providerPlanId: id, amountPaise: value.item.amount, currency: 'INR', period: 'monthly', cycles: 12 };
}
function verify(raw, signature) {
 const config = configuration();
 if (!Buffer.isBuffer(raw) || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) throw ApiError.badRequest('Invalid billing webhook signature');
 const expected = createHmac('sha256', config.webhookSecret).update(raw).digest(); if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw ApiError.badRequest('Invalid billing webhook signature');
 let event; try { event = JSON.parse(raw.toString('utf8')); } catch { throw ApiError.badRequest('Invalid billing webhook'); }
 if (event.account_id !== config.accountId || event.entity !== 'event') throw ApiError.badRequest('Billing webhook account does not match'); return event;
}
module.exports = { configuration, configured, request, plan, verify, safeLink, idOf };
