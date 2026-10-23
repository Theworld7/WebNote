#!/usr/bin/env node
/**
 * WebNote 应用图标生成器 —— macOS 26（Tahoe）Liquid Glass 风格。
 *
 * 几何、配色、构图全部读 design/icon/icon.tokens.json（唯一真源）；
 * 位图由 design/icon/rasterize.py 读同一份 tokens 渲染，两边不会漂移。
 *
 * 产出三组，用途不同，别混：
 *   src-tauri/icons/webnote-icon.svg        完整版，光效全烘焙 —— 给 .icns/.ico 用
 *   src-tauri/icons/webnote-icon-dark.svg   深色外观同上
 *   src-tauri/icons/webnote-icon-small.svg  ≤ tokens.small.maxSize 的母版（无正文行、尖括号放大）
 *   src-tauri/icons/layers/*.svg            给 Icon Composer 的分层版 —— **不带任何烘焙光效**
 *
 * 两组图的差别是刻意的，不是漏了：
 *   Tauri 直出 .icns/.ico，系统不会给位图套遮罩也不加高光，所以圆角、镜面高光、
 *   光晕、暗角必须自己画。而 Icon Composer 会自己加 —— HIG「App 图标」原话是
 *   「创建形状合适的未遮罩层…提供带预定义遮罩的层会对镜面高光效果产生负面影响，
 *   并使边缘看起来有锯齿」、「无需包括镜面高光、层间投影、斜角边缘、模糊、光晕」。
 *   所以 layers/ 里的背景是正方形全出血不透明纯渐变，其余层透明、无高光描边。
 *
 * 几何规范（macOS 26 / Tahoe 全出血圆角矩形）：
 *   - 1024×1024 画布，图形本体铺满整个画布（没有额外内缩）
 *   - 形状是**超椭圆**（squircle）|x/512|^n + |y/512|^n = 1，n = 5
 *     macOS 26 把 macOS 与 iOS 的图标语言统一到同一个圆角矩形与圆格式，
 *     所以这里用与 iOS 26 同族的连续曲率，而不是四段圆弧。
 *     附注：这个形状在对角线方向最紧的曲率半径约 160px，与「832 网格 +
 *     185 角半径 + 96 内缩」那套旧 macOS 模板并非同一条曲线；本项目选全出血，
 *     因为它是 Tahoe 的默认形态。
 *
 * 用法：node design/icon/icon.mjs
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const ICONS = join(REPO, 'src-tauri', 'icons')
const LAYERS = join(ICONS, 'layers')

const tokens = JSON.parse(readFileSync(join(HERE, 'icon.tokens.json'), 'utf8'))
const { canvas: CANVAS, exponent: N, segmentsPerQuadrant: SEGMENTS } = tokens.geometry
const HALF = CANVAS / 2

/* ────────────────────────── 1. 几何 ────────────────────────── */

const round = (v) => Math.round(v * 1000) / 1000

/** 超椭圆上参数 θ 处的点，θ=0 在右边缘中点，逆时针为正。 */
function superPoint(theta) {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return [
    Math.sign(c) * Math.abs(c) ** (2 / N) * HALF,
    Math.sign(s) * Math.abs(s) ** (2 / N) * HALF,
  ]
}

/**
 * 整条超椭圆的闭合路径（画布坐标，左上为原点）。
 * |cosθ|^(2/n) 在 θ=π/4 处是拐点、四象限完全对称，所以均匀采样 +
 * 单调三次插值（Fritsch–Carlson）就能得到平滑且无过冲的近似。
 */
function squirclePath() {
  const pts = []
  for (let i = 0; i < 4 * SEGMENTS; i++) pts.push(pagePoint((i * Math.PI) / (2 * SEGMENTS)))
  return cubicLoop(pts)
}

/** 右上角一段（镜面高光描边用）：θ 从 0 到 π/2。 */
function topRightRimPath() {
  const pts = []
  for (let i = 0; i <= SEGMENTS; i++) pts.push(pagePoint((i * Math.PI) / (2 * SEGMENTS)))
  const lines = [`M ${round(pts[0][0])} ${round(pts[0][1])}`]
  const tang = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    return [b[0] - a[0], b[1] - a[1]]
  })
  for (let i = 0; i < pts.length - 1; i++)
    lines.push(segment(pts[i], pts[i + 1], tang[i], tang[i + 1]))
  return lines.join(' ')
}

