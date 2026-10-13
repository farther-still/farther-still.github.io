import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import { hash } from './src/engine/hash.ts';

const root = import.meta.dirname;

const git = (args: string): string => {
  try {
    return execSync(`git ${args}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

// The git commit the build was made from (ARCHITECTURE 7.1). FS_BUILD_ID overrides it so two local builds of
// one commit can be told apart when trying the update flow on localhost.
const buildId = (): string => {
  const override = process.env['FS_BUILD_ID'];
  if (override !== undefined && override !== '') return override;
  const sha = process.env['GITHUB_SHA'] ?? git('rev-parse HEAD');
  if (sha === '') return 'unknown';
  return process.env['GITHUB_SHA'] === undefined && git('status --porcelain') !== '' ? `${sha}-dirty` : sha;
};

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]))
    .sort();

// A hash of everything under data/, balance.json included, so a record says which content wrote it.
const contentVersion = (): string => {
  const dataDir = join(root, 'data');
  const parts = filesUnder(dataDir).map((file) => {
    const name = relative(dataDir, file).split('\\').join('/');
    return `${name}\n${readFileSync(file, 'utf8').replace(/\r\n/g, '\n')}`;
  });
  return hash(parts.join('\n')).slice(0, 16);
};

// Added to the built page only; the dev server needs looser rules (ARCHITECTURE section 9). Nothing loads from
// anywhere but the site itself, which is what enforces "no ads, no third parties" by machine. The page may call
// one address besides its own: the cloud backup's (ARCHITECTURE 7.5). `scripts/check-dist.ts` pins the same list.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://api.github.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const CHARSET_TAG = '<meta charset="utf-8" />';

const contentSecurityPolicy = (): Plugin => ({
  name: 'farther-still-csp',
  apply: 'build',
  transformIndexHtml: (html) => {
    if (!html.includes(CHARSET_TAG)) throw new Error('index.html has no charset tag to put the content security policy after');
    return html.replace(CHARSET_TAG, `${CHARSET_TAG}
    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`);
  },
});

// eslint-disable-next-line no-restricted-syntax -- Vite reads its configuration from the default export.
export default defineConfig({
  base: '/',
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
    __CONTENT_VERSION__: JSON.stringify(contentVersion()),
  },
  plugins: [
    contentSecurityPolicy(),
    // The plugin's only job is the list of files to cache; the worker's logic is src/platform/sw.ts (A-11).
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/platform',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: false,
      injectManifest: { globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'] },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
