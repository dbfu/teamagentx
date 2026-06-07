const fs = require('fs');
const path = require('path');

const assets = [
  // Keep this list for non-TypeScript runtime assets that must be copied to dist.
];

const legacyTargets = [
  path.join(__dirname, '..', 'dist', 'core', 'agent', 'builtin-skills'),
];

for (const target of legacyTargets) {
  fs.rmSync(target, { recursive: true, force: true });
}

for (const asset of assets) {
  if (!fs.existsSync(asset.from)) continue;
  fs.rmSync(asset.to, { recursive: true, force: true });
  fs.cpSync(asset.from, asset.to, { recursive: true });
  console.log(`[copy-assets] ${asset.from} -> ${asset.to}`);
}
