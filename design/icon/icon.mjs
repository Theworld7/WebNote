#!/usr/bin/env node
/**
 * WebNote 应用图标生成器 —— macOS 26（Tahoe）Liquid Glass 风格。
 *
 * 几何、配色、构图全部读 design/icon/icon.tokens.json（唯一真源）；
 * 位图由 design/icon/rasterize.py 读同一份 tokens 渲染，两边不会漂移。
 *
 * 产出：
 *   src-tauri/icons/webnote-icon.svg        完整版（背景 + 玻璃面板 + 标记）
 *   src-tauri/icons/webnote-icon-dark.svg   深色外观完整版
 *   src-tauri/icons/layers/*.svg            分层版，可直接拖进 Icon Composer
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
  for (let i = 0; i < pts.length - 1; i++) lines.push(segment(pts[i], pts[i + 1], tang[i], tang[i + 1]))
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

/* ────────────────────────── 2. 构图 ────────────────────────── */

const sheet = tokens.sheet
const SHEET_PATH = roundedRect(sheet.x, sheet.y, sheet.size, sheet.radius)
const SHEET_RIM = `M ${sheet.x + sheet.radius} ${sheet.y} ` +
  `H ${sheet.x + sheet.size - sheet.radius} ` +
  `A ${sheet.radius} ${sheet.radius} 0 0 1 ${sheet.x + sheet.size} ${sheet.y + sheet.radius}`
const FOLD = {
  x: sheet.x + sheet.size,
  y: sheet.y,
  cx: sheet.x + sheet.size - sheet.fold,
  size: sheet.fold,
}

