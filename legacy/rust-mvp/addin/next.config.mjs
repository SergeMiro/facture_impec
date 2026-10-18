/** @type {import('next').NextConfig} */
const nextConfig = {
  // L'ESLint n'est pas configuré dans ce harnais de test ; ne pas bloquer le build Vercel dessus.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
