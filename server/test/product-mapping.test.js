process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Product = require('../src/models/Product');
const Recipe = require('../src/models/BakeryRecipe');
const Order = require('../src/models/Order');
let database, server, base, token, customerToken;
async function api(method, path, body, auth = token) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, ...(await response.json()) };
}
before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(database.getUri());
  const User = require('../src/models/User');
  const { signToken } = require('../src/services/token.service');
  token = signToken(await User.create({ name: 'Mapping admin', role: 'admin' }));
  customerToken = signToken(await User.create({ name: 'Customer' }));
  await Promise.all([Recipe.init(), Product.init(), Order.init()]);
  server = require('../src/app').listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (database) await database.stop();
});
async function fixture(name) {
  const product = await Product.create({ name, slug: name.toLowerCase(), group: 'bakery', category: 'Cakes', price: 9 });
  const recipe = await Recipe.create({ name: `${name} recipe`, yieldQuantity: 1, yieldUom: 'cake', piecesPerBatch: 4, targetMarkupPercent: 100,
    components: [{ componentType: 'other', name: 'Batch ingredients', itemType: 'other', quantity: 1, uom: 'piece', unitCost: '80' }] });
  return { product, recipe };
}

test('legacy recipes without a stored version can be edited from the recipe list', async () => {
  const { recipe } = await fixture('Legacy cookies');
  await Recipe.collection.updateOne({ _id: recipe._id }, { $unset: { version: '' } });
  const listed = await api('GET', '/admin/bakery/recipes');
  const editable = listed.recipes.find((item) => item._id === String(recipe._id));
  assert.equal(editable.version, 1);
  const saved = await api('PATCH', `/admin/bakery/recipes/${recipe._id}`, {
    ...editable, notes: 'Updated cookie recipe',
  });
  assert.equal(saved.status, 200, saved.message);
  assert.equal(saved.recipe.notes, 'Updated cookie recipe');
  assert.equal(saved.recipe.version, 2);
  const stale = await api('PATCH', `/admin/bakery/recipes/${recipe._id}`, {
    ...editable, notes: 'Stale update',
  });
  assert.equal(stale.status, 409);
});
async function mapProduct(product, recipe) {
  const report = await api('GET', '/admin/bakery/product-mappings');
  assert.equal(report.status, 200, JSON.stringify(report));
  const row = report.products.find((p) => p._id === String(product._id));
  const choice = report.recipes.find((r) => r.recipeId === String(recipe?._id));
  return api('PATCH', `/admin/bakery/product-mappings/${product._id}`, { recipeId: recipe ? String(recipe._id) : null,
    expectedRecipeId: row.recipeId, expectedUpdatedAt: row.updatedAt, expectedVersion: choice?.version });
}
test('mapping endpoints require admin access and reject malformed updates', async () => {
  assert.equal((await api('GET', '/admin/bakery/product-mappings', undefined, null)).status, 401);
  assert.equal((await api('GET', '/admin/bakery/product-mappings', undefined, customerToken)).status, 403);
  assert.equal((await api('PATCH', '/admin/bakery/product-mappings/invalid', {})).status, 400);
});
test('mapping includes unavailable and sold-out products, including their links, while excluding archived products', async () => {
  const linked = await fixture('Unavailable-linked');
  assert.equal((await mapProduct(linked.product, linked.recipe)).status, 200);
  await Product.updateOne({ _id: linked.product._id }, { available: false });
  const soldOut = await fixture('Sold-out-mapping');
  await Product.updateOne({ _id: soldOut.product._id }, { available: false, stockCount: 0, stockSoldOut: true });
  const archived = await fixture('Archived-mapping');
  await Product.updateOne({ _id: archived.product._id }, { archived: true });
  const result = await api('GET', '/admin/bakery/product-mappings');
  assert.equal(result.status, 200);
  assert.equal(result.products.find(p => p._id === String(linked.product._id))?.recipeId, String(linked.recipe._id));
  assert.ok(result.products.some(p => p._id === String(soldOut.product._id)));
  assert.ok(!result.products.some(p => p._id === String(archived.product._id)));
  assert.equal((await mapProduct(soldOut.product, soldOut.recipe)).status, 200);
  assert.equal((await Product.findById(soldOut.product._id)).available, false);
});

