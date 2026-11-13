# AGENTS.md

玉简(代号 WebNote):本地优先的块式笔记编辑器。笔记 = 磁盘上的普通 `.html` 文件,就地读写,盘上 HTML
即规范形态;数据表 `.tbl`(标准 JSON)是独立文档,可被任意多篇笔记同时引用;Markdown(`.md` /
`.markdown`)只读浏览,可转成同目录同名的 HTML 笔记。
技术栈:Tauri 2 + Vue 3 + TypeScript(strict)+ Tailwind v4,包管理用 pnpm。

## 读代码前

- **领域词汇** —— 命名、注释、UI 文案之前读 [GLOSSARY.md](GLOSSARY.md)。每个术语带「避免用词」
  (Block 不叫 element,Data table 不叫 sheet,Preference 不叫 setting),照它选词。
- **硬约定** —— [README「架构约定」](README.md) 一节:单一真源(块类型、路径格式、列类型各只有
  一处定义)、正文是 `InlineRun[]` 不是字符串、`contenteditable` 非受控、行内格式走 runs 不走
  `execCommand`、引用块的 `entry` 必须 `shallowRef`、读盘留在 composable / 拼 HTML 留在纯函数。
  动到这些区域先读原文,本文件不复述细节。
- **决策记录** —— `docs/adr/`:树拖拽是移动非重排(0003)、重名直接拒绝(0002)、新建后单层重扫
  (0001)、浏览器适配器伪造移动(0004)、数据表是独立文件(0005)、画册快照+指针(0006)、布局块是
  唯一受控容器(0007)、看板拖拽改值(0008)、账目块按财务口径渲染数据表(0009)、主题色取图标背景
  色(0010)、页面样式是文档级的 `<style>` 且编辑器内按正文列预览、页面样式里的浅深两套按应用
  外观解析(0011)、页面样式只在编辑期格式化、落盘压成单行(0012)、HTML 块的沙箱 iframe 带着
  页面样式重新生成、块里那张纸也跟应用外观走(0013)、外观是一份带调度的偏好且手动切换只覆盖
  当前时段(0014)、转换是换一个新块所以焦点按返回的 id 找(0015)、账目块按选定列排序且
  缺省最新在前(0016)、代码块静态态单层高亮、按需挂**全应用唯一**一个 Monaco 编辑(0017)、
