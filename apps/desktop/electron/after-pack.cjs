const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');
const { pipeline } = require('stream/promises');
const zlib = require('zlib');
const tar = require('tar');

/**
 * After pack hook: ensure Prisma client is available in the bundled server/
 * extraResources directory. The Prisma client should already be generated
 * in server/node_modules/.prisma/ during the build step.
 * This hook copies the prisma schema and ensures the migration directory
 * is available for runtime migration.
 */
exports.default = async function (context) {
  const { appOutDir, packager } = context;
  const buildPlatform = process.platform; // Platform running the build (macOS, Windows, Linux)
  const targetPlatform = normalizeTargetPlatform(packager.platform.nodeName); // Target platform: 'darwin', 'win32', 'linux'
  const targetArch = context.arch ?? packager.arch; // electron-builder Arch enum or arch name

  // Determine resources directory based on TARGET platform, not build platform
  let resourcesDir;
  if (targetPlatform === 'darwin') {
    // macOS target: app is in a .app bundle
    const appBundlePath = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
    resourcesDir = path.join(appBundlePath, 'Contents', 'Resources');
  } else {
    // Windows/Linux target: resources dir is directly in appOutDir
    resourcesDir = path.join(appOutDir, 'resources');
  }

  const serverDir = path.join(resourcesDir, 'server');

  if (!fs.existsSync(serverDir)) {
    console.log('[afterPack] Server directory not found, skipping');
    console.log(`[afterPack] Expected path: ${serverDir}`);
    console.log(`[afterPack] appOutDir: ${appOutDir}`);
    console.log(`[afterPack] targetPlatform: ${targetPlatform}`);
    return;
  }

  const cleanupLogs = [];

  // Ensure the prisma schema is available at runtime
  const prismaDir = path.join(serverDir, 'prisma');
  if (fs.existsSync(prismaDir)) {
    console.log('[afterPack] Prisma directory found at', prismaDir);
    // Verify schema.prisma exists
    const schemaPath = path.join(prismaDir, 'schema.prisma');
    if (fs.existsSync(schemaPath)) {
      console.log('[afterPack] schema.prisma found');
    }
  }

  const nodeModulesDir = path.join(serverDir, 'node_modules');

  // Copy .prisma/client from original node_modules to the bundled node_modules.
  // pnpm deploy may not copy generated Prisma artifacts into package internals.
  const projectRoot = path.resolve(__dirname, '../../..');
  const originalNodeModulesDir = path.join(projectRoot, 'server', 'node_modules');
  const originalPrismaClientDir = findGeneratedPrismaClientDir(originalNodeModulesDir, projectRoot);
  const targetPrismaClientDir = resolvePrismaClientTargetDir(nodeModulesDir);

  // Check if the bundled node_modules has .pnpm directory (pnpm structure)
  const bundledPnpmDir = path.join(nodeModulesDir, '.pnpm');
  const hasPnpmStructure = fs.existsSync(bundledPnpmDir);

  if (!originalPrismaClientDir) {
    throw new Error('[afterPack] Generated Prisma client not found. Run "cd server && pnpm db:generate" before building.');
  }

  assertPrismaClientHasChatRoomWorkDir(originalPrismaClientDir);

  if (targetPrismaClientDir && hasPnpmStructure) {
    // Create target directory structure
    const targetPrismaDir = path.dirname(targetPrismaClientDir);
    if (!fs.existsSync(targetPrismaDir)) {
      fs.mkdirSync(targetPrismaDir, { recursive: true });
    }

    // Copy the entire .prisma/client directory
    copyDirSync(originalPrismaClientDir, targetPrismaClientDir);
    console.log('[afterPack] Copied .prisma/client to bundled node_modules');
  }

  // Verify .prisma client exists in node_modules
  const prismaClientDir = targetPrismaClientDir;
  if (prismaClientDir && fs.existsSync(prismaClientDir)) {
    assertPrismaClientHasChatRoomWorkDir(prismaClientDir);
    console.log('[afterPack] Prisma client found in node_modules');
  } else {
    throw new Error('[afterPack] .prisma/client not found in bundled node_modules.');
  }

  // Shrink bundled runtime payload by removing files that are not needed on
  // the shipped macOS arm64 runtime:
  // - test output and type/source-map artifacts
  // - Prisma CLI/helper/studio packages (runtime uses generated client + libsql only)
  // - non-arm64-darwin vendor assets bundled with Claude SDK
  cleanupLogs.push(
    ...removeIfExists(path.join(serverDir, 'dist', '__tests__')),
    ...removePnpmPackages(nodeModulesDir, [
      '@fastify+swagger@',
      '@fastify+swagger-ui@',
      '@prisma+engines@',
      '@prisma+fetch-engine@',
      '@prisma+get-platform@',
      '@prisma+query-plan-executor@',
      '@prisma+studio-core@',
      '@prisma+dev@',
      '@radix-ui+',
      '@electric-sql+pglite@',
      '@electric-sql+pglite-tools@',
      '@types+react@',
      '@types+react-dom@',
      'prisma@',
      'react@',
      'react-dom@',
      'tsx@',
      'typescript@',
      'esbuild@',
    ]),
    ...prunePlatformPackages(nodeModulesDir, targetPlatform, targetArch),
    ...pruneClaudeAgentSdkVendor(nodeModulesDir, targetPlatform, targetArch),
    ...prunePrismaClientRuntime(nodeModulesDir),
    ...removeFilesByPattern(nodeModulesDir, (fullPath) => (
      fullPath.endsWith('.map')
      || fullPath.endsWith('.d.ts')
      || fullPath.endsWith('.d.mts')
      || fullPath.endsWith('.d.cts')
    )),
  );

  if (cleanupLogs.length > 0) {
    console.log('[afterPack] Cleanup summary:');
    for (const line of cleanupLogs) {
      console.log(`[afterPack]   - ${line}`);
    }
  }

  // Windows 不支持 Unix 软链接，需要将所有软链接转换为实际文件
  if (targetPlatform === 'win32') {
    // pnpm .pnpm dir has mutually-referencing symlink node_modules subdirs.
    // Expanding them causes packages to be copied dozens of times (GBs -> tens of GBs).
    // Delete .pnpm/node_modules bridge dirs first, keeping only top-level symlinks.
    const pnpmInternalNm = path.join(nodeModulesDir, '.pnpm', 'node_modules');
    if (fs.existsSync(pnpmInternalNm)) {
      const size = getPathSize(pnpmInternalNm);
      fs.rmSync(pnpmInternalNm, { recursive: true, force: true });
      console.log(`[afterPack] Removed .pnpm/node_modules bridge dir (${formatBytes(size)})`);
    }

    const convertedSymlinks = convertSymlinksToFiles(serverDir);
    if (convertedSymlinks.length > 0) {
      console.log(`[afterPack] Converted ${convertedSymlinks.length} symlink(s) to files for Windows`);
    }

    cleanupLogs.push(
      ...pruneNestedPlatformPackageCopies(nodeModulesDir, targetPlatform, targetArch),
      ...hoistPnpmPackageCopies(nodeModulesDir),
      ...pruneHoistedPnpmDuplicates(nodeModulesDir),
      ...removeJunkDocFiles(nodeModulesDir),
      ...removeDevDirectories(nodeModulesDir),
      ...removeFilesByPattern(nodeModulesDir, (fullPath) => (
        fullPath.endsWith('.map')
        || fullPath.endsWith('.d.ts')
        || fullPath.endsWith('.d.mts')
        || fullPath.endsWith('.d.cts')
      )),
    );
  }

  // Some filtered pnpm packages leave dangling symlinks behind in the bundled
  // node_modules. Those broken links make the final app bundle fail code-sign
  // verification on macOS, which then prevents the app from launching.
  const removedDanglingSymlinks = removeDanglingSymlinks(serverDir);
  if (removedDanglingSymlinks.length > 0) {
    console.log(`[afterPack] Removed ${removedDanglingSymlinks.length} dangling symlink(s)`);
    for (const symlinkPath of removedDanglingSymlinks) {
      console.log(`[afterPack]   - ${symlinkPath}`);
    }
  }

  await createServerRuntimeArchive(serverDir, resourcesDir);
};

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function removeDanglingSymlinks(rootDir) {
  const removed = [];

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isSymbolicLink()) {
        if (!fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          removed.push(fullPath);
        }
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      }
    }
  }

  walk(rootDir);
  return removed;
}