test('linked products use per-piece recipe pricing in the catalogue and quotes', async () => {
  const { product, recipe } = await fixture('Slices');
  const preview = await api('GET', '/admin/bakery/product-mappings');
  const choice = preview.recipes.find((r) => r.recipeId === String(recipe._id));
  assert.equal(choice.unitCost, '20'); assert.equal(choice.sellingPrice, 40); assert.equal(choice.marginPercent, 50);
  assert.equal((await mapProduct(product, recipe)).status, 200);
  assert.equal((await Product.findById(product._id)).price, 40);
  const catalogue = await api('GET', '/products/slices', undefined, null);
  assert.equal(catalogue.product.price, 40); assert.equal(catalogue.product.unitCost, undefined);
  const quote = await api('POST', '/admin/orders/quote', { items: [{ productId: String(product._id), quantity: 2 }], orderType: 'takeaway' });
  assert.equal(quote.items[0].price, 40); assert.equal(quote.pricing.subtotal, 80);
  assert.equal(quote.recipeCostSnapshot, undefined);
  assert.equal((await api('PATCH', `/admin/products/${product._id}`, { price: 1 })).status, 409);
});

test('recipe saves clear existing archived or deleted product links with a notice', async () => {
  for (const state of ['archived', 'deleted']) {
    const { product, recipe } = await fixture(`Cookies-${state}`);
    assert.equal((await mapProduct(product, recipe)).status, 200);
    if (state === 'archived') await Product.updateOne({ _id: product._id }, { archived: true });
    else await Product.deleteOne({ _id: product._id });
    const saved = await api('PATCH', `/admin/bakery/recipes/${recipe._id}`, {
      version: recipe.version, notes: 'Cookie recipe changes', productId: String(product._id),
    });
    assert.equal(saved.status, 200, saved.message);
    assert.match(saved.message, /link.*removed/);
    assert.equal(saved.recipe.productId, null);
    assert.equal(saved.recipe.notes, 'Cookie recipe changes');
    assert.equal((await Recipe.findById(recipe._id)).productId, null);
    if (state === 'archived') {
      const retained = await Product.findById(product._id);
      assert.equal(retained.archived, true);
      assert.equal(retained.price, 40);
    }
  }
});

test('saving a sold-out linked recipe preserves its link and updates its product price', async () => {
  const { product, recipe } = await fixture('Sold-out-save');
  assert.equal((await mapProduct(product, recipe)).status, 200);
  await Product.updateOne({ _id: product._id }, { available: false, stockCount: 0, stockSoldOut: true });
  const saved = await api('PATCH', `/admin/bakery/recipes/${recipe._id}`, {
    version: recipe.version, manualSellingPricePerPiece: 55,
  });
  assert.equal(saved.status, 200, saved.message);
  assert.equal(saved.recipe.productId, String(product._id));
  const retained = await Product.findById(product._id);
  assert.equal(retained.price, 55);
  assert.equal(retained.available, false);
});