代码块的格式化只在按按钮时跑、结果留在缓冲等提交(0018)、代码块的语法配色是我们自己的 token
而非引主题文件、深色另取一套(0019)、原生 select 的弹层靠元素底色与 option 显式色上色、
静止态不填底(0020)、行内链接单击即跳、工作区文档在应用内开标签(0021)、块类型的行为分派
保持显式穷举而不用查表(0022)、引用块的设置两侧各手写读写而不合成 schema(0023)、窗口 chrome
只有一条且标签条不自带浮岛外壳(0024)、正文能写进去的颜色也是 token 且都有明暗两套、装饰面
用 tint 而 selection 只表示选中、行内色按 `data-run-color` 换深色(0025)、深色的面层级是一条
  单调向上的色阶（画布 < 页面底 < 卡片 < 浮层）、浮起面用 popover 而阴影走 `--elev-*` 间接(0026)、
  字号是九档阶梯且不落半像素、h4~h6 靠字重与颜色分、字体栈只存一份（CSS 那份由自检页钉住）、
  版心 720px 与标准档同源(0027)、块框选只收基础/列表两组、逐块换类型不合并、矩形只比纵向(0028)、
  标签行独立在标题栏之下、标题栏中段整段留给拖拽(0029)、新版本只提示不代劳:按钮落在撤销重做
  簇右端、查不到就是没有(0030)、手动检查更新住在设置「关于」里、第一次之后的请求都带
  `If-None-Match`（304 不占限额）、每次按下都以一条瞬态提示收尾(0031)、主路没给出结论就问
  jsDelivr 上的 `package.json`、镜像只往「有更新」下结论且链接退回列表页(0032)、标签住在编辑
  卡片的第一行、chrome 只剩一条标题栏、激活项不在视口里时标签条自己补位(0033)、记一笔曾是模态表单(0034)、记一笔是行内草稿行:
  插在列表顶端、回车横着走到下一输入格而 Tab 走到每一格(含选择格)、草稿行的日期格回车取月历高亮那天、焦点离开这一行才按排序归位、一格没填就自动删掉(0035)、切标签 / 窗口失焦 /
  关窗这三个「离开」的时机才落盘、不按时间轮询(0036)、删一行先弹确认而空行不弹(0037)、
  关窗那一刻把标签 / 激活项 / 展开的层 / 每篇停在哪记进 `localStorage`、下次打开原样接上(0038)、
  撤销 / 重做只重画数据真变了的那块而其余块连赋值都不做、代码块仍整块重挂(0039)、
  数据表的脏态只有注册表一处真源、标签侧按「这个界面能改到哪几张表」现算(0044)、
  画册的归桶(空值不聚合 / 单行平铺 / 多行折叠)只有 `lib/gallery` 一份、分节各写各的(0045)、
  文件的菜单只有一份:网页自己的右键菜单在窗口层被吃掉而 Monaco 例外,树行 `⋯` / 树行右键 /
  标签右键共用 `FileMenuItems`,三个对话框目标共享在 `useTreeDialogs` 里(0046)、
  密钥块是一张卡一条凭据:掩码只是显示开关,明文躺在 `data-secret` 属性里、导出的可见文本
  永远是掩码、不做加密(0047)、窄屏(<900)下侧栏是盖在正文上的浮层且默认不出现、手机(<480)铺满
  而平板竖屏仍是一张卡片、宽屏那份收起偏好照旧落盘而浮层开合不记(0048)、触摸端按住 500ms
  才弹菜单、按压态是自己算的 `data-pressed` 而非 `:active`、底色在 500ms 里推到
  `muted-strong` 且菜单开着时整行保持(0049)、导出文件的字号是 rem、根字号留给读者不动、
  窄屏(≤640)只换字号与三处宫格列数而不改根字号、标题整套按 16/14 等比放大(0050)、
  块类型标识取 `@lucide/vue` 的图标组件(24 网格 / stroke 2 / 14px)、不再挑等宽字符(0051)、
  密码本块是一张**加密落盘**的数据表(口令派生密钥且只活在内存里、导出只留指针)、旧密钥块
  整个删掉(读到旧文件只降级成提示、不把明文读回来)(0052)、改口令是换盐换密钥把整张表重新
  加密一遍(原口令先验、加密的是内存里那份)、口令的规矩(≥8 位且四类字符各一)与一键生成
  只有 `passphraseProblem` / `generatePassphrase` 一份、生成的明文只在当场摊开一次(0053)、
  账目块的筛选是多条件 AND 且**筛出来的就是这本账**(合计 / 余额 / 分节 / 行号都只算筛出的行)、
  筛选值从该列**写过**的显示文本里挑而不是手打、列被删那条条件自己退出、被筛掉的记账收工时说
  一句「已记入但看不到」(0054)、筛选是一排**页签**:一组条件一支、`全部`恒为第一支且不可删、
  没有页签就整条不画、行数写在页签上、页签名默认由条件现算、条件全失效的页签不上条、
  切页签只是换个看法(`setLedgerView` 不记脏、也不进撤销栈)、
  `data-views` + `data-view` 落盘而老 `data-filters` 解析成一支(0055)、标题导航在屏时正文列的
  右留白有 `5rem` 的下限(收起态刻度 3.875rem —— 含行内 `gap-2.5` 那截 —— 加 1.125rem 呼吸,
  固定值不跟 `cqw` 缩)而 hover 展开的目录卡仍盖在正文上(0056)。
  改对应行为前先读那篇。(0029 的标签位置已被 0033 取代,0034 的模态表单已被 0035 取代,0043
  里「导出字号是 px」那段已被 0050 取代,0047「密钥块只是显示开关」已被 0052 取代,
  0052「盐一生不变」已被 0053 收窄成「换口令时换盐」,0054 的「整块只有一组条件」与
  「筛选条上的 `12 / 40 行`」已被 0055 取代)

## 验证

没有测试框架,回归靠两条:

1. **类型门**:`pnpm build`(vue-tsc)。全项目零类型断言 —— 不写 `as`、不写 `@ts-ignore`,
   用类型收窄和类型守卫表达。
