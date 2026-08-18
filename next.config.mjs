/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        // Обложки блога из bucket blog-images (миграция 008). Wildcard
        // вместо конкретного project ref — работает для любого проекта
        // Supabase без правки при смене окружения (dev/prod).
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