test('new links to unavailable products are rejected without changing the recipe', async () => {
  const { product, recipe } = await fixture('Invalid-new-link');
  await Product.updateOne({ _id: product._id }, { archived: true });
  const saved = await api('PATCH', `/admin/bakery/recipes/${recipe._id}`, {
    version: recipe.version, productId: String(product._id), notes: 'Must not save',
  });
  assert.equal(saved.status, 400);
  assert.match(saved.message, /archived or deleted/);
  const unchanged = await Recipe.findById(recipe._id);
  assert.equal(unchanged.productId, null);
  assert.equal(unchanged.notes, '');
});
test('new sales retain private cost snapshots while legacy event costs are marked as estimates', async () => {
  const { product, recipe } = await fixture('Historical');
  await Order.create({ orderNumber: 'OLD-MAPPED', source: 'event', eventName: 'Old Fair', orderType: 'takeaway', paymentStatus: 'paid', orderStatus: 'completed',
    items: [{ product: product._id, name: product.name, price: 55, quantity: 2, lineTotal: 110 }], pricing: { subtotal: 110, tax: 0, total: 110 } });
  assert.equal((await mapProduct(product, recipe)).status, 200);
  let old = await api('GET', '/admin/reports/events?eventName=Old%20Fair');
  assert.equal(old.events[0].cost, 40); assert.equal(old.events[0].costEstimated, true); assert.equal(old.events[0].revenue, 110);
  assert.equal(old.events[0].profit, 70);
  const items = [{ productId: String(product._id), quantity: 2 }];
  const quote = await api('POST', '/admin/orders/quote', { items, orderType: 'takeaway' });
  const sale = await api('POST', '/admin/orders', { items, orderType: 'takeaway', source: 'event', eventName: 'New Fair', paymentMethod: 'cash', paymentStatus: 'paid', orderStatus: 'completed', requestKey: randomUUID(), expectedQuote: quote });
  assert.equal(sale.status, 201, JSON.stringify(sale));
  assert.equal(sale.order.recipeCostSnapshot, undefined);
  const stored = await Order.findById(sale.order._id).select('+recipeCostSnapshot');
  assert.equal(stored.recipeCostSnapshot[0].unitCost, '20');
  const changed = await api('PATCH', `/admin/bakery/recipes/${recipe._id}`, { version: recipe.version, targetMarkupPercent: 200,
    components: [{ componentType: 'other', name: 'Batch ingredients', itemType: 'other', quantity: 1, uom: 'piece', unitCost: '120' }] });
  assert.equal(changed.status, 200, JSON.stringify(changed));
  assert.equal((await api('GET', '/products/historical', undefined, null)).product.price, 90);
  const recorded = await api('GET', '/admin/reports/events?eventName=New%20Fair');
  assert.equal(recorded.events[0].cost, 40); assert.equal(recorded.products[0].cost, 40); assert.equal(recorded.events[0].costEstimated, false);
  assert.equal((await Order.findById(stored._id)).items[0].price, 40);
  old = await api('GET', '/admin/reports/events?eventName=Old%20Fair');
  assert.equal(old.events[0].cost, 60); assert.equal(old.products[0].costEstimated, true);
  assert.equal(old.events[0].profit, 50);
  assert.equal((await api('GET', `/admin/orders/${sale.order._id}`)).order.recipeCostSnapshot, undefined);
});
test('links are unique, version checked, and protect recipes from deletion', async () => {
  const { product, recipe } = await fixture('Unique');
  const other = await fixture('Other');
  assert.equal((await mapProduct(product, recipe)).status, 200);
  assert.equal((await mapProduct(other.product, recipe)).status, 409);
  assert.equal((await api('DELETE', `/admin/bakery/recipes/${recipe._id}`)).status, 409);
  const report = await api('GET', '/admin/bakery/product-mappings');
  const row = report.products.find((p) => p._id === String(product._id));
  assert.equal((await api('PATCH', `/admin/bakery/product-mappings/${product._id}`, { recipeId: String(other.recipe._id), expectedRecipeId: null, expectedUpdatedAt: row.updatedAt, expectedVersion: other.recipe.version })).status, 409);
  await assert.rejects(Recipe.create({ name: 'Duplicate', productId: product._id }), (err) => err.code === 11000);
  assert.equal((await mapProduct(product, null)).status, 200);
  assert.equal((await Product.findById(product._id)).price, 40);
  assert.equal((await Recipe.findById(recipe._id)).productId, null);
});
test('recipe manual selling price applies per piece, and material changes update linked selling prices', async () => {
  const { product, recipe } = await fixture('Manual');
  await Recipe.updateOne({ _id: recipe._id }, { $set: { manualSellingPrice: '180' } });
  assert.equal((await mapProduct(product, recipe)).status, 200);
  assert.equal((await api('GET', '/products/manual', undefined, null)).product.price, 45);
  const Material = require('../src/models/BakeryMaterial');
  const material = await Material.create({ name: 'Ingredient', baseUom: 'g', packQuantity: 1, packUom: 'g', purchasePrice: 80 });
  await Recipe.updateOne({ _id: recipe._id }, { $set: { manualSellingPrice: '0', components: [{ componentType: 'material', materialId: material._id, quantity: 1, uom: 'g' }] } });
  assert.equal((await api('GET', '/products/manual', undefined, null)).product.price, 40);
  await Material.updateOne({ _id: material._id }, { $set: { purchasePrice: '120' } });
  assert.equal((await api('GET', '/products/manual', undefined, null)).product.price, 60);
  await Recipe.updateOne({ _id: recipe._id }, { $set: { isActive: false } });
  const quote = await api('POST', '/admin/orders/quote', { items: [{ productId: String(product._id), quantity: 1 }], orderType: 'takeaway' });
  assert.equal(quote.status, 409);
});

