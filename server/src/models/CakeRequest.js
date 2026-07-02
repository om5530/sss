const mongoose = require('mongoose');

// A custom-cake brief from the storefront. Staff triage it in the admin panel:
// new → quoted → accepted / declined → closed.
const cakeRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
    occasion: { type: String, required: true, trim: true, maxlength: 60 },
    servings: { type: Number, required: true, min: 1, max: 500 },
    flavour: { type: String, required: true, trim: true, maxlength: 80 },
    messageOnCake: { type: String, trim: true, maxlength: 120, default: '' },
    dateNeeded: { type: Date, required: true },
    details: { type: String, trim: true, maxlength: 2000, default: '' },
    referenceImage: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['new', 'quoted', 'accepted', 'declined', 'closed'], default: 'new', index: true },
    // Staff's quoted price + note, shared back with the customer by phone.
    quote: {
      amount: { type: Number, default: null },
      note: { type: String, trim: true, maxlength: 500, default: '' },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('CakeRequest', cakeRequestSchema);
