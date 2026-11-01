const {test}=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync,spawnSync}=require('node:child_process');
const path=require('node:path');
const {localAuthority,localOrigin,menuLink}=require('../src/config/saas-local-routing');
const {preflight}=require('../src/saas/rehearsal-preflight');
const example=require('../../docs/saas/rehearsal.example.json');
test('local tenant routing rejects ambiguous hosts and never derives origin from caller text',()=>{
 for(const host of ['localhost','LOCALHOST:4200','127.0.0.1:5000','[::1]:65535'])assert.equal(localAuthority(host),true);
 for(const host of [undefined,'','localhost.evil.test','evil.test','localhost:0','localhost:65536','localhost:01','localhost:80@evil.test','localhost,evil.test','localhost/anything'])assert.equal(localAuthority(host),false);
 for(const origin of ['http://localhost:4200','https://127.0.0.1:5000','http://[::1]:4200'])assert.equal(localOrigin(origin),origin);
 for(const origin of ['https://production.test','http://localhost/path','http://localhost?token=x','http://user:pass@localhost','file:///tmp/x','http://2130706433','http://localhost:0'])assert.throws(()=>localOrigin(origin));
 assert.deepEqual(menuLink('bakery-a','http://localhost:4200'),{path:'/b/bakery-a',url:'http://localhost:4200/b/bakery-a'});assert.throws(()=>menuLink('../admin','http://localhost'));
});
test('valid synthetic preflight never claims hosted staging or production ready and unsafe configurations are redacted',()=>{
 const report=preflight(example);assert.equal(report.readyForLocalConfiguration,true);assert.equal(report.readyForHostedStaging,false);assert.equal(report.readyForProduction,false);
 for(const patch of [{databaseUri:'mongodb+srv://production.test/live'},{databaseUri:'mongodb://user:SECRET@127.0.0.1/saas_x'},{publicOrigin:'https://production.test'},{apiOrigin:'http://localhost/api'},{dataSource:'production-copy'},{deployTarget:'vercel'},{mode:'staging'},{billingMode:'live'},{ownerMailDelivery:'smtp'},{apiKey:'SECRET'}]){const denied=preflight({...example,...patch});assert.equal(denied.readyForLocalConfiguration,false);assert.equal(JSON.stringify(denied).includes('SECRET'),false);}
 assert.equal(preflight(null).readyForLocalConfiguration,false);assert.equal(preflight({}).readyForLocalConfiguration,false);
});
test('offline rehearsal CLI imports no database driver, ignores ambient production configuration and reports invalid input safely',()=>{
 const cli=require.resolve('../src/utils/saas-rehearsal-preflight'),fixture=path.resolve(__dirname,'../../docs/saas/rehearsal.example.json');
 const report=JSON.parse(execFileSync(process.execPath,[cli,'--config',fixture],{encoding:'utf8',env:{...process.env,MONGODB_URI:'mongodb+srv://SECRET@production.test/live',NODE_ENV:'production'}}));assert.equal(report.readyForLocalConfiguration,true);assert.equal(JSON.stringify(report).includes('SECRET'),false);
 assert.equal(execFileSync(process.execPath,['-e',`require(${JSON.stringify(cli)});console.log(Object.keys(require.cache).some(p=>/node_modules.*(?:mongoose|mongodb|dotenv)/.test(p)))`],{encoding:'utf8'}).trim(),'false');
 const failed=spawnSync(process.execPath,[cli,'--uri','mongodb+srv://SECRET@production.test/live'],{encoding:'utf8'});assert.equal(failed.status,1);assert.equal((failed.stdout+failed.stderr).includes('SECRET'),false);
});
