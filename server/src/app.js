const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const env = require('./config/env');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const paymentController = require('./controllers/payment.controller');
const { UPLOAD_DIR } = require('./services/upload.service');

const app = express();

// Behind a reverse proxy (nginx/Caddy) the client IP arrives in
// X-Forwarded-For; without this, every visitor shares the proxy's IP and the
// per-IP rate limits throttle everyone at once.
if (env.isProd) app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: env.clientUrl, credentials: true }));
if (!env.isProd) app.use(morgan('dev'));
app.use(cookieParser());

// Payment webhooks must receive the raw body (signatures are computed over
// the exact bytes), so they are registered before the JSON body parser.
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), paymentController.webhook);
app.post('/api/payments/razorpay-webhook', express.raw({ type: 'application/json' }), paymentController.razorpayWebhook);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Locally-stored uploads (product photos, cake references). Under /api so the
// dev proxy and any same-origin reverse proxy forward them unchanged.
app.use('/api/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false }));

app.get('/', (req, res) =>
  res.json({ name: 'Bakery & Café API', version: '1.0.0', health: '/api/health' }),
);

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
