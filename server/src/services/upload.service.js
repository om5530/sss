const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const env = require('../config/env');

// Where local uploads live; served at /api/uploads (registered in app.js so it
// rides through the dev proxy and any same-origin reverse proxy in prod).
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function isCloudinaryEnabled() {
  const c = env.cloudinary;
  return Boolean(c.cloudName && c.apiKey && c.apiSecret);
}

/**
 * Stores an image buffer and returns its public URL.
 * Cloudinary when configured (CDN, survives redeploys); local disk otherwise.
 */
async function storeImage(buffer, mimetype, folder = 'sss') {
  const ext = EXT_BY_MIME[mimetype];
  if (!ext) throw new Error('Unsupported image type');

  if (isCloudinaryEnabled()) return uploadToCloudinary(buffer, mimetype, folder);

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
  await fs.writeFile(path.join(UPLOAD_DIR, name), buffer);
  return `/api/uploads/${name}`;
}

/** Signed Cloudinary upload via their REST API — no SDK needed. */
async function uploadToCloudinary(buffer, mimetype, folder) {
  const { cloudName, apiKey, apiSecret } = env.cloudinary;
  const timestamp = Math.floor(Date.now() / 1000);
  // Signature: sha1 of the alphabetically-sorted params + api secret.
  const signature = crypto
    .createHash('sha1')
    .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
    .digest('hex');

  const form = new FormData();
  form.append('file', `data:${mimetype};base64,${buffer.toString('base64')}`);
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: form,
  });
  const body = await res.json();
  if (!res.ok || !body.secure_url) {
    throw new Error(body?.error?.message || 'Cloudinary upload failed');
  }
  return body.secure_url;
}

module.exports = { storeImage, isCloudinaryEnabled, UPLOAD_DIR, EXT_BY_MIME };
