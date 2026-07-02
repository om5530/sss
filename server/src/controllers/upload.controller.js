const multer = require('multer');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { storeImage, EXT_BY_MIME } = require('../services/upload.service');

// In-memory buffer → storage backend (disk or Cloudinary). 5 MB cap; photos
// straight off a phone camera compress well under that once resized client-side,
// and anything larger is likely abuse.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (EXT_BY_MIME[file.mimetype]) cb(null, true);
    else cb(new ApiError(400, 'Only JPEG, PNG or WebP images are allowed'));
  },
}).single('image');

/** Wraps multer so its errors flow through the normal error handler. */
function acceptImage(req, res, next) {
  imageUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(ApiError.badRequest('Image is too large — 5 MB max'));
    next(err.statusCode ? err : ApiError.badRequest(err.message || 'Upload failed'));
  });
}

/** Admin: product photos. */
const uploadProductImage = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Attach an image in the "image" field');
  const url = await storeImage(req.file.buffer, req.file.mimetype, 'sss-products');
  res.status(201).json({ success: true, url });
});

/** Public (rate-limited): reference photos for custom-cake requests. */
const uploadCakeReference = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Attach an image in the "image" field');
  const url = await storeImage(req.file.buffer, req.file.mimetype, 'sss-cake-refs');
  res.status(201).json({ success: true, url });
});

module.exports = { acceptImage, uploadProductImage, uploadCakeReference };
