/**
 * dsh-chat-wallpaper — browser half (浏览器半边)
 * ----------------------------------------------------------------------------
 * 以 dsh.client bundle 格式加载（手写 ModuleLoader bundle，无需构建）。
 * 注册 id 必须等于 loader entry 名（dsh-chat-wallpaper）。
 *
 * 做四件事：
 *   1. 把 DSH 外壳底色变量改成透明 —— 这是"背景而不覆盖"的全部秘密。
 *      只动 --dsw-alias-bg-base 和 --dsw-specific-sidebar-fill；
 *      面板、卡片、代码块、下拉菜单用的都是**别的**变量，一律保持不透明，
 *      所以文字永远落在实心底上，可读性一点不损失。
 *   2. 在最底层（z-index:-1）放一个循环播放的静音 <video>，并压一层纱。
 *      浅色主题压白纱、深色主题压深纱。
 *   3. 循环区间：第一次从头播完，之后只在 [loopStart, loopEnd] 里循环
 *      （剪辑软件里常把片尾做成可循环段）。
 *   4. 等开机动画收场再开始播，并且**从 0 开始** —— 否则开机动画盖住的
 *      那十几秒里视频把片头放完了，用户进来只看得到循环段。
 *
 * 失败即退场：视频放不出来就把 CSS 全部撤回，页面回到原样，绝不留一个黑洞。
 */
