import { register } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
if (process.argv[1] && process.argv.includes('serve')) {
  const bin = realpathSync(process.argv[1]), root = dirname(dirname(bin));
  const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (metadata.name !== '@waishnav/devspace' || metadata.version !== '1.1.1') console.error('Paseo cleanup adapter disabled: unsupported DevSpace version.');
  else register(new URL('./devspace-lifecycle-loader.mjs', import.meta.url), { parentURL: import.meta.url, data: { target: pathToFileURL(join(root, 'dist/server.js')).href } });
}