async function createServerRuntimeArchive(serverDir, resourcesDir) {
  const useZstd = typeof zlib.createZstdCompress === 'function';
  const archivePath = path.join(resourcesDir, useZstd ? 'server.tar.zst' : 'server.tar.gz');
  const startedAt = Date.now();

  if (fs.existsSync(archivePath)) {
    fs.rmSync(archivePath, { force: true });
  }

  const beforeBytes = getPathSize(serverDir);
  console.log(`[afterPack] Creating server runtime archive: ${archivePath}`);

  await pipeline(
    tar.c(
      {
        cwd: serverDir,
        portable: true,
        noMtime: true,
      },
      ['.'],
    ),
    useZstd
      ? zlib.createZstdCompress({
          params: {
            [zlib.constants.ZSTD_c_compressionLevel]: 6,
          },
        })
      : zlib.createGzip({ level: 6 }),
    fs.createWriteStream(archivePath),
  );

  const archiveBytes = fs.statSync(archivePath).size;
  fs.rmSync(serverDir, { recursive: true, force: true });
  console.log(
    `[afterPack] Archived server runtime ${formatBytes(beforeBytes)} -> ${formatBytes(archiveBytes)} `
    + `in ${Date.now() - startedAt}ms; removed loose server directory`,
  );
}

