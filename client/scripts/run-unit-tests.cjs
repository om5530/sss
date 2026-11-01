const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(root, '.unit-test-output-'));
try {
  const entries = fs.readdirSync(__dirname).filter(name => /\.test\.ts$/.test(name)).sort();
  for (const name of entries) buildSync({
    absWorkingDir: root, entryPoints: [path.join(__dirname, name)],
    outfile: path.join(directory, name.replace(/\.ts$/, '.mjs')),
    bundle: true, packages: 'external', platform: 'node', format: 'esm', tsconfig: path.join(root, 'tsconfig.json'),
  });
  // Startup checks read the actual distribution/source, so run the existing
  // JavaScript test directly rather than bundling away its relative paths.
  const tests = [...entries.map(name => path.join(directory, name.replace(/\.ts$/, '.mjs'))),
    path.join(__dirname, 'app-startup.test.js')];
  const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
