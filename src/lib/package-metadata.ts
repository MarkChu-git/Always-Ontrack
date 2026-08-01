import { createRequire } from 'node:module';

interface PackageManifest {
  version?: unknown;
}

const require = createRequire(import.meta.url);
const manifest = require('../../package.json') as PackageManifest;

if (
  typeof manifest.version !== 'string' ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)
) {
  throw new Error('package.json contains an invalid version');
}

export const packageVersion = manifest.version;