/**
 * Convert all symlinks to actual files (required for Windows)
 * pnpm uses symlinks extensively, which don't work on Windows
 */
function convertSymlinksToFiles(rootDir) {
  const converted = [];

  // First pass: collect all symlinks and their targets
  const symlinks = [];
  function collectSymlinks(currentPath) {
    if (!fs.existsSync(currentPath)) return;
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      // Skip .bin directory
      if (fullPath.includes('node_modules/.bin')) continue;
      if (entry.isSymbolicLink()) {
        try {
          const linkTarget = fs.readlinkSync(fullPath);
          const resolvedTarget = path.resolve(currentPath, linkTarget);
          symlinks.push({ fullPath, resolvedTarget, parentDir: currentPath });
        } catch (e) {
          // Remove broken symlink
          try {
            fs.unlinkSync(fullPath);
            converted.push(`${fullPath} (broken, removed)`);
          } catch {}
        }
      } else if (entry.isDirectory()) {
        collectSymlinks(fullPath);
      }
    }
  }
  collectSymlinks(rootDir);

  // Sort symlinks by depth (deepest first) to avoid path issues when converting nested symlinks
  symlinks.sort((a, b) => b.fullPath.split('/').length - a.fullPath.split('/').length);

  // Second pass: convert symlinks to actual files
  for (const { fullPath, resolvedTarget, parentDir } of symlinks) {
    if (!fs.existsSync(fullPath)) continue; // Already converted or removed
    try {
      // Remove the symlink first
      fs.unlinkSync(fullPath);

      if (fs.existsSync(resolvedTarget)) {
        const stat = fs.statSync(resolvedTarget);
        if (stat.isDirectory()) {
          // Copy directory, but also convert any symlinks inside the copied directory
          copyDirWithSymlinkConversion(resolvedTarget, fullPath, rootDir, converted);
        } else {
          fs.copyFileSync(resolvedTarget, fullPath);
        }
        converted.push(fullPath);
      }
    } catch (e) {
      // If conversion fails, just remove the broken link
      try {
        fs.unlinkSync(fullPath);
      } catch {}
    }
  }

  return converted;
}

/**
 * Copy directory and convert any symlinks inside it to actual files
 */
