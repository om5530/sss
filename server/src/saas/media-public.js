const Media = require('../models/SaasMedia');
const publicImage = (slug, row) => row ? { path: `/saas/storefront/${encodeURIComponent(slug)}/media/${row._id}/${row.version}-${row.hash}.webp`, width: row.width, height: row.height } : null;
async function menuImages(bakery, productIds) {
 const rows = await Media.find({ bakeryId: bakery._id, active: true, $or: [{ kind: 'logo', targetId: bakery._id }, { kind: 'product', targetId: { $in: productIds } }] }).select('_id kind targetId version hash width height').lean();
 return { logo: publicImage(bakery.slug, rows.find(row => row.kind === 'logo')), products: new Map(rows.filter(row => row.kind === 'product').map(row => [String(row.targetId), publicImage(bakery.slug, row)])) };
}
module.exports = { menuImages, publicImage };