/** superPoint 给的是中心原点坐标，SVG 用画布坐标，这里换算。 */
function pagePoint(theta) {
  const [x, y] = superPoint(theta)
  return [x + HALF, y + HALF]
}

/** 由等距采样点构造闭合三次贝塞尔路径。 */
function cubicLoop(pts) {
  const count = pts.length
  const tang = pts.map((_, i) => {
    const a = pts[(i - 1 + count) % count]
    const b = pts[(i + 1) % count]
    return [(b[0] - a[0]) / 2, (b[1] - a[1]) / 2]
  })
  const lines = [`M ${round(pts[0][0])} ${round(pts[0][1])}`]
  for (let i = 0; i < count; i++) {
    lines.push(segment(pts[i], pts[(i + 1) % count], tang[i], tang[(i + 1) % count]))
  }
  lines.push('Z')
  return lines.join(' ')
}

function segment(p0, p1, t0, t1) {
  return (
    `C ${round(p0[0] + t0[0] / 3)} ${round(p0[1] + t0[1] / 3)} ` +
    `${round(p1[0] - t1[0] / 3)} ${round(p1[1] - t1[1] / 3)} ${round(p1[0])} ${round(p1[1])}`
  )
}

const BODY = squirclePath()
const RIM = topRightRimPath()

/* ── 自检 ── */

/** 在真实曲线上取密集点，量它们到方程的垂直距离（一阶），即像素误差。 */
function fitError() {
  let worst = 0
  for (let i = 0; i <= 2000; i++) {
    const [x, y] = superPoint((i / 2000) * 2 * Math.PI)
    const v = Math.abs(x / HALF) ** N + Math.abs(y / HALF) ** N - 1
    const gx = (N * Math.abs(x) ** (N - 1)) / HALF ** N
    const gy = (N * Math.abs(y) ** (N - 1)) / HALF ** N
    worst = Math.max(worst, Math.abs(v) / Math.hypot(gx, gy))
  }
  return worst
}

/** 外接盒应该正好是画布尺寸。 */
function extents() {
  let mx = 0
  let my = 0
  for (let i = 0; i < 360; i++) {
    const [x, y] = superPoint((i * Math.PI) / 180)
    mx = Math.max(mx, Math.abs(x))
    my = Math.max(my, Math.abs(y))
  }
  return [mx * 2, my * 2]
}

const [extW, extH] = extents()
const fit = fitError()
if (fit > 0.5) {
  console.error(`超椭圆拟合误差 ${fit.toFixed(3)}px 超过 0.5px，把 tokens 里的采样段数加大。`)
  process.exit(1)
}
if (Math.abs(extW - CANVAS) > 0.5 || Math.abs(extH - CANVAS) > 0.5) {
  console.error(`图形外接盒 ${extW.toFixed(1)}×${extH.toFixed(1)}，不等于 ${CANVAS}×${CANVAS}`)
  process.exit(1)
}
if (tokens.sheet.fold < tokens.sheet.radius) {
  console.error(
    `折角 ${tokens.sheet.fold} < 面板圆角 ${tokens.sheet.radius}：折缝起点会落进圆角弧里，` +
      `面板右上角的断口接不上折角三角形。把 fold 加大到 ≥ radius。`,
  )
  process.exit(1)
}

/* ────────────────────────── 2. 构图 ────────────────────────── */

const sheet = tokens.sheet
const SHEET_X1 = sheet.x + sheet.size
const FOLD = {
  x: SHEET_X1,
  y: sheet.y,
  cx: SHEET_X1 - sheet.fold,
  size: sheet.fold,
}

const SHEET_PATH = sheetOutline(sheet.x, sheet.y, sheet.size, sheet.radius, sheet.fold)
const SHEET_RIM = `M ${sheet.x + sheet.radius} ${sheet.y} H ${FOLD.cx}`

/**
 * 面板轮廓。**右上角不是圆角，是一段被折角切掉的斜边。**
 *
 * 折角把纸的右上角翻到了纸面上，被折走的那块三角区域必须留空（露出背景）。
 * 曾经这里是完整圆角矩形 + 折角三角形盖上去，结果折缝外侧仍按 r=64 上色，
 * 圆角弧最远鼓出折缝 46.5px —— 看上去就是「折角外面又套了一个圆角」。
 *
 * 折缝端点与折角三角形共线（都用 FOLD），所以纸的断口和翻起来那片纸严丝合缝。
 * 约束：fold ≥ radius，否则折缝起点会落在圆角弧里，轮廓接不上（见下面自检）。
 */
