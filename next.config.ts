import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow dev access from LAN IP (fixes HMR WebSocket + React hydration)
  allowedDevOrigins: ['10.0.0.2'],
};

export default nextConfig;
