import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helperCrateDir = path.join(rootDir, 'native', 'desktop-follow-helper');
const modDir = path.join(rootDir, 'folia-desktop-follow');
const modBinDir = path.join(modDir, 'bin');
const exeName = 'folia-desktop-follow-helper.exe';
const builtExe = path.join(helperCrateDir, 'target', 'release', exeName);
const targetExe = path.join(modBinDir, exeName);

console.log('[build] Compiling Rust desktop-follow helper...');
execFileSync('cargo', ['build', '--release'], {
  cwd: helperCrateDir,
  stdio: 'inherit',
});

if (!fs.existsSync(builtExe)) {
  throw new Error(`Expected built helper at ${builtExe}`);
}

fs.mkdirSync(modBinDir, { recursive: true });
fs.copyFileSync(builtExe, targetExe);
const sizeKb = (fs.statSync(targetExe).size / 1024).toFixed(1);
console.log(`[build] Copied helper to ${targetExe} (${sizeKb} KB)`);

if (process.argv.includes('--zip')) {
  const distDir = path.join(rootDir, 'dist');
  const zipPath = path.join(distDir, 'folia-desktop-follow.zip');
  fs.mkdirSync(distDir, { recursive: true });
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${modDir}\\*' -DestinationPath '${zipPath}' -Force`,
    ],
    { stdio: 'inherit' }
  );
  console.log(`[build] Packaged zip: ${zipPath}`);
}