test('card selling-price edits update products and new event sales, preserving existing orders', async () => {
  const { product, recipe } = await fixture('CardPrice');
  assert.equal((await mapProduct(product, recipe)).status, 200);
  const items = [{ productId: String(product._id), quantity: 2 }];
  const oldQuote = await api('POST', '/admin/orders/quote', { items, orderType: 'takeaway' });
  const orderBody = { items, orderType: 'takeaway', source: 'event', eventName: 'Card Price Fair',
    paymentMethod: 'cash', paymentStatus: 'paid', orderStatus: 'completed' };
  const oldSale = await api('POST', '/admin/orders', { ...orderBody, requestKey: randomUUID(), expectedQuote: oldQuote });
  assert.equal(oldSale.status, 201, JSON.stringify(oldSale));

  const saved = await api('PATCH', `/admin/bakery/recipes/${recipe._id}/selling-price`, {
    version: recipe.version, pricePerPiece: 209, name: 'Ignored extra field',
  });
  assert.equal(saved.status, 200, JSON.stringify(saved));
  assert.equal(saved.recipe.name, recipe.name);
  assert.equal(saved.recipe.sellingPricePerPiece, '209');
  assert.equal(saved.recipe.sellingPricePerBatch, '836');
  assert.equal(saved.recipe.manualSellingPricePerPiece, '209');
  assert.equal(Number(saved.recipe.actualMarginPercent).toFixed(2), '90.43');
  assert.equal(saved.recipe.actualMarkupPercent, '945');
  const reloaded = await api('GET', `/admin/bakery/recipes/${recipe._id}`);
  assert.equal(reloaded.recipe.actualMarginPercent, saved.recipe.actualMarginPercent);
  assert.equal(reloaded.recipe.actualMarkupPercent, saved.recipe.actualMarkupPercent);
  assert.equal((await Product.findById(product._id)).price, 209);
  assert.equal((await api('GET', '/products/cardprice', undefined, null)).product.price, 209);
  const mapping = await api('GET', '/admin/bakery/product-mappings');
  const choice = mapping.recipes.find((r) => r.recipeId === String(recipe._id));
  assert.equal(choice.sellingPrice, 209); assert.equal(choice.marginPercent, 90.43);

  const outdated = await api('POST', '/admin/orders', { ...orderBody, requestKey: randomUUID(), expectedQuote: oldQuote });
  assert.equal(outdated.status, 409); assert.equal(outdated.code, 'PRICE_CHANGED');
  const quote = await api('POST', '/admin/orders/quote', { items, orderType: 'takeaway' });
  assert.equal(quote.items[0].price, 209); assert.equal(quote.pricing.subtotal, 418);
  const newSale = await api('POST', '/admin/orders', { ...orderBody, requestKey: randomUUID(), expectedQuote: quote });
  assert.equal(newSale.status, 201, JSON.stringify(newSale));
  assert.equal(newSale.order.items[0].price, 209);
  assert.equal((await Order.findById(oldSale.order._id)).items[0].price, 40);
  const report = await api('GET', '/admin/reports/events?eventName=Card%20Price%20Fair');
  assert.equal(report.events[0].revenue, oldQuote.pricing.total + quote.pricing.total);
  assert.equal(report.products[0].subtotal, 498);
  assert.equal(report.events[0].cost, 80); assert.equal(report.events[0].costEstimated, false);

  // Admin prices are per piece, so changing the batch yield keeps the chosen unit price.
  const resized = await api('PATCH', `/admin/bakery/recipes/${recipe._id}`, { version: saved.recipe.version, piecesPerBatch: 8 });
  assert.equal(resized.status, 200, JSON.stringify(resized));
  assert.equal(resized.recipe.sellingPricePerPiece, '209');
  assert.equal(resized.recipe.sellingPricePerBatch, '1672');
  assert.equal(Number(resized.recipe.actualMarginPercent).toFixed(2), '95.22');
  assert.equal(resized.recipe.actualMarkupPercent, '1990');
  assert.equal((await api('GET', '/products/cardprice', undefined, null)).product.price, 209);
  const websiteQuote = await api('POST', '/cart/price', { items, orderType: 'takeaway' }, null);
  assert.equal(websiteQuote.status, 200, JSON.stringify(websiteQuote));
  assert.equal(websiteQuote.items[0].price, 209); assert.equal(websiteQuote.pricing.subtotal, 418);
  const overview = await api('GET', '/admin/bakery/reports?scope=overview');
  assert.equal(Number(overview.recipes.find((r) => r.recipeId === String(recipe._id)).currentMargin).toFixed(2), '95.22');
  const reset = await api('PATCH', `/admin/bakery/recipes/${recipe._id}/selling-price`, { version: resized.recipe.version, pricePerPiece: null });
  assert.equal(reset.status, 200, JSON.stringify(reset));
  assert.equal(reset.recipe.manualSellingPricePerPiece, null);
  assert.equal(reset.recipe.sellingPricePerPiece, '20');
  assert.equal(reset.recipe.actualMarginPercent, '50');
  assert.equal(reset.recipe.actualMarkupPercent, '100');
  assert.equal((await Product.findById(product._id)).price, 20);
  assert.equal((await Order.findById(newSale.order._id)).items[0].price, 209);
});

