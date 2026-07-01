#!/usr/bin/env node
/**
 * Builds a portable Nexus-Git .exe (no installer) and drops it in /portable
 * as Nexus-Git-vN.exe, auto-incrementing N from whatever's already there.
 *
 * Uses `tauri build --no-bundle` rather than a bare `cargo build --release` —
 * the raw cargo build does not correctly embed the production frontend and
 * ends up pointing at the dev server (localhost:4200) instead.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const portableDir = path.join(root, 'portable');
const releaseExe = path.join(root, 'src-tauri', 'target', 'release', 'app.exe');

function nextVersion() {
  if (!fs.existsSync(portableDir)) return 1;
  const files = fs.readdirSync(portableDir);
  let max = 0;
  for (const f of files) {
    if (/^Nexus-Git\.exe$/i.test(f)) max = Math.max(max, 1);
    const m = f.match(/^Nexus-Git-v(\d+)\.exe$/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

const version = nextVersion();
const outName = `Nexus-Git-v${version}.exe`;
const outPath = path.join(portableDir, outName);

console.log(`\n> Building portable executable (${outName})...\n`);
execSync('npx tauri build --no-bundle', { stdio: 'inherit', cwd: root });

if (!fs.existsSync(releaseExe)) {
  console.error(`\nBuild finished but ${releaseExe} was not found.`);
  process.exit(1);
}

fs.mkdirSync(portableDir, { recursive: true });
fs.copyFileSync(releaseExe, outPath);

console.log(`\nPortable build ready: portable/${outName}`);
