/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@guru/core", "@guru/db"],
  // The floating dev badge sits bottom-left, directly over the sign-out link.
  devIndicators: false,
};

export default nextConfig;
