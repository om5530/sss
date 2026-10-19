const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { buildOrdersWorkbook } = require('../src/services/order-export.service');

test('exports every order with numeric zero totals, quantities, IST dates, and safe text', async () => {
  const orders = Array.from({ length: 91 }, (_, i) => ({
    orderNumber: `ORDER-${i}`, source: 'event', eventName: '=1+1',
    items: [{ name: 'Cheesecake', quantity: 2 }, { name: 'Muffin', quantity: 1 }],
    pricing: { total: i === 0 ? 0 : 199, currency: 'inr' }, paymentMethod: 'cash',
    paymentStatus: 'paid', orderStatus: 'completed', createdAt: new Date('2026-10-19T07:00:00Z'),
  }));
  async function* cursor() { yield* orders; }
  const workbook = await buildOrdersWorkbook(cursor());
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = reloaded.getWorksheet('Orders');
  assert.equal(sheet.rowCount, 92);
  assert.equal(sheet.getCell('F2').value, 0);
  assert.equal(sheet.getCell('E2').value, 3);
  assert.equal(sheet.getCell('D2').value, 'Cheesecake × 2\nMuffin × 1');
  assert.equal(sheet.getCell('C2').type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('C2').value, '=1+1');
  assert.equal(sheet.getCell('K2').value.toISOString(), '2026-10-19T12:30:00.000Z');
});

test('empty exports retain column headers', async () => {
  const workbook = await buildOrdersWorkbook([]);
  assert.equal(workbook.getWorksheet('Orders').rowCount, 1);
});
