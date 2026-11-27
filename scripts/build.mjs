import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modDir = path.join(rootDir, 'folia-desktop-follow');
const helperScript = path.join(modDir, 'helper', 'desktop-follow-helper.ps1');

if (!fs.existsSync(helperScript)) {
  throw new Error(`Helper script not found at ${helperScript}`);
}

execFileSync(process.execPath, ['--check', path.join(modDir, 'main.cjs')], { stdio: 'inherit' });
execFileSync(process.execPath, ['--check', path.join(modDir, 'client.mjs')], { stdio: 'inherit' });
console.log('[build] Verified main.cjs, client.mjs, and pure-source PowerShell helper.');

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
