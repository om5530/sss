const crypto = require('crypto');

module.exports = function generateOrderNumber() {
  return `BC-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
};
