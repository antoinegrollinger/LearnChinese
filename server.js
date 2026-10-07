// Entry file for hosts that ask for a .js file (e.g. Hostinger): starts the server built by
// "npm run build:server" from server/server.ts. Some hosts don't copy the build output (dist/ is
// git-ignored) to where the app runs, so when it is missing it is built here first.
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = import.meta.dirname;
const bundle = join(root, 'dist', 'server', 'server.mjs');

if (!existsSync(bundle)) {
  console.log('dist/server/server.mjs is missing: building it now…');
  try {
    // Same options as "build:server" in package.json.
    createRequire(import.meta.url)('esbuild').buildSync({
      entryPoints: [join(root, 'server', 'server.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      outfile: bundle,
      logLevel: 'warning',
    });
  } catch (err) {
    console.error(`Could not build the server: ${err instanceof Error ? err.message : err}`);
    console.error(`Files in ${root}: ${readdirSync(root).join(', ')}`);
    process.exit(1);
  }
}

import(pathToFileURL(bundle).href).catch((err) => {
  console.error(err);
  process.exit(1);
});
