import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json" with { type: "json" };

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [vue(), tailwindcss()],

  // 当前版本号：更新的检测要拿它跟 GitHub 上的最新 release 比。
  // 真源是 package.json —— `chore(release)` 那一次提交会把它和 Cargo.toml、
  // tauri.conf.json 一起改掉，前端不必再从 Tauri 的 API 异步取一份。
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },

  // shadcn-vue 生成的组件按 `@/` 引用，与 tsconfig.json 的 paths 保持一致
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