/** 普通圆角矩形（面板），四段圆弧就够 —— 这里的半径小到看不出圆/超椭圆的差别。 */
function roundedRect(x, y, size, r) {
  const x1 = x + size
  const y1 = y + size
  return [
    `M ${x + r} ${y}`,
    `H ${x1 - r}`,
    `A ${r} ${r} 0 0 1 ${x1} ${y + r}`,
    `V ${y1 - r}`,
    `A ${r} ${r} 0 0 1 ${x1 - r} ${y1}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 1 ${x} ${y1 - r}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ')
}

const g = tokens.glyph
const [gcx, gcy] = g.center
const GLYPH = {
  open: `M ${gcx - g.spread} ${gcy - g.height / 2} L ${gcx - g.spread - 50} ${gcy} L ${gcx - g.spread} ${gcy + g.height / 2}`,
  close: `M ${gcx + g.spread} ${gcy - g.height / 2} L ${gcx + g.spread + 50} ${gcy} L ${gcx + g.spread} ${gcy + g.height / 2}`,
  slash: `M ${gcx + g.slashSpread} ${gcy - g.slashHeight / 2} L ${gcx - g.slashSpread} ${gcy + g.slashHeight / 2}`,
}

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

function bgLayer(theme, name) {
  const t = tokens.themes[theme]
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

function sheetLayer(theme, name) {
  const t = tokens.themes[theme]
  return `  <!-- L2 玻璃面板：半透明底面 + 上缘接光 + 折角 -->
  <g id="${id(name)}-sheet">
    <defs>
      <linearGradient id="${id('sheet')}" x1="0" y1="0" x2="0.55" y2="1">
${stops(t.sheet)}
      </linearGradient>
      <linearGradient id="${id('sheetRim')}" x1="0.15" y1="0" x2="0.85" y2="0.4">
        <stop offset="0" stop-color="${paint(t.sheetTopHighlight.rgb)}" stop-opacity="0"/>
        <stop offset="0.45" stop-color="${paint(t.sheetTopHighlight.rgb)}" stop-opacity="${t.sheetTopHighlight.alpha}"/>
        <stop offset="1" stop-color="${paint(t.sheetTopHighlight.rgb)}" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="${id('fold')}" x1="0" y1="0" x2="1" y2="1">
${stops(t.fold)}
      </linearGradient>
      <linearGradient id="${id('foldShade')}" x1="0.1" y1="1" x2="0.9" y2="0.15">
        <stop offset="0" stop-color="${paint(t.foldShade.rgb)}" stop-opacity="${t.foldShade.alpha}"/>
        <stop offset="0.55" stop-color="${paint(t.foldShade.rgb)}" stop-opacity="${t.foldShade.alpha * 0.26}"/>
        <stop offset="1" stop-color="${paint(t.foldShade.rgb)}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${SHEET_PATH}" fill="url(#${id('sheet')})"/>
    <path d="${SHEET_RIM}" fill="none" stroke="url(#${id('sheetRim')})" stroke-width="4"/>
    <path d="M ${FOLD.cx} ${FOLD.y} L ${FOLD.cx} ${FOLD.y + FOLD.size} L ${FOLD.x} ${FOLD.y + FOLD.size} Z"
          fill="url(#${id('foldShade')})"/>
    <path d="M ${FOLD.cx} ${FOLD.y} L ${FOLD.x} ${FOLD.y + FOLD.size} L ${FOLD.cx} ${FOLD.y + FOLD.size} Z"
          fill="url(#${id('fold')})"/>
    <path d="M ${FOLD.cx} ${FOLD.y} L ${FOLD.x} ${FOLD.y + FOLD.size}" fill="none"
          stroke="${paint(t.foldSeam.rgb)}" stroke-opacity="${t.foldSeam.alpha}" stroke-width="5" stroke-linecap="round"/>
  </g>`
}

function markLayer(theme, name) {
  const t = tokens.themes[theme]
  const bars = tokens.bars.rows
    .map(({ y, width }) => {
      const x = (CANVAS - width) / 2
      return `    <rect x="${round(x)}" y="${y}" width="${width}" height="${tokens.bars.height}" rx="${tokens.bars.height / 2}"/>`
    })
    .join('\n')
  return `  <!-- L3 标记：HTML 尖括号 + 正文行（笔记的正身就是一份 HTML 文件） -->
  <g id="${id(name)}-mark">
    <defs>
      <linearGradient id="${id('glyph')}" x1="0" y1="0" x2="0.7" y2="1">
${stops(t.glyph)}
      </linearGradient>
    </defs>
    <g fill="none" stroke="url(#${id('glyph')})" stroke-width="${g.stroke}"
       stroke-linecap="round" stroke-linejoin="round">
      <path d="${GLYPH.open}"/>
      <path d="${GLYPH.close}"/>
      <path d="${GLYPH.slash}"/>
    </g>
    <g fill="${paint(t.bar.rgb)}" fill-opacity="${t.bar.alpha}">
${bars}
    </g>
  </g>`
}

const LAYERS_OF = [
  ['background', bgLayer],
  ['sheet', sheetLayer],
  ['mark', markLayer],
]

function document(theme, layers, title) {
  const content = layers.map((name) => LAYERS_OF.find((l) => l[0] === name)[1](theme, name)).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  WebNote 应用图标 · ${title}
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

/* ────────────────────────── 5. 主流程 ────────────────────────── */

mkdirSync(ICONS, { recursive: true })
mkdirSync(LAYERS, { recursive: true })

const written = []
for (const theme of ['light', 'dark']) {
  const suffix = theme === 'dark' ? '-dark' : ''
  const all = LAYERS_OF.map((l) => l[0])
  const files = [
    [join(ICONS, `webnote-icon${suffix}.svg`), document(theme, all, theme === 'dark' ? '深色外观' : '默认外观')],
    ...LAYERS_OF.map(([name]) => [
      join(LAYERS, `${name}${suffix}.svg`),
      document(theme, [name], `${name} 层`),
    ]),
  ]
  for (const [path, text] of files) {
    writeFileSync(path, text)
    written.push(path)
  }
}

console.log(`超椭圆拟合最大误差：${fit.toFixed(4)} px（${SEGMENTS} 段/象限）`)
console.log(`外接盒 ${extW.toFixed(1)}×${extH.toFixed(1)}，铺满 ${CANVAS} 画布`)
console.log('SVG：')
for (const p of written) console.log(`  ${p.slice(REPO.length + 1)}`)
