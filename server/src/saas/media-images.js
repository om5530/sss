const sharp = require('sharp');
const { createHash } = require('node:crypto');
const ApiError = require('../utils/ApiError');
let inFlight = 0;
const MAX_INPUT = 512 * 1024, MAX_OUTPUT = 128 * 1024;
async function normalizeImage(encoded, kind) {
 if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_INPUT / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw ApiError.badRequest('Choose a JPEG, PNG or WebP image up to 512 KiB');
 const input = Buffer.from(encoded, 'base64');
 if (!input.length || input.length > MAX_INPUT || input.toString('base64') !== encoded) throw ApiError.badRequest('Invalid image encoding');
 const format = input.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' : input[0] === 255 && input[1] === 216 && input[2] === 255 ? 'jpeg' : input.toString('ascii',0,4) === 'RIFF' && input.toString('ascii',8,12) === 'WEBP' ? 'webp' : '';
 if (!format) throw ApiError.badRequest('Only JPEG, PNG and WebP images are supported');
 if (inFlight >= 2) throw new ApiError(429, 'Image processing is busy. Try again shortly');
 inFlight++;
 try {
  const image = sharp(input, { limitInputPixels: 8000000, failOn: 'warning' }), metadata = await image.metadata();
  if (metadata.format !== format || !metadata.width || !metadata.height || (metadata.pages || 1) !== 1) throw new Error('Unsupported image');
  const size = kind === 'logo' ? 512 : 800;
  const { data, info } = await image.rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
  if (data.length > MAX_OUTPUT) throw ApiError.badRequest('Image is too detailed. Choose a smaller image');
  return { bytes: data, hash: createHash('sha256').update(data).digest('hex'), byteLength: data.length, width: info.width, height: info.height };
 } catch (error) { if (error instanceof ApiError) throw error; throw ApiError.badRequest('Could not decode this image. Use a single-frame JPEG, PNG or WebP'); }
 finally { inFlight--; }
}
module.exports = { normalizeImage, MAX_INPUT, MAX_OUTPUT };
