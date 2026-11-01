const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const ApiError = require('../utils/ApiError');
const derive = promisify(scrypt);
function passwordOf(value) {
  if (typeof value !== 'string' || !value.trim() || value.length < 12 || value.length > 128 || Buffer.byteLength(value, 'utf8') > 512) throw ApiError.badRequest('Use a password with 12–128 characters');
  return value;
}
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex'), hash = await derive(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt-v1:${salt}:${hash.toString('hex')}`;
}
async function matches(password, encoded) {
  const [salt, hash] = /^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded || '') ? encoded.split(':').slice(1) : ['0'.repeat(32), '0'.repeat(128)];
  const actual = await derive(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(hash, 'hex')) && !!encoded;
}
module.exports = { passwordOf, hashPassword, matches };
