import { fileURLToPath } from 'node:url'
// 回归测试：挂载必须幂等
//
// 针对的真实 bug：鼠标点一下窗口，背景视频闪一下然后从头重播。
// 原因是 mountLayer() 原先"先删再建" —— 只要它被调用第二次，视频元素就被重建，
// 表现就是黑一下 + 从 0 开始。
//
// 这个测试直接数"创建了几个 <video>"：
//   调一次 → 1 个
//   再调一次 → 仍然是 1 个（第二次必须走提前返回）
import fs from 'node:fs'
import vm from 'node:vm'

const FILE = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const code = fs.readFileSync(FILE, 'utf8')

let captured = null
let videoCreated = 0
let rootCreated = 0

function mkEl(tag) {
  const el = {
    tagName: tag, id: '', className: '', dataset: {}, style: {}, attributes: [],
    children: [], removed: false, src: '', muted: false, loop: false, autoplay: false,
    playsInline: false, preload: '', playbackRate: 1, currentTime: 0, duration: 7.04,
    videoWidth: 2560, videoHeight: 1440, error: null, readyState: 4,
    setAttribute() {}, removeAttribute() {}, pause() {}, load() {},
    _handlers: {},
    /* 记录事件处理器，测试里可以主动 fire —— 循环逻辑就靠这个验证 */
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn) },
    fire(type) { (this._handlers[type] || []).forEach((fn) => fn({ type })) },
    play() { this.paused = false; this.fire('play'); return Promise.resolve() },
    appendChild(c) { this.children.push(c); return c },
    remove() { this.removed = true; const i = sandbox.document.body.children.indexOf(this); if (i >= 0) sandbox.document.body.children.splice(i, 1) },
    insertBefore(node) { sandbox.document.body.children.unshift(node); return node },
    /* 注意：必须支持**标签选择器**（插件里用的是 querySelector('video')）。
       第一版测试桩只处理 .class / #id，导致提前返回永远不触发 ——
       表现是"测试失败"，但其实是**测试桩**的锅，不是插件的锅。 */
    querySelector(sel) {
      return this.children.find((c) =>
        sel.startsWith('.') ? '.' + c.className === sel
          : sel.startsWith('#') ? '#' + c.id === sel
            : c.tagName === sel
      ) || null
    },
    querySelectorAll() { return [] },
  }
  return el
}

const sandbox = {
  window: { __ModuleLoader__: { load(o) { captured = o } } },
  console,
  document: {
    documentElement: mkEl('html'),
    head: mkEl('head'),
    body: mkEl('body'),
    createElement(t) { if (t === 'video') videoCreated++; return mkEl(t) },
    getElementById(id) {
      const found = sandbox.document.body.children.find((c) => c.id === id)
      return found || null
    },
    querySelector() { return null },
    addEventListener() {},
  },
  getComputedStyle: () => ({ backgroundColor: 'rgb(247, 241, 248)' }),
  MutationObserver: function () { this.observe = () => {} },
  /* 循环驱动用 rAF；测试里当无事发生（判定走 timeupdate 那条路） */
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
  /* vm 沙箱默认没有定时器：backToLoop 用 setTimeout 防抖，
     startWhenFree 用 setInterval 轮询开机浮层 —— 这个测试里都当无事发生
     （起始时机单独由 smoke-start.mjs 用可控定时器测） */
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  fetch: () => Promise.reject(new Error('no network in test')),
}
vm.createContext(sandbox)
vm.runInContext(code, sandbox, { filename: 'client.js' })

let fails = 0
const ok = (cond, label, extra) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
  if (!cond) fails++
}

const cfg = {
  objectFit: 'cover', opacity: 1, playbackRate: 1,
  veilLightA: 'rgba(253,250,254,.80)', veilLightB: 'rgba(250,247,253,.68)',
  sidebarLight: 'rgba(255,255,255,.78)', fallbackLight: '#f7f1f8',
  veilDarkA: 'rgba(8,10,16,.74)', veilDarkB: 'rgba(6,8,14,.62)',
  sidebarDark: 'rgba(22,24,32,.74)', fallbackDark: '#0b0d12',
}

const mod = captured.factory(() => { throw new Error('unexpected require') })
console.log('=== 挂载幂等性（这就是"闪一下 + 重播"的回归测试）===')