test('card selling prices validate money, require admin access and reject stale edits', async () => {
  const { recipe } = await fixture('PriceValidation');
  const path = `/admin/bakery/recipes/${recipe._id}/selling-price`;
  const body = { version: recipe.version, pricePerPiece: 39.99 };
  assert.equal((await api('PATCH', path, body, null)).status, 401);
  assert.equal((await api('PATCH', path, body, customerToken)).status, 403);
  for (const value of [0, -1, '', 'invalid', 39.999, '1e309']) {
    assert.equal((await api('PATCH', path, { ...body, pricePerPiece: value })).status, 400, String(value));
  }
  assert.equal((await api('PATCH', path, { version: recipe.version })).status, 400);
  assert.equal((await api('PATCH', path, { pricePerPiece: 39.99 })).status, 409);
  assert.equal((await Recipe.findById(recipe._id)).version, recipe.version);
  const saved = await api('PATCH', path, body);
  assert.equal(saved.status, 200, JSON.stringify(saved));
  assert.equal(saved.recipe.sellingPricePerPiece, '39.99');
  assert.equal(saved.recipe.sellingPricePerBatch, '159.96');
  assert.equal((await api('PATCH', path, { ...body, pricePerPiece: 35 })).status, 409);
  assert.equal((await Recipe.findById(recipe._id)).manualSellingPricePerPiece, '39.99');
});

test('resetting a legacy batch override restores the markup suggestion', async () => {
  const { recipe } = await fixture('LegacyPriceReset');
  await Recipe.updateOne({ _id: recipe._id }, { $set: { manualSellingPrice: '180' } });
  const reset = await api('PATCH', `/admin/bakery/recipes/${recipe._id}/selling-price`, { version: recipe.version, pricePerPiece: null });
  assert.equal(reset.status, 200, JSON.stringify(reset));
  assert.equal(reset.recipe.manualSellingPrice, '0');
  assert.equal(reset.recipe.manualSellingPricePerPiece, null);
  assert.equal(reset.recipe.sellingPricePerPiece, '40');
});

