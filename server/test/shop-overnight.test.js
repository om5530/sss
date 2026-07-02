// Overnight opening windows (close < open) must wrap past midnight rather
// than silently becoming "always closed". Pure unit test with fixed instants.
process.env.SHOP_OPENS = '20:00';
process.env.SHOP_CLOSES = '01:00';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isOpenAt } = require('../src/services/shop.service');

// Helper: an instant at the given IST wall-clock time (date is arbitrary).
const atIST = (h, m = 0) => new Date(Date.UTC(2026, 0, 15, h, m) - 5.5 * 60 * 60 * 1000);

test('a 20:00–01:00 window is open in the evening and past midnight, closed midday', () => {
  assert.equal(isOpenAt(atIST(21, 0)), true); // 9 pm IST
  assert.equal(isOpenAt(atIST(0, 30)), true); // 12:30 am IST
  assert.equal(isOpenAt(atIST(12, 0)), false); // noon IST
  assert.equal(isOpenAt(atIST(19, 59)), false); // one minute before opening
  assert.equal(isOpenAt(atIST(1, 0)), false); // exactly at close
});