function copyDirWithSymlinkConversion(src, dest, rootDir, converted) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      // Convert symlink to actual file
      try {
        const linkTarget = fs.readlinkSync(srcPath);
        const resolvedTarget = path.resolve(src, linkTarget);
        if (fs.existsSync(resolvedTarget)) {
          const stat = fs.statSync(resolvedTarget);
          if (stat.isDirectory()) {
            copyDirWithSymlinkConversion(resolvedTarget, destPath, rootDir, converted);
          } else {
            fs.copyFileSync(resolvedTarget, destPath);
          }
          converted.push(destPath);
        }
      } catch (e) {
        // Skip if symlink is broken
      }
    } else if (entry.isDirectory()) {
      copyDirWithSymlinkConversion(srcPath, destPath, rootDir, converted);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyPackageDirForWindows(src, dest) {
  if (!fs.existsSync(src) || fs.existsSync(dest)) {
    return false;
  }

  copyDirWithSymlinkConversion(src, dest, path.dirname(dest), []);
  return true;
}

function hoistPnpmPackageCopies(nodeModulesDir) {
  const pnpmDir = path.join(nodeModulesDir, '.pnpm');
  if (!fs.existsSync(pnpmDir)) {
    return [];
  }

  let copiedCount = 0;
  let copiedBytes = 0;

  const copyPackage = (sourcePath, packageNameParts) => {
    const destPath = path.join(nodeModulesDir, ...packageNameParts);
    if (fs.existsSync(destPath)) {
      return;
    }

    const beforeSize = getPathSize(destPath);
    if (copyPackageDirForWindows(sourcePath, destPath)) {
      copiedCount += 1;
      copiedBytes += getPathSize(destPath) - beforeSize;
    }
  };

  for (const storeEntry of fs.readdirSync(pnpmDir, { withFileTypes: true })) {
    if (!storeEntry.isDirectory()) continue;

    const packageNodeModules = path.join(pnpmDir, storeEntry.name, 'node_modules');
    if (!fs.existsSync(packageNodeModules)) continue;

    for (const entry of fs.readdirSync(packageNodeModules, { withFileTypes: true })) {
      const entryPath = path.join(packageNodeModules, entry.name);

      if (entry.name.startsWith('@') && entry.isDirectory()) {
        const scopeDir = entryPath;
        for (const scopedEntry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
          if (!scopedEntry.isDirectory() && !scopedEntry.isSymbolicLink()) continue;
          copyPackage(path.join(scopeDir, scopedEntry.name), [entry.name, scopedEntry.name]);
        }
        continue;
      }

      if (entry.isDirectory() || entry.isSymbolicLink()) {
        copyPackage(entryPath, [entry.name]);
      }
    }
  }

  if (copiedCount === 0) {
    return [];
  }

  return [`hoisted ${copiedCount} pnpm package copy/copies for Windows ESM resolution (${formatBytes(copiedBytes)})`];
}

function removeIfExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return [];
  }

  const size = getPathSize(targetPath);
  fs.rmSync(targetPath, { recursive: true, force: true });
  return [`removed ${path.relative(process.cwd(), targetPath)} (${formatBytes(size)})`];
}

function removePnpmPackages(nodeModulesDir, prefixes) {
  const pnpmDir = path.join(nodeModulesDir, '.pnpm');
  if (!fs.existsSync(pnpmDir)) {
    return [];
  }

  const removed = [];
  const entries = fs.readdirSync(pnpmDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!prefixes.some(prefix => entry.name.startsWith(prefix))) continue;

    removed.push(...removeIfExists(path.join(pnpmDir, entry.name)));
  }

  return removed;
}

function findPnpmPackageNodeModules(nodeModulesDir, packagePrefix) {
  const pnpmDir = path.join(nodeModulesDir, '.pnpm');
  if (!fs.existsSync(pnpmDir)) {
    return null;
  }

  const entries = fs.readdirSync(pnpmDir, { withFileTypes: true });
  const packageDir = entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith(packagePrefix))
    .map(entry => entry.name)
    .sort()
    .pop();

  if (!packageDir) {
    return null;
  }

  return path.join(pnpmDir, packageDir, 'node_modules');
}

function findGeneratedPrismaClientDir(nodeModulesDir, projectRoot) {
  const resolvedClientDir = resolveGeneratedPrismaClientDir(projectRoot);
  if (resolvedClientDir) {
    return resolvedClientDir;
  }

  const topLevelClientDir = path.join(nodeModulesDir, '.prisma', 'client');
  if (fs.existsSync(topLevelClientDir) && prismaClientHasChatRoomWorkDir(topLevelClientDir)) {
    return topLevelClientDir;
  }

  const prismaClientNodeModules = findPnpmPackageNodeModules(nodeModulesDir, '@prisma+client@');
  if (!prismaClientNodeModules) {
    return null;
  }

  const pnpmClientDir = path.join(prismaClientNodeModules, '.prisma', 'client');
  return fs.existsSync(pnpmClientDir) && prismaClientHasChatRoomWorkDir(pnpmClientDir) ? pnpmClientDir : null;
}

function resolveGeneratedPrismaClientDir(projectRoot) {
  try {
    const serverRequire = createRequire(path.join(projectRoot, 'server', 'package.json'));
    const packageJsonPath = serverRequire.resolve('@prisma/client/package.json');
    const packageDir = path.dirname(packageJsonPath);
    const clientDir = path.resolve(packageDir, '..', '..', '.prisma', 'client');
    return fs.existsSync(clientDir) && prismaClientHasChatRoomWorkDir(clientDir) ? clientDir : null;
  } catch {
    return null;
  }
}

