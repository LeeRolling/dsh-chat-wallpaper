import { fileURLToPath } from 'node:url'
// mode='once' 测试：播一次 → 淡出 → 收场（或留下背景图）
//
// 这是"片头式"用法：视频只是开场，放完就让位给聊天背景。
// 用可控 setTimeout，不真等 1.2 秒。
import fs from 'node:fs'
import vm from 'node:vm'

/* 允许指定被测文件：这样能拿一个"故意没修"的副本来证明测试真的抓得住这个 bug */
const FILE = process.argv[2] || fileURLToPath(new URL('../lib/client.js', import.meta.url))
const code = fs.readFileSync(FILE, 'utf8')

let captured = null
const timeouts = []
let timeoutId = 0

function mkEl(tag) {
  const el = {
    tagName: tag, id: '', className: '', dataset: {}, attributes: [],
    /* style 要支持 setProperty —— 横幅的浓度是通过 CSS 变量传的 */
    style: { _v: {}, setProperty(k, v) { this._v[k] = String(v) }, removeProperty(k) { delete this._v[k] } },
    getBoundingClientRect: () => ({ width: 800, height: 400 }),
    children: [], parentNode: null, src: '', alt: '',
    duration: 7.0417, currentTime: 0, paused: true, loop: false, videoWidth: 2560, videoHeight: 1440,
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
  setTimeout(fn, ms) { timeouts.push({ fn, ms, id: ++timeoutId, cleared: false }); return timeoutId },
  clearTimeout(id) { const t = timeouts.find((x) => x.id === id); if (t) t.cleared = true },
  setInterval(fn, ms) { sandbox._intervals.push({ fn, ms, cleared: false, id: sandbox._intervals.length + 1 }); return sandbox._intervals.length },
  clearInterval(id) { const t = sandbox._intervals.find((x) => x.id === id); if (t) t.cleared = true },
  _intervals: [],
  getComputedStyle: () => ({ backgroundColor: 'rgb(247, 241, 248)' }),
  /* 记录观察者回调，测试里可以主动"触发一次属性变化" */
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
sandbox.document.head.appendChild = function (c) { sandbox._styleTags.push(c); return c }
sandbox.document.body = mkEl('body')
// style 标签的 dataset 要能读
sandbox.document.createElement = (t) => mkEl(t)

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
const runTimeouts = () => { for (const t of timeouts.slice()) if (!t.cleared) { t.cleared = true; t.fn() } }
const fireMutation = () => { for (const cb of sandbox._observers.slice()) cb([]) }
/* 走 setInterval 的表（闸门的轮询用它） */
const tickTimers = (n) => { for (let i = 0; i < n; i++) for (const t of sandbox._intervals.slice()) if (!t.cleared) t.fn() }
const layer = () => sandbox.document.getElementById('dsh-chat-wallpaper')

console.log("=== A. mode='once' + 没有背景图 → 整层淡出后收场 ===")
timeouts.length = 0
sandbox.document.body.children.length = 0
sandbox._styleTags.length = 0
mod.__mountLayer(cfg)
const L1 = layer()
ok(!!L1, '层挂上了')
ok(L1.children.filter((c) => c.tagName === 'img').length === 0, '没配图 → 不创建 <img>')
const v1 = L1.children.find((c) => c.tagName === 'video')
ok(v1.loop === false, "mode='once' → 关掉原生 loop（不然 ended 不触发）", 'loop=' + v1.loop)

// 模拟播到结尾
v1.duration = 7.0417
v1.currentTime = 7.0417
v1.fire('timeupdate')
ok(L1.style.opacity === '0', '★ 到结尾 → 整层开始淡出（opacity→0）', 'opacity=' + L1.style.opacity)
ok(String(L1.style.transition).includes('1200ms'), '淡出时长 = fadeOutMs(1200ms)', L1.style.transition)

// 再播一次 timeupdate 不该重复触发
L1.style.opacity = 'MARK'
v1.fire('timeupdate')
ok(L1.style.opacity === 'MARK', '重复触发被挡住（只收场一次）')

runTimeouts()
ok(!layer(), '★ 淡出结束后整层收场（回到 DSH 默认底色）')
ok(sandbox._styleTags.length === 0 || !sandbox.document.querySelector('style[data-plugin-css="dsh-chat-wallpaper/main.css"]'),
  '★ CSS 也撤回了（外壳变量恢复原样）')

console.log("\n=== B. 有底图 → 两层彻底分开：视频在最前演，淡出后视频走人、底图留下 ===")
timeouts.length = 0
sandbox.document.body.children.length = 0
sandbox._styleTags.length = 0
mod.__applyNow({ ...cfg, __imageOk: true, placement: 'front' })
mod.__mountLayer({ ...cfg, __imageOk: true, placement: 'front' })
const bg = sandbox.document.getElementById('dsh-cw-bg')
const L2 = layer()
ok(!!bg, '★ 底图是**独立的一层** #dsh-cw-bg（不是塞在视频层里）')
ok(bg.children.filter((c) => c.tagName === 'img').length === 1, '底图层里有 1 个 <img>')
ok(String(bg.children.find((c) => c.tagName === 'img').src).includes('/chat-wallpaper/image'), '图的地址走宿主路由')
ok(bg.children.some((c) => c.className === 'dsh-cw-veil'), '底图上有纱（底图上的文字要能读）')
ok(L2.children.filter((c) => c.tagName === 'img').length === 0, '★ 视频层里【没有】img（两层解耦）')
ok(L2.children.filter((c) => c.className === 'dsh-cw-veil').length === 0, '★ front 模式视频上【不】压纱（全屏那层没有文字要读）')

const v2 = L2.children.find((c) => c.tagName === 'video')
ok(!!v2, '视频层里有 video')
v2.duration = 7.0417
v2.currentTime = 7.0417
v2.fire('timeupdate')
ok(L2.style.opacity === '0', '★ 视频层开始淡出', 'opacity=' + L2.style.opacity)

runTimeouts()
ok(!layer(), '★ 视频层被移除（开场演完了）')
ok(!!sandbox.document.getElementById('dsh-cw-bg'), '★★ 底图还在 —— 聊天就落在这张底图上')

console.log("\n=== C. ended 事件也能触发收场（不只靠 timeupdate 兜底）===")
timeouts.length = 0
sandbox.document.body.children.length = 0
sandbox._styleTags.length = 0
mod.__mountLayer(cfg)
const L3 = layer()
const v3 = L3.children.find((c) => c.tagName === 'video')
v3.fire('ended')
ok(L3.style.opacity === '0', '★ ended → 淡出', 'opacity=' + L3.style.opacity)

console.log("\n=== D. mode='loop' → 完全不介入，不许淡出 ===")
timeouts.length = 0
sandbox.document.body.children.length = 0
sandbox._styleTags.length = 0
mod.__mountLayer({ ...cfg, mode: 'loop' })
const L4 = layer()
const v4 = L4.children.find((c) => c.tagName === 'video')
ok(v4.loop === true, "mode='loop' → 原生循环", 'loop=' + v4.loop)
v4.duration = 7.0417
v4.currentTime = 7.0417
v4.fire('timeupdate')
ok(L4.style.opacity !== '0', '★ loop 模式下播到结尾【不】淡出', 'opacity=' + (L4.style.opacity || '(未设)'))

console.log("\n=== E. ★ 复活回归：收场后触发主题变化，壁纸不许自己回来 ===")
console.log('   （这就是用户报的「淡出看到了，但动画还在后面一直 loop」）')
timeouts.length = 0
sandbox._observers.length = 0
sandbox._intervals.length = 0
sandbox.document.body.children.length = 0
sandbox._styleTags.length = 0
mod.__applyNow(cfg)                      // ★ 走【真实入口】—— current 是在这里设的
mod.__mountLayer(cfg)                    // cw-14 起 applyNow 不再直接挂层（时机交给闸门）
mod.__watchTheme(cfg)                    // 装主题观察者（真实运行时由 boot() 装）
ok(sandbox._observers.length === 1, '主题观察者已装上')
ok(mod.__hasCurrent() === true, '★ 前置条件：applyNow 之后 current 非空（否则根本走不到 bug 那条路）')

const L5 = layer()
const v5 = L5.children.find((c) => c.tagName === 'video')
v5.duration = 7.0417
v5.currentTime = 7.0417
v5.fire('timeupdate')
runTimeouts()                            // 淡出结束 → teardown()
ok(!layer(), '先确认：已经收场了（层没了）')
ok(mod.__hasCurrent() === false, '★ 收场后 current 被清空')

// DSH 一直在改 html/body 的属性 —— 模拟一次属性变化
fireMutation()
ok(!layer(), '★★ 属性变化后壁纸【没有】被复活（bug 就在这一条）')
ok(mod.__hasCurrent() === false, 'current 仍然是空的')

fireMutation()
fireMutation()
ok(!layer(), '连触发三次也不会回来')

console.log("\n=== E2. ★ 有底图的情形：开场演完后，主题变化也不许把视频复活 ===")
console.log('   （cw-15 的 bug：有底图 → 不 teardown → current 还留着 → 观察者复活视频 → 无限循环）')
timeouts.length = 0
sandbox._observers.length = 0
sandbox._intervals.length = 0
sandbox.document.body.children.length = 0
sandbox._styleTags.length = 0
sandbox.__overlay = null
const cfgImg = { ...cfg, __imageOk: true, placement: 'front' }
/* ★ 走**真实路径**：applyNow 装上闸门 → 等闸门开（3s 宽限）→ 它自己把层挂上。
   不能手动 __mountLayer —— 那样闸门还停在 waiting，之后它照样会去挂，测试会误报。 */
mod.__applyNow(cfgImg)
tickTimers(70)
ok(!!layer(), '闸门打开后视频层在（真实路径）')
mod.__watchTheme(cfgImg)
const v6 = layer().children.find((c) => c.tagName === 'video')
v6.duration = 7.0417
v6.currentTime = 7.0417
v6.fire('timeupdate')
runTimeouts()
ok(!layer(), '★ 视频层被移除（开场演完了）')
ok(!!sandbox.document.getElementById('dsh-cw-bg'), '★ 底图留着（正确行为）')
ok(mod.__hasCurrent() === true, 'current 仍非空（有底图所以没 teardown）—— 这正是 bug 的前提')
fireMutation()
tickTimers(70)
ok(!layer(), '★★ 主题变化后视频【没有】被复活（cw-15 那个"动画还在继续"）')
fireMutation()
fireMutation()
tickTimers(70)
ok(!layer(), '连触发三次也不会回来')
ok(!!sandbox.document.getElementById('dsh-cw-bg'), '底图始终在')

console.log("\n=== F. front 模式：全屏盖在最前、不动外壳、**绝不吞点击** ===")
const cssFront = mod.__buildCss({ ...cfg, placement: 'front' })
ok(cssFront.includes('z-index: 2147482990'),
  '★ front → z-index 2147482990（**比开机动画的 2147483000 低 10**）')
ok(!cssFront.includes('z-index: 2147483000'),
  '★ 绝不和开机动画同级 —— 同级由 DOM 顺序决定谁在上，可能压住开机动画（真踩到过）')
ok(cssFront.includes('background: #000'), 'front → 不透明底（不让聊天内容透出来）')
const frontBlock = cssFront.split('z-index: 2147482990')[1] || ''
ok(frontBlock.includes('pointer-events: none'),
  '★ front 层 pointer-events:none —— 绝不吞点击（"点一下才播动画"那个 bug 的根因）')
ok(!cssFront.includes('cursor: pointer'), 'front 层不再假装可点（"点击跳过"已删掉）')
ok(!cssFront.includes('--dsw-alias-bg-base: transparent'),
  '★ front + 没图 → 【不动外壳变量】—— 动了的话视频播完聊天界面会变透明')
const cssBehind = mod.__buildCss({ ...cfg, placement: 'behind' })
ok(cssBehind.includes('--dsw-alias-bg-base: transparent'), 'behind → 外壳让开（要能看见后面的视频）')
ok(cssBehind.includes('z-index: -1'), 'behind → z-index -1（在正常流内容之下）')
const cssFrontImg = mod.__buildCss({ ...cfg, placement: 'front', __imageOk: true })
ok(cssFrontImg.includes('--dsw-alias-bg-base: transparent'), 'front + 有底图 → 外壳仍然让开（聊天要落在底图上）')

// front + loop 必须强制当 once：全屏循环 = 永久盖住界面
timeouts.length = 0
sandbox.document.body.children.length = 0
sandbox._styleTags.length = 0
mod.__applyNow({ ...cfg, placement: 'front', mode: 'loop' })
mod.__mountLayer({ ...cfg, placement: 'front', mode: 'loop' })
const vF = layer().children.find((c) => c.tagName === 'video')
ok(vF.loop === false, '★ front + loop → 仍然关掉原生 loop（不然会永久盖住聊天界面）')

// ★ 关键回归：点全屏层不该有任何反应
layer().fire('click')
ok(layer().style.opacity !== '0',
  '★★ 点它【不会】触发跳过 —— 全屏层不再吃用户的点击（这就是你刚报的 bug）')

console.log("\n=== H. 大字横幅：视频演完进聊天，一眼看到铺满窗口的那行字 ===")
timeouts.length = 0
sandbox._intervals.length = 0
sandbox.document.body.children.length = 0
sandbox._styleTags.length = 0
const cfgB = { ...cfg, banner: '人类与AI的日常', bannerOpacity: 0.15 }
mod.__applyNow(cfgB)
const bEl = sandbox.document.getElementById('dsh-cw-banner')
ok(!!bEl, '★ 挂了横幅层 #dsh-cw-banner')
const bSpan = bEl && bEl.children[0]
ok(bSpan && bSpan.textContent === '人类与AI的日常', '文字正确', bSpan && bSpan.textContent)
ok(bEl.style._v['--cw-banner-a'] === '0.15', '★ 浓度通过 CSS 变量传下去', bEl.style._v['--cw-banner-a'])
ok(bSpan.style.fontSize !== undefined && bSpan.style.fontSize !== '', '★ 插进 DOM 后自动量过字号', bSpan.style.fontSize)

const cssB = mod.__buildCss(cfgB)
ok(cssB.includes('#dsh-cw-banner'), 'CSS 里有横幅规则')
const bannerBlock = cssB.split('#dsh-cw-banner')[1] || ''
ok(bannerBlock.includes('z-index: -1'),
  '★★ 横幅 z-index:-1 —— 在底图之上、聊天内容之下（不挡聊天）')
ok(cssB.includes('--dsw-alias-bg-base: transparent'),
  '★★ 有横幅 → 外壳让开（否则大字被外壳底色挡住，白做）')
ok(cssB.includes('white-space: nowrap'), '不换行（一行铺满）')
ok(/#dsh-cw-banner > span[\s\S]*?font-weight: 800/.test(cssB) || /font-weight: 800/.test(cssB),
  '加粗（大字要够分量）')

/* 改文字：只更新，不重建（避免闪烁）*/
const sameEl = mod.__mountBanner({ ...cfgB, banner: '换个字' })
ok(sameEl === bEl, '★ 改文字时复用同一个元素（不重建）')
ok(bSpan.textContent === '换个字', '文字更新了')

/* 清空 → 移除 */
mod.__applyNow({ ...cfg, banner: '' })
ok(!sandbox.document.getElementById('dsh-cw-banner'), '★ 清空文字 → 横幅层被移除')

console.log(`\n${fails === 0 ? '✓ 全部通过' : `✗ ${fails} 项失败`}\n`)
process.exit(fails === 0 ? 0 : 1)
