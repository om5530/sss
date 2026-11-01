// Rehearsal-only codec. No connections, filesystem access or restore endpoint.
const {createHash,randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const {BSON}=require('mongoose').mongo;
const PERSISTENT=Object.freeze(['bakeries','bakerymemberships','saas_accounts','saas_account_audit','saas_audit_logs','saas_billing_checkouts','saas_billing_events','saas_billing_invoices','saas_customers','saas_events','saas_materials','saas_material_movements','saas_material_stocks','saas_media','saas_orders','saas_order_changes','saas_payment_entries','saas_products','saas_production_runs','saas_recipes','saas_recipe_revisions','saas_stock_movements','saas_storefronts','saas_subscription_changes','saas_waste'].sort());
const EPHEMERAL=Object.freeze(['saas_account_sessions','saas_account_actions','saas_account_mail_previews','saas_customer_sessions','saas_customer_actions','saas_customer_mail_previews','saas_invitations'].sort());
const MAGIC=Buffer.from('SAASBK01'),MAX_BYTES=16*1024*1024;
const invalid=()=>new Error('Invalid synthetic rehearsal archive');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function indexOf(row){const value={key:row.key,name:row.name};for(const key of ['unique','sparse','partialFilterExpression','expireAfterSeconds','collation'])if(row[key]!==undefined)value[key]=row[key];return value;}
function makeArchive(collections){
 const tables=collections.map(row=>({name:row.name,indexes:row.indexes.map(indexOf).sort((a,b)=>a.name.localeCompare(b.name)),documents:BSON.EJSON.serialize(row.documents,{relaxed:false})})).sort((a,b)=>a.name.localeCompare(b.name));
 const archive={formatVersion:1,scope:'synthetic-rehearsal-only',excluded:[...EPHEMERAL],tables,checksum:digest(tables)};validate(archive);return archive;
}
function validate(archive){
 if(!archive||archive.formatVersion!==1||archive.scope!=='synthetic-rehearsal-only'||Object.keys(archive).sort().join(',')!=='checksum,excluded,formatVersion,scope,tables'||JSON.stringify(archive.excluded)!==JSON.stringify(EPHEMERAL)||!Array.isArray(archive.tables)||archive.tables.length!==PERSISTENT.length||archive.checksum!==digest(archive.tables))throw invalid();
 const names=archive.tables.map(row=>row?.name).sort();if(JSON.stringify(names)!==JSON.stringify(PERSISTENT))throw invalid();
 for(const row of archive.tables){
  if(Object.keys(row).sort().join(',')!=='documents,indexes,name'||!Array.isArray(row.documents)||!Array.isArray(row.indexes)||row.documents.length>10000)throw invalid();
  const ids=new Set();for(const document of row.documents){if(!document||typeof document!=='object'||Array.isArray(document)||!document._id)throw invalid();const id=JSON.stringify(document._id);if(ids.has(id))throw invalid();ids.add(id);}
  const indexes=new Set();for(const index of row.indexes){if(!index||typeof index.name!=='string'||!index.name||indexes.has(index.name)||!index.key||typeof index.key!=='object'||Array.isArray(index.key)||!Object.keys(index.key).length||Object.keys(index).some(key=>!['key','name','unique','sparse','partialFilterExpression','expireAfterSeconds','collation'].includes(key)))throw invalid();indexes.add(index.name);}
  if(!indexes.has('_id_'))throw invalid();
 }
 return archive;
}
function seal(archive,key){
 validate(archive);if(!Buffer.isBuffer(key)||key.length!==32)throw invalid();const plaintext=Buffer.from(JSON.stringify(archive));if(plaintext.length>MAX_BYTES)throw invalid();
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(MAGIC);const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);return Buffer.concat([MAGIC,iv,cipher.getAuthTag(),ciphertext]);
}
function open(bytes,key){
 try{if(!Buffer.isBuffer(bytes)||bytes.length<=36||bytes.length>MAX_BYTES+36||!bytes.subarray(0,8).equals(MAGIC)||!Buffer.isBuffer(key)||key.length!==32)throw invalid();const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(8,20));decipher.setAAD(MAGIC);decipher.setAuthTag(bytes.subarray(20,36));return validate(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(36)),decipher.final()]).toString('utf8')));}catch{throw invalid();}
}
function restoreDocuments(table){
 if(!PERSISTENT.includes(table.name))throw invalid();const documents=BSON.EJSON.deserialize(table.documents,{relaxed:false});
 return documents.map(row=>{
  if(['saas_accounts','saas_customers'].includes(table.name)){const version=Number(row.sessionVersion);if(!Number.isSafeInteger(version)||version<1||version>=Number.MAX_SAFE_INTEGER)throw invalid();row.sessionVersion=version+1;}
  if(table.name==='saas_storefronts'){const version=Number(row.version);if(!Number.isSafeInteger(version)||version<1||version>=Number.MAX_SAFE_INTEGER)throw invalid();row.published=false;row.acceptCustomerOrders=false;row.version=version+1;}
  return row;
 });
}
module.exports={PERSISTENT,EPHEMERAL,indexOf,makeArchive,validate,seal,open,restoreDocuments,digest};
