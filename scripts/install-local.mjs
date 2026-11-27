import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(rootDir, 'folia-desktop-follow');
const helperPath = path.join(sourceDir, 'helper', 'desktop-follow-helper.ps1');

if (!fs.existsSync(helperPath)) {
  throw new Error(`Helper script not found at ${helperPath}.`);
}

const appData = process.env.APPDATA;
if (!appData) {
  throw new Error('APPDATA environment variable is not set.');
}

const targetDir = path.join(appData, 'Folia', 'mods', 'folia-desktop-follow');
fs.mkdirSync(targetDir, { recursive: true });

function copyTreeSmart(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  const sourceNames = new Set(fs.readdirSync(srcDir));
  for (const existing of fs.readdirSync(dstDir, { withFileTypes: true })) {
    if (!sourceNames.has(existing.name)) {
      fs.rmSync(path.join(dstDir, existing.name), { recursive: true, force: true });
    }
  }
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyTreeSmart(srcPath, dstPath);
      continue;
    }
    if (fs.existsSync(dstPath)) {
      const srcBuf = fs.readFileSync(srcPath);
      const dstBuf = fs.readFileSync(dstPath);
      if (srcBuf.equals(dstBuf)) {
        continue;
      }
    }
    fs.copyFileSync(srcPath, dstPath);
  }
}

copyTreeSmart(sourceDir, targetDir);
console.log(`[install] Installed Folia mod to: ${targetDir}`);
