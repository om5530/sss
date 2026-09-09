const { test } = require('node:test');
const assert = require('node:assert/strict');
const env = require('../src/config/env');
const { verifiedPhone } = require('../src/services/firebase.service');
test('verified Firebase claims require recent phone authentication', () => {
  const claims = { uid: 'test-user', phone_number: '+919999000123', auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'phone' } };
  assert.equal(verifiedPhone(claims).phone, claims.phone_number);
  assert.throws(() => verifiedPhone({ ...claims, firebase: { sign_in_provider: 'password' } }));
  assert.throws(() => verifiedPhone({ ...claims, auth_time: claims.auth_time - 3600 }));
  assert.throws(() => verifiedPhone({ ...claims, phone_number: '' }));
});
test('production and unsupported providers cannot send or verify mock OTPs', async () => {
  const otp = require('../src/services/otp.service');
  const previous = { isProd: env.isProd, provider: env.otp.provider };
  try {
    env.isProd = true;
    await assert.rejects(otp.createOtp('+919999000123'), /secure phone/);
    await assert.rejects(otp.verifyOtp('+919999000123', '123456'), /secure phone/);
    env.isProd = false;
    env.otp.provider = 'unimplemented-provider';
    await assert.rejects(otp.createOtp('+919999000123'), /secure phone/);
  } finally { env.isProd = previous.isProd; env.otp.provider = previous.provider; }
});
