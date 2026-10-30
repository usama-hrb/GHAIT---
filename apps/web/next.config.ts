import path from 'node:path';
import { withSerwist } from '@serwist/turbopack';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

const PAGE_EXTENSIONS = ['tsx', 'ts'];

export default function nextConfig(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  // The API on the same origin under /api: Caddy in production, this proxy in development and
  // end-to-end tests (API_PROXY_TARGET), so the refresh cookie stays SameSite=Strict.
  const apiTarget = process.env.API_PROXY_TARGET ?? (dev ? 'http://localhost:4000' : undefined);
  return withSerwist({
    // The floating dev badge sits on top of the phone tab bar; errors still open the overlay.
    devIndicators: false,
    // `page.dev.tsx` routes (the /design gallery) exist only under `next dev`; production
    // builds never see them.
    pageExtensions: dev ? ['dev.tsx', ...PAGE_EXTENSIONS] : PAGE_EXTENSIONS,
    // Docker builds set NEXT_OUTPUT=standalone; local `next start` keeps the default output.
    ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const } : {}),
    // Trace files from the monorepo root so workspace packages land in the standalone bundle.
    outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
    // Workspace packages are compiled by Next so web always uses the same source as the API.
    transpilePackages: ['@fabric/core', '@fabric/contracts'],
    turbopack: {
      rules: {
        '*.css': {
          loaders: ['@tailwindcss/turbopack'],
          as: '*.css',
        },
      },
    },
    rewrites: () =>
      Promise.resolve(
        apiTarget ? [{ source: '/api/:path*', destination: `${apiTarget}/:path*` }] : [],
      ),
  });
}
