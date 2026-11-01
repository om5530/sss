process.env.NODE_ENV = 'test';
delete process.env.SAAS_LEGACY_WORKSPACE_AUTH;
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const mongoose=require('mongoose');
const {MongoMemoryReplSet}=require('mongodb-memory-server');
const sharp=require('sharp');
let database,server,base,a,b,pA,pB,material,recipe,revision,event,pickup,counter,unpaid,staffMember,logoPath;
const password='Synthetic rehearsal password!42';
const actor=(ip,kind='account')=>({ip,kind,cookie:null,id:null});
const alice=actor(1),bob=actor(2),staff=actor(3),customerA=actor(4,'customer'),customerB=actor(5,'customer');
const ownerPath=(bakery,suffix)=>`/saas/bakeries/${bakery._id}/${suffix}`;
const customerPath=(bakery,suffix)=>`/saas/storefront/${bakery.slug}/customer${suffix}`;
async function api(method,path,body,identity=alice){
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Saas-Workspace':'1','X-Saas-Account':'1','X-Saas-Customer':'1','X-Forwarded-For':`10.4.0.${identity?.ip||9}`,...(identity?.cookie?{Cookie:identity.cookie,[identity.kind==='customer'?'X-Saas-Customer-Id':'X-Saas-Account-Id']:identity.id}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 return{status:response.status,cookie:response.headers.get('set-cookie'),...await response.json()};
}
function checked(result,status=200){assert.equal(result.status,status,result.message||'Unexpected API response');return result;}
function signedIn(identity,result,key='account'){identity.id=result[key].id;identity.cookie=result.cookie.split(';')[0];}
const getProduct=async(bakery,product,identity=alice)=>checked(await api('GET',ownerPath(bakery,`products/${product._id}`),undefined,identity)).product;
const items=(product,quantity=1)=>[{productId:product._id,quantity,expectedUnitPricePaise:19900}];
before(async()=>{
 database=await MongoMemoryReplSet.create({replSet:{count:1,args:['--nounixsocket']},instanceOpts:[{launchTimeout:60000}]});await mongoose.connect(database.getUri('saas_rehearsal_test'));
 process.env.SAAS_FOUNDATION_ENABLED='true';process.env.SAAS_LOCAL_OWNER_MAIL_PREVIEW_KEY=randomBytes(32).toString('hex');process.env.SAAS_LOCAL_PUBLIC_ORIGIN='http://localhost:4200';
 const app=require('../src/app');app.set('trust proxy',1);server=app.listen(0);base=`http://127.0.0.1:${server.address().port}/api`;
});
after(async()=>{delete process.env.SAAS_FOUNDATION_ENABLED;delete process.env.SAAS_LOCAL_OWNER_MAIL_PREVIEW_KEY;delete process.env.SAAS_LOCAL_PUBLIC_ORIGIN;if(server)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();if(database)await database.stop();});
test('synthetic two-bakery API rehearsal with dedicated accounts and no legacy-auth bridge',async t=>{
 await t.test('owner onboarding and reviewed staff invitations create separate workspaces',async()=>{
  for(const [identity,name] of [[alice,'Alice'],[bob,'Bob'],[staff,'Staff']])signedIn(identity,checked(await api('POST','/saas/account/register',{displayName:name,email:`${name.toLowerCase()}@example.test`,password,confirmed:true},identity),201));
  a=checked(await api('POST','/saas/bakeries',{name:'Synthetic Bakery A',slug:'rehearsal-a'}),201).bakery;
  b=checked(await api('POST','/saas/bakeries',{name:'Synthetic Bakery B',slug:'rehearsal-b'},bob),201).bakery;
  const invite=checked(await api('POST',ownerPath(a,'invitations'),{expiresInMinutes:30}),201);
  checked(await api('POST','/saas/invitations/inspect',{token:invite.token},staff));checked(await api('POST','/saas/invitations/accept',{token:invite.token},staff));
  staffMember=checked(await api('GET',ownerPath(a,'members'))).members.find(row=>String(row.userId)===staff.id);assert.equal(staffMember.role,'staff');
  checked(await api('GET',ownerPath(b,'context'),undefined,alice),404);checked(await api('GET',ownerPath(a,'context'),undefined,bob),404);checked(await api('GET',ownerPath(b,'context'),undefined,staff),404);
  assert.equal(await require('../src/models/User').countDocuments(),0);assert.equal(process.env.SAAS_LEGACY_WORKSPACE_AUTH,undefined);
 });
 await t.test('recipe revisions, mapping and tracked material production retain immutable costs and replay once',async()=>{
  pA=checked(await api('POST',ownerPath(a,'products'),{name:'Synthetic cheesecake',slug:'cake',category:'Cakes',pricePaise:19900,stockCount:0}),201).product;
  pB=checked(await api('POST',ownerPath(b,'products'),{name:'Different synthetic cake',slug:'cake',category:'Cakes',pricePaise:19900,stockCount:5},bob),201).product;
  material=checked(await api('POST',ownerPath(a,'materials'),{name:'Synthetic cream',packQuantity:'1000',packUom:'g',purchasePricePaise:10000}),201).material;
  const other=checked(await api('POST',ownerPath(b,'materials'),{name:'Synthetic cream',packQuantity:'1000',packUom:'g',purchasePricePaise:20000},bob),201).material;
  const ingredients=[{materialId:material._id,expectedVersion:1,quantity:'400',uom:'g'}];
  const first=checked(await api('POST',ownerPath(a,'recipes'),{name:'Synthetic batch',category:'Cakes',yieldPieces:8,overheadPaise:1600,ingredients}),201);recipe=first.recipe;
  const second=checked(await api('POST',ownerPath(a,`recipes/${recipe._id}/revisions`),{expectedVersion:recipe.version,yieldPieces:9,overheadPaise:1600,ingredients}),201);revision=second.revision;
  checked(await api('POST',ownerPath(a,'recipes'),{name:'Foreign material rejected',category:'Cakes',yieldPieces:8,ingredients:[{materialId:other._id,expectedVersion:1,quantity:'1',uom:'g'}]}),404);
  checked(await api('PATCH',ownerPath(a,`products/${pA._id}/recipe-mapping`),{revisionId:revision._id,expectedVersion:pA.version}));pA=await getProduct(a,pA);
  checked(await api('POST',ownerPath(a,'inventory'),{materialId:material._id,kind:'opening',quantity:'1000',uom:'g',expectedMaterialVersion:1,expectedStockVersion:0,reason:'Synthetic opening count',confirmed:true,idempotencyKey:randomUUID()}),201);
  const input={productId:pA._id,revisionId:revision._id,expectedProductVersion:pA.version,batches:2};const quote=checked(await api('POST',ownerPath(a,'production/quote'),input)).quote;assert.equal(quote.producedPieces,18);assert.equal(quote.totalCostPaise,'11200');
  const submission={...input,inventoryFingerprint:quote.inventoryFingerprint,confirmed:true,idempotencyKey:randomUUID()};const runs=await Promise.all([api('POST',ownerPath(a,'production'),submission),api('POST',ownerPath(a,'production'),submission)]);assert.deepEqual(runs.map(row=>row.status).sort(),[200,201]);assert.equal(runs[0].run._id,runs[1].run._id);
  assert.equal((await getProduct(a,pA)).stockCount,18);assert.equal((await getProduct(b,pB,bob)).stockCount,5);assert.equal(checked(await api('GET',ownerPath(a,'inventory'))).stocks[0].onHand,'200');
  checked(await api('PATCH',ownerPath(a,`materials/${material._id}`),{expectedVersion:1,purchasePricePaise:30000}));const versions=checked(await api('GET',ownerPath(a,`recipes/${recipe._id}`))).revisions;assert.equal(versions.find(row=>row.revisionNumber===1).yieldPieces,8);assert.equal(versions.find(row=>row.revisionNumber===2).batchCostPaise,'5600');
 });
 await t.test('published branding, media and same-email customer accounts stay bakery scoped',async()=>{
  checked(await api('PATCH',ownerPath(a,'storefront-settings'),{expectedVersion:0,published:true,acceptCustomerOrders:true,brandTheme:'rose',brandMark:'A'}));
  checked(await api('PATCH',ownerPath(b,'storefront-settings'),{expectedVersion:0,published:true,acceptCustomerOrders:true,brandTheme:'sage',brandMark:'B'},bob));
  const picture=await sharp({create:{width:16,height:16,channels:3,background:'#885544'}}).png().toBuffer();checked(await api('POST',ownerPath(a,`media/logo/${a._id}`),{imageBase64:picture.toString('base64'),expectedVersion:0,confirmed:true}));
  const menuA=checked(await api('GET',`/saas/storefront/${a.slug}`,undefined,null)),menuB=checked(await api('GET',`/saas/storefront/${b.slug}`,undefined,null));logoPath=menuA.profile.logo.path;assert.equal(menuA.profile.brandTheme,'rose');assert.equal(menuB.profile.brandTheme,'sage');assert.equal(menuB.profile.logo,null);assert.equal(menuA.products[0].stockCount,undefined);assert.equal(menuA.products[0].recipeRevisionId,undefined);
  assert.equal((await fetch(base+logoPath)).status,200);assert.equal((await fetch(base+logoPath.replace(`/${a.slug}/`,`/${b.slug}/`))).status,404);
  assert.equal(checked(await api('GET',ownerPath(a,'storefront-link'))).link.url,`http://localhost:4200/b/${a.slug}`);
  for(const [identity,bakery]of [[customerA,a],[customerB,b]])signedIn(identity,checked(await api('POST',customerPath(bakery,'/register'),{displayName:'Synthetic customer',email:'same@example.test',password},identity),201),'customer');assert.notEqual(customerA.id,customerB.id);
  checked(await api('GET',customerPath(b,'/me'),undefined,customerA),401);checked(await api('GET',ownerPath(a,'products'),undefined,customerA),401);checked(await api('GET',ownerPath(a,`media/logo/${a._id}`),undefined,staff),403);
 });
 await t.test('customer pickup, staff readiness, manual settlement and collection reconcile stock without cross-tenant history',async()=>{
  checked(await api('POST',customerPath(a,'/orders'),{items:items(pB),expectedReservationMinutes:30,confirmed:true,idempotencyKey:randomUUID()},customerA),404);
  const submission={items:items(pA,2),expectedReservationMinutes:30,confirmed:true,idempotencyKey:randomUUID()};const placed=await Promise.all([api('POST',customerPath(a,'/orders'),submission,customerA),api('POST',customerPath(a,'/orders'),submission,customerA)]);assert.deepEqual(placed.map(row=>row.status).sort(),[200,201]);pickup=placed[0].order;
  checked(await api('GET',customerPath(b,`/orders/${pickup._id}`),undefined,customerB),404);checked(await api('GET',ownerPath(b,`orders/${pickup._id}`),undefined,bob),404);
  pickup=checked(await api('POST',ownerPath(a,`orders/${pickup._id}/pickup-status`),{expectedVersion:pickup.version,confirmed:true,status:'ready'},staff)).order;
  checked(await api('POST',ownerPath(a,`orders/${pickup._id}/pickup-status`),{expectedVersion:pickup.version,confirmed:true,status:'collected'},staff),409);
  pickup=checked(await api('POST',ownerPath(a,`orders/${pickup._id}/settle`),{expectedVersion:pickup.version,confirmed:true,paymentMethod:'cash'},staff)).order;
  pickup=checked(await api('POST',ownerPath(a,`orders/${pickup._id}/pickup-status`),{expectedVersion:pickup.version,confirmed:true,status:'collected'},staff)).order;pickup=checked(await api('GET',ownerPath(a,`orders/${pickup._id}`))).order;assert.equal(pickup.receivedPaise,39800);assert.equal(pickup.duePaise,0);
  const own=checked(await api('GET',customerPath(a,`/orders/${pickup._id}`),undefined,customerA)).order;assert.equal(own.pickupStatus,'collected');assert.equal(own.costSnapshot,undefined);assert.equal((await getProduct(a,pA)).stockCount,16);
  const cancelled=checked(await api('POST',customerPath(a,'/orders'),{items:items(pA),expectedReservationMinutes:30,confirmed:true,idempotencyKey:randomUUID()},customerA),201).order;
  checked(await api('POST',customerPath(a,`/orders/${cancelled._id}/cancel`),{expectedVersion:cancelled.version,confirmed:true,reason:'Synthetic cancellation'},customerA));assert.equal((await getProduct(a,pA)).stockCount,16);
  const snapshot=await require('../src/models/SaasOrder').findById(pickup._id).select('+costSnapshot');assert.equal(snapshot.costSnapshot[0].batchCostPaise,'5600');assert.equal(String(snapshot.costSnapshot[0].revisionId),revision._id);
 });
 await t.test('event discounts, recorded refunds and wastage balance without exposing owner finance to staff',async()=>{
  event=checked(await api('POST',ownerPath(a,'events'),{name:'Synthetic stall',key:'synthetic-stall',rentPaise:500}),201).event;
  const sale={eventId:event._id,items:items(pA),paymentStatus:'paid',paymentMethod:'upi',idempotencyKey:randomUUID()};counter=checked(await api('POST',ownerPath(a,'orders'),sale,staff),201).order;
  checked(await api('PATCH',ownerPath(a,`orders/${counter._id}/discount`),{expectedVersion:counter.version,discountPaise:1000,reason:'Synthetic discount',confirmed:true},staff),403);
  counter=checked(await api('PATCH',ownerPath(a,`orders/${counter._id}/discount`),{expectedVersion:counter.version,discountPaise:1000,reason:'Synthetic discount',confirmed:true})).order;assert.equal(counter.refundDuePaise,1000);
  const refund={expectedVersion:counter.version,expectedRefundPaise:1000,paymentMethod:'upi',reason:'Synthetic manual return',confirmed:true,idempotencyKey:randomUUID()};const refunds=await Promise.all([api('POST',ownerPath(a,`orders/${counter._id}/refund`),refund),api('POST',ownerPath(a,`orders/${counter._id}/refund`),refund)]);assert.deepEqual(refunds.map(row=>row.status),[200,200]);counter=refunds[0].order;assert.equal(counter.receivedPaise,18900);assert.equal(counter.refundDuePaise,0);
  unpaid=checked(await api('POST',ownerPath(a,'orders'),{eventId:event._id,items:items(pA),paymentStatus:'unpaid',idempotencyKey:randomUUID()},staff),201).order;
  pA=await getProduct(a,pA);checked(await api('POST',ownerPath(a,'waste'),{productId:pA._id,eventId:event._id,quantity:1,expectedProductVersion:pA.version,reason:'Synthetic display loss',confirmed:true,idempotencyKey:randomUUID()}),201);
  const report=checked(await api('GET',ownerPath(a,`events/${event._id}/report`))).report;assert.equal(report.receivedMoneyPaise,'18900');assert.equal(report.outstandingPaise,'19900');assert.equal(report.recordedWasteUnits,1);assert.equal(report.unknownCostLines,0);assert.notEqual(report.recordedProfitPaise,null);
  checked(await api('GET',ownerPath(a,`events/${event._id}/report`),undefined,staff),403);checked(await api('GET',ownerPath(b,`events/${event._id}/report`),undefined,bob),404);assert.equal((await getProduct(a,pA)).stockCount,13);
 });
 await t.test('restricted plans block new writes while allowing settlement, recovery and staff revocation',async()=>{
  assert.equal(mongoose.connection.name,'saas_rehearsal_test');await require('../src/models/Bakery').updateOne({_id:a._id},{$set:{subscription:{planId:'starter',status:'cancelled',version:1}}});
  const denied=await api('POST',ownerPath(a,'products'),{name:'Blocked synthetic product',slug:'blocked',category:'Cakes',pricePaise:19900});checked(denied,409);assert.equal(denied.details.code,'SAAS_SUBSCRIPTION_RESTRICTED');
  assert.equal(checked(await api('GET',`/saas/storefront/${a.slug}`,undefined,null)).orderingEnabled,false);
  checked(await api('POST',customerPath(a,'/orders'),{items:items(pA),expectedReservationMinutes:30,confirmed:true,idempotencyKey:randomUUID()},customerA),409);
  checked(await api('POST',ownerPath(a,`orders/${unpaid._id}/settle`),{expectedVersion:unpaid.version,paymentMethod:'cash',confirmed:true}));
  const finalReport=checked(await api('GET',ownerPath(a,`events/${event._id}/report`))).report;assert.equal(finalReport.receivedMoneyPaise,'38800');assert.equal(finalReport.outstandingPaise,'0');assert.equal(finalReport.paidOrders,2);
  checked(await api('POST',ownerPath(a,`members/${staffMember._id}/revoke`),{expectedVersion:staffMember.version,confirmed:true}));checked(await api('GET',ownerPath(a,'products'),undefined,staff),404);checked(await api('GET','/saas/account/me',undefined,staff));
  assert.equal((await getProduct(b,pB,bob)).stockCount,5);assert.equal(checked(await api('GET',ownerPath(b,'orders'),undefined,bob)).orders.length,0);
 });
 await t.test('owner recovery revokes only target workspace sessions and publication changes revoke known media',async()=>{
  checked(await api('POST','/saas/account/password-reset/request',{email:'alice@example.test'},null));const row=await require('../src/models/SaasAccountMailPreview').findOne({accountId:alice.id,purpose:'password_reset'}).select('+ciphertext +iv +tag').lean();const token=require('../src/saas/account-mail-preview').decryptToken(row);
  const changed='Changed synthetic password!43';checked(await api('POST','/saas/account/password-reset/confirm',{token,newPassword:changed,confirmed:true},bob));checked(await api('GET','/saas/account/me',undefined,alice),401);checked(await api('GET',ownerPath(b,'context'),undefined,bob));checked(await api('GET',customerPath(a,'/me'),undefined,customerA));
  signedIn(alice,checked(await api('POST','/saas/account/login',{email:'alice@example.test',password:changed},alice)));
  assert.equal(checked(await api('GET','/saas/account/me')).account.emailVerified,false);assert.equal((await getProduct(a,pA)).stockCount,13);
  // Suspension is a fixture-only state transition, never an exposed operator endpoint.
  assert.equal(mongoose.connection.name,'saas_rehearsal_test');await require('../src/models/Bakery').updateOne({_id:a._id},{$set:{status:'suspended'}});assert.equal((await fetch(base+logoPath)).status,404);checked(await api('GET',`/saas/storefront/${a.slug}`,undefined,null),404);checked(await api('GET',ownerPath(a,'context')),404);checked(await api('GET',ownerPath(b,'context'),undefined,bob));
  for(const name of ['users','products','orders'])assert.equal(await mongoose.connection.collection(name).countDocuments(),0);assert.equal(await require('../src/models/SaasProductionRun').countDocuments({bakeryId:a._id}),1);assert.equal(await require('../src/models/SaasOrder').countDocuments({bakeryId:b._id}),0);
 });
});
