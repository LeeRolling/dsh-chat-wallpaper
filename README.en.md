# dsh-chat-wallpaper

**English** · [中文](README.md)

> A **fullscreen intro video + custom chat wallpaper** plugin for
> [DeepSeek Harness](https://github.com/deepseek-ai).
>
> When your boot animation finishes, a video of your choosing takes over the
> whole screen as a "second act". When it ends, it fades out and hands the
> screen back to the chat — over a wallpaper you pick yourself.
> Swapping the wallpaper means dropping an image into a folder.

```
   boot animation (your dsh-startup-screen)
        ↓  cross-dissolve (no hard cut, and no flash)
   fullscreen intro video (covering the chat window)
        ↓  fade out
   chat window + your wallpaper
```

**Panels, cards and code blocks stay fully opaque the entire time** — however
busy your wallpaper is, text stays readable.

---

## Contents

- [Two layers, fully decoupled](#two-layers-fully-decoupled)
- [How it does "background, not overlay"](#how-it-does-background-not-overlay)
- [The cross-dissolve: the hardest part of this plugin](#the-cross-dissolve-the-hardest-part-of-this-plugin)
- [Install](#install)
- [Swap the video / the wallpaper](#swap-the-video--the-wallpaper)
- [Settings panel](#settings-panel)
- [Configuration](#configuration)
- [Diagnostics and tools](#diagnostics-and-tools)
- [Tests](#tests)
- [Pitfalls we hit (all covered by regression tests)](#pitfalls-we-hit-all-covered-by-regression-tests)
- [Credits and sources](#credits-and-sources) ⭐
- [License](#license)

---

## Two layers, fully decoupled

```
   z-index 2147482990  ┌─ #dsh-chat-wallpaper ─ intro video (placement="front")
                       │   the "second act" after the boot animation:
                       │   fullscreen, covering the chat window
                       │   finishes → fades out → removed → chat takes over
                       └───────────────────────────────────────────────
         normal flow   │  chat UI / sidebar / composer
                       └───────────────────────────────────────────────
            z-index -1  ┌─ #dsh-cw-bg ─ chat wallpaper + veil (optional)
                       │   an image of your choosing; the chat sits on top of it
                       └───────────────────────────────────────────────
```

**These two are independent of each other:**

| What you configure | Result |
|---|---|
| Video only | boot → fullscreen intro plays once → fades out → back to the DSH default background |
| Wallpaper only | no intro; the chat simply sits on your image |
| Both | the intro plays in front, fades out, revealing the chat over your wallpaper |

---

## How it does "background, not overlay"

There are exactly two tricks:

```css
/* 1) Make the shell's own background variables transparent.
      Panels, cards and code blocks use *different* variables, which we never
      touch — so text always lands on an opaque surface. Zero readability cost. */
html body {
  --dsw-alias-bg-base: transparent;
  --dsw-specific-sidebar-fill: rgba(255, 255, 255, .78);   /* translucent sidebar */
}

/* 2) Put the wallpaper at z-index:-1 — below all normal flow content, and it
      never intercepts clicks. */
#dsh-cw-bg { position: fixed; inset: 0; z-index: -1; pointer-events: none; }
```

On top of that sits a **veil** (`linear-gradient`): a white veil for light
themes, a dark veil for dark themes.

> Theme detection **never guesses DSH's internal marker names**. The JS first
> scans every attribute on `html`/`body` for `dark`, then falls back to
> measuring the shell's background luminance, and finally writes the result as
> **its own class** (`dsh-cw-dark` / `dsh-cw-light`). The CSS only ever reads
> that class — so DSH can rename its internals and nothing breaks.

---

## The cross-dissolve: the hardest part of this plugin

**The problem.** The boot animation ends with a fade-out. If the intro video
also fades in, then at the seam **neither layer is opaque** — and the chat
window flashes through in between.

**The fix.** Make *their* fade-out *our* cross-dissolve: at the exact moment
they begin to fade, we are already sitting underneath at full opacity.

That requires knowing precisely when they begin. We read the
`dsh-startup-screen` source; its ending happens in **two steps**:

```js
/* dsh-startup-screen/lib/splash.js — the reveal */
root.classList.add('dsu-handoff')   // ★ step 1: the root *starts* fading out
await wait(780)                      //   a full 780 ms
finish()                             // step 2: only now does dsu-gone appear (+620 ms)
```

```css
/* dsh-startup-screen/lib/splash.css:791 */
#dsh-startup-root.dsu-handoff {
  transform: scale(1.035);
  filter: blur(5px);
  opacity: 0;                                        /* ★ it is already fading here */
  transition: opacity 780ms cubic-bezier(.4, 0, .2, 1), ...;
}
```

**So the timeline is:**

```
t=0      dsu-handoff  → starts fading out (780 ms, with a push-in and defocus) ↘
                                                        ← we are already opaque underneath
t=780    dsu-gone     → (long since fully transparent by now)
t=1400   root element removed
```

> ⚠️ **Watching only `dsu-gone` is 780 ms too late** — during those 780 ms the
> boot animation is already fading the chat window through, which is exactly
> the "flash" a user sees. **That was a real bug we hit.**

The signal classes are configurable (`bootLeaveClasses`) — swap them if you use
a different boot animation plugin.

**The honest trade-off.** A cross-dissolve means the video is already playing
while the fade is in progress, so roughly the first 0.4–0.7 s of the intro is
partly covered by the outgoing boot animation. That is the price of *never
flashing* — we think it is worth it.

The second seam (video → your wallpaper) needs no special handling: the video
layer fades out *while* the wallpaper is revealed underneath, which is already a
cross-dissolve.

---

## Install

```bash
# 1) Install the plugin (<path-to-this-repo> = wherever you cloned it)
dsh plugin --profile <your-profile> add link:<path-to-this-repo>

# 2) Restart DSH (see the last pitfalls: after editing lib/*.js you must
#    restart — a page refresh is not enough)
```

> There is **no build step**: `lib/index.js` (host half) and `lib/client.js`
> (browser half) are hand-written files that load directly.

---

## Swap the video / the wallpaper

**Video** — drop files here and the newest one wins (by mtime):

```
~/.dsh/boot-animation/videos/
```

**Wallpaper** — drop files here and the newest one is used automatically:

```
~/.dsh/chat-wallpaper/
```

Supported: `jpg / jpeg / png / webp / gif / avif / bmp`.
**No image at all** → after the intro fades out you get the DSH default background.

Both can also be pinned to an absolute path in the config (below).

---

## Settings panel

**There is a「🖼 背景」button in the bottom-left corner** — it opens everything:

```
┌─ Chat background ───────────────────────────┐
│ Current: my-wallpaper.jpg                   │
│ Drop folder: …/.dsh/chat-wallpaper          │
│                                             │
│ [thumb][thumb][thumb]                        │  ← click to apply
│                                             │
│ [No image]   [Open image folder]             │  ← the latter opens Explorer
│                                             │
│ Veil strength (dark theme)  50%              │
│ ▬▬▬▬▬●▬▬▬▬▬                                 │  ← applies live, no refresh
│                                             │
│ Intro video: ● Fullscreen intro: play once → fade → chat │
│              ○ Persistent background: loop behind chat   │
└─────────────────────────────────────────────┘
```

**The panel is independent of the wallpaper layer** (its own root element, its
own `<style>` tag, its own theme class) — so after the intro finishes and the
video layer is removed, the settings entry point is **still there**.

There is also a **「🔁 Replay intro」** button: the intro only plays once per
boot, so this lets you re-record it as many times as you like without
restarting DSH.

---

## Configuration

`~/.dsh/chat-wallpaper.json` (**config changes only need a page refresh**;
code changes need a restart):

```jsonc
{
  "video": "",                    // absolute path; empty = auto-scan ~/.dsh/boot-animation/videos/
  "objectFit": "cover",           // used in persistent-background mode; fullscreen intro is always cover
  "opacity": 1,                   // video layer opacity
  "playbackRate": 1,              // 1 = normal speed

  // Where the video goes
  "placement": "front",           // front = fullscreen, in front of the chat (second act)
                                  // behind = behind the chat, as a background

  // What happens when it ends
  "mode": "once",                 // once  = play once → fade out → chat
                                  // loop  = keep looping (pair with placement "behind")
  "fadeOutMs": 1200,              // fade duration for "once"

  // Chat wallpaper (independent of the video): empty = newest file in ~/.dsh/chat-wallpaper/
  "image": "",
  "imageFit": "cover",

  // Only meaningful for mode="loop": play through once, then loop within
  // [loopStart, loopEnd]. loopStart accepts an NLE timecode; the host converts
  // it to seconds using "fps".
  "loopStart": "00:00:05:23",
  "loopEnd": "",                  // empty = until the end of the video
  "fps": 24,

  // When to start playing: wait for the boot animation to finish (otherwise the
  // intro plays while it is still covered).
  "waitForBoot": true,
  "bootOverlaySelectors": ["#dsh-startup-root"],
  // The classes that mean "the boot animation has started leaving" — this is what
  // decides the cross-dissolve timing. Change it if you use another boot plugin.
  "bootLeaveClasses": ["dsu-handoff", "dsu-gone"],

  // The veil (readability insurance over the wallpaper): white for light themes,
  // dark for dark themes.
  "veilLightA": "rgba(253,250,254,.80)",
  "veilLightB": "rgba(250,247,253,.68)",
  "sidebarLight": "rgba(255,255,255,.78)",
  "fallbackLight": "#f7f1f8",
  "veilDarkA": "rgba(8,10,16,.50)",
  "veilDarkB": "rgba(6,8,14,.38)",
  "sidebarDark": "rgba(22,24,32,.74)",
  "fallbackDark": "#0b0d12"
}
```

> Config-only changes / swapping images / using the panel → **a page refresh is
> enough**. Note that inside Electron's DevTools you must open the devtools with
> `F12` first, otherwise `Ctrl+R` may not bypass the cache.

---

## Diagnostics and tools

| Endpoint | Purpose |
|---|---|
| `GET /chat-wallpaper/status` | which video/image is resolved, the source, the drop folder, the loop timecode converted to seconds |
| `GET /chat-wallpaper/config` | the config the browser half actually received |
| `GET /chat-wallpaper/images` | for the settings panel: image list + current selection |
| `GET /chat-wallpaper/video` | the video stream (with Range support — `<video>` needs it) |
| `GET /chat-wallpaper/image` | the wallpaper (`?name=xxx` picks one from the drop folder) |

Every log line in the browser console is prefixed with `[chat-wallpaper]`, and
the first one is **`client build cw-N 已加载`** — when something looks wrong,
check that number first: it tells you instantly whether you are looking at a
code problem or at a stale bundle.

**Two ready-to-use inspection tools** (no ffmpeg required):

```bash
# Full specs: real resolution / frame rate / duration / faststart / codec / keyframe positions
node test/inspect-mp4.mjs "your-video.mp4"

# Frame rate only (reads the stts table; tells CFR from VFR)
node test/probe-fps.mjs "your-video.mp4"
```

> These are pure-Node MP4 box parsers: resolution from `tkhd`/`stsd`, frame rate
> from `stts`, faststart by checking whether `moov` precedes `mdat`, keyframes
> from `stss`. **A loop point only seeks seamlessly if it lands on a keyframe** —
> check before you decide to use loop mode.

---

## Tests

**Eight suites, none of which need DSH running** (`node:vm` plus a hand-written
DOM stub):

```bash
npm test
```

| Suite | What it guards |
|---|---|
| `smoke-client` | CSS generation, theme detection (including "a transparent background is not black") |
| `smoke-mount` | **idempotent mounting** (prevents "click the window and the background flashes and restarts from 0") + loop ranges |
| `smoke-start` | **the start gate**: while the boot animation runs, **no layer may be mounted at all**; step on stage the moment `dsu-handoff` appears |
| `smoke-once` | `once` → fade → chat; the two layers stay decoupled; **the resurrection regression**; front mode never swallows clicks |
| `smoke-timecode` | `HH:MM:SS:FF` → seconds (with a cross-check) |
| `smoke-panel` / `smoke-panel-client` | the settings panel: listing, selection state, **the panel surviving the wallpaper teardown** |
| `smoke-host` | the Cordis contract (only the `default` export counts) |

### Red/green checks: proving a regression test actually catches the bug

**This is the most important part of our testing approach.**

The easiest mistake when writing a regression test is that **the test passes
without ever reaching the bug**. So there is a companion tool:

```bash
# Build a deliberately unfixed copy (removes `current = null` from teardown)
node test/make-nofix.mjs

# Run the same suite against it — it SHOULD go red
node test/smoke-once.mjs test/client.nofix.js
```

`test/make-nofix.mjs` writes `test/client.nofix.js` (gitignored).
**If it still passes, that test is not testing what it claims to** — that is how
we found two tests that "passed" while proving nothing at all.

---

## Pitfalls we hit (all covered by regression tests)

| Pitfall | Symptom | Root cause |
|---|---|---|
| **The wallpaper "resurrects"** | you see the fade-out, but the animation keeps **looping** behind the chat — and no longer lines up with the boot animation | `teardown()` never cleared `current`; more fundamentally, the theme observer contained `if (!mounted) applyNow(current)` — the moment the layer was removed it **mounted the wallpaper again**. **The observer may now only swap the theme class, never mount anything.** |
| **Geometric misjudgement of the boot timing** | the loop section was already playing when you entered, so the intro was wasted | Treating "zero size" as "the overlay is gone" — but a freshly inserted overlay usually *is* zero-sized. Now it only trusts the plugin's own classes. |
| **The fullscreen layer swallowed every click** | clicking anywhere controlled the animation; the UI was unusable | We had added `click → skip` to the fullscreen layer. **A fullscreen layer is always `pointer-events: none` now.** |
| **One click started playback** | a single mouse click started the video; the UI was unusable | We had added "retry `play()` on the first user gesture". **A fullscreen intro must play and finish on its own; a click is not a switch.** |
| **Setting `currentTime` on a video that has not loaded** | the fullscreen layer froze on frame 0, covered the UI, and only the watchdog cleaned it up | Setting `currentTime` before `loadedmetadata` leaves the element stuck in a seek state where `play()` never takes effect. **Only set it when `readyState >= 1`, and preload first.** |
| **The cross-dissolve was 780 ms late** | a flash of the chat window between the boot animation and the video | Watching only `dsu-gone`, while the fade *starts* earlier at `dsu-handoff` (780 ms). |
| **Only refreshing after a code change** | `web boot: 1 entry did not activate` — the app would not start | Editing a plugin's client file **while the host is running** invalidates the host's `rev` registry → 404 → the entry never activates → DSH refuses to boot. **Editing `lib/*.js` → restart. Config/images → refresh.** If startup fails, use the dialog's "disable third-party plugins, back up profile patches and restart" escape hatch. |
| **A test that did not test the thing** | the regression suite was green while the bug still reproduced | The test called an internal function directly, bypassing the real entry point (`applyNow` is where `current` is set). Only the **red/green check** caught it. |

---

## Credits and sources

Two of this plugin's key techniques **are not ours**, and it **depends on
another plugin's internal conventions**. Stated one by one:

### 1. [`KylinQ01/dsh-startup-animation`](https://github.com/KylinQ01/dsh-startup-animation) — MIT

**What we took:** the core technique of "make the shell's background transparent
so the wallpaper shows through". This plugin's
`--dsw-alias-bg-base: transparent` + `--dsw-specific-sidebar-fill` approach, and
the insight that panels/cards use *different* variables (and therefore keep text
readable), both come from that project's already-validated implementation.

**What we changed:** we did not copy its code, but we **adopted the technique**
and built two layers on top of it — "two veils (light/dark)" and "write our own
theme class instead of guessing DSH's internal markers".

### 2. [`dsh-startup-screen`](https://github.com/6shenhonghong9/dsh-startup-screen) — the boot animation plugin

**What we took:** its **internal conventions**. This plugin watches whether
`#dsh-startup-root` carries `dsu-handoff` / `dsu-gone` to decide when the boot
animation begins to leave, and that is what makes the cross-dissolve possible.
The `780 ms` / `620 ms` constants come from reading its `splash.js` /
`splash.css`.

**This is coupling, not copying.** That is why the signal classes are a config
option (`bootLeaveClasses`) — if upstream renames them, change the config, not
the code. Thanks to its author for making the animation this detailed —
especially the `dsu-handoff` step (push-in + defocus); that is why the dissolve
looks good.

### 3. [`NativeDog1/dsh-boot-animation`](https://github.com/NativeDog1/dsh-boot-animation)

**What we took:** the cyberpunk clip used as the intro material during this
project's development **came from that project's media library**, and was
upscaled to 2560×1440 by the user.

**⚠️ This repository contains no video, audio or image assets.** Bring your own
video.

### 4. [DeepSeek Harness](https://github.com/deepseek-ai)

The host platform itself. The host-half conventions (`ctx.webServer.register`
routes, the `cordis.patch.yml` bundle patch layer, the `dsh.client` browser-half
contract) all come from DSH's plugin specification.

### Statement

- This repository **copies no third-party code**; everything here was written
  independently;
- **Zero media**: no video / audio / image / font / binary files;
- Every "what we took" above is also written into the comments of
  `lib/client.js` and `lib/index.js` — please keep those attributions if you
  build on this.

**If you reuse the techniques in this project, please @ those projects too.**
If you used someone else's work, say so.

---

## License

[MIT](LICENSE) © 2026 LeeRolling
