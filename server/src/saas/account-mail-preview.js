const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { foundationAvailable, foundationDatabaseAllowed } = require('../config/saas-foundation');
const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
function previewKey() {
 const key = process.env.SAAS_LOCAL_OWNER_MAIL_PREVIEW_KEY;
 if (!foundationAvailable() || !foundationDatabaseAllowed(mongoose.connection) || !/^[a-f0-9]{64}$/i.test(key || '')) throw new ApiError(503, 'Local workspace-mail preview is not configured. No email was sent');
 return Buffer.from(key, 'hex');
}
const aad = row => Buffer.from(`workspace-account:v1:${row.accountId}:${row.actionId}:${row.purpose}`);
function encryptToken(token, row, key = previewKey()) {
 const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad(row));
 return { ciphertext: Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]).toString('hex'), iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
}
function decryptToken(row) {
 const decipher = createDecipheriv('aes-256-gcm', previewKey(), Buffer.from(row.iv, 'hex')); decipher.setAAD(aad(row)); decipher.setAuthTag(Buffer.from(row.tag, 'hex'));
 return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'hex')), decipher.final()]).toString('utf8');
}
module.exports = { previewKey, encryptToken, decryptToken };
