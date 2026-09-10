const { dec } = require("../services/bakeryCost.service");
// Decimal strings preserve all digits in MongoDB and JSON.
module.exports = function bakeryDecimal(schema, fields) {
  for (const name of fields) {
    const old = schema.path(name).options;
    schema.remove(name);
    schema.add({
      [name]: {
        type: String,
        default: old.default == null ? old.default : String(old.default),
        required: old.required,
        set: (value) =>
          value == null
            ? value
            : dec(value, name, Number(old.min) > 0).toString(),
      },
    });
  }
};
