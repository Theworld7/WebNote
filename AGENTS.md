# AGENTS.md

WebNote:本地优先的块式笔记编辑器。笔记 = 磁盘上的普通 `.html` 文件,就地读写,盘上 HTML
即规范形态;数据表 `.tbl`(标准 JSON)是独立文档,可被任意多篇笔记同时引用。
技术栈:Tauri 2 + Vue 3 + TypeScript(strict)+ Tailwind v4,包管理用 pnpm。

## 读代码前

- **领域词汇** —— 命名、注释、UI 文案之前读 [CONTEXT.md](CONTEXT.md)。每个术语带「避免用词」
  (Block 不叫 element,Data table 不叫 sheet,Preference 不叫 setting),照它选词。
- **硬约定** —— [README「架构约定」](README.md) 一节:单一真源(块类型、路径格式、列类型各只有
  一处定义)、正文是 `InlineRun[]` 不是字符串、`contenteditable` 非受控、行内格式走 runs 不走
  `execCommand`、引用块的 `entry` 必须 `shallowRef`、读盘留在 composable / 拼 HTML 留在纯函数。
  动到这些区域先读原文,本文件不复述细节。
- **决策记录** —— `docs/adr/`:树拖拽是移动非重排(0003)、重名直接拒绝(0002)、新建后单层重扫
  (0001)、浏览器适配器伪造移动(0004)、数据表是独立文件(0005)、画册快照+指针(0006)、布局块是
  唯一受控容器(0007)、看板拖拽改值(0008)、账目块按财务口径渲染数据表(0009)、主题色取图标背景
  色(0010)。改对应行为前先读那篇。

## 验证

没有测试框架,回归靠两条:

1. **类型门**:`pnpm build`(vue-tsc)。全项目零类型断言 —— 不写 `as`、不写 `@ts-ignore`,
   用类型收窄和类型守卫表达。
2. **自检页**:`design/*.html` 是能直接跑的回归页,每个用例输出 `OK` / `FAIL` 行。
   `pnpm dev` 后访问 `/design/<名字>.html`;其中 `drag-check`、`typography-check`、
   `data-table-check`、`ledger-edit-check` 含顶层 `await`,要抓结果用
   `node design/cdp-dump.mjs http://localhost:1420/design/<名字>.html`。

改哪层跑哪页:动 `lib/html` → `parse-check`;动块拖拽 / 标签栏 → `drag-check` / `tab-check`;
动数据表 → `data-table-check`;动排版样式 → `typography-check`;动新建 / 移动 →
`create-check` / `move-check`;动设置 → `settings-check`;动布局块 → `layout-check`;
动账目块的财务口径 → `ledger-check`,动它的就地增删改 → `ledger-edit-check`(挂真实编辑器,
走 CDP 驱动);动主题色 / 品牌色 → `theme-check`(对齐图标 tokens,守对比度)。
覆盖明细见 README「自检」一节。

## 写代码

- 注释与 UI 文案用中文;注释写「为什么」和设计立场,不逐行复述代码。
- `pnpm dev` 走浏览器文件系统实现(伪造盘上行为,调试用);验证真实的读写与移动要跑
  `pnpm tauri dev`。两份 `WorkspaceFs` 实现共用 `lib/fs/policy.ts` 的过滤与排序。
- Tauri(Rust)侧保持薄:只做目录授权、目录扫描、文本读写;业务逻辑都在前端。
- 应用图标的真源是 `design/icon/icon.tokens.json`,改后跑 `pnpm icon`;
  `src-tauri/icons/` 下的产物不手改。