function prismaClientHasChatRoomWorkDir(clientDir) {
  const schemaPath = path.join(clientDir, 'schema.prisma');
  if (!fs.existsSync(schemaPath)) {
    return false;
  }

  const schema = fs.readFileSync(schemaPath, 'utf8');
  const chatRoomModel = schema.match(/model\s+ChatRoom\s+\{[\s\S]*?\n\}/)?.[0] ?? '';
  return /\bworkDir\b/.test(chatRoomModel);
}

function assertPrismaClientHasChatRoomWorkDir(clientDir) {
  if (!prismaClientHasChatRoomWorkDir(clientDir)) {
    throw new Error(`[afterPack] Prisma client schema is missing ChatRoom.workDir: ${clientDir}`);
  }
}

function resolvePrismaClientTargetDir(nodeModulesDir) {
  const prismaClientNodeModules = findPnpmPackageNodeModules(nodeModulesDir, '@prisma+client@');
  if (prismaClientNodeModules) {
    return path.join(prismaClientNodeModules, '.prisma', 'client');
  }

  return path.join(nodeModulesDir, '.prisma', 'client');
}

function normalizeTargetPlatform(targetPlatform) {
  if (targetPlatform === 'win' || targetPlatform === 'windows') return 'win32';
  if (targetPlatform === 'mac' || targetPlatform === 'macos') return 'darwin';
  return targetPlatform;
}

function getTargetPackagePlatforms(targetPlatform, targetArch) {
  const arch = normalizeElectronBuilderArch(targetArch);

  if (!['x64', 'ia32', 'arm64'].includes(arch)) {
    if (targetPlatform === 'darwin') return ['darwin-x64', 'darwin-arm64'];
    if (targetPlatform === 'win32') return ['win32-x64', 'win32-arm64'];
    return ['linux-x64', 'linux-arm64'];
  }

  if (targetPlatform === 'darwin') {
    return [`darwin-${arch}`];
  }

  if (targetPlatform === 'win32') {
    return [`win32-${arch}`];
  }

  return [`linux-${arch}`];
}

function getTargetLibsqlPlatforms(targetPlatform, targetArch) {
  const arch = normalizeElectronBuilderArch(targetArch);

  if (!['x64', 'ia32', 'arm64'].includes(arch)) {
    if (targetPlatform === 'darwin') return ['darwin-x64', 'darwin-arm64'];
    if (targetPlatform === 'win32') return ['win32-x64-msvc'];
    return ['linux-x64-gnu', 'linux-arm64-gnu'];
  }

  if (targetPlatform === 'darwin') {
    return [`darwin-${arch}`];
  }

  if (targetPlatform === 'win32') {
    // libsql currently publishes win32-x64-msvc for this dependency line.
    return arch === 'arm64' ? ['win32-x64-msvc'] : [`win32-${arch}-msvc`];
  }

  return [`linux-${arch}-gnu`];
}

function normalizeElectronBuilderArch(targetArch) {
  if (typeof targetArch === 'string') {
    return targetArch;
  }

  // electron-builder Arch enum: ia32 = 0, x64 = 1, armv7l = 2, arm64 = 3, universal = 4.
  const archMap = {
    0: 'ia32',
    1: 'x64',
    2: 'armv7l',
    3: 'arm64',
    4: 'universal',
  };

  return archMap[targetArch] || String(targetArch);
}

function prunePnpmPackagesByPattern(nodeModulesDir, matcher) {
  const pnpmDir = path.join(nodeModulesDir, '.pnpm');
  if (!fs.existsSync(pnpmDir)) {
    return [];
  }

  const removed = [];
  const entries = fs.readdirSync(pnpmDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!matcher(entry.name)) continue;

    removed.push(...removeIfExists(path.join(pnpmDir, entry.name)));
  }

  return removed;
}

