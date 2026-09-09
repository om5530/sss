const env = require('../config/env');

// The store's day runs on IST regardless of where the server runs
// (same convention as the admin reports).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const parseHHMM = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins >= 0 && mins <= 24 * 60 ? mins : null;
};

/** Minutes since IST midnight for a given instant. */
function istMinutes(date) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function windowMinutes(settings = env.shop) {
  const open = parseHHMM(settings.opensAt) ?? 8 * 60;
  const close = parseHHMM(settings.closesAt) ?? 22 * 60;
  return { open, close };
}

/** True when the shop accepts orders at the given instant (default: now). */
function isOpenAt(date = new Date(), settings) {
  const { open, close } = windowMinutes(settings);
  const mins = istMinutes(date);
  // Overnight window (e.g. 20:00–01:00) wraps past midnight. opens === closes
  // stays "always closed" because the strict < never matches.
  if (close < open) return mins >= open || mins < close;
  return mins >= open && mins < close;
}

function shopInfo(settings = env.shop) {
  return {
    opensAt: settings.opensAt,
    closesAt: settings.closesAt,
    openNow: isOpenAt(new Date(), settings),
    timezone: 'Asia/Kolkata',
    contactAddress: settings.contactAddress || '',
    contactPhone: settings.contactPhone || '',
    contactEmail: settings.contactEmail || '',
  };
}

module.exports = { isOpenAt, shopInfo };
