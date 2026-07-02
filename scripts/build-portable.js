#!/usr/bin/env node
/**
 * Builds a portable Nexus-Git .exe (no installer), publishes it as a GitHub Release, and
 * drops a local copy in /portable as Nexus-Git-vN.exe.
 *
 * Version handling: bumps the version in Cargo.toml/tauri.conf.json to N.0.0 (N = next build
 * number, continuing the v1..v10 counter used before this was automated). This exact string
 * gets baked into the binary (Rust reads it via env!("CARGO_PKG_VERSION")) and is what the
 * app's in-app update check compares against the GitHub release tag "vN.0.0".
 *
 * Publishes two assets to the release: the versioned copy (Nexus-Git-vN.exe, for browsing the
 * releases page) and a constant-named copy (Nexus-Git.exe) so
 * https://github.com/<repo>/releases/latest/download/Nexus-Git.exe always points at the
 * newest build regardless of version — a stable link you can share once and never update.
 *
 * Uses `tauri build --no-bundle` rather than a bare `cargo build --release` — the raw cargo
 * build does not correctly embed the production frontend and ends up pointing at the dev
 * server (localhost:4200) instead.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const portableDir = path.join(root, 'portable');
const releaseExe = path.join(root, 'src-tauri', 'target', 'release', 'app.exe');
const cargoTomlPath = path.join(root, 'src-tauri', 'Cargo.toml');
const cargoLockPath = path.join(root, 'src-tauri', 'Cargo.lock');
const tauriConfPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const REPO = 'GuilhermeMPG/nexus-git';

function run(cmd) {
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

function currentCargoMajor() {
  const content = fs.readFileSync(cargoTomlPath, 'utf8');
  const m = content.match(/^version = "(\d+)\.\d+\.\d+"/m);
  if (!m) throw new Error('Could not find version in Cargo.toml');
  return parseInt(m[1], 10);
}

function nextVersion() {
  let next = currentCargoMajor() + 1;
  if (fs.existsSync(portableDir)) {
    for (const f of fs.readdirSync(portableDir)) {
      const m = f.match(/^Nexus-Git-v(\d+)\.exe$/i);
      if (m) next = Math.max(next, parseInt(m[1], 10) + 1);
    }
  }
  return next;
}

function bumpVersion(newVersion) {
  let cargo = fs.readFileSync(cargoTomlPath, 'utf8');
  cargo = cargo.replace(/^version = "\d+\.\d+\.\d+"/m, `version = "${newVersion}"`);
  fs.writeFileSync(cargoTomlPath, cargo);

  let tauriConf = fs.readFileSync(tauriConfPath, 'utf8');
  tauriConf = tauriConf.replace(/"version": "\d+\.\d+\.\d+"/, `"version": "${newVersion}"`);
  fs.writeFileSync(tauriConfPath, tauriConf);
}

const version = nextVersion();
const semver = `${version}.0.0`;
const tag = `v${semver}`;
const versionedName = `Nexus-Git-v${version}.exe`;
const versionedPath = path.join(portableDir, versionedName);
const stableName = 'Nexus-Git.exe';
const stablePath = path.join(portableDir, stableName);

console.log(`\n> Bumping version to ${semver}...`);
bumpVersion(semver);

console.log(`\n> Building portable executable (${versionedName})...\n`);
run('npx tauri build --no-bundle');

if (!fs.existsSync(releaseExe)) {
  console.error(`\nBuild finished but ${releaseExe} was not found.`);
  process.exit(1);
}

fs.mkdirSync(portableDir, { recursive: true });
fs.copyFileSync(releaseExe, versionedPath);
fs.copyFileSync(releaseExe, stablePath);
console.log(`\nPortable build ready: portable/${versionedName}`);

console.log(`\n> Committing version bump...`);
run(`git add "${cargoTomlPath}" "${tauriConfPath}" "${cargoLockPath}"`);
run(`git commit -m "Bump version to ${semver} (portable build v${version})"`);

console.log(`\n> Tagging and publishing GitHub release ${tag}...`);
run(`git tag ${tag}`);
run(`git push origin master ${tag}`);
run(
  `gh release create ${tag} "${versionedPath}" "${stablePath}" --repo ${REPO} --title "Nexus-Git ${tag}" --generate-notes`
);

console.log(`\nRelease published: https://github.com/${REPO}/releases/tag/${tag}`);
console.log(`Link fixo (sempre a versão mais nova): https://github.com/${REPO}/releases/latest/download/${stableName}`);
