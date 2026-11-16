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
  var INLINE = /^(A|ABBR|B|BDI|BDO|BR|CITE|CODE|DATA|DEL|DFN|EM|I|INS|KBD|MARK|Q|S|SAMP|SMALL|SPAN|STRONG|SUB|SUP|TIME|U|VAR|WBR)$/
  var DRAG_DISTANCE = 6
  var MOVE_MS = 150
  var ZOOM_MS = 220
  var SAVED_MS = 600
  var EASE = 'cubic-bezier(.2,0,0,1)'
  var LIFT = '0 24px 96px rgba(0,0,0,.4)'
  var LABEL = 22
  var EDGE = 56
  var EDGE_SPEED = 0.3
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
  var scale = 1
  var standalone = false
  var bare = false
  var reported = ''
  var bust = 0
  var editing = false
  var active = null
  var held = false
  var edits = []
  var drag = null
  var dragged = false
  var motions = new WeakMap()
  var hovered = null
  var RAISED = { zIndex: 1 }
  var LIFTED = { zIndex: 1, boxShadow: LIFT }
  var LANDED = { zIndex: 1, boxShadow: 'none' }
  var busy = false
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
    '#dc-deck[data-mode=overview] .dc-stage{display:grid;grid-template-columns:repeat(var(--dc-columns,1),' + WIDTH + 'px);gap:calc(' + GRID_GAP + 'px + ' + LABEL + 'px / var(--dc-scale,1)) ' + GRID_GAP + 'px;width:max-content;height:auto;padding-bottom:var(--dc-tail,0px)}',
    '#dc-deck[data-mode=overview] .dc-slide{position:relative;overflow:visible;visibility:visible;opacity:1;cursor:pointer;user-select:none;outline:12px solid transparent;outline-offset:12px;transition:outline-color .12s}',
    '#dc-deck[data-mode=overview] .dc-slide:hover{outline-color:color-mix(in srgb,var(--dc-accent) 35%,transparent)}',
    '#dc-deck[data-mode=overview] .dc-slide[data-current]{outline-color:var(--dc-accent)}',
    '#dc-deck[data-mode=overview] .dc-slide::after{content:counter(dc-slide);position:absolute;left:0;top:100%;padding-top:calc(7px / var(--dc-scale,1));font:calc(11px / var(--dc-scale,1))/1 system-ui,-apple-system,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums;color:var(--dc-ink)}',
    '#dc-deck[data-mode=overview] .dc-slide[data-current]::after{color:var(--dc-accent)}',
    '#dc-deck[data-mode=overview] .dc-slide>section{pointer-events:none}',
    '[data-dc-pending]{visibility:hidden!important;opacity:0!important}',
    '#dc-deck[data-editing] [data-dc-editable]{cursor:text;outline:4px solid color-mix(in srgb,var(--dc-accent) 40%,transparent);outline-offset:8px}',
    '.dc-slide [contenteditable]{outline:4px solid var(--dc-accent);outline-offset:8px}',
    '#dc-deck[data-editing][data-mode=overview] .dc-slide{cursor:grab}',
    '#dc-deck[data-mode=overview] .dc-slide[data-dc-dragging]{z-index:1;box-shadow:' + LIFT + ';cursor:grabbing}',
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
    '.dc-slide [contenteditable],[data-dc-editable]{outline:0!important}',
    '.dc-slide::after{display:none!important}',
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
      editing: editing,
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
      scale = Math.max(0.01, (width - GRID_PAD * 2) / natural)
      setVariable('--dc-columns', String(columns))
      setVariable('--dc-scale', String(scale))
      setVariable('--dc-x', GRID_PAD + 'px')
      setVariable('--dc-y', GRID_PAD + 'px')
      setVariable('--dc-tail', GRID_PAD / scale + 'px')
      return
    }
    var margin = bare || mode === 'present' ? 0 : MARGIN
    scale = Math.max(0.01, Math.min((width - margin * 2) / WIDTH, (height - margin * 2) / HEIGHT))
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
    if (active && active.entry.id !== id) finishEdit(true)
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
    finishEdit(true)
    cancelDrag()
    hover(null)
    entries.forEach(stopMotion)
    if (nextMode === 'present') markEditing(false)
    var entry = entries[indexOf(currentId)]
    var from = entry && mode !== 'present' && nextMode !== 'present' ? entry.element.getBoundingClientRect() : null
    mode = nextMode
    step = 0
    root.setAttribute('data-mode', mode)
    applyStep()
    layout()
    if (entry) reveal(entry)
    if (from) {
      glide(entry.element, from, entry.element.getBoundingClientRect(), RAISED, RAISED)
      if (mode === 'overview') entries.forEach(function (other) {
        if (other !== entry) fadeIn(other.element)
      })
    }
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

  function markBusy(on) {
    if (busy === on) return
    busy = on
    emit({ type: 'busy', on: on })
  }

  function markEditing(on) {
    editing = on
    if (on) root.setAttribute('data-editing', '')
    else {
      root.removeAttribute('data-editing')
      hover(null)
    }
  }

  function setEditing(on) {
    var next = !!on && !standalone && mode !== 'present'
    if (next === editing) return
    if (!next) {
      finishEdit(true)
      cancelDrag()
    }
    markEditing(next)
    report()
  }

  function onlyInline(element) {
    for (var i = 0; i < element.children.length; i += 1) {
      var child = element.children[i]
      if (!INLINE.test(child.tagName) || !onlyInline(child)) return false
    }
    return true
  }

  function editableBlock(element) {
    return !!element && /\S/.test(element.textContent || '') && onlyInline(element)
  }

  function editableUnit(target, section) {
    if (!(target instanceof HTMLElement) || target.closest('svg')) return null
    var node = target
    var outer = null
    while (node !== section && INLINE.test(node.tagName)) {
      outer = node
      node = node.parentElement
    }
    if (node !== section && editableBlock(node)) return node
    return editableBlock(outer) ? outer : null
  }

  function pathOf(element, section) {
    var path = []
    for (var node = element; node !== section; node = node.parentElement) path.unshift(Array.prototype.indexOf.call(node.parentElement.children, node))
    return path
  }

  function follow(section, path) {
    var node = section
    for (var i = 0; node && i < path.length; i += 1) node = node.children[path[i]]
    return node || null
  }

  function currentSection() {
    var entry = entries[indexOf(currentId)]
    var section = entry && entry.element.firstElementChild
    return section && section.tagName === 'SECTION' ? { entry: entry, section: section } : null
  }

  function unitAt(target) {
    if (!editing || mode !== 'browse') return null
    var current = currentSection()
    return current && current.section.contains(target) ? editableUnit(target, current.section) : null
  }

  function hover(unit) {
    if (unit === hovered) return
    if (hovered) hovered.removeAttribute('data-dc-editable')
    hovered = unit
    if (unit) unit.setAttribute('data-dc-editable', '')
  }

  function trimEnd(node) {
    if (node) node.nodeValue = node.nodeValue.replace(/ $/, '')
  }

  function collapseSpace(element) {
    var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    var last = null
    var open = true
    while (walker.nextNode()) {
      var node = walker.currentNode
      if (node.nodeType !== Node.TEXT_NODE) {
        if (node.tagName !== 'BR') continue
        trimEnd(last)
        last = null
        open = true
        continue
      }
      var value = node.nodeValue.replace(/[ \t\n\r\f]+/g, ' ')
      if (open && value.charAt(0) === ' ') value = value.slice(1)
      node.nodeValue = value
      if (value === '') continue
      open = value.charAt(value.length - 1) === ' '
      last = node
    }
    trimEnd(last)
  }

  function breakLines(element) {
    var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    var nodes = []
    while (walker.nextNode()) if (walker.currentNode.nodeValue !== '') nodes.push(walker.currentNode)
    var last = nodes[nodes.length - 1]
    if (last) last.nodeValue = last.nodeValue.replace(/\n+$/, '')
    nodes.forEach(function (node) {
      var lines = node.nodeValue.split('\n')
      if (lines.length === 1) return
      var parts = document.createDocumentFragment()
      lines.forEach(function (line, index) {
        if (index > 0) parts.appendChild(document.createElement('br'))
        parts.appendChild(document.createTextNode(line))
      })
      node.parentNode.replaceChild(parts, node)
    })
  }

  function startEdit(event) {
    if (event.button !== 0 || (active && active.element.contains(event.target))) return
    finishEdit(true)
    var unit = unitAt(event.target)
    if (!unit) return
    hover(null)
    var original = unit.innerHTML
    var spaced = /^(pre|pre-wrap|pre-line|break-spaces)$/.test(getComputedStyle(unit).whiteSpace)
    if (!spaced) collapseSpace(unit)
    unit.setAttribute('contenteditable', 'plaintext-only')
    unit.addEventListener('keydown', editKey)
    unit.addEventListener('blur', editBlur)
    active = { entry: entries[indexOf(currentId)], element: unit, original: original, before: unit.innerHTML, spaced: spaced }
    markBusy(true)
    unit.focus()
  }

  function editKey(event) {
    if (event.isComposing) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      finishEdit(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      finishEdit(false)
    }
  }

  function editBlur() {
    finishEdit(true)
  }

  function finishEdit(commit) {
    var current = active
    if (!current) return
    active = null
    var element = current.element
    element.removeEventListener('keydown', editKey)
    element.removeEventListener('blur', editBlur)
    element.removeAttribute('contenteditable')
    if (document.activeElement === element) element.blur()
    if (commit && !current.spaced) breakLines(element)
    var changed = commit && element.innerHTML !== current.before
    if (!changed) element.innerHTML = current.original
    var submitted = changed && submitEdit(current.entry, element)
    if (submitted) {
      element.animate([{ outline: '4px solid var(--dc-accent)', outlineOffset: '8px' }, { outline: '4px solid transparent', outlineOffset: '8px' }], { duration: SAVED_MS, easing: 'ease-out' })
      report()
    }
    markBusy(false)
    if (!held) return
    held = false
    if (!submitted) refresh()
  }

  function submitEdit(entry, element) {
    var previous = entry.source
    var copy = typeof previous === 'string' ? parseSection(previous) : null
    var target = copy && follow(copy, pathOf(element, entry.element.firstElementChild))
    if (!target) {
      console.warn('[deck] could not place an edit in the source of a slide', entry.id)
      return false
    }
    target.innerHTML = element.innerHTML
    var html = previous.match(/^\s*/)[0] + copy.outerHTML + previous.match(/\s*$/)[0]
    entry.source = html
    edits.push({ id: entry.id, html: html, previous: previous })
    emit({ type: 'edit' })
    return true
  }

  function takeEdit() {
    return edits.shift() || null
  }

  function moveEntry(entry, index) {
    var from = entries.indexOf(entry)
    if (from === index) return
    entries.splice(from, 1)
    entries.splice(index, 0, entry)
    stage.insertBefore(entry.element, stage.children[index + (index > from ? 1 : 0)] || null)
  }

  function slotOf(index) {
    return { x: (index % columns) * (WIDTH + GRID_GAP), y: Math.floor(index / columns) * (HEIGHT + GRID_GAP + LABEL / scale) }
  }

  function slotAt(clientX, clientY) {
    var box = stage.getBoundingClientRect()
    var pitch = slotOf(columns)
    var column = Math.max(0, Math.min(columns - 1, Math.floor(((clientX - box.left) / scale + GRID_GAP / 2) / (WIDTH + GRID_GAP))))
    var row = Math.max(0, Math.floor(((clientY - box.top) / scale + (pitch.y - HEIGHT) / 2) / pitch.y))
    return Math.min(entries.length - 1, row * columns + column)
  }

  function stopMotion(entry) {
    var running = motions.get(entry.element)
    if (running) running.cancel()
  }

  function play(element, start, end, duration) {
    motions.set(element, element.animate([start, end], { duration: duration, easing: EASE }))
  }

  function fadeIn(element) {
    play(element, { opacity: 0 }, { opacity: 1 }, MOVE_MS)
  }

  function glide(element, from, to, start, end) {
    if (to.width === 0 || (from.left === to.left && from.top === to.top && from.width === to.width)) return
    var zoomed = from.width !== to.width
    var transform = 'translate(' + (from.left - to.left) / scale + 'px,' + (from.top - to.top) / scale + 'px)' + (zoomed ? ' scale(' + from.width / to.width + ')' : '')
    play(element, Object.assign({ transformOrigin: '0 0', transform: transform }, start), Object.assign({ transformOrigin: '0 0', transform: 'none' }, end), zoomed ? ZOOM_MS : MOVE_MS)
  }

  function flow(change, landing) {
    if (mode !== 'overview') return change()
    var before = entries.slice()
    var boxes = before.map(boxOf)
    var result = change()
    before.forEach(stopMotion)
    var targets = entries.map(boxOf)
    entries.forEach(function (entry, index) {
      var from = boxes[before.indexOf(entry)]
      if (!from) fadeIn(entry.element)
      else if (drag && entry === drag.entry) return
      else if (entry === landing) glide(entry.element, from, targets[index], LIFTED, LANDED)
      else glide(entry.element, from, targets[index])
    })
    return result
  }

  function boxOf(entry) {
    return entry.element.getBoundingClientRect()
  }

  function carry() {
    var box = stage.getBoundingClientRect()
    var slot = slotOf(entries.indexOf(drag.entry))
    var x = Math.max(0, Math.min(slotOf(columns - 1).x, (drag.clientX - box.left) / scale - drag.grab.x))
    var y = Math.max(0, Math.min(slotOf(entries.length - 1).y, (drag.clientY - box.top) / scale - drag.grab.y))
    drag.entry.element.style.transform = 'translate(' + (x - slot.x) + 'px,' + (y - slot.y) + 'px)'
  }

  function place() {
    var to = slotAt(drag.clientX, drag.clientY)
    if (to !== entries.indexOf(drag.entry)) {
      flow(function () {
        moveEntry(drag.entry, to)
      })
    }
    carry()
  }

  function scrollAtEdge(current) {
    if (drag !== current) return
    var past = current.clientY < EDGE ? current.clientY - EDGE : Math.max(0, current.clientY - (window.innerHeight - EDGE))
    var top = root.scrollTop
    if (past !== 0) root.scrollTop = top + past * EDGE_SPEED
    if (root.scrollTop !== top) place()
    requestAnimationFrame(function () {
      scrollAtEdge(current)
    })
  }

  function drop(current) {
    current.entry.element.removeAttribute('data-dc-dragging')
    current.entry.element.removeAttribute('style')
  }

  function startDrag(event) {
    dragged = false
    if (!editing || mode !== 'overview' || event.button !== 0) return
    var element = event.target.closest && event.target.closest('.dc-slide')
    var index = element ? indexOf(element.getAttribute('data-slide')) : -1
    if (index < 0) return
    var box = stage.getBoundingClientRect()
    var slot = slotOf(index)
    drag = {
      entry: entries[index],
      x: event.clientX,
      y: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      grab: { x: (event.clientX - box.left) / scale - slot.x, y: (event.clientY - box.top) / scale - slot.y },
      moved: false,
      before: entries.map(idOf),
    }
  }

  function idOf(entry) {
    return entry.id
  }

  function moveDrag(event) {
    if (!drag) return
    drag.clientX = event.clientX
    drag.clientY = event.clientY
    if (!drag.moved) {
      if (Math.abs(event.clientX - drag.x) < DRAG_DISTANCE && Math.abs(event.clientY - drag.y) < DRAG_DISTANCE) return
      drag.moved = true
      drag.entry.element.setAttribute('data-dc-dragging', '')
      markBusy(true)
      scrollAtEdge(drag)
    }
    place()
  }

  function endDrag() {
    var current = drag
    if (!current) return
    drag = null
    if (!current.moved) return
    dragged = true
    flow(function () {
      drop(current)
    }, current.entry)
    var ids = entries.map(idOf)
    if (ids.join('\n') !== current.before.join('\n')) {
      report()
      emit({ type: 'order', slides: ids })
    }
    markBusy(false)
  }

  function cancelDrag() {
    if (!drag) return
    var current = drag
    drag = null
    dragged = current.moved
    flow(function () {
      drop(current)
      current.before.forEach(function (id, index) {
        moveEntry(entries[indexOf(id)], index)
      })
    }, current.entry)
    markBusy(false)
  }

  function nudge(delta) {
    var from = indexOf(currentId)
    var to = Math.max(0, Math.min(entries.length - 1, from + delta))
    if (from < 0 || to === from) return
    flow(function () {
      moveEntry(entries[from], to)
    })
    reveal(entries[to])
    report()
    emit({ type: 'order', slides: entries.map(idOf) })
  }

  function moveAction(event) {
    var delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key]
    if (!delta || !editing || mode !== 'overview' || drag || event.repeat) return null
    return function () {
      nudge(delta)
    }
  }

  function keyActions() {
    if (drag && drag.moved) return { Escape: cancelDrag }
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
      if (!standalone) {
        actions.Delete = actions.Backspace = function () {
          if (currentId) emit({ type: 'delete' })
        }
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
    var sources = {}
    data.ids.forEach(function (id, index) {
      sources[id] = data.sources[index]
    })
    var ids = data.ids
    if (drag && ids.join('\n') === drag.before.join('\n')) ids = entries.map(idOf)
    else cancelDrag()
    if (active && ids.indexOf(active.entry.id) < 0) finishEdit(false)
    var nextEntries = ids.map(function (id) {
      var entry = known[id] || createEntry(id)
      if (entry.source === sources[id]) return entry
      if (active && active.entry === entry) held = true
      else {
        fill(entry, sources[id])
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
          var changed = flow(function () {
            return apply(data)
          })
          if (changed) keepPlace(currentId, previous)
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
      if (event.defaultPrevented || event.altKey || isTyping(event.target)) return
      var action = event.ctrlKey || event.metaKey ? moveAction(event) : keyActions()[event.key]
      if (!action) return
      event.preventDefault()
      action()
    })
    stage.addEventListener('pointerdown', function (event) {
      startEdit(event)
      startDrag(event)
    })
    stage.addEventListener('pointermove', function (event) {
      var unit = unitAt(event.target)
      hover(active && active.element === unit ? null : unit)
    })
    stage.addEventListener('pointerleave', function () {
      hover(null)
    })
    document.addEventListener('pointermove', moveDrag)
    document.addEventListener('pointerup', endDrag)
    document.addEventListener('pointercancel', cancelDrag)
    stage.addEventListener('click', function (event) {
      if (dragged) {
        dragged = false
        return
      }
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
    root.removeAttribute('data-editing')
    Array.prototype.forEach.call(root.querySelectorAll('[contenteditable]'), function (element) {
      element.removeAttribute('contenteditable')
    })
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
    setEditing: setEditing,
    takeEdit: takeEdit,
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
