import { fileURLToPath } from 'node:url'
// 起始时机测试（cw-14 改版后）
//
// 设计变了：**开机动画期间根本不挂视频层** —— 只在"到点了"那一刻挂上并开播。
// 所以这里观察的不是"传进去的假 video 有没有 play"，而是"层有没有出现 + video 有没有开播"。
//
// 用可控定时器，不真等 20 秒。
import fs from 'node:fs'
import vm from 'node:vm'

const FILE = process.argv[2] || fileURLToPath(new URL('../lib/client.js', import.meta.url))
const code = fs.readFileSync(FILE, 'utf8')

let captured = null
const timers = []

function mkEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), id: '', className: '', dataset: {}, style: {},
    children: [], parentNode: null, currentTime: 99, duration: 7.0417, paused: true, playCalls: 0,
    readyState: 4,
    loop: false, muted: false, autoplay: false, playsInline: false, preload: '', src: '', error: null,
    _handlers: {},
    setAttribute() {}, removeAttribute() {}, load() {},
    addEventListener(t, fn) { (el._handlers[t] = el._handlers[t] || []).push(fn) },
    fire(t) { (el._handlers[t] || []).forEach((fn) => fn({ type: t })) },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c },
    insertBefore(c) { c.parentNode = el; el.children.unshift(c); return c },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c },
    remove() { if (el.parentNode) el.parentNode.removeChild(el) },
    querySelector(sel) {
      return el.children.find((c) =>
        sel.startsWith('.') ? '.' + c.className === sel
          : sel.startsWith('#') ? '#' + c.id === sel
            : c.tagName === String(sel).toUpperCase()) || null
    },
    querySelectorAll() { return [] },
    pause() { el.paused = true },
    play() { el.playCalls++; el.paused = false; return Promise.resolve() },
  }
  return el
}

const sandbox = {
  window: { __ModuleLoader__: { load(o) { captured = o } } },
  console,
  __overlay: null,
  createdVideos: [],
  document: {
    documentElement: { attributes: [], classList: { add() {}, remove() {} } },
    head: mkEl('head'), body: mkEl('body'),
    createElement(t) { const e = mkEl(t); if (String(t) === 'video') sandbox.createdVideos.push(e); return e },
    getElementById(id) { return sandbox.document.body.children.find((c) => c.id === id) || null },
    querySelector(sel) { return sel === '#dsh-startup-root' ? sandbox.__overlay : null },
    addEventListener() {},
  },
  setTimeout: () => 0, clearTimeout: () => {},
  setInterval(fn, ms) { timers.push({ fn, ms, cleared: false, id: timers.length + 1 }); return timers.length },
  clearInterval(id) { const t = timers.find((x) => x.id === id); if (t) t.cleared = true },
  getComputedStyle: () => ({ backgroundColor: 'rgb(247, 241, 248)' }),
  MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {} },
  requestAnimationFrame: (fn) => { if (fn) fn(); return 1 },
  cancelAnimationFrame: () => {},
  fetch: () => Promise.reject(new Error('no network')),
}

function tick(n = 1) { for (let i = 0; i < n; i++) for (const t of timers) if (!t.cleared) t.fn() }
function reset() {
  timers.length = 0
  sandbox.createdVideos.length = 0
  sandbox.document.body.children.length = 0
  /* preloaded 是模块级缓存，跨场景会留着 —— 用 teardown 清掉它，
     否则后面的场景复用它、createdVideos 里就没有新元素了 */
  try { mod.__teardown() } catch (e) { /* 第一次调用时 mod 还没赋值 */ }
}
/**
 * 造一个开机浮层。
 *   overlay(true)                  → 正在播（没有任何"离场 class"）
 *   overlay(false)                 → 已收场（dsu-gone）
 *   overlay(false, 'dsu-handoff')  → ★ 刚开始收场（它这一步就开始淡了）
 */
function overlay(present, leaveClass) {
  const cls = present ? [] : [leaveClass || 'dsu-gone']
  return { classList: { _c: new Set(cls), contains(c) { return this._c.has(c) } } }
}
const layerEl = () => sandbox.document.getElementById('dsh-chat-wallpaper')
const lastVideo = () => sandbox.createdVideos[sandbox.createdVideos.length - 1] || null

