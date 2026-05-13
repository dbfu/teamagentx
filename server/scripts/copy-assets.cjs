const fs = require('fs');
const path = require('path');

const assets = [
  {
    from: path.join(__dirname, '..', 'src', 'core', 'agent', 'builtin-skills'),
    to: path.join(__dirname, '..', 'dist', 'core', 'agent', 'builtin-skills'),
  },
];

for (const asset of assets) {
  if (!fs.existsSync(asset.from)) continue;
  fs.rmSync(asset.to, { recursive: true, force: true });
  fs.cpSync(asset.from, asset.to, { recursive: true });
  console.log(`[copy-assets] ${asset.from} -> ${asset.to}`);
}
