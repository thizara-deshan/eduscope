/** @type {import('next').NextConfig} */
// Deploys to the campus web server on a public domain (A-16, QZ-1) — NOT to the
// device. Nothing here may assume LAN access to core-api.
export default {
  reactStrictMode: true,
  transpilePackages: ['@eduscope/shared', '@eduscope/api-client'],
  // The codebase's ESM-style relative imports use an explicit `.js`
  // extension even for `.ts`/`.tsx` source files (matching NodeNext
  // resolution elsewhere in the monorepo) — webpack needs to be told to
  // also try `.ts`/`.tsx` when it sees a `.js` specifier it can't resolve.
  webpack(config) {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};
