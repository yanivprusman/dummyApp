import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow dev access from LAN IP + public dev subdomain (fixes HMR WebSocket + React hydration)
  allowedDevOrigins: ['10.0.0.2', 'dummyapp.dev.ya-niv.com'],
};

export default nextConfig;
