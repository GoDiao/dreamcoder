(function () {
  var PREFIX = 'dreamcoder-deck:'
  var WIDTH = 1920
  var HEIGHT = 1080
  var MARGIN = 24
  var GRID_GAP = 96
  var GRID_PAD = 32
  var MIN_THUMBNAIL = 260
  var MAX_COLUMNS = 6
  var SETTLE_MS = 120
  var STYLE_ID = 'dc-deck-style'
  var TOKENS_ID = 'dc-deck-tokens'
  var SHEET_ID = 'dc-deck-sheet'
  var SHEET_FILE = 'deck.css'
  var SLIDE_ID = /^[A-Za-z0-9_-]{1,64}$/
  var REFERENCES = 'iframe[src],img[src],video[src],audio[src],source[src]'
  var MODES = ['browse', 'overview', 'present']
  var TEXT = {
    en: { empty: 'This deck has no slides yet', failed: 'Could not read the deck', missing: 'Could not read this slide', keys: '← → slides · F present · O overview · Esc back' },
    zh: { empty: '这份幻灯片还没有页面', failed: '无法读取幻灯片', missing: '无法读取这一页', keys: '← → 翻页 · F 演示 · O 总览 · Esc 返回' },
  }
  var text = /^zh/i.test(navigator.language || '') ? TEXT.zh : TEXT.en

  var baseUrl = new URL('.', location.href)
  var root = null
  var stage = null
  var notice = null
  var entries = []
  var sheets = {}
  var stamps = new WeakMap()
  var artifactId = null
  var mode = 'browse'
  var currentId = null
  var step = 0
  var columns = 1
  var standalone = false
  var bare = false
  var reported = ''
  var bust = 0
  var queue = Promise.resolve()
  var resolveLoaded = null
  var loaded = new Promise(function (resolve) {
    resolveLoaded = resolve
  })

  var STYLE = [
    ':root{color-scheme:light;--dc-bg:#e9e9e6;--dc-ink:#6b6b66;--dc-accent:#2f6fed}',
    ':root[data-scheme=dark]{color-scheme:dark;--dc-bg:#161614;--dc-ink:#9a9a94;--dc-accent:#6c9bff}',
    'html,body{margin:0;height:100%;overflow:hidden;background:var(--dc-bg)}',
    '#dc-deck{position:fixed;inset:0;overflow:hidden}',
    '#dc-deck[data-mode=overview]{overflow:auto}',
    '#dc-deck[data-mode=present]{background:#000}',
    '.dc-stage{position:absolute;left:0;top:0;width:' + WIDTH + 'px;height:' + HEIGHT + 'px;transform-origin:0 0;transform:translate(var(--dc-x,0px),var(--dc-y,0px)) scale(var(--dc-scale,1))}',
    '.dc-slide{position:absolute;left:0;top:0;width:' + WIDTH + 'px;height:' + HEIGHT + 'px;overflow:hidden;color-scheme:light;color:#000;background:#fff;visibility:hidden;opacity:0}',
    '.dc-slide{counter-increment:dc-slide}',
    '.dc-slide[data-current]{visibility:visible;opacity:1}',
    '.dc-slide>section{position:relative;box-sizing:border-box;width:' + WIDTH + 'px;height:' + HEIGHT + 'px;overflow:hidden}',
    '#dc-deck[data-mode=overview] .dc-stage{display:grid;grid-template-columns:repeat(var(--dc-columns,1),' + WIDTH + 'px);gap:' + GRID_GAP + 'px;width:max-content;height:auto;padding-bottom:var(--dc-tail,0px)}',
    '#dc-deck[data-mode=overview] .dc-slide{position:relative;visibility:visible;opacity:1;cursor:pointer;outline:12px solid transparent;outline-offset:12px}',
    '#dc-deck[data-mode=overview] .dc-slide[data-current]{outline-color:var(--dc-accent)}',
    '#dc-deck[data-mode=overview] .dc-slide>section{pointer-events:none}',
    '[data-dc-pending]{visibility:hidden!important;opacity:0!important}',
    '.dc-missing{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;width:' + WIDTH + 'px;height:' + HEIGHT + 'px;font:36px system-ui,-apple-system,"Segoe UI",sans-serif;color:#6b6b66;background:#f4f4f2}',
    '.dc-notice{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font:13px system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--dc-ink);text-align:center}',
    '.dc-hint{position:absolute;left:0;right:0;bottom:5px;font:11px system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--dc-ink);text-align:center;pointer-events:none}',
    '#dc-deck:not([data-mode=browse]) .dc-hint{display:none}',
    '@page{size:' + WIDTH + 'px ' + HEIGHT + 'px;margin:0}',
    '@media print{',
    'html,body{height:auto!important;overflow:visible!important;background:none!important}',
    '#dc-deck{position:static!important;overflow:visible!important;background:none!important}',
    '.dc-stage{position:static!important;display:block!important;width:' + WIDTH + 'px!important;height:auto!important;padding:0!important;transform:none!important}',
    '.dc-slide{position:relative!important;visibility:visible!important;opacity:1!important;outline:0!important;break-after:page;break-inside:avoid}',
    '.dc-slide:last-child{break-after:auto}',
    '[data-dc-pending]{visibility:visible!important;opacity:1!important}',
    '.dc-notice,.dc-hint{display:none!important}',
    '}',
  ].join('\n')

  function emit(message) {
    console.log(PREFIX + JSON.stringify(message))
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return
    var style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = STYLE
    document.head.appendChild(style)
  }

  function indexOf(id) {
    for (var i = 0; i < entries.length; i += 1) if (entries[i].id === id) return i
    return -1
  }

  function slideTitle(entry) {
    var heading = entry.element.querySelector('h1,h2,h3,h4,h5,h6')
    var value = heading ? heading.textContent.replace(/\s+/g, ' ').trim() : ''
    return value || entry.id
  }

  function state() {
    var index = indexOf(currentId)
    var entry = entries[index]
    return {
      artifact: artifactId,
      slide: entry ? entry.id : null,
      title: entry ? slideTitle(entry) : null,
      index: index,
      count: entries.length,
      mode: mode,
    }
  }

  function report() {
    var current = state()
    var encoded = JSON.stringify(current)
    if (encoded === reported) return
    reported = encoded
    current.type = 'state'
    emit(current)
  }

  function fragments(entry) {
    return Array.prototype.slice.call(entry.element.querySelectorAll('.fragment'))
  }

  function applyStep() {
    entries.forEach(function (entry) {
      var list = fragments(entry)
      var shown = mode === 'present' && entry.id === currentId ? step : list.length
      list.forEach(function (node, index) {
        if (index < shown) node.removeAttribute('data-dc-pending')
        else node.setAttribute('data-dc-pending', '')
      })
    })
  }

  function setVariable(name, value) {
    stage.style.setProperty(name, value)
  }

  function layout() {
    var width = window.innerWidth
    var height = window.innerHeight
    if (mode === 'overview') {
      columns = Math.max(1, Math.min(MAX_COLUMNS, entries.length, Math.floor((width - GRID_PAD * 2) / MIN_THUMBNAIL)))
      var natural = columns * WIDTH + (columns - 1) * GRID_GAP
      var fit = Math.max(0.01, (width - GRID_PAD * 2) / natural)
      setVariable('--dc-columns', String(columns))
      setVariable('--dc-scale', String(fit))
      setVariable('--dc-x', GRID_PAD + 'px')
      setVariable('--dc-y', GRID_PAD + 'px')
      setVariable('--dc-tail', GRID_PAD / fit + 'px')
      return
    }
    var margin = bare || mode === 'present' ? 0 : MARGIN
    var scale = Math.max(0.01, Math.min((width - margin * 2) / WIDTH, (height - margin * 2) / HEIGHT))
    setVariable('--dc-scale', String(scale))
    setVariable('--dc-x', (width - WIDTH * scale) / 2 + 'px')
    setVariable('--dc-y', (height - HEIGHT * scale) / 2 + 'px')
    setVariable('--dc-tail', '0px')
  }

  function hashId() {
    try {
      return decodeURIComponent(location.hash.slice(1))
    } catch (error) {
      return ''
    }
  }

  function reveal(entry) {
    if (mode === 'overview' && entry.element.scrollIntoView) entry.element.scrollIntoView({ block: 'nearest' })
  }

  function show(id) {
    var index = indexOf(id)
    if (index < 0) return false
    currentId = id
    entries.forEach(function (entry) {
      if (entry.id === id) entry.element.setAttribute('data-current', '')
      else entry.element.removeAttribute('data-current')
    })
    applyStep()
    if (hashId() !== id) history.replaceState(null, '', '#' + id)
    report()
    return true
  }

  function open(id) {
    step = 0
    if (!show(id)) return false
    reveal(entries[indexOf(id)])
    return true
  }

  function goTo(id) {
    return indexOf(id) >= 0 && open(id)
  }

  function turn(delta) {
    var index = indexOf(currentId)
    var target = entries[Math.max(0, Math.min(entries.length - 1, index + delta))]
    return !!target && target.id !== currentId && open(target.id)
  }

  function next() {
    var entry = entries[indexOf(currentId)]
    if (mode === 'present' && entry && step < fragments(entry).length) {
      step += 1
      applyStep()
      return
    }
    turn(1)
  }

  function prev() {
    if (mode === 'present' && step > 0) {
      step -= 1
      applyStep()
      return
    }
    if (!turn(-1) || mode !== 'present') return
    step = fragments(entries[indexOf(currentId)]).length
    applyStep()
  }

  function setMode(nextMode) {
    if (MODES.indexOf(nextMode) < 0 || nextMode === mode) return
    mode = nextMode
    step = 0
    root.setAttribute('data-mode', mode)
    applyStep()
    layout()
    var entry = entries[indexOf(currentId)]
    if (entry) reveal(entry)
    report()
  }

  function setScheme(scheme) {
    if (scheme !== 'light' && scheme !== 'dark') return
    document.documentElement.setAttribute('data-scheme', scheme)
  }

  function present() {
    setMode('present')
    var element = document.documentElement
    if (!element.requestFullscreen) return
    element.requestFullscreen().catch(function (error) {
      console.warn('[deck] the browser refused full screen', error)
    })
  }

  function leavePresent() {
    if (!standalone) {
      emit({ type: 'exit' })
      return
    }
    if (document.fullscreenElement) document.exitFullscreen()
    setMode('browse')
  }

  function isTyping(target) {
    return !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || ''))
  }

  function keyActions() {
    var actions = {
      Home: function () {
        turn(-entries.length)
      },
      End: function () {
        turn(entries.length)
      },
    }
    if (mode === 'overview') {
      actions.ArrowLeft = function () {
        turn(-1)
      }
      actions.ArrowRight = function () {
        turn(1)
      }
      actions.ArrowUp = function () {
        turn(-columns)
      }
      actions.ArrowDown = function () {
        turn(columns)
      }
      actions.Enter = actions.Escape = function () {
        setMode('browse')
      }
    } else {
      actions.ArrowRight = actions.PageDown = next
      actions.ArrowLeft = actions.PageUp = prev
    }
    if (mode === 'present') {
      actions[' '] = next
      actions.Escape = leavePresent
    } else if (standalone) {
      actions.f = actions.F = present
      actions.o = actions.O = function () {
        setMode(mode === 'overview' ? 'browse' : 'overview')
      }
    }
    return actions
  }

  function placeholder(id) {
    var box = document.createElement('div')
    box.className = 'dc-missing'
    var title = document.createElement('div')
    title.textContent = text.missing
    var file = document.createElement('div')
    file.textContent = 'slides/' + id + '.html'
    box.appendChild(title)
    box.appendChild(file)
    return box
  }

  function parseSection(html) {
    var parsed = new DOMParser().parseFromString(html, 'text/html')
    var children = parsed.body.children
    return children.length === 1 && children[0].tagName === 'SECTION' ? children[0] : null
  }

  function fill(entry, source) {
    var section = typeof source === 'string' ? parseSection(source) : null
    entry.element.textContent = ''
    entry.element.appendChild(section ? document.adoptNode(section) : placeholder(entry.id))
    entry.source = source
  }

  function createEntry(id) {
    var element = document.createElement('div')
    element.className = 'dc-slide'
    element.setAttribute('data-slide', id)
    return { id: id, element: element, source: undefined }
  }

  function watchLoad(link) {
    return new Promise(function (resolve) {
      link.addEventListener('load', resolve, { once: true })
      link.addEventListener('error', resolve, { once: true })
    })
  }

  function syncSheet(id, href, content) {
    var record = sheets[id]
    if (record && record.href !== href) {
      record.link.remove()
      delete sheets[id]
      record = null
    }
    if (!href) return
    if (!record) {
      var link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = href
      sheets[id] = { link: link, href: href, content: content, loaded: watchLoad(link) }
      document.head.insertBefore(link, id === TOKENS_ID ? document.getElementById(SHEET_ID) : null)
      return
    }
    var stale = record.content !== undefined && record.content !== content
    record.content = content
    if (!stale) return
    bust += 1
    record.loaded = watchLoad(record.link)
    record.link.href = href + '?t=' + bust
  }

  function slideIds(manifest) {
    var seen = {}
    return (Array.isArray(manifest.slides) ? manifest.slides : []).filter(function (id) {
      if (typeof id !== 'string' || !SLIDE_ID.test(id) || seen[id]) return false
      seen[id] = true
      return true
    })
  }

  function readText(url) {
    return fetch(url.toString(), { cache: 'no-store' }).then(
      function (response) {
        return response.ok ? response.text() : null
      },
      function () {
        return null
      },
    )
  }

  function load() {
    return fetch(new URL('artifact.json', baseUrl).toString(), { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('manifest')
        return response.json()
      })
      .then(function (manifest) {
        var ids = slideIds(manifest)
        var tokens = typeof manifest.designSystem === 'string' && manifest.designSystem !== '' ? '../' + manifest.designSystem + '/tokens.css' : null
        return Promise.all([
          Promise.all(
            ids.map(function (id) {
              return readText(new URL('slides/' + id + '.html', baseUrl))
            }),
          ),
          readText(new URL(SHEET_FILE, baseUrl)),
          tokens ? readText(new URL(tokens, baseUrl)) : null,
        ]).then(function (results) {
          return { manifest: manifest, ids: ids, sources: results[0], sheet: results[1], tokens: tokens, tokensContent: results[2] }
        })
      })
  }

  function apply(data) {
    var changed = false
    artifactId = typeof data.manifest.id === 'string' ? data.manifest.id : null
    if (typeof data.manifest.title === 'string' && data.manifest.title !== '') document.title = data.manifest.title
    syncSheet(TOKENS_ID, data.tokens, data.tokensContent)
    syncSheet(SHEET_ID, SHEET_FILE, data.sheet)

    var known = {}
    entries.forEach(function (entry) {
      known[entry.id] = entry
    })
    var nextEntries = data.ids.map(function (id, index) {
      var entry = known[id] || createEntry(id)
      if (entry.source !== data.sources[index]) {
        fill(entry, data.sources[index])
        changed = true
      }
      return entry
    })
    if (nextEntries.length !== entries.length) changed = true
    entries.forEach(function (entry, index) {
      if (nextEntries[index] !== entry) changed = true
      if (nextEntries.indexOf(entry) < 0) entry.element.remove()
    })
    nextEntries.forEach(function (entry, index) {
      if (stage.children[index] !== entry.element) stage.insertBefore(entry.element, stage.children[index] || null)
    })
    entries = nextEntries
    countSlides()
    notice.textContent = entries.length === 0 ? text.empty : ''
    return changed
  }

  function referenceUrl(element) {
    try {
      var url = new URL(element.getAttribute('src'), baseUrl)
      url.hash = ''
      return url.protocol === baseUrl.protocol && url.host === baseUrl.host ? url.toString() : null
    } catch (error) {
      return null
    }
  }

  function readStamp(url) {
    return fetch(url, { method: 'HEAD', cache: 'no-store' }).then(
      function (response) {
        return response.status + ' ' + (response.headers.get('etag') || '')
      },
      function () {
        return ''
      },
    )
  }

  function reloadReference(element) {
    if (element.tagName !== 'SOURCE') element.setAttribute('src', element.getAttribute('src'))
    else if (element.parentNode && element.parentNode.load) element.parentNode.load()
  }

  function syncReferences() {
    var elementsByUrl = {}
    entries.forEach(function (entry) {
      Array.prototype.forEach.call(entry.element.querySelectorAll(REFERENCES), function (element) {
        var url = referenceUrl(element)
        if (url) (elementsByUrl[url] = elementsByUrl[url] || []).push(element)
      })
    })
    return Promise.all(
      Object.keys(elementsByUrl).map(function (url) {
        return readStamp(url).then(function (stamp) {
          elementsByUrl[url].forEach(function (element) {
            var known = stamps.get(element)
            stamps.set(element, stamp)
            if (known !== undefined && known !== stamp) reloadReference(element)
          })
        })
      }),
    )
  }

  function countSlides() {
    stage.style.setProperty('counter-reset', 'dc-slide 0 dc-slides ' + entries.length)
  }

  function keepPlace(preferred, fallbackIndex) {
    var kept = indexOf(preferred) >= 0
    var fallback = entries[Math.max(0, Math.min(entries.length - 1, fallbackIndex))]
    if (kept) {
      step = Math.min(step, fragments(entries[indexOf(preferred)]).length)
      show(preferred)
    } else if (fallback) open(fallback.id)
    else currentId = null
    layout()
    report()
  }

  function refresh() {
    if (standalone) return Promise.resolve(false)
    queue = queue.then(function () {
      return load()
        .then(function (data) {
          var previous = indexOf(currentId)
          if (apply(data)) keepPlace(currentId, previous)
          return syncReferences()
        })
        .then(
          function () {
            return true
          },
          function (error) {
            console.warn('[deck] could not refresh the deck', error)
            return true
          },
        )
    })
    return queue
  }

  function stageRect() {
    var entry = entries[indexOf(currentId)]
    if (!entry) return null
    var rect = entry.element.getBoundingClientRect()
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
  }

  function describe(element) {
    var name = element.tagName.toLowerCase()
    var first = (element.getAttribute('class') || '').trim().split(/\s+/)[0]
    return first ? name + '.' + first : name
  }

  function collectOverflow(element, frame, scale, found) {
    for (var i = 0; i < element.children.length; i += 1) {
      var child = element.children[i]
      var rect = child.getBoundingClientRect()
      var box = {
        left: Math.round((rect.left - frame.left) / scale),
        top: Math.round((rect.top - frame.top) / scale),
        right: Math.round((rect.right - frame.left) / scale),
        bottom: Math.round((rect.bottom - frame.top) / scale),
      }
      var empty = rect.width === 0 && rect.height === 0
      if (!empty && (box.left < 0 || box.top < 0 || box.right > WIDTH || box.bottom > HEIGHT)) {
        box.element = describe(child)
        box.text = (child.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
        found.push(box)
      } else {
        collectOverflow(child, frame, scale, found)
      }
    }
  }

  function overflow() {
    var result = []
    entries.forEach(function (entry) {
      var frame = entry.element.getBoundingClientRect()
      var found = []
      var section = entry.element.querySelector(':scope > section')
      if (section && frame.width > 0) collectOverflow(section, frame, frame.width / WIDTH, found)
      if (found.length > 0) result.push({ slide: entry.id, elements: found })
    })
    return result
  }

  function settled(element, done) {
    return new Promise(function (resolve) {
      if (done(element)) {
        resolve()
        return
      }
      element.addEventListener('load', resolve, { once: true })
      element.addEventListener('error', resolve, { once: true })
    })
  }

  function frameLoaded(frame) {
    try {
      return frame.contentDocument.readyState === 'complete' && frame.contentWindow.location.href !== 'about:blank'
    } catch (error) {
      return true
    }
  }

  function prepareCapture() {
    bare = true
    return loaded.then(function () {
      layout()
      var entry = entries[indexOf(currentId)]
      var waits = Object.keys(sheets).map(function (id) {
        return sheets[id].loaded
      })
      if (entry) {
        Array.prototype.forEach.call(entry.element.querySelectorAll('img'), function (image) {
          waits.push(
            settled(image, function (node) {
              return node.complete
            }),
          )
        })
        Array.prototype.forEach.call(entry.element.querySelectorAll('iframe[src]'), function (frame) {
          waits.push(settled(frame, frameLoaded))
        })
      }
      if (document.fonts && document.fonts.ready) waits.push(document.fonts.ready)
      return Promise.all(waits).then(function () {
        return new Promise(function (resolve) {
          setTimeout(resolve, SETTLE_MS)
        })
      })
    })
  }

  function listen() {
    window.addEventListener('resize', layout)
    window.addEventListener('hashchange', function () {
      var id = hashId()
      if (id !== currentId) goTo(id)
    })
    document.addEventListener('keydown', function (event) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return
      var action = keyActions()[event.key]
      if (!action) return
      event.preventDefault()
      action()
    })
    stage.addEventListener('click', function (event) {
      if (mode !== 'overview') return
      var slide = event.target.closest('.dc-slide')
      if (!slide) return
      goTo(slide.getAttribute('data-slide'))
      setMode('browse')
    })
    document.addEventListener('fullscreenchange', function () {
      if (standalone && !document.fullscreenElement) setMode('browse')
    })
  }

  function build() {
    root = document.createElement('div')
    root.id = 'dc-deck'
    root.setAttribute('data-mode', mode)
    stage = document.createElement('div')
    stage.className = 'dc-stage'
    notice = document.createElement('div')
    notice.className = 'dc-notice'
    root.appendChild(stage)
    root.appendChild(notice)
    document.body.appendChild(root)
    syncSheet(SHEET_ID, SHEET_FILE, undefined)
    listen()
    layout()
    return load().then(
      function (data) {
        apply(data)
        keepPlace(hashId(), 0)
        return syncReferences()
      },
      function () {
        notice.textContent = text.failed
      },
    )
  }

  function adopt(existing) {
    standalone = true
    root = existing
    stage = root.querySelector('.dc-stage')
    notice = root.querySelector('.dc-notice')
    root.setAttribute('data-mode', mode)
    entries = Array.prototype.map.call(stage.querySelectorAll(':scope > .dc-slide'), function (element) {
      return { id: element.getAttribute('data-slide'), element: element, source: undefined }
    })
    countSlides()
    var hint = root.querySelector('.dc-hint') || root.appendChild(document.createElement('div'))
    hint.className = 'dc-hint'
    hint.textContent = text.keys
    listen()
    keepPlace(hashId(), 0)
  }

  function boot() {
    ensureStyle()
    var existing = document.getElementById('dc-deck')
    var started = existing && existing.querySelector('.dc-slide') ? adopt(existing) : build()
    Promise.resolve(started).then(resolveLoaded)
  }

  window.__dreamcoderDeck = {
    state: state,
    goTo: goTo,
    next: next,
    prev: prev,
    setMode: setMode,
    setScheme: setScheme,
    refresh: refresh,
    stageRect: stageRect,
    overflow: overflow,
    prepareCapture: prepareCapture,
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