vm.createContext(sandbox)
vm.runInContext(code, sandbox, { filename: 'client.js' })
const mod = captured.factory(() => { throw new Error('unexpected require') })

let fails = 0
const ok = (cond, label, extra) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
  if (!cond) fails++
}

console.log('=== A. 开机动画在跑 → 【层都不该挂】（cw-14 的核心改动）===')
reset()
sandbox.__overlay = overlay(true)
mod.__startWhenFree({ placement: 'front' })
tick(5)
ok(!layerEl(), '★ 开机层还在 → 视频层根本没挂（界面完全不受影响）', layerEl() ? '竟然挂了' : '')
tick(200)
ok(!layerEl(), '★ 等了 10s 仍然没挂', layerEl() ? '竟然挂了' : '')

console.log('\n=== B. 开机动画收场 → 立刻挂上 + 开播 + 从 0 开始 ===')
sandbox.__overlay = overlay(false)
tick(1)
ok(!!layerEl(), '★ 收场后立刻挂上层')
ok(layerEl().style.transition === 'none',
  '★★ 交叉叠化：见过开机层 → 我【不】自己淡入（让它的 620ms 淡出来叠化我）')
ok(layerEl().style.opacity === '1', '★★ 直接满不透明待在下面（中间不会露出聊天窗口）')
const v = lastVideo()
ok(!!v && v.playCalls === 1, '★ 开播了一次', v ? 'playCalls=' + v.playCalls : '没有 video')
ok(!!v && v.currentTime === 0, '★ currentTime 归零（片头从头放）', v ? 'currentTime=' + v.currentTime : '')
tick(20)
ok(lastVideo().playCalls === 1, '只开播一次，不重复 play')

console.log('\n=== B2. ★ 开机动画【刚开始收场】(dsu-handoff) → 必须立刻上场（比 dsu-gone 早 780ms）===')
reset()
sandbox.__overlay = overlay(true)
mod.__startWhenFree({ placement: 'front' })
tick(4)
ok(!layerEl(), '还在播 → 不挂')
sandbox.__overlay = overlay(false, 'dsu-handoff')     // ★ 它在这一步就开始淡出（780ms）
tick(1)
ok(!!layerEl(), '★★ 一看到 dsu-handoff 就立刻挂上（旧代码要等 dsu-gone，晚 780ms → 闪屏）')
ok(layerEl().style.transition === 'none', '★★ 且直接满不透明 → 它的 780ms 淡出就是叠化')
ok(layerEl().style.opacity === '1', '满不透明待在它下面')

console.log('\n=== C. 根本没装开机动画（宽限期后挂上）===')
reset()
sandbox.__overlay = null
mod.__startWhenFree({ placement: 'front' })
tick(20)
ok(!layerEl(), '宽限期内先等（开机层可能还没来得及插进 DOM）')
tick(45)
ok(!!layerEl(), '3 秒后确认没有开机动画 → 挂上并开播')
ok(String(layerEl().style.transition).includes('300ms'),
  '★ 没见过开机层 → 自己来一个短淡入（否则会凭空冒出来）')
ok(lastVideo().currentTime === 0, '同样从头播')

console.log('\n=== C2. 开机层【晚出现】—— 真实踩到的那个 bug ===')
reset()
sandbox.__overlay = null
mod.__startWhenFree({ placement: 'front' })
tick(6)
ok(!layerEl(), '还没挂')
sandbox.__overlay = overlay(true)
tick(4)
ok(!layerEl(), '★ 开机层出现后仍然不挂（旧代码此时已经在放了）')
tick(400)
ok(!layerEl(), '开机动画跑 20s 期间一直不挂')
sandbox.__overlay = overlay(false)
tick(1)
ok(!!layerEl(), '★ 收场后立刻挂上')
ok(lastVideo().currentTime === 0, '★ 从 0 开始（片头能看见了）')

console.log('\n=== C3. 已经放了，开机层才出现 → 应该把层撤掉等 ===')
reset()
sandbox.__overlay = null
mod.__startWhenFree({ placement: 'front' })
tick(61)
ok(!!layerEl(), '先挂上开播了')
sandbox.__overlay = overlay(true)
tick(2)
ok(!layerEl(), '★ 检测到开机层 → 把视频层撤掉（等它收场再说）')
sandbox.__overlay = overlay(false)
tick(1)
ok(!!layerEl(), '★ 收场后重新挂上')

