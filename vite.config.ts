import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json" with { type: "json" };

const host = process.env.TAURI_DEV_HOST;

/**
 * GitHub Pages 项目站点的子路径（仓库名 WebNote → `/WebNote/`）。
 *
 * 只在 `vite build --mode pages` 时生效，默认仍是 `/`。桌面端的 `pnpm tauri build`
 * 走 `beforeBuildCommand: pnpm build` 并以 asset 协议加载 `../dist`，那时的绝对路径
 * 相对应用根解析；把 base 改成子路径会打断它，所以两种构建按 mode 分开。
 */
const PAGES_BASE = "/WebNote/";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === "pages" ? PAGES_BASE : "/",
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
