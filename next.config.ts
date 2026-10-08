import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['better-sqlite3', 'pino', 'pino-pretty'],
  // Tests and tooling are not in the Docker build context; `pnpm check` typechecks them.
  typescript: { tsconfigPath: 'tsconfig.build.json' },
};

export default nextConfig;
