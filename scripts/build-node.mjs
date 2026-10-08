// Bundles the non-Next entry points (worker, migrations, CLI) into dist/ for the production image.
import { existsSync } from 'node:fs';
import { build } from 'esbuild';

const entries = {
  worker: 'src/worker.ts',
  migrate: 'src/db/migrate.ts',
  cli: 'src/cli/index.ts',
};

const entryPoints = Object.fromEntries(Object.entries(entries).filter(([, file]) => existsSync(file)));

await build({
  entryPoints,
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  sourcemap: true,
  external: ['better-sqlite3', 'pino-pretty'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
