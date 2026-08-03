/** @type {import('next').NextConfig} */
// Deploys to the campus web server on a public domain (A-16, QZ-1) — NOT to the
// device. Nothing here may assume LAN access to core-api.
export default {
  reactStrictMode: true,
  transpilePackages: ['@eduscope/shared', '@eduscope/api-client'],
};
