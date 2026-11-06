'use strict';

const path = require('node:path');
const { getCurrentFuseWire, FuseVersion, FuseV1Options } = require('@electron/fuses');

// Read the packaged executable, not just the builder configuration. Fuse states
// are the ASCII bytes '0' (disabled) and '1' (enabled) in Electron's fuse wire.
const expected = {
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  GrantFileProtocolExtraPrivileges: false,
};

async function verifyFuses(executable) {
  const wire = await getCurrentFuseWire(executable);
  if (wire.version !== FuseVersion.V1) throw new Error('Unexpected Electron fuse version.');
  const failures = [];
  for (const [name, enabled] of Object.entries(expected)) {
    if (wire[FuseV1Options[name]] !== (enabled ? 0x31 : 0x30)) {
      failures.push(`${name} must be ${enabled ? 'enabled' : 'disabled'}`);
    }
  }
  if (failures.length) throw new Error(`Packaged security checks failed: ${failures.join('; ')}`);
  console.log(`Verified ${Object.keys(expected).length} security fuses in ${path.basename(executable)}.`);
}

if (require.main === module) {
  const executable = process.argv[2] || path.join(__dirname, '..', 'dist', 'win-unpacked', 'Ravenshelf.exe');
  verifyFuses(executable).catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { verifyFuses };
