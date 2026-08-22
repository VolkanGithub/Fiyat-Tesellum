import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse kütüphanesini Next.js derleyicisinden (bundler) kaçırıyoruz.
  // "Bunu olduğu gibi, saf Node.js modülü olarak çalıştır" talimatı veriyoruz.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;