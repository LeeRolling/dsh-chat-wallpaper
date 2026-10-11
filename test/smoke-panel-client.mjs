import { fileURLToPath } from 'node:url'
// 设置面板测试：挂载、开合、列图、以及"面板不被壁纸收场带走"这个不变量
import fs from 'node:fs'
import vm from 'node:vm'

const FILE = process.argv[2] || fileURLToPath(new URL('../lib/client.js', import.meta.url))
const code = fs.readFileSync(FILE, 'utf8')

let captured = null
const fetched = []

/* ── 一个够用的 DOM 桩（递归 querySelector + 能用的 classList）── */
function mkEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), id: '', name: '', value: '', checked: false,
    textContent: '', title: '', alt: '', src: '', type: '', min: '', max: '', step: '',
    style: { setProperty() {}, removeProperty() {} },
    dataset: {}, children: [], parentNode: null, _cls: new Set(), _handlers: {},
    /* video 相关：这个桩本来只为面板写，加了「重播开场」之后需要用 video 的能力 */
    currentTime: 0, duration: 7.0417, paused: true, readyState: 4, playCalls: 0,
    play() { el.playCalls++; el.paused = false; return Promise.resolve() },
    pause() { el.paused = true },
    load() {},
    removeAttribute() {},
    get className() { return [...el._cls].join(' ') },
    set className(v) { el._cls = new Set(String(v || '').split(/\s+/).filter(Boolean)) },
    get firstChild() { return el.children[0] || null },
    classList: {
      add(...c) { c.forEach((x) => el._cls.add(x)) },
      remove(...c) { c.forEach((x) => el._cls.delete(x)) },
      contains(c) { return el._cls.has(c) },
      toggle(c) { el._cls.has(c) ? el._cls.delete(c) : el._cls.add(c) },
    },
    setAttribute() {}, removeAttribute() {},
    addEventListener(t, fn) { (el._handlers[t] = el._handlers[t] || []).push(fn) },
    fire(t) { (el._handlers[t] || []).forEach((fn) => fn({ type: t, target: el })) },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c },
    insertBefore(c) { c.parentNode = el; el.children.unshift(c); return c },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c },
    remove() { if (el.parentNode) el.parentNode.removeChild(el) },
    querySelector(sel) { return findAll(el, sel)[0] || null },
    querySelectorAll(sel) { return findAll(el, sel) },
  }
  return el
}

function matches(node, sel) {
  if (sel.startsWith('.')) return node._cls.has(sel.slice(1))
  if (sel.startsWith('#')) return node.id === sel.slice(1)
  const attr = /^(\w+)\[name="([^"]+)"\]$/.exec(sel)
  if (attr) return node.tagName === attr[1].toUpperCase() && node.name === attr[2]
  return node.tagName === sel.toUpperCase()
}
function findAll(root, sel) {
  const out = []
  const walk = (n) => { for (const c of n.children) { if (matches(c, sel)) out.push(c); walk(c) } }
  walk(root)
  return out
}

const sandbox = {
  window: { __ModuleLoader__: { load(o) { captured = o } } },
  console,
  _tags: [],
  document: {
    documentElement: { attributes: [], classList: { add() {}, remove() {} } },
    head: null, body: null,
    createElement(t) { return mkEl(t) },
    getElementById(id) { return findAll(sandbox.document.body, '#' + id)[0] || null },
    querySelector(sel) {
      const m = /data-plugin-css="([^"]+)"/.exec(sel)
      if (!m) return null
      /* 从 head.children 里找（而不是另存一份数组）——
         这样 style 标签被 remove() 之后这里也真的找不到了 */
      return sandbox.document.head.children.find((t) => t.dataset.pluginCss === m[1]) || null
    },
    addEventListener() {},
  },
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  getComputedStyle: () => ({ backgroundColor: 'rgb(20, 22, 28)' }),   // 深色
  MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {} },
  requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
  fetch(url, opts) {
    fetched.push({ url: String(url), opts })
    const canned = (body) => Promise.resolve({ json: () => Promise.resolve(body) })
    if (String(url).includes('/images')) {
      return canned({
        ok: true, dropDir: 'C:/Users/example/.dsh/chat-wallpaper', dropDirExists: true,
        mode: 'once', placement: 'front',
        current: 'C:/Users/example/.dsh/chat-wallpaper/我的背景.jpg',
        images: [
          { name: '我的背景.jpg', url: '/chat-wallpaper/image?name=%E6%88%91', sizeKB: 820, mtime: '2026-10-11 20:00:00' },
          { name: 'cyberpunk.png', url: '/chat-wallpaper/image?name=cyberpunk.png', sizeKB: 1400, mtime: '2026-10-11 19:00:00' },
        ],
        veil: { light: 0.8, dark: 0.5 },
      })
    }
    if (String(url).includes('/config')) {
      return canned({ ok: true, source: 'your-library', file: 'x.mp4', loopStartSec: null, loopEndSec: null, imageOk: true, image: 'y.jpg', config: { mode: 'once' } })
    }
    if (String(url).includes('/set')) return canned({ ok: true, applied: {} })
    return canned({ ok: true })
  },
}
sandbox.document.head = mkEl('head')
sandbox.document.body = mkEl('body')

vm.createContext(sandbox)
vm.runInContext(code, sandbox, { filename: 'client.js' })
const mod = captured.factory(() => { throw new Error('unexpected require') })

let fails = 0
const ok = (cond, label, extra) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
  if (!cond) fails++
}
const flush = () => new Promise((r) => setImmediate(r))
const panel = () => sandbox.document.getElementById('dsh-cw-panel')

