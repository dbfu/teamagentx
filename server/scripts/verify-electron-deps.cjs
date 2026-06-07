const fs = require('fs');
const path = require('path');

const serverRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(serverRoot, 'package.json'));
const nodeModulesProd = path.join(serverRoot, 'node_modules-prod');

const requiredPackages = Object.keys(packageJson.dependencies || {});
const missingPackages = requiredPackages.filter((packageName) => {
  return !fs.existsSync(path.join(nodeModulesProd, 'node_modules', ...packageName.split('/'), 'package.json'));
});

if (missingPackages.length > 0) {
  console.error('[verify-electron-deps] Missing production dependencies in node_modules-prod:');
  for (const packageName of missingPackages) {
    console.error(`  - ${packageName}`);
  }
  process.exit(1);
}

const requiredRuntimePackages = [
  '@libsql/core',
  '@libsql/hrana-client',
  '@libsql/isomorphic-ws',
  '@neon-rs/load',
  'cross-fetch',
  'detect-libc',
  'js-base64',
  'libsql',
  'node-fetch',
  'promise-limit',
  'ws',
];

const missingRuntimePackages = requiredRuntimePackages.filter((packageName) => {
  return !fs.existsSync(path.join(nodeModulesProd, 'node_modules', ...packageName.split('/'), 'package.json'));
});

if (missingRuntimePackages.length > 0) {
  console.error('[verify-electron-deps] Missing runtime dependencies in node_modules-prod:');
  for (const packageName of missingRuntimePackages) {
    console.error(`  - ${packageName}`);
  }
  process.exit(1);
}

console.log(`[verify-electron-deps] Verified ${requiredPackages.length} production dependencies and ${requiredRuntimePackages.length} runtime dependencies`);