2. **自检页**:`design/*.html` 是能直接跑的回归页,每个用例输出 `OK` / `FAIL` 行。
   `pnpm dev` 后访问 `/design/<名字>.html`;其中 `drag-check`、`typography-check`、
   `data-table-check`、`ledger-edit-check`、`ledger-entry-check`、`ledger-filter-check`、`ledger-date-check`、`kanban-date-check`、`option-cell-check`、`playlist-edit-check`、`menu-nav-check`、`link-check`、`block-select-check`、`tab-housing-check`、`undo-paint-check`、`table-ref-check`、`context-menu-check`、`vault-check`、`sidebar-overlay-check` 含顶层 `await`,要抓结果用
   `node design/cdp-dump.mjs http://localhost:1420/design/<名字>.html`。
   **收尾行的判据里别出现 `数字 / 数字`** —— `cdp-dump.mjs` 靠 `\d+\s*/\s*\d+` 认出「跑完了」,
   用例名里带 `10-03 / 10-01` 这种写法会让它在半路收工,打印一份看着全绿的半截结果。
   **挂进来的是复用组件时,把 `App.vue` 提供的上下文补齐** —— `provideWorkspace()`、
   `provideSettings()`、`TooltipProvider`(提示气泡走 reka-ui 的注入)。缺一层不会报在结果里:
   Vue 的 `setup` 抛错会让顶层 `await` 永不继续,`#out` 停在 `running: …`,看着像"卡住"而不是
   "失败"。定位办法是在页里另起一段普通 `<script>` 挂钩 `error` / `unhandledrejection` 与
   `console.error`,把栈追加进 `#out`。