function sheetOutline(x, y, size, r, fold) {
  const x1 = x + size
  const y1 = y + size
  return [
    `M ${x + r} ${y}`,
    `H ${x1 - fold}`,
    `L ${x1} ${y + fold}`,
    `V ${y1 - r}`,
    `A ${r} ${r} 0 0 1 ${x1 - r} ${y1}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 1 ${x} ${y1 - r}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ')
}

/** 一套标记（尖括号 + 正文行）。small 版没有正文行，bars 传 null。 */
function marks(glyph, bars) {
  const [gcx, gcy] = glyph.center
  const paths = {
    open: `M ${gcx - glyph.spread} ${gcy - glyph.height / 2} L ${gcx - glyph.spread - glyph.head} ${gcy} L ${gcx - glyph.spread} ${gcy + glyph.height / 2}`,
    close: `M ${gcx + glyph.spread} ${gcy - glyph.height / 2} L ${gcx + glyph.spread + glyph.head} ${gcy} L ${gcx + glyph.spread} ${gcy + glyph.height / 2}`,
    slash: `M ${gcx + glyph.slashSpread} ${gcy - glyph.slashHeight / 2} L ${gcx - glyph.slashSpread} ${gcy + glyph.slashHeight / 2}`,
  }
  return { glyph, bars, paths }
}

const BIG = marks(tokens.glyph, tokens.bars)
const SMALL = marks(tokens.small.glyph, null)

/* ────────────────────────── 3. 颜色格式 ────────────────────────── */

/** tokens 里的颜色写成 [r,g,b] / [r,g,b,a]，这里转成 SVG 认的形式。 */
function paint(rgb) {
  const [r, g2, b, a] = rgb
  if (a === undefined || a >= 1) return `rgb(${r} ${g2} ${b})`
  return `rgb(${r} ${g2} ${b} / ${a})`
}

function stops(list) {
  return list
    .map(([offset, rgb]) => `        <stop offset="${offset}" stop-color="${paint(rgb)}"/>`)
    .join('\n')
}

/* ────────────────────────── 4. 分层 ────────────────────────── */

const id = (name) => `wn-${name}`

/**
 * L1 背景。
 * composer=true 时只留渐变本身：正方形、全出血、不透明。圆角遮罩和一切光效都交给系统，
 * 这是 Icon Composer 的要求（见文件头）。其余场合烘焙全部效果 —— 位图没人替他加。
 */
function bgLayer(theme, name, composer) {
  const t = tokens.themes[theme]
  if (composer) {
    return `  <!-- L1 背景（Icon Composer 版）：正方形全出血、不透明、只有渐变。
       圆角遮罩 / 镜面高光 / 光晕 / 暗角全部交给系统，这里画了就会和 Liquid Glass 叠加。 -->
  <g id="${id(name)}-background">
    <defs>
      <linearGradient id="${id('bg')}" x1="0.06" y1="0" x2="0.94" y2="1">
${stops(t.bg)}
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" fill="url(#${id('bg')})"/>
  </g>`
  }
  return `  <!-- L1 背景：全出血 squircle + 内发光 + 底部收暗 + 上缘镜面高光 -->
  <g id="${id(name)}-background">
    <defs>
      <linearGradient id="${id('bg')}" x1="0.06" y1="0" x2="0.94" y2="1">
${stops(t.bg)}
      </linearGradient>
      <radialGradient id="${id('glow')}" cx="${t.glow.center[0]}" cy="${t.glow.center[1]}" r="${t.glow.radius}">
        <stop offset="0" stop-color="${paint(t.glow.rgb)}" stop-opacity="${t.glow.alpha}"/>
        <stop offset="0.5" stop-color="${paint(t.glow.rgb)}" stop-opacity="${t.glow.alpha * 0.24}"/>
        <stop offset="1" stop-color="${paint(t.glow.rgb)}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${id('vignette')}" cx="${t.vignette.center[0]}" cy="${t.vignette.center[1]}" r="${t.vignette.radius}">
        <stop offset="0" stop-color="${paint(t.vignette.rgb)}" stop-opacity="${t.vignette.alpha}"/>
        <stop offset="0.55" stop-color="${paint(t.vignette.rgb)}" stop-opacity="${t.vignette.alpha * 0.24}"/>
        <stop offset="1" stop-color="${paint(t.vignette.rgb)}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="${id('rim')}" x1="0.08" y1="0" x2="0.9" y2="0.35">
        <stop offset="0" stop-color="${paint(t.rim.rgb)}" stop-opacity="0"/>
        <stop offset="0.45" stop-color="${paint(t.rim.rgb)}" stop-opacity="${t.rim.alpha}"/>
        <stop offset="1" stop-color="${paint(t.rim.rgb)}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${BODY}" fill="url(#${id('bg')})"/>
    <path d="${BODY}" fill="url(#${id('glow')})"/>
    <path d="${BODY}" fill="url(#${id('vignette')})"/>
    <path d="${RIM}" fill="none" stroke="url(#${id('rim')})" stroke-width="${t.rim.width}" stroke-linecap="round"/>
  </g>`
}

/**
 * L2 玻璃面板。gloss=false 时不画上缘那道接光描边（系统会自己加高光）。
 */
function sheetLayer(theme, name, composer) {
  const t = tokens.themes[theme]
  const gloss = composer
    ? `  <!-- 上缘接光那道描边拿掉了：Icon Composer 会给前景层加镜面高光，留着就是双层。 -->\n`
    : ''
  const glossStop = composer
    ? ''
    : `      <linearGradient id="${id('sheetRim')}" x1="0.15" y1="0" x2="0.85" y2="0.4">
        <stop offset="0" stop-color="${paint(t.sheetTopHighlight.rgb)}" stop-opacity="0"/>
        <stop offset="0.45" stop-color="${paint(t.sheetTopHighlight.rgb)}" stop-opacity="${t.sheetTopHighlight.alpha}"/>
        <stop offset="1" stop-color="${paint(t.sheetTopHighlight.rgb)}" stop-opacity="0"/>
      </linearGradient>
`
  const glossPaint = composer
    ? ''
    : `    <path d="${SHEET_RIM}" fill="none" stroke="url(#${id('sheetRim')})" stroke-width="4"/>
`
  return `${gloss}  <!-- L2 玻璃面板：方形底 + 折角；右上角被折走，沿折缝断口 -->
  <defs>
    <clipPath id="${id('sheetClip')}"><path d="${SHEET_PATH}"/></clipPath>
  </defs>
  <g id="${id(name)}-sheet" clip-path="url(#${id('sheetClip')})">
    <defs>
      <linearGradient id="${id('sheet')}" x1="0" y1="0" x2="0.55" y2="1">
${stops(t.sheet)}
      </linearGradient>
${glossStop}      <linearGradient id="${id('fold')}" x1="0" y1="0" x2="1" y2="1">
${stops(t.fold)}
      </linearGradient>
      <linearGradient id="${id('foldShade')}" x1="0.1" y1="1" x2="0.9" y2="0.15">
        <stop offset="0" stop-color="${paint(t.foldShade.rgb)}" stop-opacity="${t.foldShade.alpha}"/>
        <stop offset="0.55" stop-color="${paint(t.foldShade.rgb)}" stop-opacity="${t.foldShade.alpha * 0.26}"/>
        <stop offset="1" stop-color="${paint(t.foldShade.rgb)}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${SHEET_PATH}" fill="url(#${id('sheet')})"/>
${glossPaint}    <path d="M ${FOLD.cx} ${FOLD.y} L ${FOLD.cx} ${FOLD.y + FOLD.size} L ${FOLD.x} ${FOLD.y + FOLD.size} Z"
          fill="url(#${id('foldShade')})"/>
    <path d="M ${FOLD.cx} ${FOLD.y} L ${FOLD.x} ${FOLD.y + FOLD.size} L ${FOLD.cx} ${FOLD.y + FOLD.size} Z"
          fill="url(#${id('fold')})"/>
    <path d="M ${FOLD.cx} ${FOLD.y} L ${FOLD.x} ${FOLD.y + FOLD.size}" fill="none"
          stroke="${paint(t.foldSeam.rgb)}" stroke-opacity="${t.foldSeam.alpha}" stroke-width="5" stroke-linecap="round"/>
  </g>`
}

/** L3 标记：HTML 尖括号 +（大母版才有）正文行 —— 笔记的正身就是一份 HTML 文件。 */
function markLayer(theme, name, marks_) {
  const t = tokens.themes[theme]
  const g = marks_.glyph
  const barBody = marks_.bars
    ? `
    <g fill="${paint(t.bar.rgb)}" fill-opacity="${t.bar.alpha}">
${marks_.bars.rows
  .map(({ y, width }) => {
    const x = (CANVAS - width) / 2
    return `      <rect x="${round(x)}" y="${y}" width="${width}" height="${marks_.bars.height}" rx="${marks_.bars.height / 2}"/>`
  })
  .join('\n')}
    </g>`
    : ''
  const comment = marks_.bars
    ? '尖括号 + 正文行'
    : '尖括号（小尺寸母版：没有正文行，字形放大到铺满纸面）'
  return `  <!-- L3 标记：${comment} -->
  <g id="${id(name)}-mark">
    <defs>
      <linearGradient id="${id('glyph')}" x1="0" y1="0" x2="0.7" y2="1">
${stops(t.glyph)}
      </linearGradient>
    </defs>
    <g fill="none" stroke="url(#${id('glyph')})" stroke-width="${g.stroke}"
       stroke-linecap="round" stroke-linejoin="round">
      <path d="${marks_.paths.open}"/>
      <path d="${marks_.paths.close}"/>
      <path d="${marks_.paths.slash}"/>
    </g>${barBody}
  </g>`
}

/* ────────────────────────── 5. 输出清单 ────────────────────────── */

/**
 * 一份 SVG 由哪几层、用哪套标记、走哪套光效规则组成。
 * composer=true 只出现在 layers/ —— 那是唯一会被 Icon Composer 读到的产物。
 */
const OUTPUTS = [
  {
    file: 'webnote-icon.svg',
    theme: 'light',
    comment: '默认外观（完整版，光效烘焙）',
    layers: ['background', 'sheet', 'mark'],
    marks: () => BIG,
    composer: false,
  },
  {
    file: 'webnote-icon-dark.svg',
    theme: 'dark',
    comment: '深色外观（完整版，光效烘焙）',
    layers: ['background', 'sheet', 'mark'],
    marks: () => BIG,
    composer: false,
  },
  {
    file: 'webnote-icon-small.svg',
    theme: 'light',
    comment: `默认外观 · 小尺寸母版（≤${tokens.small.maxSize}px）`,
    layers: ['background', 'sheet', 'mark'],
    marks: () => SMALL,
    composer: false,
  },
  {
    file: 'webnote-icon-small-dark.svg',
    theme: 'dark',
    comment: `深色外观 · 小尺寸母版（≤${tokens.small.maxSize}px）`,
    layers: ['background', 'sheet', 'mark'],
    marks: () => SMALL,
    composer: false,
  },
]

/** layers/ 只给 Icon Composer 用：分层、无圆角遮罩、无烘焙光效。 */
const LAYER_FILES = ['background', 'sheet', 'mark']

const RENDERERS = { background: bgLayer, sheet: sheetLayer, mark: markLayer }

function document(theme, comment, layers, marks_, composer) {
  const content = layers
    .map((name) =>
      name === 'mark' ? markLayer(theme, name, marks_) : RENDERERS[name](theme, name, composer),
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  WebNote 应用图标 · ${comment}
  几何：${CANVAS} 画布全出血 / 超椭圆 |x|^${N}+|y|^${N}=(${HALF})^${N}
  真源：design/icon/icon.tokens.json · 生成：node design/icon/icon.mjs
  不要手改这个文件。
-->
<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}"
     viewBox="0 0 ${CANVAS} ${CANVAS}" role="img" aria-label="WebNote">
  <title>WebNote</title>
${content}
</svg>
`
}

/* ────────────────────────── 6. 主流程 ────────────────────────── */

mkdirSync(ICONS, { recursive: true })
mkdirSync(LAYERS, { recursive: true })

const written = []
for (const out of OUTPUTS) {
  const path = join(ICONS, out.file)
  writeFileSync(path, document(out.theme, out.comment, out.layers, out.marks(), out.composer))
  written.push(path)
}

for (const theme of ['light', 'dark']) {
  const suffix = theme === 'dark' ? '-dark' : ''
  for (const layer of LAYER_FILES) {
    const path = join(LAYERS, `${layer}${suffix}.svg`)
    const comment = `${layer} 层 · Icon Composer${theme === 'dark' ? ' · 深色' : ''}`
    writeFileSync(path, document(theme, comment, [layer], BIG, true))
    written.push(path)
  }
}

console.log(`超椭圆拟合最大误差：${fit.toFixed(4)} px（${SEGMENTS} 段/象限）`)
console.log(`外接盒 ${extW.toFixed(1)}×${extH.toFixed(1)}，铺满 ${CANVAS} 画布`)
console.log(`小尺寸母版阈值：≤${tokens.small.maxSize}px`)
console.log('SVG：')
for (const p of written) console.log(`  ${p.slice(REPO.length + 1)}`)
