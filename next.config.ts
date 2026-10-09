import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // No next/image: the optimizer (and its native sharp) is never needed; the image is built for any arch.
  images: { unoptimized: true },
  serverExternalPackages: ['better-sqlite3', 'pino', 'pino-pretty'],
  // Tests and tooling are not in the Docker build context; `pnpm check` typechecks them.
  typescript: { tsconfigPath: 'tsconfig.build.json' },
};

export default nextConfig;
