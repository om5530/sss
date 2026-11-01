#!/usr/bin/env node
// Offline only: no dotenv, database driver, network or deployment import.
const fs = require('node:fs');
const { preflight } = require('../saas/rehearsal-preflight');
function main(args) {
 if (args.length !== 2 || args[0] !== '--config') throw new Error('Use --config with an explicit synthetic JSON file');
 const fd = fs.openSync(args[1], 'r'); let input;
 try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.size > 16384) throw new Error('Invalid config file'); const buffer = Buffer.alloc(16385), size = fs.readSync(fd,buffer,0,buffer.length,0); if(size>16384)throw new Error('Config is too large'); input=JSON.parse(buffer.subarray(0,size).toString('utf8')); } finally { fs.closeSync(fd); }
 const report=preflight(input);process.stdout.write(JSON.stringify(report,null,2)+'\n');if(!report.readyForLocalConfiguration)process.exitCode=1;return report;
}
if(require.main===module){try{main(process.argv.slice(2));}catch{process.stderr.write('Offline rehearsal preflight failed. Use an explicit readable synthetic configuration; no connection or deployment was attempted.\n');process.exitCode=1;}}
module.exports={main};
