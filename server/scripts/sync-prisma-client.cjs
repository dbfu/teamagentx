const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

const serverRoot = path.resolve(__dirname, '..');
const targetDir = path.join(serverRoot, 'node_modules-prod', 'node_modules', '.prisma', 'client');
const serverRequire = createRequire(path.join(serverRoot, 'package.json'));

function assertExists(targetPath, description) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${description} not found: ${targetPath}`);
  }
}

function getGeneratedClientCandidates() {
  const candidates = [];

  try {
    const packageJsonPath = serverRequire.resolve('@prisma/client/package.json');
    const packageDir = path.dirname(packageJsonPath);
    candidates.push(path.resolve(packageDir, '..', '..', '.prisma', 'client'));
  } catch (error) {
    console.warn(`[sync-prisma-client] Could not resolve @prisma/client: ${error.message}`);
  }

  candidates.push(path.join(serverRoot, 'node_modules', '.prisma', 'client'));

  return [...new Set(candidates)];
}

function clientHasChatRoomWorkDir(clientDir) {
  const schemaPath = path.join(clientDir, 'schema.prisma');
  if (!fs.existsSync(schemaPath)) {
    return false;
  }

  const schema = fs.readFileSync(schemaPath, 'utf8');
  const chatRoomModel = schema.match(/model\s+ChatRoom\s+\{[\s\S]*?\n\}/)?.[0] ?? '';
  return /\bworkDir\b/.test(chatRoomModel);
}

function resolveGeneratedClientSource() {
  const candidates = getGeneratedClientCandidates();
  const existing = candidates.filter((candidate) => fs.existsSync(candidate));
  const valid = existing.find(clientHasChatRoomWorkDir);

  if (valid) {
    return valid;
  }

  throw new Error([
    'Generated Prisma client is missing ChatRoom.workDir.',
    'Run "cd server && pnpm db:generate" and rebuild production deps.',
    `Checked: ${candidates.join(', ')}`,
  ].join(' '));
}

function main() {
  const sourceDir = resolveGeneratedClientSource();
  assertExists(sourceDir, 'Generated Prisma client source');

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });

  if (!clientHasChatRoomWorkDir(targetDir)) {
    throw new Error(`Synced Prisma client is missing ChatRoom.workDir: ${targetDir}`);
  }

  console.log(`[sync-prisma-client] Synced ${sourceDir} -> ${targetDir}`);
}

main();
