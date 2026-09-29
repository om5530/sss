const ApiError = require('../utils/ApiError');
const { Decimal, dec } = require('./bakeryCost.service');

const istOffset = 330 * 60 * 1000;
function indiaDay(value = new Date()) {
  return new Date(new Date(value).getTime() + istOffset).toISOString().slice(0, 10);
}

function purchaseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw ApiError.badRequest('Please choose a valid purchase date');
  }
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw ApiError.badRequest('Please choose a valid purchase date');
  }
  if (value > indiaDay()) throw ApiError.badRequest('Purchase date cannot be in the future');
  return new Date(parsed.getTime() - istOffset);
}

function monthRange(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw ApiError.badRequest('Please choose a valid month');
  }
  const start = new Date(value + '-01T00:00:00.000Z');
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { $gte: new Date(start.getTime() - istOffset), $lt: new Date(end.getTime() - istOffset) };
}

function receiptTotal(receipt) {
  return (receipt.lines || []).reduce((total, line) =>
    total.add(line.totalPaid != null ? dec(line.totalPaid) : dec(line.purchasePrice || 0).mul(line.packs || 0)),
  new Decimal(0)).toString();
}

function summarizeMonths(months, selectedMonth, now = new Date()) {
  const today = indiaDay(now);
  const total = (rows) => rows.reduce((sum, row) => sum.add(row.total), new Decimal(0)).toString();
  return {
    allTime: total(months),
    thisMonth: total(months.filter(row => row.month === today.slice(0, 7))),
    thisYear: total(months.filter(row => row.month.startsWith(today.slice(0, 4) + '-'))),
    selectedTotal: total(months.filter(row => !selectedMonth || row.month === selectedMonth)),
    count: months.reduce((sum, row) => sum + row.count, 0),
  };
}

module.exports = { indiaDay, purchaseDate, monthRange, receiptTotal, summarizeMonths };
