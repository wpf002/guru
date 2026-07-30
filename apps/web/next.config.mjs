/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@guru/core", "@guru/db"],
};

export default nextConfig;