window.__ModuleLoader__.load({
  id: 'dsh-chat-wallpaper',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var TAG_ID = 'dsh-chat-wallpaper/main.css'
    var ROOT_ID = 'dsh-chat-wallpaper'   /* 视频层（front=最前 / behind=最底）*/
    var BG_ID = 'dsh-cw-bg'              /* 聊天底图层（用户自己定的那张图 + 纱）*/
    var API = '/chat-wallpaper'
    /* 每次改客户端就把这个号 +1。
       有了它在控制台一眼就能判断"浏览器里跑的是不是最新那份" ——
       排查问题时，分不清是代码问题还是旧包，会白猜一轮。 */
    var BUILD = 'cw-18'

    function log() {
      try {
        var a = ['[chat-wallpaper]']
        for (var i = 0; i < arguments.length; i++) a.push(arguments[i])
        console.log.apply(console, a)
      } catch (e) { /* console 不可用就算了 */ }
    }

    /* ── 主题判定 ───────────────────────────────────────────────────────── */

    /** 扫 html/body 上所有属性的名字与值，以及 className，找 "dark" */
    function markerSaysDark() {
      var els = [document.documentElement, document.body]
      for (var i = 0; i < els.length; i++) {
        var el = els[i]
        if (!el) continue
        if (/dark/i.test(el.className || '')) return true
        var attrs = el.attributes || []
        for (var j = 0; j < attrs.length; j++) {
          var a = attrs[j]
          if (/dark/i.test(a.name) || /dark/i.test(String(a.value))) return true
        }
      }
      return false
    }

    /** 兜底：量一下外壳的实心底色亮度（必须在注入我们自己的 CSS 之前调用） */
    function bgLuminance() {
      try {
        var el = document.getElementById('root') || document.body
        var c = getComputedStyle(el).backgroundColor
        var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(c || '')
        if (!m) return -1
        var alpha = m[4] === undefined ? 1 : parseFloat(m[4])
        // 透明底 = 判断不了，必须返回"未知"。
        // 否则会把 rgba(0,0,0,0) 当成纯黑判成深色 —— 而我们的 CSS 恰恰把外壳变透明，
        // 于是主题一变，壁纸就自己判自己深色、把自己撤掉（自杀式回归）。
        if (!(alpha > 0)) return -1
        return (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255
      } catch (e) { return -1 }
    }

    /**
     * 主题判定。
     *
     * 亮度只在**第一次**判定时量，之后缓存 —— 因为一旦我们的 CSS 生效，
     * 外壳底色就变透明了，再量只会得到"未知"（见 bgLuminance 的注释）。
     * 之后的主题变化靠标记判定（MutationObserver 会在属性变化时重跑）。
     */
    var measuredLum = null

    function looksDark() {
      if (markerSaysDark()) return true
      if (measuredLum === null) measuredLum = bgLuminance()
      return measuredLum >= 0 && measuredLum < 0.45
    }

    /* ── CSS ─────────────────────────────────────────────────────────────── */

    /**
     * 生成注入的 CSS。
     *
     * 关键设计：**所有规则都挂在我自己写上去的 .dsh-cw-dark / .dsh-cw-light 上**，
     * 不依赖 DSH 内部的主题标记叫什么名字（那个名字我没法保证，也不该去猜）。
     * 主题由 JS 判定后写到 <html> 的 class 上，CSS 只读这个 class。
     *
     * 两处"魔法"：
     *   · --dsw-alias-bg-base: transparent   外壳让开（面板/卡片用的是别的变量，不受影响）
     *   · 视频放 z-index:-1                  它在正常流内容之下
     * 其余是可读性保险：浅色主题压白纱、深色主题压深纱。
     */
    /**
     * 生成注入的 CSS。
     *
     * **两个层彻底分开**（这是"第二幕"和"聊天底图"两件事解耦的关键）：
     *
     *   #dsh-cw-bg      聊天底图 + 纱    z-index:-1        只有用户配了图才有
     *   #dsh-chat-wallpaper  开场视频
     *        placement="front"  → z-index:2147483000（盖住一切，播完淡出）
     *        placement="behind" → z-index:-1（当常驻背景用，配合 mode=loop）
     *
     * "外壳让开"（--dsw-alias-bg-base: transparent）**只在需要看见底图时才做**：
     * 全屏开场视频自己盖住一切，不需要动外壳 —— 动了反而会在视频结束后
     * 让聊天界面变透明（如果用户没配图，那就是一片空洞）。
     *
     * 主题由 JS 判定后写到 <html> 的 class 上，CSS 只读这个 class，
     * 不去猜 DSH 内部的主题标记叫什么。
     */
    function buildCss(cfg) {
      var R = '#' + ROOT_ID
      var B = '#' + BG_ID
      var V = '.dsh-cw-veil'
      var front = cfg.placement === 'front'
      var hasImage = !!cfg.__imageOk
      var L = []

      /* ── 外壳让开：只有当"背后有东西要看"（有底图），或视频放后面时 ── */
      if (hasImage || !front) {
        L.push('/* 让开的只是 html/body 自己的底色 */')
        L.push('html.dsh-cw-light, html.dsh-cw-light body,')
        L.push('html.dsh-cw-dark, html.dsh-cw-dark body { background: transparent !important; }')
        L.push('/* 外壳让开 —— 秘密就这两个变量；侧栏按主题给半透色。')
        L.push('   面板/卡片/代码块用的是别的变量，一律不动，所以文字永远落在实心底上。 */')
        L.push('html.dsh-cw-light body {')
        L.push('  --dsw-alias-bg-base: transparent;')
        L.push('  --dsw-specific-sidebar-fill: ' + cfg.sidebarLight + ';')
        L.push('}')
        L.push('html.dsh-cw-dark body {')
        L.push('  --dsw-alias-bg-base: transparent;')
        L.push('  --dsw-specific-sidebar-fill: ' + cfg.sidebarDark + ';')
        L.push('}')
      }

      /* ── 聊天底图层（最底）── */
      if (hasImage) {
        L.push('/* 聊天底图：最底层、不拦点击 */')
        L.push(B + ' {')
        L.push('  position: fixed; inset: 0; z-index: -1;')
        L.push('  pointer-events: none; overflow: hidden;')
        L.push('}')
        L.push('html.dsh-cw-light ' + B + ' { background: ' + cfg.fallbackLight + '; }')
        L.push('html.dsh-cw-dark ' + B + ' { background: ' + cfg.fallbackDark + '; }')
        L.push(B + ' > img {')
        L.push('  position: absolute; inset: 0;')
        L.push('  width: 100%; height: 100%; display: block;')
        L.push('  object-fit: ' + (cfg.imageFit || 'cover') + '; object-position: center;')
        L.push('}')
        L.push('/* 纱：底图上的文字靠它撑对比度。浅色压白纱、深色压深纱 */')
        L.push(B + ' > ' + V + ' { position: absolute; inset: 0; }')
        L.push('html.dsh-cw-light ' + B + ' > ' + V + ' { background: linear-gradient(' + cfg.veilLightA + ', ' + cfg.veilLightB + '); }')
        L.push('html.dsh-cw-dark ' + B + ' > ' + V + ' { background: linear-gradient(' + cfg.veilDarkA + ', ' + cfg.veilDarkB + '); }')
      }

      /* ── 视频层 ── */
      if (front) {
        L.push('/* 开场视频：盖在聊天窗口最前面（第二幕）')
        L.push('   ⚠️ z-index 必须**比开机动画低一点点**：')
        L.push('      开机动画 #dsh-startup-root 是 2147483000，我用 2147482990。')
        L.push('      同级的话由 DOM 顺序决定谁在上 —— 我的层不透明，一旦压住开机动画，')
        L.push('      用户就会看到黑屏、点一下才露出开机动画（这个 bug 真踩到了）。')
        L.push('   ⚠️ pointer-events:none —— 绝不吞点击。')
        L.push('      之前加了"点击跳过"，结果全屏层把整个界面的点击都吃掉了。 */')
        L.push(R + ' {')
        L.push('  position: fixed; inset: 0; z-index: 2147482990;')
        L.push('  overflow: hidden; pointer-events: none;')
        L.push('  background: #000;')
        L.push('  opacity: ' + cfg.opacity + ';')
        L.push('}')
      } else {
        L.push('/* 常驻背景视频：最底层、不拦点击 */')
        L.push(R + ' {')
        L.push('  position: fixed; inset: 0; z-index: -1;')
        L.push('  pointer-events: none; overflow: hidden;')
        L.push('  opacity: ' + cfg.opacity + ';')
        L.push('}')
        L.push('html.dsh-cw-light ' + R + ' { background: ' + cfg.fallbackLight + '; }')
        L.push('html.dsh-cw-dark ' + R + ' { background: ' + cfg.fallbackDark + '; }')
        /* 放后面时才需要在视频上压纱（前面那层没有文字要读） */
        L.push(R + ' > ' + V + ' { position: absolute; inset: 0; }')
        L.push('html.dsh-cw-light ' + R + ' > ' + V + ' { background: linear-gradient(' + cfg.veilLightA + ', ' + cfg.veilLightB + '); }')
        L.push('html.dsh-cw-dark ' + R + ' > ' + V + ' { background: linear-gradient(' + cfg.veilDarkA + ', ' + cfg.veilDarkB + '); }')
      }
      L.push(R + ' > video {')
      L.push('  width: 100%; height: 100%; display: block;')
      L.push('  object-fit: ' + (front ? 'cover' : cfg.objectFit) + '; object-position: center;')
      L.push('}')
      return L.join('\n')
    }

    function styleTag() {
      return document.querySelector('style[data-plugin-css="' + TAG_ID + '"]')
    }

    function injectCss(cfg) {
      var existing = styleTag()
      if (existing) existing.remove()
      var tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-chat-wallpaper'
      tag.dataset.pluginCss = TAG_ID
      tag.textContent = buildCss(cfg)
      document.head.appendChild(tag)
    }

    function removeCss() {
      var existing = styleTag()
      if (existing) existing.remove()
    }

    /* ── DOM ─────────────────────────────────────────────────────────────── */

    function killVideo(root) {
      if (!root) return
      var v = root.querySelector('video')
      if (v) { try { v.pause(); v.removeAttribute('src'); v.load() } catch (e) {} }
    }

    /** 撤掉视频层（最前那层"第二幕"）。只暂停、**保留 src** —— 预加载的成果不能丢。 */
    function removeLayer() {
      var el = document.getElementById(ROOT_ID)
      if (el) {
        var v = el.querySelector('video')
        if (v) { try { v.pause() } catch (e) {} }
        el.remove()
      }
    }

    /** 撤掉聊天底图层（最底那层）*/
    function removeBg() {
      var el = document.getElementById(BG_ID)
      if (el) el.remove()
    }

    /* ── 预加载 ──────────────────────────────────────────────────────────
       页面一加载就把视频元素建好并开始 load，**但不插进 DOM**。
       · 好处一：到点插进去时首帧已就绪 → 和开机动画接得上（不丝滑的问题解决）
       · 好处二：绝不在页面加载时就挂全屏层（那样会盖住开机动画期间的界面）
       · 关键：有了它，到点时元素已经 loadedmetadata，设 currentTime 才安全。 */
    var preloaded = null

    function preloadVideo(cfg) {
      if (preloaded) return preloaded
      var v = document.createElement('video')
      v.muted = true
      v.autoplay = false
      v.playsInline = true
      v.preload = 'auto'
      v.setAttribute('muted', '')
      v.setAttribute('playsinline', '')
      v.src = API + '/video?t=' + Date.now()
      if (cfg && cfg.playbackRate && cfg.playbackRate !== 1) {
        try { v.playbackRate = cfg.playbackRate } catch (e) {}
      }
      preloaded = v
      log('视频预加载已开始（元素建好了，但**还没插进 DOM**）')
      return v
    }

    /**
     * 聊天底图层：用户自己定的那张图 + 纱。**在最底下。**
     *
     * 和视频**完全独立** —— 这是这次改版的核心：
     *   · 只配图不配视频 → 一张静态聊天背景
     *   · 只配视频不配图 → 开场演完淡出，回到 DSH 默认底色
     *   · 两个都配     → 视频在前面演，演完淡出，露出"聊天 + 底图"
     */
    function mountBg(cfg) {
      if (!cfg.__imageOk) return null
      var already = document.getElementById(BG_ID)
      if (already) return already

      var bg = document.createElement('div')
      bg.id = BG_ID
      bg.setAttribute('aria-hidden', 'true')

      var img = document.createElement('img')
      img.alt = ''
      img.setAttribute('aria-hidden', 'true')
      img.addEventListener('error', function () {
        log('聊天底图加载失败 → 撤掉它')
        if (img.parentNode) img.parentNode.removeChild(img)
      })
      img.src = API + '/image?t=' + Date.now()

      var veil = document.createElement('div')
      veil.className = 'dsh-cw-veil'

      bg.appendChild(img)
      bg.appendChild(veil)
      document.body.insertBefore(bg, document.body.firstChild)
      log('挂载聊天底图层')
      return bg
    }

    /** 挂载计数：控制台里能直接看出"到底挂了几次" —— 闪一下 + 重播的元凶就是重复挂载 */
    var mountCount = 0

    /**
     * 挂载视频层。
     *
     * placement="front"（默认）：z-index 2147483000，**盖在聊天窗口最前面**，
     *   开机动画收场后的"第二幕"，播完淡出就进聊天。
     * placement="behind"：z-index:-1，当常驻背景（配合 mode=loop）。
     *
     * ⚠️ **幂等：已经挂好就绝不再建。**
     * 原先的写法是先 removeLayer() 再建新的 —— 那会让视频黑一下、从 0 重新播，
     * 表现就是"鼠标点一下窗口，背景闪一下然后重新开始"。
     */
    function mountLayer(cfg) {
      var existing = document.getElementById(ROOT_ID)
      if (existing && existing.querySelector('video')) {
        log('视频层已在位（累计挂载 ' + mountCount + ' 次）→ 跳过重建，避免闪烁与重播')
        return existing
      }
      if (existing) existing.remove()
      mountCount++
      log('挂载视频层 #' + mountCount + '（' + (cfg.placement === 'front' ? '最前 · 第二幕' : '最底 · 常驻背景') + '）')

      var root = document.createElement('div')
      root.id = ROOT_ID
      root.setAttribute('aria-hidden', 'true')

      /* 全屏开场必然是"播一次"：让它循环等于永久盖住界面，没有任何意义。
         所以 front 模式强制走 once 逻辑（并且点击可跳过）。*/
      var isFront = cfg.placement === 'front'
      var once = (cfg.mode !== 'loop') || isFront

      /* 用**预加载好的**那个元素（页面加载时就开始 load 了）——
         这样到点插进 DOM 时首帧已就绪，接得上、不丝滑的问题也一起解决。 */
      var video = preloaded || document.createElement('video')
      preloaded = video
      video.muted = true
      video.autoplay = false
      video.loop = !once
      video.playsInline = true
      video.setAttribute('muted', '')
      video.setAttribute('playsinline', '')
      video.preload = 'auto'
      if (!video.src) video.src = API + '/video?t=' + Date.now()
      if (cfg.playbackRate && cfg.playbackRate !== 1) {
        try { video.playbackRate = cfg.playbackRate } catch (e) {}
      }

      /* ── 循环区间（只在 mode='loop' 时）────────────────────────────────────
         语义：**第一次从头播完，之后只在 [loopStart, loopEnd] 里循环**。
         （剪辑软件里把片尾做成可循环段就是干这个用的。）

         为什么不用 <video loop>：那个只会回到 0，把片头再放一遍。
         为什么要 rAF：timeupdate 只有 ~4Hz，最坏情况会多播 250ms 的冗余尾巴；
         rAF 每个显示帧查一次（~16ms ≈ 半帧），够精确。

         后台标签页 rAF 会暂停 → 视频会播过头 → 由 ended / timeupdate 兜底拉回来。 */
      if (!once && typeof cfg.loopStartSec === 'number' && cfg.loopStartSec > 0) {
        video.loop = false
        var loopFrom = cfg.loopStartSec
        var loopTo = (typeof cfg.loopEndSec === 'number' && cfg.loopEndSec > loopFrom) ? cfg.loopEndSec : null
        var seeking = false
        var atLoopPoint = function () {
          var end = loopTo !== null ? loopTo : video.duration
          return end > 0 && video.currentTime >= end - 0.005
        }
        var backToLoop = function () {
          if (seeking) return
          seeking = true
          /* 这条日志是决定性的：有它 = 回跳真的发生了；没有 = 循环区间根本没触发。
             （之前"loop 到底有没有生效"只能靠肉眼猜，加这一行就不用猜了。） */
          log('循环回跳', { from: +video.currentTime.toFixed(3), to: +loopFrom.toFixed(3) })
          try { video.currentTime = loopFrom } catch (e) {}
          setTimeout(function () { seeking = false }, 150)
        }
        var rafId = null
        var tick = function () {
          rafId = null
          if (video.paused || video.ended) return
          if (atLoopPoint()) backToLoop()
          rafId = requestAnimationFrame(tick)
        }
        var startTick = function () { if (rafId === null) rafId = requestAnimationFrame(tick) }
        var stopTick = function () { if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null } }

        video.addEventListener('timeupdate', function () { if (atLoopPoint()) backToLoop() })
        video.addEventListener('play', startTick)
        video.addEventListener('pause', stopTick)
        video.addEventListener('ended', function () { backToLoop(); video.play().catch(function () {}) })
        log('循环区间已启用', { from: loopFrom, to: loopTo === null ? '(视频结尾)' : loopTo })
      }

      video.addEventListener('error', function () {
        log('视频加载失败，撤回壁纸 —— code', video.error && video.error.code,
            (video.error && video.error.message) || '')
        teardown()
      })
      video.addEventListener('playing', function () {
        log('开始播放', { duration: video.duration, w: video.videoWidth, h: video.videoHeight })
      })

      /* ── 播一次 → 淡出 → 进聊天 ──────────────────────────────────────────
         placement='front' 时这就是"第二幕"：开机动画收场 → 这个全屏视频接上 →
         播完淡出 → 露出聊天窗口（底图是你自己在面板里定的那张）。
         placement='behind' + mode='once' 时是"露一次就走"的背景视频。

         ⚠️ 注意：**绝不再用 `img` 这个变量**了 —— 底图现在住在另一个层（#dsh-cw-bg），
         视频层里没有 img。淡出只淡视频，底图（若有）原样留着。 */
      if (once) {
        var finished = false
        var watchdog = null
        var finishOnce = function (why) {
          if (finished) return
          finished = true
          if (watchdog) clearTimeout(watchdog)
          var ms = Number(cfg.fadeOutMs) > 0 ? Number(cfg.fadeOutMs) : 1200
          log('播放结束（' + why + '）→ 淡出 ' + ms + 'ms',
              cfg.__imageOk ? '进聊天（底图留着）' : '进聊天（回到 DSH 默认底色）')

          var rootEl = document.getElementById(ROOT_ID)
          if (rootEl) {
            rootEl.style.transition = 'opacity ' + ms + 'ms linear'
            rootEl.style.opacity = '0'
          }
          setTimeout(function () {
            removeLayer()
            /* 没有底图 → 连"外壳让开"那套 CSS 一起撤掉，彻底回到 DSH 原样。
               有底图 → 保留 CSS，聊天就落在底图上。 */
            if (!cfg.__imageOk) teardown()
          }, ms + 80)
        }
        video.addEventListener('ended', function () { finishOnce('ended') })
        /* 兜底一：ended 偶尔不触发（被 seek 过、或浏览器脾气）→ 到点自己收 */
        video.addEventListener('timeupdate', function () {
          if (video.duration > 0 && video.currentTime >= video.duration - 0.08) finishOnce('到达结尾')
        })
        /* 兜底二（看门狗）：万一视频卡住永远不 ended，全屏层会永久盖住界面 ——
           这是最坏的情况，所以必须有一个"无论如何都会收"的定时器。 */
        watchdog = setTimeout(function () {
          finishOnce('看门狗兜底（视频没正常结束）')
        }, ((video.duration > 0 ? video.duration : 12) + 5) * 1000)

        /* ⚠️ 这里**故意什么都不做**：
           既没有"点击跳过"，也没有"第一次手势补 play"。
           两个都加过，两个都出事了 ——
             · click→跳过：全屏层把整个界面的点击全吞了
             · pointerdown→补 play：**点一下就开播**，用户根本没法操作
           全屏开场就是要"老老实实自动播、自动收"，宁可不能点，
           也绝不能把用户的点击当成开关。收不了场由看门狗兜底。 */
      }

      root.appendChild(video)
      if (!isFront) {
        /* 只有"放后面"时才在视频上压纱 —— 全屏那层没有文字要读，压纱反而糊 */
        var veil = document.createElement('div')
        veil.className = 'dsh-cw-veil'
        root.appendChild(veil)
      }
      document.body.insertBefore(root, document.body.firstChild)

      /* ⚠️ 挂载时**不播**，而且这一步只由 beginIntro() 调用 ——
         绝不在页面加载时就挂全屏层（那样会在开机动画结束前盖住整个界面）。
         返回 video 给调用方去 play。 */
      return video
    }

    /**
     * 到点了：把（预加载好的）视频层插进 DOM → 摆好不透明度 → 开播。
     *
     * ★ 交叉叠化（cross-dissolve）★
     * dsh-startup-screen 收场时是给根元素加 `.dsu-gone`，然后自己
     * **opacity 1 → 0，620ms**（splash.css:111）。加 class 的那一刻淡出刚开始。
     *
     * 所以只要我在那一刻**已经完全不透明地待在他下面**（我的 z-index 是 2147482990，
     * 比他 2147483000 低 10），他的淡出就自动变成叠化 —— 中间不会露出聊天窗口。
     *
     * ⚠️ 反过来，如果我也跟着淡入（曾经是 260ms），头 260ms 两层都不够实，
     * 中间那一小段就会透出聊天界面 —— 用户看到的"闪一下"就是这个。
     * 前人叠化，后人就别再叠了。
     *
     * 两条硬规则（都是踩坑换来的）：
     *   1. **只在 loadedmetadata 之后才设 currentTime** ——
     *      对还没加载好的元素设 currentTime 会让它卡在 seek 状态、`play()` 永不生效
     *      （"全屏停在第 0 帧盖住界面、只能靠看门狗收"那个 bug）。
     *   2. **2 秒内没播起来就立刻撤层** —— 全屏层绝不能停在那盖住界面。
     */
    function beginIntro(cfg, why, sawOverlay) {
      if (document.getElementById(ROOT_ID)) return       // 已经在了（幂等）
      var video = mountLayer(cfg)
      if (!video) return
      /* readyState 写进日志：>=2 表示首帧已解码，叠化时露出的是真画面而不是黑底 */
      log('开始播（' + why + '）· readyState=' + video.readyState)

      var target = String(cfg.opacity == null ? 1 : cfg.opacity)
      var root = document.getElementById(ROOT_ID)
      if (root) {
        if (sawOverlay) {
          /* 交叉叠化：直接满不透明 —— 让开机动画的 620ms 淡出把我叠出来 */
          root.style.transition = 'none'
          root.style.opacity = target
          log('交叉叠化：我直接满不透明待在下面，等它的 620ms 淡出把我叠出来')
        } else {
          /* 没有开机动画（宽限/超时那条路）→ 没人替我淡，自己来一个短淡入 */
          root.style.transition = 'opacity 300ms linear'
          root.style.opacity = '0'
          requestAnimationFrame(function () { root.style.opacity = target })
        }
      }

      if (video.readyState >= 1) {
        try { video.currentTime = 0 } catch (e) {}
      } else {
        log('元数据还没就绪（readyState=' + video.readyState + '）→ 不设 currentTime，直接 play')
      }
      var p = video.play()
      if (p && typeof p.catch === 'function') {
        p.catch(function (e) { log('play() 被拒（autoplay 策略？）', String(e && e.name)) })
      }

      /* 硬保证：2 秒还没播起来就撤层（绝不把界面盖住）*/
      setTimeout(function () {
        if (!document.getElementById(ROOT_ID)) return
        if (video.paused) {
          log('⚠️ 2 秒内没能开始播放 → 撤掉全屏层，宁可没有开场也不盖住界面')
          removeLayer()
          if (!cfg.__imageOk) teardown()
        }
      }, 2000)
    }

    /* ── 等开机动画收场再开始播 ──────────────────────────────────────────
       为什么需要：页面一加载就播的话，开机动画（十几秒，而且要用户点几下）
       盖在上面的那段时间视频已经把片头放完了 —— 用户进到界面看到的直接是循环段，
       那 6 秒片头等于白做。

       顺带的好处：开机动画期间不播视频 = 不占解码器。

       注意：这两个配置项**客户端自己兜底**（不要求宿主提供）。 */

    /**
     * 开机浮层**开始收场**的信号 class。
     *
     * ★ 关键：是 `dsu-handoff`，不是 `dsu-gone` ★
     *   dsh-startup-screen 的收尾分两步（splash.js:1392-1397 / 1400-1425）：
     *     · `dsu-handoff` → 根元素**开始**淡出，整整 780ms（splash.css:791，opacity:0）
     *     · 780ms 之后才是 `dsu-gone` → 再淡出 620ms（那时其实早就透明了）
     *
     * 只盯 `dsu-gone` 会**晚 780ms** —— 那 780ms 里开机动画一路在变透明、
     * 已经在把聊天窗口透出来了，用户看到的就是"闪一下"。
     * 要叠化，必须在它**刚开始**淡的时候就已经满不透明地待在它下面。
     *
     * 换别的开机动画插件时，用 `bootLeaveClasses` 覆盖这里。
     */
    var DEFAULT_LEAVE_CLASSES = ['dsu-handoff', 'dsu-gone']

    /**
     * 开机浮层**还在挡着**吗？
     *
     * ⚠️ 只用 **class** 判定，不看几何尺寸。
     * 第一版加了"零尺寸也算已收场"的几何判断 —— 结果踩坑：
     * 开机层刚插进 DOM 的那一刻往往就是零尺寸/隐藏的，被误判成"收场了"，
     * 于是页面一加载就开播，等用户走完开机动画视频早跑完了。
     */
    function bootOverlayPresent(sels, leaveClasses) {
      if (!sels || !sels.length) return false
      var leave = (leaveClasses && leaveClasses.length) ? leaveClasses : DEFAULT_LEAVE_CLASSES
      for (var i = 0; i < sels.length; i++) {
        var el = null
        try { el = document.querySelector(sels[i]) } catch (e) { continue }
        if (!el) continue
        if (el.classList) {
          var leaving = false
          for (var k = 0; k < leave.length; k++) {
            if (el.classList.contains(leave[k])) { leaving = true; break }
          }
          if (leaving) continue        // 它已在收场路上 → 该我上场了
        }
        return true
      }
      return false
    }

    var POLL_MS = 50           // 50ms 一次：开机动画一收场就尽可能快接上（不加长过渡的空档）
    var GRACE_MS = 3000        // 一直没见到开机层 → 先播，别干等
    var GIVE_UP_MS = 180000    // 3 分钟后停止轮询

    /**
     * 决定何时开始播：等开机浮层收场，**然后才把视频层挂上去并开播**。
     *
     * 三个状态：
     *   waiting  还没见到开机层 —— 过了 GRACE_MS 就先播（万一本机没装开机动画）
     *   covering 开机层在 —— 什么都不做（**层都还没挂**，所以绝不挡界面）
     *   playing  已经开播
     *
     * 关键点：开机层**任何时候**出现都要接住，不只是启动那一下。
     */
    function startWhenFree(cfg) {
      var wantWait = cfg.waitForBoot === undefined ? true : !!cfg.waitForBoot
      var sels = cfg.bootOverlaySelectors || ['#dsh-startup-root']

      var ticks = 0
      var phase = 'waiting'
      var sawOverlay = false     // 见过开机层吗 —— 决定要不要自己淡入（见 beginIntro 的交叉叠化）
      var go = function (why) {
        if (phase === 'playing') return
        phase = 'playing'
        beginIntro(cfg, why, sawOverlay)
      }

      if (!wantWait) { go('waitForBoot=false'); return }
      /* 显式给了空选择器 = "没有浮层要等"。
         （注意 [] 是 truthy，不能用 `cfg.x || 默认值` 兜底，必须显式判长度。） */
      if (sels.length === 0) { go('bootOverlaySelectors 为空'); return }

      var iv = setInterval(function () {
        ticks++
        var present = bootOverlayPresent(sels, cfg.bootLeaveClasses)
        if (present) sawOverlay = true
        /* 用**滴答数**算时间，不用 Date.now()：轮询间隔固定，两者等价；
           但滴答数让这段逻辑可以用假定时器测试（用墙钟的话测试里时间不流逝，
           宽限期永远到不了）。 */
        var waited = (ticks * POLL_MS / 1000).toFixed(1)

        if (ticks * POLL_MS >= GIVE_UP_MS) {           // 轮询不该跑一辈子
          clearInterval(iv)
          log('轮询超时 ' + (GIVE_UP_MS / 1000) + 's，开机层一直没收场 → 不再等')
          go('轮询超时')
          return
        }
        if (phase === 'playing') {
          if (present) {                       // 开机层后来又出现了（比如刷新后重启了序列）
            /* ⚠️ 这里**不能** clearInterval —— 清了就再也不会轮询，
               开机层收场后视频永远不播（测试抓到过这个 bug）。 */
            log('开机动画又出现了 → 撤回视频层，等它收场再挂')
            removeLayer()
            phase = 'covering'
          }
          return
        }
        if (phase === 'covering') {
          if (!present) go('开机动画已收场，等了 ' + waited + 's')
          return
        }
        /* phase === 'waiting' */
        if (present) { phase = 'covering'; log('开机动画在跑 → 视频先不播（层都还没挂，界面不受影响）'); return }
        if (ticks * POLL_MS >= GRACE_MS) go('宽限 ' + (GRACE_MS / 1000) + 's 内没检测到开机动画')
      }, POLL_MS)
    }

    /* ── 生命周期 ───────────────────────────────────────────────────────── */

    var current = null         // 当前生效的配置
    var observer = null
    var themeClass = null      // 当前写到 <html> 上的主题 class

    /** 把主题判定结果写到 <html> 的 class 上 —— CSS 全部读它，不读 DSH 的标记 */
    function setThemeClass(dark) {
      var next = dark ? 'dsh-cw-dark' : 'dsh-cw-light'
      if (themeClass === next) return
      document.documentElement.classList.remove('dsh-cw-dark', 'dsh-cw-light')
      document.documentElement.classList.add(next)
      themeClass = next
    }

    function applyNow(cfg) {
      current = cfg
      var dark = looksDark()
      setThemeClass(dark)
      log('套用壁纸', { source: cfg.__source, file: cfg.__file, theme: dark ? 'dark' : 'light' })
      injectCss(cfg)
      mountBg(cfg)            /* 最底：聊天底图（用户自己定的那张，可选）*/
      preloadVideo(cfg)       /* 先把视频加载起来（**不插进 DOM**，所以不挡界面）*/
      /* ⚠️ 这里**不挂视频层** —— 只装"到点就挂并播"的闸门。
         页面加载时就挂全屏层的话，它会盖住开机动画结束前的整个界面。 */
      startWhenFree(cfg)
    }

    /**
     * 撤场：把 CSS 和视频层全部收回，页面回到原样。
     *
     * ★★ 必须同时清掉 `current` 并断开主题观察者 ★★
     * 否则会"复活"：撤场后 current 还留着 → 下一次 html/body 属性变化把观察者叫醒
     * → 它发现"没挂载" → applyNow(current) → **把壁纸重新挂起来** → 视频从 0 重播
     * → 播完又淡出 → 又被复活 …… 无限循环。
     *
     * 实际表现就是用户报的：「淡出我看到了，但动画还在后面一直 loop」，
     * 而且因为每次复活都是"宽限 3 秒后随机开播"，时序全乱、不再跟在开机动画后面。
     */
    function teardown() {
      current = null
      if (observer) {
        try { observer.disconnect() } catch (e) { /* 忽略 */ }
        observer = null
      }
      removeCss()
      removeLayer()
      removeBg()
      /* 彻底收场：连预加载的元素一起清掉，别留个解码器在后台 */
      if (preloaded) {
        try { preloaded.pause(); preloaded.removeAttribute('src'); preloaded.load() } catch (e) {}
        preloaded = null
      }
      try {
        document.documentElement.classList.remove('dsh-cw-dark', 'dsh-cw-light')
        themeClass = null
      } catch (e) { /* 忽略 */ }
    }

    /**
     * 主题变化时**只换主题 class**（换纱换色）。
     *
     * ⚠️⚠️ **绝不允许在这里挂载任何东西。**
     * 之前这里有一行 `if (!mounted) applyNow(current)` —— 它造成过两次事故：
     *   1. 视频演完、层被移除后，它把视频**复活** → 播完又淡出又复活 → 无限循环
     *      （"动画还在一直继续"）
     *   2. 视频**还没到点挂载**时（开机动画期间层不存在），每次 html/body 属性变化
     *      都 applyNow → `套用壁纸` 日志刷屏，还泄漏一堆轮询定时器
     *
     * **挂载时机只由 startWhenFree 那道闸门决定，观察者不许插手。**
     */
    function watchTheme(cfg) {
      if (observer || typeof MutationObserver === 'undefined') return
      observer = new MutationObserver(function () {
        if (!current) return
        var dark = looksDark()
        var want = dark ? 'dsh-cw-dark' : 'dsh-cw-light'
        if (themeClass !== want) {
          log('主题切换 →', dark ? '深色纱' : '白纱')
          setThemeClass(dark)
        }
      })
      observer.observe(document.documentElement, { attributes: true })
      if (document.body) observer.observe(document.body, { attributes: true })
    }

    /* ── 设置面板 ────────────────────────────────────────────────────────
       用户要"一个清晰的观察点"：所以做成右下角常驻小圆钮，点开是设置面板。

       ⚠️ 面板**独立于壁纸层**：
         · 自己的根元素 (#dsh-cw-panel) + 自己的 style 标签，teardown() 不碰它们
           —— 否则 once 模式播完收场后，设置入口会跟着壁纸一起消失
         · 自己的主题 class（写在面板根元素上），不依赖 <html> 上的 dsh-cw-*
           —— 那个会被 teardown() 清掉
    */

    var PANEL_ID = 'dsh-cw-panel'
    var PANEL_TAG_ID = 'dsh-chat-wallpaper/panel.css'
    var panelEl = null
    var panelCfg = null

    function panelStyleTag() {
      return document.querySelector('style[data-plugin-css="' + PANEL_TAG_ID + '"]')
    }

    function panelCss() {
      var P = '#' + PANEL_ID
      return [
        P + ', ' + P + ' * { box-sizing: border-box; }',
        /* 放左下角：右下角是发送钮和状态栏，别去挤它们 */
        P + ' { position: fixed; left: 20px; bottom: 52px; z-index: 2147482000;',
        '  font: 13px/1.5 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; }',
        P + ' .cw-fab { height: 34px; padding: 0 13px; border-radius: 999px; cursor: pointer;',
        '  border: 1px solid var(--cw-line); background: var(--cw-bg); color: var(--cw-fg);',
        '  font-size: 12px; box-shadow: 0 4px 16px rgba(0,0,0,.30); }',
        P + ' .cw-fab:hover { border-color: var(--cw-accent); }',
        P + ' .cw-panel { position: absolute; left: 0; bottom: 46px; width: 328px;',
        '  background: var(--cw-bg); color: var(--cw-fg); border: 1px solid var(--cw-line);',
        '  border-radius: 12px; box-shadow: 0 14px 44px rgba(0,0,0,.42); padding: 14px;',
        '  display: none; max-height: 76vh; overflow: auto; }',
        P + '.cw-open .cw-panel { display: block; }',
        P + ' .cw-head { display: flex; align-items: center; justify-content: space-between;',
        '  font-weight: 600; font-size: 14px; margin-bottom: 10px; }',
        P + ' .cw-x { border: 0; background: transparent; color: var(--cw-dim); cursor: pointer; font-size: 15px; }',
        P + ' .cw-sec { margin: 12px 0; }',
        P + ' .cw-label { color: var(--cw-dim); font-size: 12px; margin-bottom: 6px; }',
        P + ' .cw-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }',
        P + ' .cw-thumb { position: relative; aspect-ratio: 16/10; border-radius: 8px; cursor: pointer;',
        '  overflow: hidden; border: 2px solid transparent; background: var(--cw-line); }',
        P + ' .cw-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }',
        P + ' .cw-thumb.cw-sel { border-color: var(--cw-accent); }',
        P + ' .cw-thumb span { position: absolute; left: 0; right: 0; bottom: 0; font-size: 10px;',
        '  padding: 2px 4px; background: rgba(0,0,0,.55); color: #fff; overflow: hidden;',
        '  text-overflow: ellipsis; white-space: nowrap; }',
        P + ' .cw-empty { color: var(--cw-dim); font-size: 12px; padding: 10px 0; line-height: 1.7; }',
        P + ' .cw-row { display: flex; gap: 8px; margin-top: 8px; }',
        P + ' .cw-act { flex: 1; padding: 7px 8px; border-radius: 8px; cursor: pointer; font-size: 12px;',
        '  border: 1px solid var(--cw-line); background: transparent; color: var(--cw-fg); }',
        P + ' .cw-act:hover { border-color: var(--cw-accent); }',
        P + ' .cw-veil { width: 100%; accent-color: var(--cw-accent); }',
        P + ' .cw-radios { display: flex; gap: 14px; font-size: 12px; }',
        P + ' .cw-radios label { display: flex; align-items: center; gap: 5px; cursor: pointer; }',
        P + ' .cw-note { font-size: 11px; color: var(--cw-dim); margin-top: 6px; word-break: break-all; }',
      ].join('\n')
    }

    function injectPanelCss() {
      var existing = panelStyleTag()
      if (existing) existing.remove()
      var tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-chat-wallpaper'
      tag.dataset.pluginCss = PANEL_TAG_ID
      tag.textContent = panelCss()
      document.head.appendChild(tag)
    }

    function paintPanelTheme(dark) {
      if (!panelEl) return
      var c = dark
        ? { bg: 'rgba(26,28,36,.97)', fg: '#e9ecf3', dim: '#98a2b3', line: 'rgba(255,255,255,.15)', accent: '#5aa9ff' }
        : { bg: 'rgba(255,255,255,.98)', fg: '#1b1e25', dim: '#6b7280', line: 'rgba(0,0,0,.13)', accent: '#2b7fff' }
      panelEl.style.setProperty('--cw-bg', c.bg)
      panelEl.style.setProperty('--cw-fg', c.fg)
      panelEl.style.setProperty('--cw-dim', c.dim)
      panelEl.style.setProperty('--cw-line', c.line)
      panelEl.style.setProperty('--cw-accent', c.accent)
    }

    function cwEl(tag, cls, text) {
      var e = document.createElement(tag)
      if (cls) e.className = cls
      if (text !== undefined) e.textContent = text
      return e
    }

    /** 调宿主接口，拿 JSON（失败一律返回 null，绝不抛） */
    function api(path, opts) {
      return fetch(API + path, opts)
        .then(function (r) { return r.json() })
        .catch(function (e) { log('设置面板请求失败', path, String(e && e.message)); return null })
    }

    /** 改配置 → 立刻预览。full=true 需要重挂（换图 / 换模式），false 只重注 CSS（改纱） */
    function panelApply(patch, full) {
      api('/set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }).then(function (r) {
        if (!r || !r.ok) { log('设置没写进去', r && r.error); return }
        log('设置已更新', r.applied)
        return api('/config', { cache: 'no-store' })
      }).then(function (data) {
        if (!data || !data.config) return
        var cfg = data.config
        cfg.__source = data.source
        cfg.__file = data.file
        cfg.loopStartSec = data.loopStartSec
        cfg.loopEndSec = data.loopEndSec
        cfg.__imageOk = !!data.imageOk
        cfg.__image = data.image
        panelCfg = cfg
        if (full) {
          removeLayer()
          removeBg()
          removeCss()
          applyNow(cfg)          // 重新挂载 → 新图/新模式立刻能看到
        } else {
          current = cfg
          injectCss(cfg)         // 只改纱：不重挂，视频不重播
        }
        refreshPanel()
      })
    }

    function refreshPanel() {
      if (!panelEl) return
      api('/images').then(function (d) {
        if (!d || !d.ok) return
        paintPanelTheme(looksDark())
        panelEl.querySelector('.cw-cur').textContent = d.current
          ? d.current.split(/[\\/]/).pop()
          : '（没有背景图 —— 视频淡出后回到 DSH 默认底色）'
        panelEl.querySelector('.cw-dir').textContent = '丢图目录：' + d.dropDir

        var grid = panelEl.querySelector('.cw-grid')
        grid.textContent = ''
        if (!d.images.length) {
          grid.appendChild(cwEl('div', 'cw-empty',
            '这里还没有图。点下面「打开图片文件夹」，把 jpg / png / webp 丢进去，\n再点一次这个面板就会出现在这里。'))
        }
        d.images.forEach(function (im) {
          var t = cwEl('div', 'cw-thumb' + (d.current && d.current.endsWith(im.name) ? ' cw-sel' : ''))
          var i = document.createElement('img')
          i.src = im.url
          i.alt = ''
          t.appendChild(i)
          t.appendChild(cwEl('span', '', im.name))
          t.title = im.name + ' · ' + im.sizeKB + ' KB · ' + im.mtime
          t.addEventListener('click', function () { panelApply({ image: im.name }, true) })
          grid.appendChild(t)
        })

        var dark = looksDark()
        panelEl.querySelector('.cw-veil-label').textContent =
          '纱的浓度（' + (dark ? '深色' : '浅色') + '主题）'
        panelEl.querySelector('.cw-veil-val').textContent = Math.round((dark ? d.veil.dark : d.veil.light) * 100) + '%'
        var slider = panelEl.querySelector('.cw-veil')
        slider.value = String(Math.round((dark ? d.veil.dark : d.veil.light) * 100))
        panelEl.querySelectorAll('input[name="cw-mode"]').forEach(function (r) {
          r.checked = (r.value === d.mode + '/' + (d.placement || 'front'))
        })
      })
    }

    function mountPanel() {
      if (panelEl || typeof document === 'undefined' || !document.body) return
      injectPanelCss()
      panelEl = document.createElement('div')
      panelEl.id = PANEL_ID

      var fab = cwEl('button', 'cw-fab', '🖼 背景')
      fab.title = '聊天背景设置'
      fab.addEventListener('click', function () {
        panelEl.classList.toggle('cw-open')
        if (panelEl.classList.contains('cw-open')) refreshPanel()
      })
      panelEl.appendChild(fab)

      var panel = cwEl('div', 'cw-panel')
      var head = cwEl('div', 'cw-head')
      head.appendChild(cwEl('span', '', '聊天背景'))
      var x = cwEl('button', 'cw-x', '✕')
      x.addEventListener('click', function () { panelEl.classList.remove('cw-open') })
      head.appendChild(x)
      panel.appendChild(head)

      var sec1 = cwEl('div', 'cw-sec')
      sec1.appendChild(cwEl('div', 'cw-label', '当前'))
      sec1.appendChild(cwEl('div', 'cw-cur', '…'))
      sec1.appendChild(cwEl('div', 'cw-note cw-dir', ''))
      panel.appendChild(sec1)

      var sec2 = cwEl('div', 'cw-sec')
      sec2.appendChild(cwEl('div', 'cw-label', '选一张（丢进目录的图会自动出现在这里）'))
      sec2.appendChild(cwEl('div', 'cw-grid'))
      panel.appendChild(sec2)

      var row = cwEl('div', 'cw-row')
      var none = cwEl('button', 'cw-act', '不用图片')
      none.addEventListener('click', function () { panelApply({ image: '' }, true) })
      var open = cwEl('button', 'cw-act', '打开图片文件夹')
      open.addEventListener('click', function () { api('/open-dir', { method: 'POST' }) })
      row.appendChild(none)
      row.appendChild(open)
      panel.appendChild(row)

      var sec3 = cwEl('div', 'cw-sec')
      var vl = cwEl('div', 'cw-label')
      vl.appendChild(cwEl('span', 'cw-veil-label', '纱的浓度'))
      vl.appendChild(cwEl('span', 'cw-veil-val', ''))
      sec3.appendChild(vl)
      var slider = document.createElement('input')
      slider.type = 'range'
      slider.className = 'cw-veil'
      slider.min = '0'
      slider.max = '80'
      slider.step = '1'
      slider.addEventListener('input', function () {
        var a = Number(slider.value) / 100
        panelEl.querySelector('.cw-veil-val').textContent = Math.round(a * 100) + '%'
      })
      slider.addEventListener('change', function () {
        var a = Number(slider.value) / 100
        /* 只改第一个渐变停靠点的 alpha，第二个按原比例跟着走（保持渐变的味道） */
        var b = Math.round(a * 76) / 100
        var patch = looksDark()
          ? { veilDarkA: 'rgba(8,10,16,' + a + ')', veilDarkB: 'rgba(6,8,14,' + b + ')' }
          : { veilLightA: 'rgba(253,250,254,' + a + ')', veilLightB: 'rgba(250,247,253,' + b + ')' }
        panelApply(patch, false)
      })
      sec3.appendChild(slider)
      panel.appendChild(sec3)

      var sec4 = cwEl('div', 'cw-sec')
      sec4.appendChild(cwEl('div', 'cw-label', '开场视频'))
      var radios = cwEl('div', 'cw-radios')
      /* 两个选项 = 两种**完整设计**，所以一次同时设定 mode + placement，
         免得用户拼出"全屏 + 循环"这种把界面永久盖住的无意义组合。 */
      ;[
        ['once', 'front', '全屏开场：播一次 → 淡出 → 进聊天'],
        ['loop', 'behind', '常驻背景：在聊天窗口后面一直循环'],
      ].forEach(function (pair) {
        var lab = cwEl('label')
        var r = document.createElement('input')
        r.type = 'radio'
        r.name = 'cw-mode'
        r.value = pair[0] + '/' + pair[1]
        r.addEventListener('change', function () {
          if (r.checked) panelApply({ mode: pair[0], placement: pair[1] }, true)
        })
        lab.appendChild(r)
        lab.appendChild(cwEl('span', '', pair[2]))
        radios.appendChild(lab)
      })
      sec4.appendChild(radios)
      panel.appendChild(sec4)

      panelEl.appendChild(panel)
      document.body.appendChild(panelEl)
      paintPanelTheme(looksDark())
      log('设置面板已挂载（左下角「🖼 背景」）')
    }

    /* ── 启动 ───────────────────────────────────────────────────────────── */

    var booted = false

    /**
     * 自举。**只跑一次** —— 重复自举会走一遍 applyNow，虽然 mountLayer 现在幂等，
     * 但重复 fetch + 重复注 CSS 也没必要，而且会把"到底是哪儿在重建"搅浑。
     * 需要重新读配置就刷新页面。
     */
    function boot() {
      if (booted) { log('已自举过 → 跳过重复自举（要重读配置请刷新页面）'); return }
      booted = true
      log('client build ' + BUILD + ' 已加载')
      try {
        fetch(API + '/config', { cache: 'no-store' })
          .then(function (r) { return r.json() })
          .then(function (data) {
            var cfg = data && data.config ? data.config : null
            if (!cfg) { log('拿不到配置，放弃'); return }
            cfg.__source = data.source
            cfg.__file = data.file
            /* 循环区间由宿主把时间码换算成秒后传下来（客户端不做解析） */
            cfg.loopStartSec = data.loopStartSec
            cfg.loopEndSec = data.loopEndSec
            /* 背景图：宿主已经解析好了，这里只拿"有没有" */
            cfg.__imageOk = !!data.imageOk
            cfg.__image = data.image
            cfg.__imageSource = data.imageSource
            if (!data.ok) {
              log('宿主没找到可用视频 —— 检查 /chat-wallpaper/status。片库目录：',
                  (data.config && data.config.userClipDirs) || '?')
              return
            }
            applyNow(cfg)
            watchTheme(cfg)
            /* 设置面板独立挂载：壁纸收场了它也要在（那是用户的"观察点"） */
            mountPanel()
          })
          .catch(function (e) { log('请求配置失败，放弃', String(e && e.message)) })
      } catch (e) {
        log('自举失败，放弃（绝不能把宿主带崩）', String(e && e.message))
      }
    }

    function apply() {
      if (typeof document === 'undefined') return
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true })
      } else {
        boot()
      }
    }

    exports.apply = apply
    exports.inject = []       // 不需要任何客户端服务

    /* 测试钩子：只给 node:vm 冒烟测试用，不参与运行时逻辑。
       有了它们就能在不启动 DSH 的情况下验证 CSS 生成、主题判定、挂载幂等、起始时机。 */
    exports.__buildCss = buildCss
    exports.__looksDark = looksDark
    exports.__TAG_ID = TAG_ID
    exports.__ROOT_ID = ROOT_ID
    exports.__THEME_CLASSES = ['dsh-cw-dark', 'dsh-cw-light']
    exports.__resetLum = function () { measuredLum = null }
    exports.__mountLayer = mountLayer
    exports.__mountCount = function () { return mountCount }
    exports.__bootOverlayPresent = bootOverlayPresent
    exports.__DEFAULT_LEAVE_CLASSES = DEFAULT_LEAVE_CLASSES
    exports.__startWhenFree = startWhenFree
    exports.__teardown = teardown
    exports.__applyNow = applyNow
    exports.__watchTheme = watchTheme
    exports.__mountPanel = mountPanel
    exports.__refreshPanel = refreshPanel
    exports.__preloadVideo = preloadVideo
    exports.__beginIntro = beginIntro
    exports.__PANEL_ID = PANEL_ID
    exports.__PANEL_TAG_ID = PANEL_TAG_ID
    exports.__hasCurrent = function () { return !!current }
    exports.__BUILD = BUILD

    return module.exports
  }
})