改哪层跑哪页:动 `lib/html` → `parse-check`;动块拖拽 / 标签栏 → `drag-check` / `tab-check`;
动窗口 chrome(品牌名 / 全局动作 / 拖拽面 / 字数 / 页面样式入口)→ `chrome-check`;
动侧栏的窄屏浮层(断点 / 默认隐藏 / 跨断点复位 / 浮层宽度,`composables/useSidebarLayout.ts`、
`AppSidebar` 的 `overlay` 形态)→ `sidebar-overlay-check`(挂真实侧栏,走 CDP,两个视口各跑一次
—— 宽度分手机全宽 / 平板卡片两段,`WINDOW=390` 与 `WINDOW=800` 各钉一支);
动标签的落位(编辑卡片第一行长什么样、塞满时在卡片里滚动)→ `tab-housing-check`(挂真实
标题栏与编辑卡片,走 CDP);
动文件树的整合数据表视图（笔记隐后缀、引用表收进笔记名下、展开箭头）→ `tree-integration-check`;
动文件树的层级引导线（虚线画法、每级几根、显示与否的开关,`style.css` 的 `.tree-guide` 与
`useSettings` 的 `treeGuides`)→ `sidebar-check`(量画法与根数)与 `settings-check`(量开关 → 偏好 →
`<html data-tree-guides>` → 样式表);
动块菜单的方向键寻路(`lib/menu-nav.ts`、横向布局的列间移动)→ `menu-nav-check`(挂真实菜单,
走 CDP);动右侧标题导航(收录范围 / 出现门槛 / 点击跳转 / 激活跟随滚动 / 收起态在正文右侧
让出的那截留白,`lib/headings.ts`、`components/HeadingNav.vue`)→ `heading-nav-check`(挂真实
编辑器,走 CDP;留白那条在两个宽度下各量一次);
动数据表 → `data-table-check`;动排版样式 → `typography-check`;动新建 / 移动 →
`create-check` / `move-check`;动 Markdown 导入 / 导出(`lib/markdown/*`、`lib/fs/transfer.ts`)→
`markdown-check`;动**批量**导入 / 导出(哪些笔记、落到哪个相对路径、结果那句话,都在
`lib/markdown/batch.ts`;落点怎么取、每篇怎么写,在 `lib/fs/transfer.ts` 的
`pickExportSink` / `writeMarkdownTree`)→ `markdown-batch-check`(纯函数 + 两条落点分支:
浏览器走真 OPFS,桌面端把 `__TAURI_INTERNALS__.invoke` 换成记录器,钉住
`recursive: true` 与逐层 `mkdir`);动 Markdown 浏览 / 转笔记(`lib/markdown/render.ts`、`components/MarkdownView.vue`、
树上 `.md` 节点、`convertMarkdownToNote`)→ `markdown-check`(预览 HTML 与消毒)、
`markdown-view-check`(挂真实编辑器，排版 / 消毒 / 转笔记)、
`create-check`(扫描 / 打开 / 同目录转换)、`tree-integration-check`(整合视图保留 `.md`);
动设置 → `settings-check`;动布局块 → `layout-check`;
动字号档位 / 基础字号(`style.css` 的 `--text-*`、`useSettings` 的 `baseFont`)→
`settings-check`(切档后量 computed 字号,不看存储值)与 `typography-check`(默认档下编辑器与
导出仍逐像素一致)。**给 Tailwind 加自定义字号刻度必须同时扩 `lib/utils.ts` 的
`classGroups`** —— 否则 `cn()` 会把档位名当成文字颜色吃掉,标题静默掉回正文大小;
**`Input` 自带 `text-base md:text-sm`,要它按档位显示就得连 `md:text-13` 一起写** —— 普通工具类
里 `.text-13` 排在 `.text-base` 之后能盖住它,但变体 `md:text-sm` 排在所有普通工具类之后,
只写 `text-13` 会在 ≥768 的窗口里漏回 14px(同一个面板里出现两种字号,`vault-check` 量三个
口令框的 computed 字号就是为此);
动**尺寸**(改宽度 / 弹层 / 侧栏这类 px 时)→ 一律写 rem(`w-[244px]` 写成 `w-[15.25rem]`,
换算脚本 `design/px-to-rem.py`),**除了 3px 以内的细线、圆角、版心与导出几何** —— 前两者各有
自己的刻度(细线是物理像素,圆角跟四档设置走),后两者按 ADR-0043 刻意不跟。默认档下 rem 与 px
等价,所以任何既有自检都验不出这类改动;**只有非默认档才分得出来**,`settings-check` 量分区栏
在三档下的宽度(76 / 95 / 76)就是为此;
动保存时机(`saveOnLeave` / `attachAutoSave` / `requestWindowClose` 的前置保存、`useSettings`
的 `autoSave`) → `autosave-check`(真实工作区 + 假盘),设置面板里那颗开关 → `settings-check`;
动会话快照(`composables/useSession.ts`、`adoptRoot` 里的 `restoreSession`、`confirmWindowClose`
的 `persistSession`) → `session-check`(真实工作区 + OPFS);动编辑器的滚动记忆(实时记录与挂回)
→ `scroll-memory-check`(挂真实编辑器,走 CDP 驱动);
动新版本检测(`lib/update.ts`、`composables/useUpdateCheck.ts`、`components/NewVersionButton.vue`)
→ `update-check`(版本号比较 / release 解析 / 手动检查的三种结论 / 按钮行为),按钮在标题栏里的
落位 → `chrome-check`,设置里的入口 → `settings-check`;
动代码块的编辑态 / 格式化 / 静态配色(`lib/monaco-code.ts`、`lib/source-format.ts`、
`style.css` 里的 `--color-code-*`)→ `code-edit-check`(挂真实编辑器,走 CDP 驱动);
动对比度 / 配色 token → `theme-check`、`code-edit-check` 的第十节;
动落块 / 转换之后的焦点(菜单插入、`/` 转换、`转为…` 子菜单、Esc 关菜单)→ `focus-check`;
动撤销 / 重做的行为(`useWorkspace` 的 `undo` / `redo` / `snapshotOf`、`lib/blocks` 的
`snapshotBlock`、`BlockItem` 的 `repaintFromData`、`BlockEditor` 的 `blockKey`)→ `undo-check`
(合并、块级操作、输入框放行)与 `undo-paint-check`(挂真实编辑器,走 CDP:没有整篇重挂、滚动与
焦点留住、布局格子里的正文同样重画);
动块框选(空白处起的矩形、`lib/block-select.ts`、`retypeBlocks` / `removeBlocks`、选区浮条)→
`block-select-check`(挂真实编辑器,走 CDP 驱动);
动格子的增删行为 → `cell-check`(挂真实编辑器,走 CDP);动行内链接的样式 / 单击跳转
(`lib/link.ts`、`lib/open-external.ts`、`linkHrefOf`)→ `link-check`(挂真实编辑器,走 CDP);
动选择格的键盘模型 / 浮层落位(`components/OptionCell.vue`、`lib/floating.ts`)→
`option-cell-check`(组件级,不借账目夹具);动引用块的提示态(空指针 / 读不到 / 读取中,以及
读不到时「重新选择数据表」的出路,`components/TableRefNotice.vue`、换表该清什么的规则在
`lib/rebind.ts`)→ `table-ref-check`(组件级 + 纯函数,不借任何一个引用块的夹具);动账目块的财务口径 → `ledger-check`,动它的就地增删改 →
`ledger-edit-check`,动记一笔的草稿行(顶端落位 / 回车与 Tab 横着填 / 归位排序 / 空行自动删)→
`ledger-entry-check`,动日期面板 / 编辑期钉住排序 → `ledger-date-check`(都挂真实编辑器,走 CDP 驱动);
动账目块的筛选页签(块顶那排页签、`全部`恒在第一支、设置里改的是**选中那一支**的条件与名字、
`新建页签` / `删除页签`、每支自己的行数、合计 / 余额 / 行号只算那一支的行、被筛掉的记账收工时
的提示、`lib/ledger` 的 `ledgerTabs` 与 `data-views` / `data-view` 的往返,见 ADR-0055)→
`ledger-filter-check`(挂真实编辑器,走 CDP 驱动)与 `ledger-check`;
动删行的确认框(账目块 / 数据表编辑页同一套,`requestDelete` 与 `lib/data-table` 的 `isBlankRow`)→
`ledger-edit-check` 与 `data-table-check` 都跑;
动日期格的月历浮层本身(`composables/useDateCellPanel.ts`,账目行与看板卡共用)、
它的键盘导航(`lib/date-key.ts` 的日期算术、`DateCalendar.vue` 的高亮环)→ 两页都跑;
动看板卡的逐格编辑 → `kanban-date-check`(挂真实编辑器,走 CDP 驱动);动歌单块的字段识别 / 在线封面 / 多表绑定的落盘形态(`lib/playlist.ts`)→
`playlist-check`,动它的标签切换 / 加歌 / 删歌 / 解除绑定 / 搜索 / 复制纯文本 → `playlist-edit-check`(挂真实编辑器,走 CDP 驱动);动主题色 / 品牌色 → `theme-check`(对齐图标 tokens,守对比度);动外观 / 主题模式 / 定时与
日出日落 → `theme-mode-check`(挂真实标题栏 —— 外观开关在窗口这一层,ADR-0033 之后标签栏里没有它了;含太阳位置与时区);动页面级样式
(读写、预览改写、chrome 入口、编辑期格式化与落盘紧凑、页面样式对 HTML 块生效)→ `page-style-check`
(挂真实编辑器,走 CDP 驱动),改写规则与紧凑化本身在 `parse-check`;动 HTML 块的沙箱文档 /
高度探针 / 块里那张纸(画布底色与 `pinScheme`)→ `html-check`;动源码抽屉(打开 / 提交 / 取消)或抽屉里 Monaco 的配色
(`lib/monaco-theme.ts`)→ `html-drawer-check`;动右键菜单(网页菜单的拦截与 Monaco 例外、
`FileMenuItems` 的三处入口、`useTreeDialogs` 的共享目标,见 ADR-0046)或触摸长按与按压底色
(`composables/usePressHold.ts`、`lib/touch.ts` 的 `LONG_PRESS_MS`,见 ADR-0049)→
`context-menu-check`(挂真实侧栏与标签,走 CDP 驱动);动密码本块(掩码 / 明文切换、复制、锁与解锁、加密落盘、导出只留指针,见 ADR-0052;换口令与口令的规矩,见 ADR-0053)→
`vault-check`(挂真实编辑器 + OPFS,走 CDP:真加解密 + 锁屏 + 明文不上屏 + 盘上是密文 + 换口令后旧口径作废、新口令解得开)与
`parse-check` 的密码本往返样本与旧密钥块降级样本;动 Monaco 的
按需加载(块内编辑态与源码抽屉的 loading 态,见 ADR-0017)→ `code-edit-check` 与
`html-drawer-check` 的首次打开用例。
自检页清单见 README「自检」一节,每页具体断言读该页脚本里的 `check(...)` 用例。

## 写代码

- 注释与 UI 文案用中文;注释写「为什么」和设计立场,不逐行复述代码。
- `pnpm dev` 走浏览器文件系统实现(伪造盘上行为,调试用);验证真实的读写与移动要跑
  `pnpm tauri dev`。两份 `WorkspaceFs` 实现共用 `lib/fs/policy.ts` 的过滤与排序。
- Tauri(Rust)侧保持薄:只做目录授权、目录扫描、文本读写;业务逻辑都在前端。
- 应用图标的真源是 `design/icon/icon.tokens.json`,改后跑 `pnpm icon`;
  `src-tauri/icons/` 下的产物不手改。