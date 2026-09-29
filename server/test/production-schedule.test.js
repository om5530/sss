const { test } = require('node:test');
const assert = require('node:assert/strict');
const { groupProductionPlans } = require('../src/services/production-schedule.service');

test('past production is overdue; today and future plans are upcoming in date order', () => {
  const past = { requiredDate: '2026-09-22' };
  const today = { requiredDate: '2026-09-29' };
  const future = { requiredDate: '2026-10-01' };
  const undated = {};
  const result = groupProductionPlans([future, past, undated, today], new Date('2026-09-29T10:00:00Z'));
  assert.deepEqual(result.overduePlans, [past]);
  assert.deepEqual(result.upcomingPlans, [today, future]);
  assert.deepEqual(result.undatedPlans, [undated]);
});

test('classification changes at midnight in India and keeps all of today upcoming', () => {
  const yesterday = { requiredDate: '2026-09-28T00:00:00Z' };
  const midnight = { requiredDate: '2026-09-28T18:30:00Z' };
  const before = groupProductionPlans([yesterday, midnight], new Date('2026-09-28T18:29:59Z'));
  assert.deepEqual(before.upcomingPlans, [yesterday, midnight]);
  const after = groupProductionPlans([yesterday, midnight], new Date('2026-09-28T18:30:00Z'));
  assert.deepEqual(after.overduePlans, [yesterday]);
  assert.deepEqual(after.upcomingPlans, [midnight]);
  const end = groupProductionPlans([midnight], new Date('2026-09-29T18:29:59Z'));
  assert.deepEqual(end.upcomingPlans, [midnight]);
});
