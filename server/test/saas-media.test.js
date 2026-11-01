process.env.NODE_ENV = 'test';
delete process.env.SAAS_LEGACY_WORKSPACE_AUTH;
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const sharp = require('sharp');
const { randomBytes } = require('node:crypto');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Account = require('../src/models/SaasAccount');
const Session = require('../src/models/SaasAccountSession');
const Bakery = require('../src/models/Bakery');
const Membership = require('../src/models/BakeryMembership');
const Storefront = require('../src/models/SaasStorefront');
const Product = require('../src/models/SaasProduct');
const Media = require('../src/models/SaasMedia');
const Audit = require('../src/models/SaasAuditLog');
const { COOKIE, digest } = require('../src/saas/account-access');
const { hashPassword } = require('../src/saas/customer-password');
const { normalizeImage } = require('../src/saas/media-images');
let database, server, base, alice, bob, staff, bakeryA, bakeryB, productA, productB, cookieA, cookieB, cookieStaff, png, passwordHash, ip = 0;
async function api(method, path, body, who = 'alice') {
 const account = who === 'alice' ? alice : who === 'bob' ? bob : who === 'staff' ? staff : null, cookie = who === 'alice' ? cookieA : who === 'bob' ? cookieB : cookieStaff;
 const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Saas-Account-Id': String(account?._id || ''), 'X-Saas-Workspace': '1', 'X-Forwarded-For': `10.3.0.${ip}`, ...(account ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
 return { status: res.status, ...await res.json() };
}
const slotPath = (kind = 'product', target = productA._id, bakery = bakeryA._id) => `/saas/bakeries/${bakery}/media/${kind}/${target}`;
const save = (encoded = png.toString('base64'), expectedVersion = 0, path = slotPath()) => api('POST', path, { imageBase64: encoded, expectedVersion, confirmed: true });
async function publicPath(kind = 'product', slug = bakeryA.slug) { const menu = await api('GET', `/saas/storefront/${slug}`, undefined, 'none'); return kind === 'logo' ? menu.profile.logo?.path : menu.products.find(p => p.id === String(productA._id))?.image?.path; }
async function image(path) { const response = await fetch(base + path); return { response, data: Buffer.from(await response.arrayBuffer()) }; }
before(async () => {
 database = await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket'] }, instanceOpts: [{ launchTimeout: 60000 }] }); await mongoose.connect(database.getUri('saas_media_test')); process.env.SAAS_FOUNDATION_ENABLED = 'true';
 const hash = passwordHash = await hashPassword('Synthetic owner password42'); [alice,bob,staff] = await Account.create(['alice','bob','staff'].map(name => ({ email: `${name}@example.test`, displayName: name, passwordHash: hash })));
 [bakeryA,bakeryB] = await Bakery.create([{ name: 'Image A', slug: 'image-a', createdBy: alice._id, createdByType: 'saas' }, { name: 'Image B', slug: 'image-b', createdBy: bob._id, createdByType: 'saas' }]);
 await Membership.create([{ bakeryId: bakeryA._id, userId: alice._id, accountType: 'saas', role: 'owner' }, { bakeryId: bakeryB._id, userId: bob._id, accountType: 'saas', role: 'owner' }, { bakeryId: bakeryA._id, userId: staff._id, accountType: 'saas', role: 'staff' }]);
 [productA,productB] = await Product.create([{ bakeryId: bakeryA._id, name: 'Cake A', slug: 'cake-a', category: 'Cake', pricePaise: 1000 }, { bakeryId: bakeryB._id, name: 'Cake B', slug: 'cake-b', category: 'Cake', pricePaise: 2000 }]);
 png = await sharp({ create: { width: 1000, height: 900, channels: 3, background: '#ddbb99' } }).png().withMetadata({ exif: { IFD0: { Artist: 'PRIVATE LOCATION' } } }).toBuffer();
 await Promise.all([Media.init(), Audit.init(), Session.init()]); const app = require('../src/app'); app.set('trust proxy', 1); server = app.listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
});
beforeEach(async () => {
 ip++; await Account.deleteMany({}); [alice,bob,staff] = await Account.create(['alice','bob','staff'].map(name => ({ email: `${name}@example.test`, displayName: name, passwordHash }))); await Membership.deleteMany({}); await Membership.create([{ bakeryId: bakeryA._id, userId: alice._id, accountType: 'saas', role: 'owner' }, { bakeryId: bakeryB._id, userId: bob._id, accountType: 'saas', role: 'owner' }, { bakeryId: bakeryA._id, userId: staff._id, accountType: 'saas', role: 'staff' }]); await Media.deleteMany({}); await Storefront.deleteMany({}); await Session.deleteMany({}); await Audit.deleteMany({}); await Bakery.updateMany({}, { $set: { status: 'active' } }); await Product.updateMany({}, { $set: { archived: false, available: true, stockCount: null } });
 await Storefront.create([{ bakeryId: bakeryA._id, published: true }, { bakeryId: bakeryB._id, published: true }]);
 async function login(account) { const token = randomBytes(32).toString('hex'); await Session.create({ accountId: account._id, tokenHash: digest(token), sessionVersion: 1, expiresAt: new Date(Date.now() + 3600000) }); return `${COOKIE}=${token}`; }
 cookieA = await login(alice); cookieB = await login(bob); cookieStaff = await login(staff);
});
after(async () => { delete process.env.SAAS_FOUNDATION_ENABLED; if (server) await new Promise(r => server.close(r)); await mongoose.disconnect(); if (database) await database.stop(); });
test('uploads decode and normalize private raster data, strip metadata and publish only scoped image descriptors', async () => {
 const result = await save(); assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.slot.version, 1); assert.equal(result.slot.image.width, 800); assert.equal(result.slot.image.height, 720);
 const descriptor = (await api('GET', '/saas/storefront/image-a', undefined, 'none')).products[0].image; assert.deepEqual(Object.keys(descriptor).sort(), ['height','path','width']); const { response,data } = await image(descriptor.path); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/webp'); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); const meta = await sharp(data).metadata(); assert.equal(meta.format, 'webp'); assert.equal(meta.exif, undefined); assert.equal(meta.icc, undefined); assert.equal(data.includes(Buffer.from('PRIVATE LOCATION')), false); assert.equal((await Media.findOne()).bytes, undefined);
 const logo = await save(undefined, 0, slotPath('logo', bakeryA._id)); assert.equal(logo.slot.image.width, 512); assert.equal((await image(await publicPath('logo'))).response.status, 200);
});
test('foreign tenants, staff, forged targets and public selectors cannot access private image slots', async () => {
 await save(); assert.equal((await api('GET', slotPath(), undefined, 'bob')).status, 404); assert.equal((await api('GET', slotPath(), undefined, 'staff')).status, 403); assert.equal((await api('POST', slotPath(), { imageBase64: png.toString('base64'), expectedVersion: 1, confirmed: true }, 'staff')).status, 403); assert.equal((await save(undefined, 0, slotPath('product', productB._id))).status, 404); assert.equal((await save(undefined, 0, slotPath('logo', bakeryB._id))).status, 404);
 const path = await publicPath(); assert.equal((await image(path.replace('/image-a/', '/image-b/'))).response.status, 404); assert.equal((await image(path + '?bakeryId=' + bakeryB._id)).response.status, 400); assert.equal((await api('POST', slotPath(), { imageBase64: png.toString('base64'), expectedVersion: 1, confirmed: true, bakeryId: bakeryB._id })).status, 400);
});
test('replacements, removals and tombstone versions invalidate old URLs and prevent stale resurrection', async () => {
 await save(); const oldPath = await publicPath(); const other = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#992244' } }).png().toBuffer(); const results = await Promise.all([save(other.toString('base64'),1), save(other.toString('base64'),1)]); assert.deepEqual(results.map(r=>r.status).sort(),[200,409]); assert.equal((await image(oldPath)).response.status,404); const currentPath = await publicPath(); assert.equal((await save(null,2)).status,200); assert.equal((await image(currentPath)).response.status,404); assert.equal(await publicPath(),undefined); assert.equal((await api('GET',slotPath())).slot.version,3); assert.equal((await Media.findOne().select('+bytes')).bytes,undefined); assert.equal((await save(undefined,0)).status,409); assert.equal((await save(undefined,3)).slot.version,4); assert.equal((await image(oldPath)).response.status,404);
});
test('unpublishing, suspension, product archiving and hidden availability revoke access to known image URLs', async () => {
 await save(); const path = await publicPath(); await Storefront.updateOne({ bakeryId: bakeryA._id },{$set:{published:false}}); assert.equal((await image(path)).response.status,404); await Storefront.updateOne({ bakeryId: bakeryA._id },{$set:{published:true}}); await Bakery.updateOne({_id:bakeryA._id},{$set:{status:'suspended'}}); assert.equal((await image(path)).response.status,404); await Bakery.updateOne({_id:bakeryA._id},{$set:{status:'active'}}); await Product.updateOne({_id:productA._id},{$set:{archived:true}}); assert.equal((await image(path)).response.status,404); await Product.updateOne({_id:productA._id},{$set:{archived:false,stockCount:0}}); assert.equal((await image(path)).response.status,404); await Storefront.updateOne({bakeryId:bakeryA._id},{$set:{showUnavailable:true}}); assert.equal((await image(path)).response.status,200);
});
test('invalid encodings, SVG, corrupt/truncated rasters, animated images, oversized inputs and pixels are rejected', async () => {
 for(const encoded of ['', 'not base64!', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'), png.subarray(0,20).toString('base64'), Buffer.alloc(512*1024+1).toString('base64')]) assert.equal((await save(encoded)).status,400);
 const huge = await sharp({create:{width:3000,height:3000,channels:3,background:'#fff'}}).png().toBuffer(); await assert.rejects(normalizeImage(huge.toString('base64'),'product'),e=>e.statusCode===400);
 const animated = await sharp(Buffer.concat([Buffer.alloc(48),Buffer.alloc(48,255)]),{raw:{width:4,height:8,channels:3,pageHeight:4}}).webp({loop:0,delay:[100,100]}).toBuffer(); assert.ok((await sharp(animated).metadata()).pages > 1); await assert.rejects(normalizeImage(animated.toString('base64'),'product'),e=>e.statusCode===400); assert.equal(await Media.countDocuments(),0);
});
test('audited writes roll back pixels and versions and bakery quotas serialize concurrent uploads', async () => {
 await save(); const original = Audit.create; Audit.create = async()=>{throw new Error('Synthetic image audit failure');}; try{assert.equal((await save(null,1)).status,500);}finally{Audit.create=original;} assert.equal((await api('GET',slotPath())).slot.version,1); assert.ok(await publicPath());
 const rows = Array.from({length:126},()=>({bakeryId:bakeryA._id,kind:'product',targetId:new mongoose.Types.ObjectId(),active:true,byteLength:1,hash:'a'.repeat(64)})); await Media.insertMany(rows);
 const extra = await Product.create({bakeryId:bakeryA._id,name:'Extra image',slug:'extra-image',category:'Cake',pricePaise:1000});
 const attempts = await Promise.all([save(undefined,0,slotPath('logo',bakeryA._id)), save(undefined,0,slotPath('product',extra._id))]); assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]); assert.equal(await Media.countDocuments({active:true}),128);
 assert.equal((await save(null,1)).status,200); const retry = attempts[0].status === 409 ? slotPath('logo',bakeryA._id) : slotPath('product',extra._id); assert.equal((await save(undefined,0,retry)).status,200); assert.equal(await Media.countDocuments({active:true}),128);
});