console.log('=== A. 挂载 ===')
mod.__mountPanel()
const P = panel()
ok(!!P, '创建了 #dsh-cw-panel')
ok(P.children.some((c) => c._cls.has('cw-fab')), '有「🖼 背景」按钮（.cw-fab）')
const fab = P.children.find((c) => c._cls.has('cw-fab'))
ok(!!fab && fab.textContent.includes('背景'), '按钮上写了「背景」—— 人类看得懂这是什么', fab && JSON.stringify(fab.textContent))
ok(P.children.some((c) => c._cls.has('cw-panel')), '有设置面板本体（.cw-panel）')

console.log('\n=== B. 面板 CSS 与壁纸 CSS 是两个标签（收场不会带走面板）===')
const cssIds = () => sandbox.document.head.children.map((t) => t.dataset.pluginCss)
ok(cssIds().includes('dsh-chat-wallpaper/panel.css'), '面板 CSS 已注入')
ok(cssIds().includes('dsh-chat-wallpaper/main.css') === false, '此时还没注壁纸 CSS（只有面板）')
mod.__applyNow({ mode: 'once', objectFit: 'cover', opacity: 1, playbackRate: 1, veilDarkA: 'rgba(8,10,16,.5)', veilDarkB: 'rgba(6,8,14,.38)', veilLightA: 'rgba(253,250,254,.8)', veilLightB: 'rgba(250,247,253,.68)', sidebarDark: 'rgba(22,24,32,.74)', sidebarLight: 'rgba(255,255,255,.78)', fallbackDark: '#0b0d12', fallbackLight: '#f7f1f8' })
ok(cssIds().includes('dsh-chat-wallpaper/main.css'), '壁纸 CSS 也注上了')
mod.__teardown()
ok(!cssIds().includes('dsh-chat-wallpaper/main.css'), '壁纸收场 → 壁纸 CSS 被撤')
ok(cssIds().includes('dsh-chat-wallpaper/panel.css'), '★ 面板 CSS 还在（面板不会被壁纸带走）')
ok(!!panel(), '★ 面板元素也还在')

console.log('\n=== C. 点一下按钮 → 展开并列出图片 ===')
fetched.length = 0
fab.fire('click')
ok(P._cls.has('cw-open'), '面板展开（.cw-open）')
return_flush().then(async () => {
  await flush()
  const imagesReq = fetched.find((f) => f.url.includes('/images'))
  ok(!!imagesReq, '拉取了 /chat-wallpaper/images')

  const grid = P.querySelector('.cw-grid')
  const thumbs = grid ? grid.children.filter((c) => c._cls.has('cw-thumb')) : []
  ok(thumbs.length === 2, '★ 列出了 2 张图', `实际 ${thumbs.length}`)
  ok(thumbs.filter((t) => t._cls.has('cw-sel')).length === 1, '★ 当前生效的那张有选中标记（.cw-sel）')

  const cur = P.querySelector('.cw-cur')
  ok(!!cur && cur.textContent.includes('我的背景.jpg'), '显示当前背景文件名', cur && cur.textContent)

  const veilVal = P.querySelector('.cw-veil-val')
  ok(!!veilVal && veilVal.textContent === '50%', '★ 深色主题下纱的滑块显示 50%（不是浅色的 80%）', veilVal && veilVal.textContent)

  const radios = P.querySelectorAll('input[name="cw-mode"]')
  ok(radios.length === 2, '模式单选有 2 个')
  ok(radios.some((r) => r.value === 'once/front' && r.checked),
    '★ 当前是「全屏开场」→ 对应单选被勾上',
    radios.map((r) => r.value + (r.checked ? '(勾)' : '')).join(' '))

  console.log('\n=== D. 录屏友好：「重播开场」按钮存在且能工作 ===')
  const acts = P.querySelectorAll('.cw-act')
  ok(acts.some((b) => String(b.textContent).includes('重播开场')),
    '★ 面板里有「🔁 重播开场」按钮（录视频不用重启 DSH）',
    acts.map((b) => b.textContent).join(' | '))
  const replayBtn = acts.find((b) => String(b.textContent).includes('重播开场'))

  // 先播一轮，再收场，然后点重播 —— 模拟"开机动画早就过去了，我要重拍"
  sandbox.__overlay = null
  const cfg2 = {
    mode: 'once', placement: 'front', objectFit: 'cover', opacity: 1, playbackRate: 1,
    veilDarkA: 'rgba(8,10,16,.5)', veilDarkB: 'rgba(6,8,14,.38)',
    veilLightA: 'rgba(253,250,254,.8)', veilLightB: 'rgba(250,247,253,.68)',
    sidebarDark: 'rgba(22,24,32,.74)', sidebarLight: 'rgba(255,255,255,.78)',
    fallbackDark: '#0b0d12', fallbackLight: '#f7f1f8',
  }
  mod.__applyNow(cfg2)
  mod.__beginIntro(cfg2, '测试第一轮', false)     // 直接挂上（这个桩没有可控定时器）
  ok(!!sandbox.document.getElementById('dsh-chat-wallpaper'), '第一轮：开场已挂上')
  mod.__teardown()
  ok(!sandbox.document.getElementById('dsh-chat-wallpaper'), '模拟"已经收场了"（层被撤掉）')

  replayBtn.fire('click')
  ok(!P._cls.has('cw-open'), '★ 点重播后自动收起面板（不挡镜头）')
  ok(!!sandbox.document.getElementById('dsh-chat-wallpaper'),
    '★★ 点一下 → 开场【立刻重播】（不用重启 DSH，录视频能拍无数条）')

  console.log(`\n${fails === 0 ? '✓ 全部通过' : `✗ ${fails} 项失败`}\n`)
  process.exit(fails === 0 ? 0 : 1)
})

function return_flush() { return Promise.resolve() }