mod.__mountLayer(cfg)
const afterFirst = videoCreated
const rootAfterFirst = sandbox.document.body.children.filter((c) => c.id === 'dsh-chat-wallpaper').length
ok(afterFirst === 1, '第一次挂载创建了 1 个 <video>', `实际 ${afterFirst}`)
ok(rootAfterFirst === 1, 'DOM 里只有 1 个视频层', `实际 ${rootAfterFirst}`)
ok(mod.__mountCount() === 1, '挂载计数 = 1', `实际 ${mod.__mountCount()}`)

const v1 = sandbox.document.getElementById('dsh-chat-wallpaper').children[0]

// ★ 关键：第二次调用必须提前返回，不许重建
mod.__mountLayer(cfg)
ok(videoCreated === 1, '第二次挂载【没有】创建新 <video>（修复生效）', `实际 ${videoCreated}`)
ok(mod.__mountCount() === 1, '挂载计数仍是 1（走的是提前返回）', `实际 ${mod.__mountCount()}`)
const v2 = sandbox.document.getElementById('dsh-chat-wallpaper').children[0]
ok(v1 === v2, '视频元素是【同一个对象】—— 不会被重建 → 不会闪、不会重播')

// 第三次，防抖
mod.__mountLayer(cfg)
mod.__mountLayer(cfg)
ok(videoCreated === 1, '再调两次仍然只有 1 个 <video>', `实际 ${videoCreated}`)

// 半残状态（有壳没视频）应该能恢复
console.log('\n=== 半残状态恢复（有壳没 video 时应该重新塞回 video）===')
sandbox.document.getElementById('dsh-chat-wallpaper').children = []
mod.__mountLayer(cfg)
const rebuilt = sandbox.document.getElementById('dsh-chat-wallpaper')
ok(!!rebuilt && rebuilt.children.some((c) => c.tagName === 'video'),
  '壳还在但视频没了 → 重新塞回 video（cw-15 起复用预加载元素，不再新建）')
ok(rebuilt.children.filter((c) => c.tagName === 'video').length === 1, '只有一个 video，不会塞重复')

console.log(`\n=== 循环区间（loopStart 驱动）===`)
const DUR = 169 / 24                       // 7.0417s，169 帧 @24fps
const LOOP_FROM = 5 + 23 / 24              // 00:00:05:23 = 5.9583s

// 清掉现有的才能挂新层（挂载现在是幂等的）
sandbox.document.body.children.length = 0
mod.__mountLayer({ ...cfg, mode: 'loop', loopStartSec: LOOP_FROM })
const vLoop = sandbox.document.getElementById('dsh-chat-wallpaper').children[0]
ok(vLoop.loop === false, '设了 loopStart → 关掉原生 loop（否则会跳回 0，白搭）', 'loop=' + vLoop.loop)

vLoop.duration = DUR
vLoop.currentTime = DUR                    // 模拟播到结尾
vLoop.fire('timeupdate')
ok(Math.abs(vLoop.currentTime - LOOP_FROM) < 1e-9,
  '播到结尾 → 跳回 loopStart（而不是 0）', 'currentTime=' + vLoop.currentTime.toFixed(4))

// 只播到一半不该跳
sandbox.document.body.children.length = 0
mod.__mountLayer({ ...cfg, mode: 'loop', loopStartSec: LOOP_FROM })
const vMid = sandbox.document.getElementById('dsh-chat-wallpaper').children[0]
vMid.duration = DUR
vMid.currentTime = 3
vMid.fire('timeupdate')
ok(vMid.currentTime === 3, '播到一半 → 不跳', 'currentTime=' + vMid.currentTime)

// mode='loop' → 原生整段循环；没设 mode（默认 once）→ 不循环，要能自然走完触发淡出
sandbox.document.body.children.length = 0
mod.__mountLayer({ ...cfg, mode: 'loop' })
const vPlain = sandbox.document.getElementById('dsh-chat-wallpaper').children[0]
ok(vPlain.loop === true, "mode='loop' 且没设 loopStart → 保持原生整段循环", 'loop=' + vPlain.loop)

sandbox.document.body.children.length = 0
mod.__mountLayer(cfg)
const vOnce = sandbox.document.getElementById('dsh-chat-wallpaper').children[0]
ok(vOnce.loop === false, '没设 mode → 默认 once，必须关掉 loop（否则 ended 不触发，淡出不了）', 'loop=' + vOnce.loop)

console.log(`\n${fails === 0 ? '✓ 全部通过' : `✗ ${fails} 项失败`}\n`)
process.exit(fails === 0 ? 0 : 1)