function prunePlatformPackages(nodeModulesDir, targetPlatform, targetArch) {
  if (targetPlatform === 'win32') {
    const platformPattern = /(darwin|linux|win32|android|freebsd|netbsd|openbsd|sunos|aix|openharmony)-/;
    const removed = [];

    removed.push(
      ...prunePnpmPackagesByPattern(nodeModulesDir, (packageName) => (
        packageName.startsWith('@openai+codex@')
        && platformPattern.test(packageName)
        && !packageName.includes('-win32-x64')
      )),
      ...prunePnpmPackagesByPattern(nodeModulesDir, (packageName) => (
        packageName.startsWith('@anthropic-ai+claude-agent-sdk-')
        && !packageName.startsWith('@anthropic-ai+claude-agent-sdk-win32-x64@')
      )),
      ...prunePnpmPackagesByPattern(nodeModulesDir, (packageName) => (
        packageName.startsWith('@libsql+')
        && platformPattern.test(packageName)
        && !packageName.startsWith('@libsql+win32-x64-msvc@')
      )),
      ...prunePnpmPackagesByPattern(nodeModulesDir, (packageName) => (
        packageName.startsWith('@esbuild+')
        || packageName.startsWith('@img+sharp-')
        || packageName.startsWith('sharp@')
      )),
    );

    return removed;
  }

  const targetPackagePlatforms = getTargetPackagePlatforms(targetPlatform, targetArch);
  const targetLibsqlPlatforms = getTargetLibsqlPlatforms(targetPlatform, targetArch);
  const platformPattern = /(darwin|linux|win32|android|freebsd|netbsd|openbsd|sunos|aix|openharmony)-/;

  const removed = [];

  removed.push(
    ...prunePnpmPackagesByPattern(nodeModulesDir, (packageName) => (
      packageName.startsWith('@openai+codex@')
      && platformPattern.test(packageName)
      && !targetPackagePlatforms.some(platform => packageName.includes(`-${platform}`))
    )),
    ...prunePnpmPackagesByPattern(nodeModulesDir, (packageName) => (
      packageName.startsWith('@anthropic-ai+claude-agent-sdk-')
      && !targetPackagePlatforms.some(platform => packageName.startsWith(`@anthropic-ai+claude-agent-sdk-${platform}@`))
    )),
    ...prunePnpmPackagesByPattern(nodeModulesDir, (packageName) => (
      packageName.startsWith('@libsql+')
      && platformPattern.test(packageName)
      && !targetLibsqlPlatforms.some(platform => packageName.startsWith(`@libsql+${platform}@`))
    )),
    ...prunePnpmPackagesByPattern(nodeModulesDir, (packageName) => (
      packageName.startsWith('@esbuild+')
      || packageName.startsWith('@img+sharp-')
      || packageName.startsWith('sharp@')
    )),
  );

  return removed;
}

function pruneNestedPlatformPackageCopies(nodeModulesDir, targetPlatform, targetArch) {
  const removed = [];
  const codexNodeModules = findPnpmPackageNodeModules(nodeModulesDir, '@openai+codex@');
  const claudeSdkNodeModules = findPnpmPackageNodeModules(nodeModulesDir, '@anthropic-ai+claude-agent-sdk@');
  const targetPackagePlatforms = getTargetPackagePlatforms(targetPlatform, targetArch);

  if (codexNodeModules) {
    const openAiScope = path.join(codexNodeModules, '@openai');
    if (fs.existsSync(openAiScope)) {
      for (const entry of fs.readdirSync(openAiScope, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.startsWith('codex-')) continue;
        if (targetPackagePlatforms.some(platform => entry.name === `codex-${platform}`)) continue;
        removed.push(...removeIfExists(path.join(openAiScope, entry.name)));
      }
    }
  }

  if (claudeSdkNodeModules) {
    const anthropicScope = path.join(claudeSdkNodeModules, '@anthropic-ai');
    if (fs.existsSync(anthropicScope)) {
      for (const entry of fs.readdirSync(anthropicScope, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.startsWith('claude-agent-sdk-')) continue;
        if (targetPackagePlatforms.some(platform => entry.name === `claude-agent-sdk-${platform}`)) continue;
        removed.push(...removeIfExists(path.join(anthropicScope, entry.name)));
      }
    }
  }

  return removed;
}

