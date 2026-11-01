const { validateLocalUri } = require('../utils/local-saas-uri');
const { localOrigin } = require('../config/saas-local-routing');
const keys = ['schemaVersion','mode','databaseUri','publicOrigin','apiOrigin','dataSource','deployTarget','billingMode','ownerMailDelivery','customerMailDelivery'];
function preflight(config) {
 const checks = [], check = (name, valid, message) => checks.push({ name, status: valid ? 'pass' : 'blocked', message });
 const object = config && typeof config === 'object' && !Array.isArray(config);
 check('shape', Boolean(object && Object.keys(config).length === keys.length && keys.every(key => Object.hasOwn(config,key))), 'Use exactly the documented rehearsal fields; do not include credentials');
 if (object) {
  check('mode', config.schemaVersion === 1 && config.mode === 'local-rehearsal', 'Only schema version 1 local rehearsal is supported');
  let database = false; try { validateLocalUri(config.databaseUri); database = true; } catch {}
  check('database', database, 'Use an explicit credential-free loopback saas_* MongoDB URI');
  for (const key of ['publicOrigin','apiOrigin']) { let valid = false; try { localOrigin(config[key]); valid = true; } catch {} check(key, valid, 'Use a loopback HTTP(S) origin without paths, credentials or forwarding headers'); }
  check('data', config.dataSource === 'synthetic', 'Only synthetic fixtures are permitted');
  check('deployment', config.deployTarget === 'none', 'This offline preflight cannot authorize deployment');
  check('billing', ['disabled','test'].includes(config.billingMode), 'Billing must be disabled or explicitly test-only; credentials are not checked');
  check('mail', config.ownerMailDelivery === 'local-preview' && config.customerMailDelivery === 'local-preview', 'Only local previews are configured; real delivery is not verified');
 }
 return { formatVersion: 1, readyForLocalConfiguration: checks.every(check => check.status === 'pass'), readyForHostedStaging: false, readyForProduction: false, performed: 'offline-configuration-check-only', checks,
 pending: ['Runtime guards and synthetic end-to-end rehearsal','Verified email delivery and recovery','Real billing sandbox acceptance if enabled','Production media storage and host/cookie policy','Shared abuse controls, monitoring and backup/restore','Browser/iPad validation and reviewed staged rollout'] };
}
module.exports = { preflight };
