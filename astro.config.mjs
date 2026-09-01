// @ts-check
import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  site: "https://devkitpro-mirror.vercel.app",
  output: "server",

  adapter: vercel({
    edgeMiddleware: true,
    imageService: true,
    imagesConfig: {
      sizes: [640, 768, 1024, 1280, 1536],
    },
  }),

  integrations: [
    sitemap({
      filter: (page) => !page.includes("/api/") && !page.endsWith(".json"),
      lastmod: new Date(),
      changefreq: "weekly",
      priority: 0.7,
    }),
  ],

  vite: {
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            "vendor-astro": ["astro"],
          },
        },
      },
    },
  },

  image: {
    service: { entrypoint: "astro/assets/services/sharp" },
    formats: ["avif", "webp", "png"],
  },

  markdown: {
    shikiConfig: {
      theme: "github-dark",
      wrap: true,
    },
  },

  prefetch: {
    prefetchAll: true,
    defaultStrategy: "viewport",
  },
});
