const ExcelJS = require('exceljs');

// Plain string cell values remain text, even when user input starts with '='.
async function buildOrdersWorkbook(orders) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Orders', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Order number', key: 'number', width: 24 },
    { header: 'Source', key: 'source', width: 16 },
    { header: 'Event / Stall', key: 'event', width: 28 },
    { header: 'Products', key: 'products', width: 55 },
    { header: 'Quantity', key: 'quantity', width: 12 },
    { header: 'Total', key: 'total', width: 16 },
    { header: 'Currency', key: 'currency', width: 12 },
    { header: 'Payment method', key: 'method', width: 20 },
    { header: 'Payment status', key: 'payment', width: 20 },
    { header: 'Order status', key: 'status', width: 18 },
    { header: 'Placed (IST)', key: 'placed', width: 24 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF63452C' } };
  for await (const order of orders) {
    const row = sheet.addRow({
      number: order.orderNumber, source: order.source || 'website', event: order.eventName || '',
      products: order.items.map(item => `${item.name} × ${item.quantity}`).join('\n'),
      quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
      total: order.pricing.total, currency: (order.pricing.currency || 'inr').toUpperCase(),
      method: order.paymentMethod || '', payment: order.paymentStatus, status: order.orderStatus,
      // Excel dates have no timezone; shift the instant to display the store's IST wall time.
      placed: new Date(new Date(order.createdAt).getTime() + 330 * 60 * 1000),
    });
    row.getCell('products').alignment = { wrapText: true, vertical: 'top' };
    row.height = Math.max(20, order.items.length * 16);
  }
  sheet.getColumn('total').numFmt = '#,##0.00';
  sheet.getColumn('placed').numFmt = 'dd-mmm-yyyy hh:mm';
  sheet.autoFilter = { from: 'A1', to: `K${sheet.rowCount}` };
  return workbook;
}

module.exports = { buildOrdersWorkbook };
