# WebNote

本地优先的 HTML 笔记编辑器。笔记就是磁盘上的普通 `.html` 文件，应用只做**就地读写** ——
没有私有格式、没有数据库、没有云端账号，删掉这个应用，那些文件照样能双击打开。

## 技术栈

| 层 | 选型 |
|---|---|
| 外壳 | Tauri 2（Rust 侧只做目录授权、目录扫描与文本读写） |
| 前端 | Vue 3 + TypeScript（`strict` + `noUnusedLocals`，全项目零类型断言） |
| 构建 | Vite + pnpm |
| 样式 | Tailwind v4 + shadcn-vue（neutral 主题） |

## 开发

```bash
pnpm install
pnpm tauri dev     # 桌面端：Rust + WebView
pnpm dev           # 只跑前端，走浏览器文件系统实现（调试用）
pnpm build         # vue-tsc 类型检查 + vite build
```

## 现在能做什么

- **块模型编辑**：文本、H1–H3、待办、无序 / 有序列表、引用、代码块、标注、分割线、图片、表格
- **行内格式**：加粗、高亮 —— 选中文字浮出格式条，键盘走 `Cmd/Ctrl+B` 与 `Cmd/Ctrl+Shift+H`
- **文件侧**：左侧目录树、标签栏、未保存标记、关标签时拦截确认
- **格式透明**：读的是通用 HTML（`<p>` / `<h2>` / `<ul>` / `<table>` / `<mark>` …），
  别人的文档导进来会被规范化成本项目的写法

## 架构约定

项目小，但有几条硬约定，改代码前值得先读：

- **单一真源**。块类型标识符只在 `lib/blocks.ts` 的 `BLOCK_TYPES`；工作区路径格式只在
  `lib/paths.ts`；目录扫描的过滤与排序只在 `lib/fs/policy.ts`（桌面端与浏览器端两份
  `WorkspaceFs` 实现共用）；「什么算列表族」只在 `isListBlock()` 一处。
- **正文是 `InlineRun[]`**，不是字符串。需要纯文本时投影（`runsText` / `blockText`），
  不另存一份字符串字段。
- **`contenteditable` 必须非受控**：DOM 只在 `onMounted` 写一次，Vue 不回写；格式化后由
  编辑逻辑自己重画并复原选区。
- **行内格式走 runs，不走 `execCommand`**：后者产出 `<b>` / `<span style>`，与序列化产物
  对不上，且各 WebView 行为不一致。
- **有序列表序号与序列化的分组对齐**：`orderedIndexes()` 镜像 `blocksToHtml` 的建树规则，
  所以**不相邻的 `<ol>` 各自从 1 起**。两边漂移会让编辑器显示的数字与导出文件里的对不上。

## 自检

`design/*.html` 是能在浏览器里直接跑的自检页（`pnpm dev` 后访问 `/design/<名字>.html`）：

| 页面 | 覆盖 |
|---|---|
| `parse-check.html` | 解析 / 序列化的往返一致性、宽松解析、序列化产物、有序列表编号 |
| `inline-check.html` | 真实 `contenteditable` + Range：选区 ↔ 字符偏移、标记切换与切分 |
| `tab-check.html` | 标签栏保存按钮的显隐规则（挂真实组件驱动状态） |

页面会把每个用例输出成 `OK` / `FAIL` 行，便于用无头浏览器 `--dump-dom` 抠出来做回归。

> `src/data/notes/**` 是本地私人的测试工作区，已从仓库排除。缺它时 `parse-check.html`
> 会改跑内置样本，不会因此变红。
