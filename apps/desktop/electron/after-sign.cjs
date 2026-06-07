const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * macOS afterSign 钩子。
 *
 * 两种模式，自动判断：
 *
 * 1) 正式分发：当 electron-builder 已用 Developer ID 证书签名（设置了 CSC_NAME，
 *    或本机存在唯一的 Developer ID Application 证书），且提供了公证凭据
 *    （APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID）时，
 *    用 notarytool 公证并 staple，产出可对外分发、Gatekeeper 放行的 .app。
 *
 * 2) 本机自用：当未做正式签名时，回退为 ad-hoc 签名（codesign --sign -），
 *    仅保证本机能运行，不公证。
 *
 * 换签名账号 = 改环境变量，无需改代码：
 *   CSC_NAME                      指定用哪张证书签名（如 "Developer ID Application: xxx (TEAMID)"）
 *   APPLE_ID                      公证用的 Apple ID
 *   APPLE_APP_SPECIFIC_PASSWORD   App 专用密码（appleid.apple.com 生成，非登录密码）
 *   APPLE_TEAM_ID                 团队 ID（10 位）
 */
exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  // 判断 electron-builder 是否已用 Developer ID 正式签名。
  // 注意：codesign 的描述信息输出到 stderr，必须合并 stderr 才能匹配到。
  let developerIdSigned = false;
  try {
    const info = execFileSync('codesign', ['-dvvv', appPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    developerIdSigned = /Authority=Developer ID Application/.test(info);
  } catch (err) {
    // 即使退出码非 0，描述信息可能已写入 stdout/stderr
    const out = `${err.stdout || ''}${err.stderr || ''}`;
    developerIdSigned = /Authority=Developer ID Application/.test(out);
  }
  // 兜底：execFileSync 成功时返回的是 stdout，但描述在 stderr，
  // 上面可能拿不到。直接用合并流再确认一次。
  if (!developerIdSigned) {
    try {
      const merged = require('child_process').execSync(
        `codesign -dvvv "${appPath}" 2>&1`,
        { encoding: 'utf8' },
      );
      developerIdSigned = /Authority=Developer ID Application/.test(merged);
    } catch (err) {
      developerIdSigned = /Authority=Developer ID Application/.test(
        `${err.stdout || ''}${err.stderr || ''}`,
      );
    }
  }

  if (!developerIdSigned) {
    // 回退：ad-hoc 签名，仅本机可用
    console.log('[afterSign] 未检测到 Developer ID 签名，执行 ad-hoc 签名（仅本机可用）');
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
      stdio: 'inherit',
    });
    return;
  }

  // 已正式签名 → 检查公证凭据
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.warn(
      '[afterSign] 已用 Developer ID 签名，但缺少公证凭据' +
        '（APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID），跳过公证。\n' +
        '            未公证的包对外分发时仍会被 Gatekeeper 拦截。',
    );
    return;
  }

  console.log('[afterSign] 开始公证：', appPath);

  // 1) 压缩 .app（notarytool 需要 zip/dmg/pkg）
  const zipPath = path.join(os.tmpdir(), `${path.basename(appPath)}.${Date.now()}.zip`);
  execFileSync('ditto', ['-c', '-k', '--keepParent', appPath, zipPath], {
    stdio: 'inherit',
  });

  try {
    // 2) 提交公证并等待结果
    execFileSync(
      'xcrun',
      [
        'notarytool',
        'submit',
        zipPath,
        '--apple-id',
        APPLE_ID,
        '--password',
        APPLE_APP_SPECIFIC_PASSWORD,
        '--team-id',
        APPLE_TEAM_ID,
        '--wait',
      ],
      { stdio: 'inherit' },
    );

    // 3) staple 到 .app（DMG 在此之后构建，会包含已 staple 的 app）
    execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' });
    console.log('[afterSign] 公证 + staple 完成 ✅');
  } finally {
    try {
      fs.rmSync(zipPath, { force: true });
    } catch {
      /* ignore */
    }
  }
};
