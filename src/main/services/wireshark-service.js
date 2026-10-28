'use strict';

// Open a local capture file with Wireshark (the file manager's "Open from Wireshark"
// action). Prefers the `wireshark` CLI when present; otherwise falls back to
// LaunchServices via `open -b <bundle id>`.

const { execFile } = require('child_process');
const fs = require('fs');
const logger = require('../utils/logger');

const WIRESHARK_BUNDLE_ID = 'org.wireshark.Wireshark';
const WIRESHARK_CLI_CANDIDATES = [
  '/opt/homebrew/bin/wireshark',
  '/usr/local/bin/wireshark',
  '/Applications/Wireshark.app/Contents/MacOS/Wireshark',
];

function findCli() {
  for (const candidate of WIRESHARK_CLI_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (err) {
      /* ignore */
    }
  }
  return '';
}

function openPath(filePath) {
  const target = String(filePath || '');
  if (!target) return Promise.resolve({ ok: false, error: 'no-path' });
  const cli = findCli();
  const cmd = cli || 'open';
  const args = cli ? [target] : ['-b', WIRESHARK_BUNDLE_ID, target];
  return new Promise((resolve) => {
    execFile(cmd, args, (err) => {
      if (err) {
        logger.error(`[wireshark] open failed (${target}): ${err.message}`);
        resolve({ ok: false, error: err.message });
        return;
      }
      logger.file(`[wireshark] opened ${target}`);
      resolve({ ok: true });
    });
  });
}

module.exports = { openPath, _findCli: findCli };
