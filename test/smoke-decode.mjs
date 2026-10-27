import { fileURLToPath } from 'node:url'
// 解码失败回归测试：code 3 只撤视频层，保住底图/横幅
//
// 背景：桌面版（Electron）不带 H.264 解码器，片库的 mp4 一放就是
// PIPELINE_ERROR_DECODE（MediaError code 3）。旧实现无差别 teardown()，
// 把底图和横幅一起撤了 —— 视频放不了，用户配好的壁纸也跟着白配了。
// 本套件守住两条：
//   · 解码失败（code 3）→ 优雅降级：只撤视频层，底图/横幅/CSS 留着
//   · 加载失败（code 4 等，文件真不在）→ 维持原行为：全撤
//
// 红绿对照：拿旧版 client.js 跑本套件应当【变红】——
//   git show v0.2.2:lib/client.js > old-client.js
//   node test/smoke-decode.mjs old-client.js
import fs from 'node:fs'
import vm from 'node:vm'

/* 允许指定被测文件：证明测试真的抓得住这个 bug */
const FILE = process.argv[2] || fileURLToPath(new URL('../lib/client.js', import.meta.url))
const code = fs.readFileSync(FILE, 'utf8')

let captured = null
const timeouts = []

function mkEl(tag) {
  const el = {
    tagName: tag, id: '', className: '', dataset: {}, attributes: [],
    style: { _v: {}, setProperty(k, v) { this._v[k] = String(v) }, removeProperty(k) { delete this._v[k] } },
    getBoundingClientRect: () => ({ width: 800, height: 400 }),
    children: [], parentNode: null, src: '', alt: '',
    duration: 7.0417, currentTime: 0, paused: true, loop: false, videoWidth: 2560, videoHeight: 1440,
    /* error 按 MediaError 的形状给：{ code, message } */
    error: null,
    _handlers: {},
    setAttribute() {}, removeAttribute() {},
    addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn) },
    fire(t) { (this._handlers[t] || []).forEach((fn) => fn({ type: t })) },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c },
    remove() { if (this.parentNode) this.parentNode.removeChild(this) },
    insertBefore(node) { node.parentNode = this; this.children.unshift(node); return node },
    querySelector(sel) {
      return this.children.find((c) =>
        sel.startsWith('.') ? '.' + c.className === sel
          : sel.startsWith('#') ? '#' + c.id === sel
            : c.tagName === sel) || null
    },
    querySelectorAll() { return [] },
    pause() { this.paused = true },
    load() {},
    play() { this.paused = false; return Promise.resolve() },
  }
  return el
}

const sandbox = {
  window: { __ModuleLoader__: { load(o) { captured = o } }, innerWidth: 1600, addEventListener() {}, removeEventListener() {} },
  console,
  _styleTags: [],
  document: {
    documentElement: { attributes: [], classList: { add() {}, remove() {} } },
    head: null,
    body: null,
    createElement(t) { return mkEl(t) },
    getElementById(id) { return sandbox.document.body.children.find((c) => c.id === id) || null },
    querySelector(sel) { return sandbox._styleTags.find((t) => t.dataset.pluginCss && sel.includes(t.dataset.pluginCss)) || null },
    addEventListener() {},
  },
  setTimeout(fn, ms) { timeouts.push({ fn, ms, id: timeouts.length + 1, cleared: false }); return timeouts.length },
  clearTimeout(id) { const t = timeouts.find((x) => x.id === id); if (t) t.cleared = true },
  setInterval(fn, ms) { sandbox._intervals.push({ fn, ms, cleared: false, id: sandbox._intervals.length + 1 }); return sandbox._intervals.length },
  clearInterval(id) { const t = sandbox._intervals.find((x) => x.id === id); if (t) t.cleared = true },
  _intervals: [],
  getComputedStyle: () => ({ backgroundColor: 'rgb(8, 10, 16)' }),
  _observers: [],
  MutationObserver: function (cb) {
    sandbox._observers.push(cb)
    this.observe = () => {}
    this.disconnect = () => { const i = sandbox._observers.indexOf(cb); if (i >= 0) sandbox._observers.splice(i, 1) }
  },
  requestAnimationFrame: (fn) => { if (typeof fn === 'function') fn(); return 1 },
  cancelAnimationFrame: () => {},
  fetch: () => Promise.reject(new Error('no network')),
}
sandbox.document.head = mkEl('head')
sandbox.document.head.appendChild = function (c) {
  sandbox._styleTags.push(c)
  c.parentNode = sandbox.document.head
  return c
}
/* removeCss() → styleTag().remove() 要真能把标签从 _styleTags 里摘掉，
   否则测不出"CSS 是否被撤回" */
sandbox.document.head.removeChild = function (c) {
  const i = sandbox._styleTags.indexOf(c)
  if (i >= 0) sandbox._styleTags.splice(i, 1)
  c.parentNode = null
  return c
}
sandbox.document.body = mkEl('body')