test('recipe revisions retain separate formulas and allow switching one product between revisions', async () => {
  const { product, recipe } = await fixture('Revision-biscoff');
  await Recipe.updateOne({ _id: recipe._id }, { piecesPerBatch: 8 });
  assert.equal((await mapProduct(product, recipe)).status, 200);
  const quote = await api('POST', '/admin/orders/quote', { items: [{ productId: String(product._id), quantity: 1 }], orderType: 'takeaway' });
  const sale = await api('POST', '/admin/orders', { items: [{ productId: String(product._id), quantity: 1 }], orderType: 'takeaway', source: 'event', eventName: 'Revision fair', paymentMethod: 'cash', paymentStatus: 'paid', orderStatus: 'completed', requestKey: randomUUID(), expectedQuote: quote });
  assert.equal(sale.status, 201, JSON.stringify(sale));
  const before = await Order.findById(sale.order._id).select('+recipeCostSnapshot').lean();
  const created = await api('POST', `/admin/bakery/recipes/${recipe._id}/revisions`, {
    version: 1, revisionLabel: '9 pieces, new ingredients', piecesPerBatch: 9,
    components: [{ componentType: 'other', name: 'New ingredients', itemType: 'other', quantity: 1, uom: 'piece', unitCost: '180' }],
    // A revision must never steal an existing mapping even if requested explicitly.
    productId: String(product._id), revisionNumber: 99,
  });
  assert.equal(created.status, 200, JSON.stringify(created));
  const revised = created.recipe;
  assert.equal(revised.name, recipe.name);
  assert.equal(revised.revisionNumber, 2);
  assert.equal(revised.revisionFamilyId, String(recipe._id));
  assert.equal(revised.revisionLabel, '9 pieces, new ingredients');
  assert.equal(revised.productId, null);
  assert.equal(Number(revised.costPerPiece), 20);
  assert.equal((await Recipe.findById(recipe._id)).piecesPerBatch, '8');
  assert.equal(String((await Recipe.findById(recipe._id)).productId), String(product._id));
  assert.equal((await mapProduct(product, revised)).status, 200);
  assert.equal((await Recipe.findById(recipe._id)).productId, null);
  assert.equal(await Recipe.countDocuments({ productId: product._id }), 1);
  assert.equal((await Product.findById(product._id)).price, 40);
  const mapping = await api('GET', '/admin/bakery/product-mappings');
  const choice = mapping.recipes.find(r => r.recipeId === revised._id);
  assert.equal(choice.revisionNumber, 2);
  assert.equal(choice.piecesPerBatch, 9);
  assert.equal(choice.revisionFamilyId, String(recipe._id));
  assert.equal((await mapProduct(product, recipe)).status, 200);
  assert.equal((await Product.findById(product._id)).price, 20);
  const after = await Order.findById(sale.order._id).select('+recipeCostSnapshot').lean();
  assert.deepEqual(after.recipeCostSnapshot, before.recipeCostSnapshot);
  assert.deepEqual(after.pricing, before.pricing);
});

test('revisions share family numbering independently of edit versions, including branching and archived siblings', async () => {
  const { recipe } = await fixture('Revision-family');
  const path = `/admin/bakery/recipes/${recipe._id}`;
  assert.equal((await api('POST', path + '/revisions', { version: 2 })).status, 409);
  assert.equal((await api('POST', '/admin/bakery/recipes/invalid/revisions', { version: 1 })).status, 400);
  assert.equal((await api('POST', path + '/revisions', { version: 1 }, customerToken)).status, 403);
  assert.equal((await api('POST', path + '/revisions', { version: 1, revisionLabel: 'x'.repeat(121) })).status, 400);
  const second = await api('POST', path + '/revisions', { version: 1, revisionLabel: 'Second' });
  assert.equal(second.status, 200, JSON.stringify(second));
  const edited = await api('PATCH', `/admin/bakery/recipes/${second.recipe._id}`, { version: 1, revisionFamilyId: new mongoose.Types.ObjectId(), revisionNumber: 77, notes: 'Edit this revision only' });
  assert.equal(edited.status, 200, JSON.stringify(edited));
  assert.equal(edited.recipe.version, 2);
  assert.equal(edited.recipe.revisionNumber, 2);
  assert.equal(edited.recipe.revisionFamilyId, String(recipe._id));
  const third = await api('POST', `/admin/bakery/recipes/${second.recipe._id}/revisions`, { version: 2 });
  assert.equal(third.status, 200, JSON.stringify(third));
  assert.equal(third.recipe.revisionNumber, 3);
  assert.equal(third.recipe.revisionFamilyId, String(recipe._id));
  assert.equal(third.recipe.notes, 'Edit this revision only');
  assert.equal((await api('DELETE', `/admin/bakery/recipes/${third.recipe._id}`)).status, 200);
  const fourth = await api('POST', path + '/revisions', { version: 1 });
  assert.equal(fourth.recipe.revisionNumber, 4);
  assert.equal((await api('POST', `/admin/bakery/recipes/${third.recipe._id}/revisions`, { version: 1 })).status, 400);
});

test('concurrent revision creation assigns distinct numbers and preserves inherited batch pricing', async () => {
  const { recipe } = await fixture('Revision-concurrent');
  await Recipe.updateOne({ _id: recipe._id }, { manualSellingPrice: '240' });
  const results = await Promise.all([1, 2].map(() => api('POST', `/admin/bakery/recipes/${recipe._id}/revisions`, { version: 1 })));
  results.forEach(r => assert.equal(r.status, 200, JSON.stringify(r)));
  assert.deepEqual(results.map(r => r.recipe.revisionNumber).sort(), [2, 3]);
  results.forEach(r => assert.equal(Number(r.recipe.sellingPricePerPiece), 60));
});
