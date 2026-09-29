const Counter = require('../models/Counter');

module.exports = async function generateOrderNumber() {
  const counter = await Counter.findByIdAndUpdate(
    'order-number',
    { $inc: { value: 1 } },
    { upsert: true, new: true },
  );
  return `TGB-${String(counter.value).padStart(6, '0')}`;
};
