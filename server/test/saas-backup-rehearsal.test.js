process.env.NODE_ENV='test';delete process.env.SAAS_LEGACY_WORKSPACE_AUTH;
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomBytes,randomUUID}=require('node:crypto');
const mongoose=require('mongoose');
const {MongoMemoryReplSet}=require('mongodb-memory-server');
const sharp=require('sharp');
const codec=require('../src/saas/rehearsal-archive');
const {MongoClient,BSON}=mongoose.mongo;
const password='Synthetic restore password!42',key=randomBytes(32);
const owner={ip:1},other={ip:2},customer={ip:3,customer:true};
let source,target,targetClient,sourceUri,server,base,a,b,product,order,reservation,archive,encrypted,folder,models,sourceStopped=false;
const ownerPath=suffix=>`/saas/bakeries/${a._id}/${suffix}`;
const customerPath=suffix=>`/saas/storefront/${a.slug}/customer${suffix}`;
async function api(method,route,body,actor=owner){const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json','X-Saas-Account':'1','X-Saas-Workspace':'1','X-Saas-Customer':'1','X-Forwarded-For':`10.5.0.${actor?.ip||9}`,...(actor?.cookie?{Cookie:actor.cookie,[actor.customer?'X-Saas-Customer-Id':'X-Saas-Account-Id']:actor.id}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,cookie:response.headers.get('set-cookie'),...await response.json()};}
const checked=(response,status=200)=>{assert.equal(response.status,status,response.message||'Unexpected backup rehearsal API response');return response;};
function login(actor,result,field='account'){actor.cookie=result.cookie.split(';')[0];actor.id=result[field].id;}
async function closeServer(){if(server){await new Promise(resolve=>server.close(resolve));server=null;}}
function startServer(){const app=require('../src/app');app.set('trust proxy',1);server=app.listen(0);base=`http://127.0.0.1:${server.address().port}/api`;}
async function snapshot(db,client){
 assert.match(db.databaseName,/^saas_backup_rehearsal_/);const tables=[];
 for(const name of codec.PERSISTENT)tables.push({name,indexes:await db.collection(name).listIndexes().toArray(),documents:[]});
 const session=client.startSession();try{await session.withTransaction(async()=>{for(const table of tables)table.documents=await db.collection(table.name).find({},{session,promoteValues:false}).sort({_id:1}).toArray();},{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});}finally{await session.endSession();}
 return codec.makeArchive(tables);
}
async function restore(db,client,payload){
 assert.match(db.databaseName,/^saas_backup_rehearsal_/);codec.validate(payload);const tables=payload.tables.map(table=>({...table,restored:codec.restoreDocuments(table)}));
 if((await db.listCollections().toArray()).length)throw new Error('Rehearsal target must be a new empty database');
 for(const table of tables){await db.createCollection(table.name);for(const index of table.indexes){if(index.name==='_id_')continue;const {key,...options}=index;await db.collection(table.name).createIndex(key,options);}}
 const session=client.startSession();try{await session.withTransaction(async()=>{for(const table of tables)if(table.restored.length)await db.collection(table.name).insertMany(table.restored,{session});},{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});}finally{await session.endSession();}
}
before(async()=>{
 source=await MongoMemoryReplSet.create({replSet:{count:1,args:['--nounixsocket']},instanceOpts:[{launchTimeout:60000}]});sourceUri=source.getUri('saas_backup_rehearsal_source');await mongoose.connect(sourceUri);
 process.env.SAAS_FOUNDATION_ENABLED='true';process.env.SAAS_LOCAL_OWNER_MAIL_PREVIEW_KEY=randomBytes(32).toString('hex');process.env.SAAS_LOCAL_MAIL_PREVIEW_KEY=randomBytes(32).toString('hex');
 models=fs.readdirSync(path.resolve(__dirname,'../src/models')).filter(name=>/^(?:Saas.*|Bakery|BakeryMembership)\.js$/.test(name)).map(name=>require('../src/models/'+name));await Promise.all(models.map(model=>model.init()));
 assert.deepEqual(models.map(model=>model.collection.name).sort(),[...codec.PERSISTENT,...codec.EPHEMERAL].sort());startServer();
 for(const[actor,name]of[[owner,'Owner'],[other,'Other']])login(actor,checked(await api('POST','/saas/account/register',{email:`${name.toLowerCase()}@example.test`,displayName:name,password,confirmed:true},actor),201));
 a=checked(await api('POST','/saas/bakeries',{name:'Synthetic restore A',slug:'restore-a'}),201).bakery;b=checked(await api('POST','/saas/bakeries',{name:'Synthetic restore B',slug:'restore-b'},other),201).bakery;
 product=checked(await api('POST',ownerPath('products'),{name:'Synthetic cake',slug:'cake',category:'Cakes',pricePaise:19900,stockCount:10}),201).product;
 checked(await api('POST',`/saas/bakeries/${b._id}/products`,{name:'Other synthetic cake',slug:'cake',category:'Cakes',pricePaise:19900,stockCount:5},other),201);
 const material=checked(await api('POST',ownerPath('materials'),{name:'Synthetic cream',packQuantity:'1000',packUom:'g',purchasePricePaise:10000}),201).material;
 const recipe=checked(await api('POST',ownerPath('recipes'),{name:'Synthetic batch',category:'Cakes',yieldPieces:8,overheadPaise:1600,ingredients:[{materialId:material._id,expectedVersion:1,quantity:'400',uom:'g'}]}),201);
 checked(await api('PATCH',ownerPath(`products/${product._id}/recipe-mapping`),{revisionId:recipe.revision._id,expectedVersion:product.version}));
 checked(await api('POST',ownerPath('inventory'),{materialId:material._id,kind:'opening',quantity:'1000',uom:'g',expectedMaterialVersion:1,expectedStockVersion:0,reason:'Synthetic receipt',confirmed:true,idempotencyKey:randomUUID()}),201);
 const event=checked(await api('POST',ownerPath('events'),{name:'Synthetic event',key:'synthetic-event',rentPaise:500}),201).event;
 order=checked(await api('POST',ownerPath('orders'),{eventId:event._id,items:[{productId:product._id,quantity:2,expectedUnitPricePaise:19900}],paymentStatus:'paid',paymentMethod:'cash',idempotencyKey:randomUUID()}),201).order;
 for(const[bakery,actor]of[[a,owner],[b,other]])checked(await api('PATCH',`/saas/bakeries/${bakery._id}/storefront-settings`,{expectedVersion:0,published:true,acceptCustomerOrders:true,brandTheme:'sage'},actor));
 const picture=await sharp({create:{width:32,height:32,channels:3,background:'#887755'}}).png().toBuffer();for(const[kind,id]of[['logo',a._id],['product',product._id]])checked(await api('POST',ownerPath(`media/${kind}/${id}`),{imageBase64:picture.toString('base64'),expectedVersion:0,confirmed:true}));
 login(customer,checked(await api('POST',customerPath('/register'),{email:'customer@example.test',displayName:'Synthetic customer',password},customer),201),'customer');
 reservation=checked(await api('POST',customerPath('/orders'),{items:[{productId:product._id,quantity:1,expectedUnitPricePaise:19900}],expectedReservationMinutes:30,idempotencyKey:randomUUID(),confirmed:true},customer),201).order;
 checked(await api('POST',ownerPath('invitations'),{expiresInMinutes:30}),201);
 checked(await api('POST','/saas/account/password-reset/request',{email:'owner@example.test'},null));checked(await api('POST',customerPath('/password-reset/request'),{email:'customer@example.test'},null));
 await mongoose.connection.db.collection('users').insertOne({synthetic:true,neverBackUp:'legacy sentinel'});
 await closeServer();archive=await snapshot(mongoose.connection.db,mongoose.connection.getClient());encrypted=codec.seal(archive,key);folder=fs.mkdtempSync(path.join(os.tmpdir(),'saas-synthetic-backup-'));fs.writeFileSync(path.join(folder,'archive.saasbin'),encrypted,{flag:'wx',mode:0o600});
 await mongoose.disconnect();await source.stop();sourceStopped=true;
 target=await MongoMemoryReplSet.create({replSet:{count:1,args:['--nounixsocket']},instanceOpts:[{launchTimeout:60000}]});targetClient=new MongoClient(target.getUri(),{directConnection:true,serverSelectionTimeoutMS:5000});await targetClient.connect();
});
after(async()=>{await closeServer();await mongoose.disconnect();if(targetClient)await targetClient.close();if(source&&!sourceStopped)await source.stop();if(target)await target.stop();if(folder)fs.rmSync(folder,{recursive:true,force:true});key.fill(0);delete process.env.SAAS_FOUNDATION_ENABLED;delete process.env.SAAS_LOCAL_OWNER_MAIL_PREVIEW_KEY;delete process.env.SAAS_LOCAL_MAIL_PREVIEW_KEY;});
test('cold rehearsal archive preserves BSON and all persistent collections while excluding credentials that authorize existing sessions',async()=>{
 assert.equal(sourceStopped,true);assert.equal(fs.statSync(path.join(folder,'archive.saasbin')).mode&0o777,0o600);assert.equal(encrypted.includes(Buffer.from('owner@example.test')),false);assert.equal(encrypted.includes(Buffer.from('legacy sentinel')),false);
 const decoded=codec.open(fs.readFileSync(path.join(folder,'archive.saasbin')),key);assert.deepEqual(decoded,archive);assert.equal(decoded.tables.length,codec.PERSISTENT.length);assert.equal(decoded.tables.some(row=>codec.EPHEMERAL.includes(row.name)),false);
 assert.ok(decoded.tables.find(row=>row.name==='saas_media').documents[0].bytes.$binary);assert.ok(decoded.tables.find(row=>row.name==='saas_orders').documents[0]._id.$oid);assert.ok(decoded.tables.find(row=>row.name==='saas_accounts').documents[0].createdAt.$date);
 assert.equal(decoded.tables.find(row=>row.name==='saas_orders').documents.length,2);assert.equal(decoded.tables.find(row=>row.name==='saas_payment_entries').documents.length,1);
});
test('wrong keys, tampered/truncated archives and unrecognized/missing collections fail before restore',()=>{
 assert.throws(()=>codec.open(encrypted,randomBytes(32)),/Invalid/);const tampered=Buffer.from(encrypted);tampered[tampered.length-1]^=1;assert.throws(()=>codec.open(tampered,key),/Invalid/);assert.throws(()=>codec.open(encrypted.subarray(0,30),key),/Invalid/);
 for(const change of [value=>value.tables.pop(),value=>value.tables[0].name='users',value=>value.tables.push(value.tables[0])]){const value=structuredClone(archive);change(value);value.checksum=codec.digest(value.tables);assert.throws(()=>codec.validate(value),/Invalid/);}
});
test('restoring into an occupied database is refused without changing its sentinel',async()=>{
 const db=targetClient.db('saas_backup_rehearsal_occupied');await db.collection('sentinel').insertOne({safe:true});await assert.rejects(restore(db,targetClient,codec.open(encrypted,key)),/new empty/);assert.equal(await db.collection('sentinel').countDocuments({safe:true}),1);assert.equal((await db.listCollections().toArray()).length,1);
});
test('duplicate unique keys roll back all restored documents; namespace DDL is isolated to the disposable target',async()=>{
 const bad=structuredClone(archive),table=bad.tables.find(row=>row.name==='saas_products');table.documents[1].bakeryId=structuredClone(table.documents[0].bakeryId);table.documents[1].slug=table.documents[0].slug;bad.checksum=codec.digest(bad.tables);const db=targetClient.db('saas_backup_rehearsal_rollback');await assert.rejects(restore(db,targetClient,bad),error=>error.code===11000);
 for(const name of codec.PERSISTENT)assert.equal(await db.collection(name).countDocuments(),0);
});
test('fresh restore matches every persistent document and index after explicit session/publication holds',async()=>{
 const db=targetClient.db('saas_backup_rehearsal_restored');const decoded=codec.open(fs.readFileSync(path.join(folder,'archive.saasbin')),key);await restore(db,targetClient,decoded);const actual=await snapshot(db,targetClient);
 for(const table of decoded.tables){const restored=actual.tables.find(row=>row.name===table.name);assert.deepEqual(restored.indexes,table.indexes);assert.deepEqual(restored.documents,BSON.EJSON.serialize(codec.restoreDocuments(table),{relaxed:false}));}
 for(const name of [...codec.EPHEMERAL,'users','products','orders'])assert.equal(await db.collection(name).countDocuments(),0);
 await mongoose.connect(target.getUri('saas_backup_rehearsal_restored'),{autoCreate:false,autoIndex:false});startServer();
});
test('restored API rejects old sessions, permits fresh scoped login and preserves payment/cost/image history without republishing',async()=>{
 checked(await api('GET','/saas/account/me'),401);checked(await api('GET',customerPath('/me'),undefined,customer),401);
 login(owner,checked(await api('POST','/saas/account/login',{email:'owner@example.test',password})));login(other,checked(await api('POST','/saas/account/login',{email:'other@example.test',password},other)));
 checked(await api('GET',`/saas/bakeries/${b._id}/context`,undefined,owner),404);checked(await api('GET',ownerPath('context'),undefined,other),404);
 const restored=checked(await api('GET',ownerPath(`orders/${order._id}`))).order;assert.equal(restored.receivedPaise,39800);assert.equal(restored.duePaise,0);const ledger=checked(await api('GET',ownerPath(`orders/${order._id}/history/payments`))).entries;assert.equal(ledger.length,1);assert.equal(ledger[0].amountPaise,39800);
 const privateOrder=await require('../src/models/SaasOrder').findById(order._id).select('+costSnapshot');assert.equal(privateOrder.costSnapshot[0].batchCostPaise,'5600');assert.ok(privateOrder.createdAt instanceof Date);assert.equal(checked(await api('GET',ownerPath(`products/${product._id}`))).product.stockCount,7);
 assert.equal(checked(await api('GET',ownerPath('inventory'))).stocks[0].onHand,'1000');const settings=checked(await api('GET',ownerPath('storefront-settings'))).settings;assert.equal(settings.published,false);assert.equal(settings.acceptCustomerOrders,false);assert.equal(settings.version,2);checked(await api('GET',`/saas/storefront/${a.slug}`,undefined,null),404);
 const slot=checked(await api('GET',ownerPath(`media/logo/${a._id}`))).slot;const metadata=await sharp(Buffer.from(slot.image.dataUrl.split(',')[1],'base64')).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.width,32);
 login(customer,checked(await api('POST',customerPath('/login'),{email:'customer@example.test',password},customer)),'customer');assert.equal(checked(await api('GET',customerPath(`/orders/${reservation._id}`),undefined,customer)).order.paymentStatus,'unpaid');
 checked(await api('POST',ownerPath(`orders/${reservation._id}/cancel-pickup`),{expectedVersion:reservation.version,confirmed:true,reason:'Synthetic restore reconciliation'}));assert.equal(checked(await api('GET',ownerPath(`products/${product._id}`))).product.stockCount,8);
 assert.equal(checked(await api('GET','/saas/account/me')).account.emailVerified,false);
});
