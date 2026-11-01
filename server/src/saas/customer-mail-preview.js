const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { foundationAvailable, foundationDatabaseAllowed } = require('../config/saas-foundation');
const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
function previewKey() {
  const value = process.env.SAAS_LOCAL_MAIL_PREVIEW_KEY;
  if (!foundationAvailable() || !foundationDatabaseAllowed(mongoose.connection) || typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw new ApiError(503, 'Local account-mail preview is not configured. No email was sent');
  return Buffer.from(value, 'hex');
}
const aadOf = row => Buffer.from(`${row.bakeryId}:${row.customerId}:${row.actionId}:${row.purpose}`, 'utf8');
function encryptToken(token, context, key = previewKey()) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aadOf(context));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('hex'), iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
}
function decryptToken(row) {
  const decipher = createDecipheriv('aes-256-gcm', previewKey(), Buffer.from(row.iv, 'hex')); decipher.setAAD(aadOf(row)); decipher.setAuthTag(Buffer.from(row.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'hex')), decipher.final()]).toString('utf8');
}
module.exports = { previewKey, encryptToken, decryptToken };
