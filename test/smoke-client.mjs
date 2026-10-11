import { fileURLToPath } from 'node:url'
// dsh-chat-wallpaper —— 客户端半边的冒烟测试（node:vm，无需启动 DSH）
//
// 验证三件事：
//   1. ModuleLoader 契约：注册 id 正确、factory 返回带 apply/inject 的模块
//   2. buildCss：两种主题模式下生成的 CSS 结构合法（括号平衡、关键声明在位）
//   3. looksDark：标记判定 + 底色亮度兜底
import fs from 'node:fs'
import vm from 'node:vm'

const FILE = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const code = fs.readFileSync(FILE, 'utf8')

let captured = null
const sandbox = {
  window: { __ModuleLoader__: { load(o) { captured = o } } },
  console,
  document: {
    documentElement: { className: '', attributes: [] },
    body: { className: '', attributes: [] },
    getElementById: () => null,
  },
  getComputedStyle: () => ({ backgroundColor: 'rgb(247, 241, 248)' }),   // 浅色
}
vm.createContext(sandbox)
vm.runInContext(code, sandbox, { filename: 'client.js' })

let fails = 0
const ok = (cond, label, extra) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
  if (!cond) fails++
}

console.log('=== ① ModuleLoader 契约 ===')
ok(captured !== null, 'window.__ModuleLoader__.load 被调用')
ok(captured && captured.id === 'dsh-chat-wallpaper', '注册 id 与 loader entry 名一致', captured && captured.id)
ok(captured && typeof captured.factory === 'function', 'factory 是函数')

const mod = captured.factory((name) => { throw new Error('unexpected require: ' + name) })
ok(typeof mod.apply === 'function', 'exports.apply 是函数')
ok(Array.isArray(mod.inject), 'exports.inject 是数组', JSON.stringify(mod.inject))

console.log('\n=== ② buildCss（两种主题各自的纱）===')
const base = {
  objectFit: 'cover', opacity: 1, playbackRate: 1,
  veilLightA: 'rgba(253,250,254,.80)', veilLightB: 'rgba(250,247,253,.68)',
  sidebarLight: 'rgba(255,255,255,.78)', fallbackLight: '#f7f1f8',
  veilDarkA: 'rgba(8,10,16,.74)', veilDarkB: 'rgba(6,8,14,.62)',
  sidebarDark: 'rgba(22,24,32,.74)', fallbackDark: '#0b0d12',
}
const css = mod.__buildCss(base)
console.log(css.split('\n').map((l) => '    ' + l).join('\n'))

const opens = (css.match(/\{/g) || []).length
const closes = (css.match(/\}/g) || []).length
ok(opens === closes, '花括号平衡', `${opens} { / ${closes} }`)
ok(!/,\s*\{/.test(css), '没有 "…, {" 这种悬空选择器')
ok(css.includes('--dsw-alias-bg-base: transparent'), '外壳透明变量在位')
ok(css.includes('--dsw-specific-sidebar-fill: rgba(255,255,255,.78)'), '浅色侧栏半透白在位')
ok(css.includes('--dsw-specific-sidebar-fill: rgba(22,24,32,.74)'), '深色侧栏半透黑在位')
ok(css.includes('z-index: -1'), '视频层在最底层')
ok(css.includes('pointer-events: none'), '视频层不拦点击')
ok(css.includes('object-fit: cover'), 'object-fit 生效')
ok(css.includes('html.dsh-cw-light #dsh-chat-wallpaper > .dsh-cw-veil { background: linear-gradient(rgba(253,250,254,.80), rgba(250,247,253,.68)); }'), '浅色主题压白纱')
ok(css.includes('html.dsh-cw-dark #dsh-chat-wallpaper > .dsh-cw-veil { background: linear-gradient(rgba(8,10,16,.74), rgba(6,8,14,.62)); }'), '深色主题压深纱')
ok(css.includes('html.dsh-cw-light #dsh-chat-wallpaper { background: #f7f1f8; }'), '浅色兜底底色')
ok(css.includes('html.dsh-cw-dark #dsh-chat-wallpaper { background: #0b0d12; }'), '深色兜底底色')
ok(!css.includes('display: none'), '不再"深色主题直接隐藏"（改成换纱）')
ok(!css.includes('data-ds-dark-theme'), '不再依赖 DSH 的主题标记名（改用自己写的 class）')
ok(!css.includes('undefined') && !css.includes('NaN'), '没有 undefined/NaN 泄漏')

console.log('\n=== ③ 主题 class 契约 ===')
ok(mod.__THEME_CLASSES.join(',') === 'dsh-cw-dark,dsh-cw-light', '主题 class 名固定', JSON.stringify(mod.__THEME_CLASSES))

console.log('\n=== ④ looksDark 判定（含亮度缓存）===')
const setAttrs = (htmlAttrs, bodyAttrs, bg) => {
  sandbox.document.documentElement.attributes = htmlAttrs
  sandbox.document.body.attributes = bodyAttrs
  sandbox.document.documentElement.className = ''
  sandbox.document.body.className = ''
  sandbox.getComputedStyle = () => ({ backgroundColor: bg })
  mod.__resetLum()          // 亮度是缓存的，测试里每轮要重置
}
setAttrs([], [], 'rgb(247, 241, 248)')
ok(mod.__looksDark() === false, '浅色底 + 无标记 → 浅色')
setAttrs([{ name: 'data-ds-dark-theme', value: '' }], [], 'rgb(247, 241, 248)')
ok(mod.__looksDark() === true, 'html 上有 data-ds-dark-theme → 深色')
setAttrs([], [{ name: 'data-theme', value: 'dark' }], 'rgb(247, 241, 248)')
ok(mod.__looksDark() === true, 'body 上 data-theme="dark" → 深色')
setAttrs([], [], 'rgb(18, 18, 20)')
ok(mod.__looksDark() === true, '无标记但底色很暗 → 深色（亮度兜底）')
setAttrs([], [], 'rgba(0, 0, 0, 0)')
ok(mod.__looksDark() === false, '透明底色 → 不误判为深色')

// 缓存行为本身也是契约：量一次之后，即使底色变透明也不能翻转结论
setAttrs([], [], 'rgb(247, 241, 248)')
mod.__looksDark()
sandbox.getComputedStyle = () => ({ backgroundColor: 'rgba(0, 0, 0, 0)' })
ok(mod.__looksDark() === false, '亮度已缓存 → 注入 CSS 后不会因透明底翻转成深色')

console.log(`\n${fails === 0 ? '✓ 全部通过' : `✗ ${fails} 项失败`}\n`)
process.exit(fails === 0 ? 0 : 1)
