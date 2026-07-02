const crypto = require('crypto');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const Otp = require('../models/Otp');

function generateCode(length) {
  const max = 10 ** length;
  return crypto.randomInt(0, max).toString().padStart(length, '0');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

async function createOtp(phone) {
  // Enforce a resend cooldown to prevent SMS spamming.
  const recent = await Otp.findOne({ phone, consumed: false }).sort({ createdAt: -1 });
  if (recent) {
    const ageMs = Date.now() - recent.createdAt.getTime();
    const cooldownMs = env.otp.resendCooldownSeconds * 1000;
    if (ageMs < cooldownMs) {
      throw ApiError.badRequest(
        `Please wait ${Math.ceil((cooldownMs - ageMs) / 1000)}s before requesting another OTP`,
      );
    }
  }

  const code = generateCode(env.otp.length);
  const expiresAt = new Date(Date.now() + env.otp.ttlSeconds * 1000);

  // Invalidate any previous unconsumed codes for this number.
  await Otp.updateMany({ phone, consumed: false }, { consumed: true });
  await Otp.create({ phone, codeHash: hashCode(code), expiresAt });

  await deliverOtp(phone, code);

  // In mock mode (no SMS provider) surface the code so it can be used in dev/demo.
  const exposeCode = env.otp.provider === 'mock' && !env.isProd;
  return { expiresInSeconds: env.otp.ttlSeconds, devCode: exposeCode ? code : undefined };
}

async function deliverOtp(phone, code) {
  if (env.otp.provider === 'mock') {
    console.log(`[otp] (mock) Code for ${phone} is ${code} — valid ${env.otp.ttlSeconds}s`);
    return;
  }
  // Integrate a real SMS provider (Twilio, MSG91, etc.) here.
  console.warn(`[otp] Provider "${env.otp.provider}" not implemented; logging code for ${phone}: ${code}`);
}

async function verifyOtp(phone, code) {
  const otp = await Otp.findOne({ phone, consumed: false }).sort({ createdAt: -1 });
  if (!otp) {
    return { ok: false, reason: 'No active OTP for this number. Please request a new code.' };
  }
  if (otp.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'OTP has expired. Please request a new code.' };
  }
  if (otp.attempts >= 5) {
    otp.consumed = true;
    await otp.save();
    return { ok: false, reason: 'Too many incorrect attempts. Please request a new code.' };
  }
  if (otp.codeHash !== hashCode(code)) {
    otp.attempts += 1;
    await otp.save();
    return { ok: false, reason: 'Incorrect OTP. Please try again.' };
  }

  otp.consumed = true;
  await otp.save();
  return { ok: true };
}

module.exports = { createOtp, verifyOtp };