function pruneClaudeAgentSdkVendor(nodeModulesDir, targetPlatform, targetArch) {
  const claudeSdkNodeModules = findPnpmPackageNodeModules(nodeModulesDir, '@anthropic-ai+claude-agent-sdk@');
  if (!claudeSdkNodeModules) {
    return [];
  }

  const sdkRoot = path.join(claudeSdkNodeModules, '@anthropic-ai', 'claude-agent-sdk', 'vendor');

  if (!fs.existsSync(sdkRoot)) {
    return [];
  }

  // Determine which vendor directories to keep based on target platform/arch
  const keepRipgrep = targetPlatform === 'darwin'
    ? ['arm64-darwin']
    : targetPlatform === 'win32'
      ? ['x64-win32', 'arm64-win32']
      : ['x64-linux', 'arm64-linux'];

  const keepAudioCapture = targetPlatform === 'darwin'
    ? ['arm64-darwin']
    : targetPlatform === 'win32'
      ? ['x64-win32', 'arm64-win32']
      : ['x64-linux', 'arm64-linux'];

  const keepTreeSitter = targetPlatform === 'darwin'
    ? ['arm64-darwin']
    : targetPlatform === 'win32'
      ? ['x64-win32', 'arm64-win32']
      : ['x64-linux', 'arm64-linux'];

  const removed = [];
  removed.push(...pruneVendorSubdirs(path.join(sdkRoot, 'ripgrep'), keepRipgrep));
  removed.push(...pruneVendorSubdirs(path.join(sdkRoot, 'audio-capture'), keepAudioCapture));
  removed.push(...pruneVendorSubdirs(path.join(sdkRoot, 'tree-sitter-bash'), keepTreeSitter));
  return removed;
}

function prunePrismaClientRuntime(nodeModulesDir) {
  const prismaClientRoot = findPnpmPackageNodeModules(nodeModulesDir, '@prisma+client@');

  if (!prismaClientRoot || !fs.existsSync(prismaClientRoot)) {
    return [];
  }

  const removed = [];
  removed.push(...removeIfExists(path.join(prismaClientRoot, '@prisma', 'client', 'generator-build')));
  removed.push(...removeIfExists(path.join(prismaClientRoot, '@prisma', 'client', 'runtime', 'wasm-compiler-edge.js')));
  removed.push(...removeIfExists(path.join(prismaClientRoot, '@prisma', 'client', 'runtime', 'wasm-compiler-edge.mjs')));

  const variants = ['mysql', 'postgresql', 'cockroachdb', 'sqlserver'];
  removed.push(
    ...removeFilesByPattern(prismaClientRoot, (fullPath) => (
      variants.some((variant) => fullPath.includes(`query_compiler_fast_bg.${variant}.`))
      || variants.some((variant) => fullPath.includes(`query_compiler_small_bg.${variant}.`))
    ))
  );

  return removed;
}

function pruneVendorSubdirs(rootDir, keepNames) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const removed = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (keepNames.includes(entry.name)) continue;

    removed.push(...removeIfExists(path.join(rootDir, entry.name)));
  }

  return removed;
}

/**
 * 删除 .pnpm/<pkg>@ver/node_modules/ 中已 hoist 到顶层 node_modules 的同版本兄弟副本。
 * Windows 流程的 convertSymlinksToFiles + hoistPnpmPackageCopies 之后，
 * 每个依赖在 .pnpm 内每个引用它的包目录里都存在一个完整副本，与顶层 hoist 副本重复。
 * Node 模块解析会冒泡到顶层 node_modules，所以兄弟副本是冗余的。
 * 为保持依赖正确性，仅在版本号完全相等时删除。
 */
