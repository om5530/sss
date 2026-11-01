const { menuImages } = require('../saas/media-public');
const { THEMES, defaults: brandingDefaults, brandingOf } = require('../saas/storefront-branding');
const { subscriptionPolicy } = require('../saas/plan-policy');
const Bakery = require('../models/Bakery');
const Storefront = require('../models/SaasStorefront');
const Product = require('../models/SaasProduct');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { fields, text, integer } = require('../saas/recipe-input');
const { ownerWrite } = require('../saas/owner-write');
const { auditReady, recordAudit } = require('../saas/audit');
const DEFAULTS = { ...brandingDefaults, pickupReservationMinutes: 30, acceptCustomerOrders: false, published: false, tagline: '', description: '', contactPhone: '', contactEmail: '', address: '', openingHours: '', showUnavailable: false };
const KEYS = Object.keys(DEFAULTS);
const view = value => ({ ...Object.fromEntries([...KEYS, 'version'].map(key => [key, key === 'acceptCustomerOrders' ? Boolean(value[key]) : key === 'pickupReservationMinutes' ? (value[key] ?? 30) : value[key]])), ...brandingOf(value) });
const getLink = asyncHandler(async (req, res) => {
 fields(req.query, []); let link;
 const staging = require('../config/saas-staging');
 try {
  if (staging.stagingAvailable()) {
   const origin = staging.stagingOrigin(req); if (!origin) throw new Error('Invalid staging origin');
   const path = `/b/${req.bakery.slug}`; link = { path, url: `${origin}${path}` };
  } else link = require('../config/saas-local-routing').menuLink(req.bakery.slug, process.env.SAAS_LOCAL_PUBLIC_ORIGIN ?? require('../config/env').clientUrl);
 }
 catch { throw new ApiError(503, 'Configure a loopback local public origin before creating a menu link'); }
 const settings = await Storefront.findOne({bakeryId:req.bakeryContext.bakeryId}).select('published').lean();
 res.json({link:{...link,published:Boolean(settings?.published),scope:staging.stagingAvailable()?'staging-preview':'local-preview'}});
});
const getSettings = asyncHandler(async (req, res) => {
  const settings = await Storefront.findOne({ bakeryId: req.bakeryContext.bakeryId }).lean();
  res.json({ success: true, settings: settings ? view(settings) : { ...DEFAULTS, version: 0 } });
});
const updateSettings = asyncHandler(async (req, res) => {
  fields(req.body, [...KEYS, 'expectedVersion']);
  const expected = integer(req.body.expectedVersion, 'expectedVersion', 0, Number.MAX_SAFE_INTEGER), data = {};
  for (const key of Object.keys(req.body).filter(key => key !== 'expectedVersion')) {
    if (['published', 'showUnavailable', 'acceptCustomerOrders'].includes(key)) {
      if (typeof req.body[key] !== 'boolean') throw ApiError.badRequest(`Invalid ${key}`);
      data[key] = req.body[key];
    } else if (key === 'brandTheme') { if (!THEMES.includes(req.body[key])) throw ApiError.badRequest('Choose a supported menu theme'); data[key] = req.body[key]; }
    else if (key === 'brandMark') { data[key] = text(req.body[key], key, 4, true).toUpperCase(); if (!/^[A-Z0-9]{0,4}$/.test(data[key])) throw ApiError.badRequest('Brand mark must be up to four letters A–Z or digits'); }
    else if (key === 'pickupReservationMinutes') data[key] = integer(req.body[key], key, 5, 1440);
    else data[key] = text(req.body[key], key, { tagline: 200, description: 2000, contactPhone: 30, contactEmail: 254, address: 500, openingHours: 200 }[key], true);
  }
  if (!Object.keys(data).length) throw ApiError.badRequest('No settings changes supplied');
  if (data.contactPhone && !/^[+0-9 ()-]{3,30}$/.test(data.contactPhone)) throw ApiError.badRequest('Invalid contact phone');
  if (data.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contactEmail)) throw ApiError.badRequest('Invalid contact email');
  await Promise.all([Storefront.init(), auditReady()]);
  const settings = await ownerWrite(req.bakeryContext, async session => {
    let current = await Storefront.findOne({ bakeryId: req.bakeryContext.bakeryId }).session(session);
    if ((current?.version || 0) !== expected) throw ApiError.conflict('Settings changed. Reload before saving');
    if (!current) [current] = await Storefront.create([{ bakeryId: req.bakeryContext.bakeryId, ...data }], { session });
    else { Object.assign(current, data); current.version++; await current.save({ session }); }
    await recordAudit(session, { bakeryId: req.bakeryContext.bakeryId, actorId: req.user._id, action: 'settings.update',
      entityId: current._id, fromVersion: expected, toVersion: current.version, fields: Object.keys(data) });
    return current;
  });
  res.json({ success: true, settings: view(settings) });
});
const menu = asyncHandler(async (req, res) => {
  const slug = req.params.slug;
  if (typeof slug !== 'string' || slug.length > 60 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw ApiError.notFound('Menu not found');
  fields(req.query, ['limit', 'cursor']);
  const { limit = '50', cursor } = req.query;
  if (typeof limit !== 'string' || !/^\d{1,3}$/.test(limit) || +limit < 1 || +limit > 100
    || (cursor !== undefined && (typeof cursor !== 'string' || !/^[a-f0-9]{24}$/i.test(cursor)))) throw ApiError.badRequest('Invalid menu pagination');
  const bakery = await Bakery.findOne({ slug, status: 'active' }).select('name slug currency timezone subscription').lean();
  if (!bakery) throw ApiError.notFound('Menu not found');
  const settings = await Storefront.findOne({ bakeryId: bakery._id, published: true }).lean();
  if (!settings) throw ApiError.notFound('Menu not found');
  const filter = { bakeryId: bakery._id, archived: false };
  if (cursor) filter._id = { $lt: cursor };
  if (!settings.showUnavailable) { filter.available = true; filter.$or = [{ stockCount: null }, { stockCount: { $gt: 0 } }]; }
  const products = await Product.find(filter).sort({ _id: -1 }).limit(+limit + 1).lean();
  const more = products.length > +limit; if (more) products.pop();
  const images = await menuImages(bakery, products.map(product => product._id));
  // Deliberate public whitelist: never include stock quantities, ingredient
  // costs, recipe mappings, owner identities or operational versions.
  res.json({ success: true, bakery: { name: bakery.name, slug: bakery.slug, currency: bakery.currency, timezone: bakery.timezone },
    orderingEnabled: Boolean(settings.acceptCustomerOrders && subscriptionPolicy(bakery.subscription).writable),
    profile: { logo: images.logo, ...brandingOf(settings), ...Object.fromEntries(['tagline', 'description', 'contactPhone', 'contactEmail', 'address', 'openingHours'].map(key => [key, settings[key]])) },
    products: products.map(product => ({ id: String(product._id), name: product.name, slug: product.slug, category: product.category,
      image: images.products.get(String(product._id)) || null, description: product.description, dietary: product.dietary, pricePaise: product.pricePaise, available: product.available && product.stockCount !== 0 })),
    nextCursor: more ? String(products.at(-1)._id) : null });
});
module.exports = { getLink, getSettings, updateSettings, menu };