vm.createContext(sandbox)
vm.runInContext(code, sandbox, { filename: 'client.js' })
const mod = captured.factory(() => { throw new Error('unexpected require') })

const cfg = {
  mode: 'once', fadeOutMs: 1200, objectFit: 'cover', opacity: 1, playbackRate: 1,
  veilLightA: 'rgba(253,250,254,.80)', veilLightB: 'rgba(250,247,253,.68)',
  sidebarLight: 'rgba(255,255,255,.78)', fallbackLight: '#f7f1f8',
  veilDarkA: 'rgba(8,10,16,.50)', veilDarkB: 'rgba(6,8,14,.38)',
  sidebarDark: 'rgba(22,24,32,.74)', fallbackDark: '#0b0d12',
}

let fails = 0
const ok = (cond, label, extra) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
  if (!cond) fails++
}
const layer = () => sandbox.document.getElementById('dsh-chat-wallpaper')
const reset = () => {
  timeouts.length = 0
  sandbox._intervals.length = 0
  sandbox.document.body.children.length = 0
  sandbox._styleTags.length = 0
}
/* 挂一个"视频正在播"的现场：applyNow 装底图/横幅/CSS，mountLayer 装视频层 */
const stage = (extra) => {
  reset()
  mod.__applyNow({ ...cfg, ...extra })
  mod.__mountLayer({ ...cfg, ...extra })
  return layer().children.find((c) => c.tagName === 'video')
}
/* MediaError code 3 = MEDIA_ERR_DECODE（解码器缺失）；4 = SRC 不支持/加载失败 */
const failWith = (codeNum) => {
  const v = layer().children.find((c) => c.tagName === 'video')
  v.error = { code: codeNum, message: codeNum === 3 ? 'PIPELINE_ERROR_DECODE' : 'Empty src attribute' }
  v.fire('error')
}

console.log('=== A. once/front + 底图 + 横幅，解码失败(code 3) → 只撤视频层，其余全留住 ===')
const vA = stage({ __imageOk: true, placement: 'front', banner: '人类与AI的日常', bannerOpacity: 0.15 })
ok(!!vA, '前置：视频层在')
failWith(3)
ok(!layer(), '★★ 视频层被移除（不能再盖住界面）')
ok(!!sandbox.document.getElementById('dsh-cw-bg'), '★★ 底图还在 —— 视频放不了，壁纸不能陪葬')
ok(!!sandbox.document.getElementById('dsh-cw-banner'), '★★ 横幅也在')
ok(sandbox._styleTags.length > 0 && !!sandbox.document.querySelector('style[data-plugin-css="dsh-chat-wallpaper/main.css"]'),
  '★ 外壳 CSS 没撤（聊天继续落在底图上）')
ok(mod.__hasCurrent() === true, 'current 留着（主题观察者还要给纱换色）')
vA.fire('error')
ok(!layer() && !!sandbox.document.getElementById('dsh-cw-bg'), '重复触发不炸、状态不变')

console.log('\n=== B. once/front + 没配底图，解码失败(code 3) → 全撤（回到 DSH 原样）===')
const vB = stage({ placement: 'front' })
failWith(3)
ok(!layer(), '视频层撤了')
ok(!sandbox.document.getElementById('dsh-cw-bg'), '本来就没有底图')
ok(sandbox._styleTags.length === 0 || !sandbox.document.querySelector('style[data-plugin-css="dsh-chat-wallpaper/main.css"]'),
  '★ 没底图可保 → 连外壳 CSS 一起撤（与 finishOnce 收场同款逻辑）')
ok(mod.__hasCurrent() === false, 'current 清空')

console.log('\n=== C. 加载失败(code 4，文件真不在) + 配了底图 → 维持原行为：全撤 ===')
const vC = stage({ __imageOk: true, placement: 'front' })
failWith(4)
ok(!layer(), '视频层撤掉')
ok(!sandbox.document.getElementById('dsh-cw-bg'), '★★ 文件都不存在 → 底图也撤（老行为不变）')
ok(mod.__hasCurrent() === false, 'current 清空')

console.log('\n=== D. loop/behind + 底图，解码失败(code 3) → 背景视频撤掉，底图露出 ===')
const vD = stage({ __imageOk: true, mode: 'loop', placement: 'behind' })
failWith(3)
ok(!layer(), '背景视频层撤了')
ok(!!sandbox.document.getElementById('dsh-cw-bg'), '★★ 底图露出来（本来就是它俩叠着）')
ok(!!sandbox.document.getElementById('dsh-cw-banner') === false, '没配横幅就没有横幅层')

console.log(`\n${fails === 0 ? '✓ 全部通过' : `✗ ${fails} 项失败`}\n`)
process.exit(fails === 0 ? 0 : 1)
