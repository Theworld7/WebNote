/// <reference types="vite/client" />

/** 当前版本号，由 `vite.config.ts` 从 package.json 注入（见 `useUpdateCheck`）。 */
declare const __APP_VERSION__: string

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
