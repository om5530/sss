const { randomUUID } = require("crypto");
const mongoose = require("mongoose");
const O = require("../models/BakeryOperations");
async function transaction(fn) {
  try {
    await O.Migration.updateOne(
      { key: "write-guard" },
      { $setOnInsert: { notes: "" } },
      { upsert: true },
    );
  } catch (e) {
    if (e.code !== 11000) throw e;
  }
  return mongoose.connection.transaction(async (session) => {
    await O.Migration.updateOne(
      { key: "write-guard" },
      { $set: { notes: randomUUID() } },
      { session },
    );
    return fn(session);
  });
}
module.exports = { transaction };
