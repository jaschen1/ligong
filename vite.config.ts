import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  return {
    server: {
      port: 3000,
      host: "0.0.0.0",
    },

    plugins: [
      react(),
      VitePWA({
        // 自动注入 SW 注册代码（无需你在 index.tsx/main.tsx 手写 register）
        injectRegister: "auto",

        // 最省事的更新策略：自动更新
        registerType: "autoUpdate",

        // 开发环境不启用 SW，避免缓存影响调试
        devOptions: { enabled: false },

        manifest: {
          id: "/",
          name: "Walabox",
          short_name: "Walabox",
          start_url: "/",
          scope: "/",
          display: "standalone",
          background_color: "#ffffff",
          theme_color: "#ffffff",
          icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          ],
        },

        workbox: {
          // SPA 关键：离线/导航失败时回退到应用壳
          navigateFallback: "/index.html",
		  
		  maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,

          // 只缓存你的 OSS 外网 Bucket 域名
          runtimeCaching: [
            {
              urlPattern: ({ url }) =>
                url.origin ===
                "https://walabox-assets.oss-cn-beijing.aliyuncs.com",
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "oss-assets",
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60 * 24 * 30, // 30 天
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],

    define: {
      "process.env.API_KEY": JSON.stringify(env.GEMINI_API_KEY),
      "process.env.GEMINI_API_KEY": JSON.stringify(env.GEMINI_API_KEY),
    },

    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
  };
});
