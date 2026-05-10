const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  execFileSync('codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    appPath,
  ], { stdio: 'inherit' });
};