console.log('\n=== D. waitForBoot=false（立刻挂）===')
reset()
sandbox.__overlay = overlay(true)
mod.__startWhenFree({ placement: 'front', waitForBoot: false })
ok(!!layerEl(), '显式关掉等待 → 立即挂上')
ok(lastVideo().currentTime === 0, '从 0 开始')

console.log('\n=== E. 空选择器 = 没有浮层要等 ===')
reset()
sandbox.__overlay = overlay(true)
mod.__startWhenFree({ placement: 'front', bootOverlaySelectors: [] })
ok(!!layerEl(), '选择器为空 → 不等，直接挂')

console.log('\n=== F. bootOverlayPresent 判定细节（**只看 class，不看尺寸**）===')
sandbox.__overlay = overlay(true)
ok(mod.__bootOverlayPresent(['#dsh-startup-root']) === true, '存在 + 没有离场 class → 在挡着')
sandbox.__overlay = { classList: { contains: () => false }, getBoundingClientRect: () => ({ width: 0, height: 0 }) }
ok(mod.__bootOverlayPresent(['#dsh-startup-root']) === true,
  '★ 零尺寸但没离场 class → 仍算【在】—— 旧代码"看尺寸"踩的坑')
sandbox.__overlay = overlay(false, 'dsu-handoff')
ok(mod.__bootOverlayPresent(['#dsh-startup-root']) === false,
  '★★ 有 dsu-handoff → 已在收场路上（它这一步就开始淡了，必须马上上场）')
sandbox.__overlay = overlay(false)
ok(mod.__bootOverlayPresent(['#dsh-startup-root']) === false, '有 dsu-gone → 已收场')
ok(mod.__bootOverlayPresent(['#dsh-startup-root'], ['我的离场class']) === true,
  '可配置：换成不认识的离场 class → 仍算在挡着（换别的开机动画插件时用）')
sandbox.__overlay = null
ok(mod.__bootOverlayPresent(['#dsh-startup-root']) === false, '元素不存在 → 已收场')
ok(mod.__bootOverlayPresent([]) === false, '空选择器 → 已收场')
sandbox.__overlay = { classList: null }
ok(mod.__bootOverlayPresent(['#dsh-startup-root']) === true, '没有 classList 也不炸 → 保守当作在')

console.log('\n=== G. 预加载：元素建好但**不插进 DOM**（所以绝不挡界面）===')
reset()
const pv = mod.__preloadVideo({ placement: 'front' })
ok(!!pv, '预加载返回了 video 元素')
ok(pv.src.includes('/chat-wallpaper/video'), 'src 已设好（开始 load）')
ok(sandbox.document.body.children.length === 0, '★ 预加载的元素**没有**插进 DOM —— 界面完全不受影响')
ok(!layerEl(), '★ 此刻没有视频层')

console.log('\n=== G2. 到点后用的是**同一个**预加载元素（首帧已就绪）===')
sandbox.__overlay = overlay(false)
mod.__startWhenFree({ placement: 'front' })
tick(70)   // 没有开机层 → 要等满 GRACE_MS(3s=60 tick) 才会开播
ok(!!layerEl(), '层挂上了')
ok(lastVideo() === pv, '★ 用的就是刚才预加载的那个元素（不是新建的）—— 所以插入即就绪')
ok(pv.currentTime === 0, 'readyState>=1 → currentTime 被安全归零')

console.log('\n=== G3. 元数据没就绪时不许设 currentTime（cd-14 那个 bug 的根因）===')
reset()
const v0 = mod.__preloadVideo({ placement: 'front' })
v0.readyState = 0                      // 模拟还没 loadedmetadata
v0.currentTime = 99
sandbox.__overlay = overlay(false)
mod.__beginIntro({ placement: 'front' }, '测试')
ok(lastVideo() === v0, '用的是这个元素')
ok(v0.currentTime === 99, '★ readyState=0 时**不设** currentTime（否则会卡在 seek，play 永不生效）', 'currentTime=' + v0.currentTime)

console.log(`\n${fails === 0 ? '✓ 全部通过' : `✗ ${fails} 项失败`}\n`)
process.exit(fails === 0 ? 0 : 1)