function pruneHoistedPnpmDuplicates(nodeModulesDir) {
  const pnpmDir = path.join(nodeModulesDir, '.pnpm');
  if (!fs.existsSync(pnpmDir)) return [];

  let removedCount = 0;
  let removedBytes = 0;

  const readVersion = (pkgRootDir) => {
    try {
      const pkgJsonPath = path.join(pkgRootDir, 'package.json');
      if (!fs.existsSync(pkgJsonPath)) return null;
      const parsed = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      return typeof parsed.version === 'string' ? parsed.version : null;
    } catch { return null; }
  };

  const decodeOwnerPackageName = (storeDirName) => {
    // 形如 "@anthropic-ai+claude-agent-sdk@0.2.138_..." 或 "fastify@5.8.2"
    const atIdx = storeDirName.indexOf('@', 1);
    if (atIdx <= 0) return null;
    const pkgPart = storeDirName.slice(0, atIdx);
    return pkgPart.replace('+', '/');
  };

  const tryRemoveDuplicate = (innerPkgPath, packageRelParts) => {
    const topLevelPath = path.join(nodeModulesDir, ...packageRelParts);
    if (!fs.existsSync(topLevelPath)) return;
    const innerVersion = readVersion(innerPkgPath);
    const topVersion = readVersion(topLevelPath);
    if (!innerVersion || !topVersion || innerVersion !== topVersion) return;

    const size = getPathSize(innerPkgPath);
    fs.rmSync(innerPkgPath, { recursive: true, force: true });
    removedCount += 1;
    removedBytes += size;
  };

  for (const storeEntry of fs.readdirSync(pnpmDir, { withFileTypes: true })) {
    if (!storeEntry.isDirectory()) continue;

    const innerNm = path.join(pnpmDir, storeEntry.name, 'node_modules');
    if (!fs.existsSync(innerNm)) continue;

    const ownerName = decodeOwnerPackageName(storeEntry.name);

    for (const sibling of fs.readdirSync(innerNm, { withFileTypes: true })) {
      if (sibling.isSymbolicLink()) continue;
      if (!sibling.isDirectory()) continue;

      if (sibling.name.startsWith('@')) {
        const scopeDir = path.join(innerNm, sibling.name);
        for (const scoped of fs.readdirSync(scopeDir, { withFileTypes: true })) {
          if (!scoped.isDirectory() || scoped.isSymbolicLink()) continue;
          const fullName = `${sibling.name}/${scoped.name}`;
          if (fullName === ownerName) continue;
          tryRemoveDuplicate(path.join(scopeDir, scoped.name), [sibling.name, scoped.name]);
        }
        continue;
      }

      if (sibling.name === ownerName) continue;
      tryRemoveDuplicate(path.join(innerNm, sibling.name), [sibling.name]);
    }
  }

  if (removedCount === 0) return [];
  return [`pruned ${removedCount} duplicate package copy(ies) from .pnpm after hoist (${formatBytes(removedBytes)})`];
}

/**
 * 删除依赖目录中常见的非运行时文档/法律外文件（保留 LICENSE/LICENCE/NOTICE）。
 */
function removeJunkDocFiles(rootDir) {
  return removeFilesByPattern(rootDir, (fullPath) => {
    const base = path.basename(fullPath);
    if (/^(README|CHANGELOG|HISTORY|AUTHORS|CONTRIBUTORS|CONTRIBUTING|UPGRADING|MIGRATING|SECURITY|GOVERNANCE|CODE_OF_CONDUCT)([._-].*)?\.(md|markdown|rst|txt)$/i.test(base)) return true;
    if (/^(README|CHANGELOG|HISTORY|AUTHORS|CONTRIBUTORS)$/i.test(base)) return true;
    return false;
  });
}

/**
 * 删除依赖目录中典型的开发/测试目录。LICENSE 等法律文件保持不动。
 */
function removeDevDirectories(rootDir) {
  if (!fs.existsSync(rootDir)) return [];

  const DROP_NAMES = new Set([
    'test', 'tests', '__tests__', '__test__',
    'example', 'examples', 'demo', 'demos',
    'docs', 'doc', 'documentation',
    'spec', 'specs',
    'coverage',
    '.github', '.vscode', '.idea', '.circleci',
    'man', 'samples',
  ]);

  let removedCount = 0;
  let removedBytes = 0;

  function walk(currentPath) {
    let entries;
    try { entries = fs.readdirSync(currentPath, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(currentPath, entry.name);
      if (!entry.isDirectory()) continue;

      if (DROP_NAMES.has(entry.name)) {
        const size = getPathSize(full);
        try {
          fs.rmSync(full, { recursive: true, force: true });
          removedCount += 1;
          removedBytes += size;
        } catch {}
        continue;
      }

      walk(full);
    }
  }

  walk(rootDir);
  if (removedCount === 0) return [];
  return [`removed ${removedCount} dev directory(ies) (${formatBytes(removedBytes)})`];
}

function removeFilesByPattern(rootDir, matcher) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  let removedCount = 0;
  let removedBytes = 0;

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!matcher(fullPath)) {
        continue;
      }

      const size = getPathSize(fullPath);
      fs.rmSync(fullPath, { force: true });
      removedCount += 1;
      removedBytes += size;
    }
  }

  walk(rootDir);
  if (removedCount === 0) {
    return [];
  }

  return [`removed ${removedCount} file(s) by pattern (${formatBytes(removedBytes)})`];
}

function getPathSize(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }

  const stat = fs.lstatSync(targetPath);
  if (!stat.isDirectory()) {
    return stat.size;
  }

  let total = 0;
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    total += getPathSize(path.join(targetPath, entry.name));
  }
  return total;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${bytes}B`;
}
