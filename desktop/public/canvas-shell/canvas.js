(function () {
  var PREFIX = 'dreamcoder-canvas:'
  var MIN_SCALE = 0.1
  var MAX_SCALE = 4
  var MIN_BOARD = 120
  var HEADER = 28
  var PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2]
  var STEP = 1.25
  var TEXT = {
    en: { open: 'Open in new tab', interact: 'Interact', stopInteract: 'Stop interacting', missing: 'File not found', unsafe: 'Not a file inside this canvas', empty: 'This canvas has no boards yet', failed: 'Could not read the canvas', zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoom: 'Zoom', fit: 'Fit all boards' },
    zh: { open: '在新标签打开', interact: '交互', stopInteract: '退出交互', missing: '找不到文件', unsafe: '不是画布内的文件', empty: '这个画布还没有画板', failed: '无法读取画布', zoomIn: '放大', zoomOut: '缩小', zoom: '缩放', fit: '适应全部画板' },
  }
  var text = /^zh/i.test(navigator.language || '') ? TEXT.zh : TEXT.en

  var manifestUrl = new URL('artifact.json', location.href)
  var view = { x: 0, y: 0, scale: 1 }
  var fitted = false
  var boards = new Map()
  var activeDrag = null
  var interactive = null

  function emit(message) {
    console.log(PREFIX + JSON.stringify(message))
  }

  function isSafeBoardFile(file) {
    if (typeof file !== 'string' || file.trim() === '' || file.indexOf('\0') >= 0) return false
    if (file.charAt(0) === '/' || file.charAt(0) === '\\' || /^[a-z]:/i.test(file)) return false
    if (/^[a-z][a-z0-9+.-]*:/i.test(file)) return false
    return file.split(/[\\/]/).indexOf('..') < 0
  }

  function boardUrl(file) {
    var url = new URL(file, manifestUrl)
    return url.origin === manifestUrl.origin && url.pathname.indexOf(manifestUrl.pathname.replace(/artifact\.json$/, '')) === 0 ? url : null
  }

  var style = document.createElement('style')
  style.textContent = [
    ':root{color-scheme:light;--bg:#f4f4f2;--dot:#d6d6d2;--card:#ffffff;--bar:#ececea;--ink:#1d1d1b;--mute:#6b6b66;--line:#cfcfca;--accent:#2f6fed}',
    ':root[data-scheme=dark]{color-scheme:dark;--bg:#161614;--dot:#2c2c29;--card:#1f1f1d;--bar:#2a2a27;--ink:#ececea;--mute:#9a9a94;--line:#3a3a36;--accent:#6c9bff}',
    'html,body{margin:0;height:100%;overflow:hidden;background:var(--bg);color:var(--ink);font:13px system-ui,-apple-system,"Segoe UI",sans-serif}',
    '#viewport{position:fixed;inset:0;overflow:hidden;cursor:grab;user-select:none;background-image:radial-gradient(var(--dot) 1px,transparent 1px);background-size:24px 24px;touch-action:none}',
    '#viewport.panning{cursor:grabbing}',
    '#stage{position:absolute;left:0;top:0;transform-origin:0 0}',
    '.board{position:absolute;display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.12);overflow:hidden}',
    '.board-bar{flex:0 0 ' + HEADER + 'px;display:flex;align-items:center;gap:8px;padding:0 6px 0 10px;background:var(--bar);cursor:move;user-select:none}',
    '.board-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--mute)}',
    '.board-open{border:0;background:transparent;color:var(--accent);cursor:pointer;font:inherit;padding:2px 4px}',
    '.board-frame{flex:1;border:0;width:100%;background:#fff;pointer-events:none}',
    '.board-note{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;color:var(--mute);padding:12px;text-align:center;word-break:break-all}',
    '.board-resize{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize}',
    '.board-resize::after{content:"";position:absolute;right:3px;bottom:3px;width:8px;height:8px;border-right:2px solid var(--mute);border-bottom:2px solid var(--mute)}',
    '.board.interactive{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent)}',
    '.board.interactive .board-frame{pointer-events:auto}',
    '.dragging .board.interactive .board-frame,#viewport.panning .board.interactive .board-frame{pointer-events:none}',
    '#notice{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);color:var(--mute)}',
    '#tools{position:fixed;top:12px;right:12px;z-index:10;display:flex;align-items:center;gap:2px;padding:3px;background:var(--bar);border:1px solid var(--line);border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.12);user-select:none}',
    '#tools button{border:0;background:transparent;color:var(--ink);cursor:pointer;font:inherit;border-radius:5px;height:24px;min-width:24px;padding:0 6px}',
    '#tools button:hover{background:var(--line)}',
    '#zoom-percent{min-width:52px;text-align:center}',
    '#zoom-menu{position:absolute;top:100%;right:0;margin-top:6px;min-width:150px;display:flex;flex-direction:column;padding:4px;background:var(--bar);border:1px solid var(--line);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.18)}',
    '#zoom-menu[hidden]{display:none}',
    '#zoom-menu button{text-align:left;height:26px}',
    '#zoom-menu .current{color:var(--accent)}',
    '#zoom-menu hr{border:0;border-top:1px solid var(--line);margin:4px 0;width:100%}',
  ].join('\n')
  document.head.appendChild(style)

  var viewport = document.createElement('div')
  viewport.id = 'viewport'
  var stage = document.createElement('div')
  stage.id = 'stage'
  viewport.appendChild(stage)
  document.body.appendChild(viewport)
  var notice = document.createElement('div')
  notice.id = 'notice'
  document.body.appendChild(notice)

  var tools = document.createElement('div')
  tools.id = 'tools'
  var zoomOutButton = toolButton('zoom-out', '\u2212', text.zoomOut)
  var percent = toolButton('zoom-percent', '', text.zoom)
  var zoomInButton = toolButton('zoom-in', '+', text.zoomIn)
  var menu = document.createElement('div')
  menu.id = 'zoom-menu'
  menu.hidden = true
  var presetButtons = PRESETS.map(function (value) {
    var button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('data-zoom', String(value))
    button.textContent = Math.round(value * 100) + '%'
    button.addEventListener('click', function () {
      zoomTo(value)
      menu.hidden = true
    })
    menu.appendChild(button)
    return button
  })
  menu.appendChild(document.createElement('hr'))
  var fitButton = document.createElement('button')
  fitButton.type = 'button'
  fitButton.id = 'zoom-fit'
  fitButton.textContent = text.fit
  fitButton.addEventListener('click', function () {
    fit(currentList())
    menu.hidden = true
  })
  menu.appendChild(fitButton)
  tools.appendChild(zoomOutButton)
  tools.appendChild(percent)
  tools.appendChild(zoomInButton)
  tools.appendChild(menu)
  document.body.appendChild(tools)

  function toolButton(id, label, title) {
    var button = document.createElement('button')
    button.type = 'button'
    button.id = id
    button.textContent = label
    button.title = title
    button.setAttribute('aria-label', title)
    return button
  }

  function currentList() {
    var list = []
    boards.forEach(function (entry) {
      list.push(entry.board)
    })
    return list
  }

  function zoomTo(target) {
    zoomAt(window.innerWidth / 2, window.innerHeight / 2, target / view.scale)
  }

  zoomOutButton.addEventListener('click', function () {
    zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / STEP)
  })
  zoomInButton.addEventListener('click', function () {
    zoomAt(window.innerWidth / 2, window.innerHeight / 2, STEP)
  })
  percent.addEventListener('click', function () {
    menu.hidden = !menu.hidden
  })
  document.addEventListener('pointerdown', function (event) {
    if (!tools.contains(event.target)) menu.hidden = true
    if (interactive && !interactive.element.contains(event.target)) setInteractive(null)
  }, true)

  function applyView() {
    stage.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')'
    var shown = Math.round(view.scale * 100)
    percent.textContent = shown + '%'
    presetButtons.forEach(function (button) {
      button.className = Math.round(Number(button.getAttribute('data-zoom')) * 100) === shown ? 'current' : ''
    })
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value))
  }

  function zoomAt(clientX, clientY, factor) {
    var next = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE)
    var ratio = next / view.scale
    view.x = clientX - (clientX - view.x) * ratio
    view.y = clientY - (clientY - view.y) * ratio
    view.scale = next
    applyView()
  }

  function fit(list) {
    if (list.length === 0) return
    var minX = Infinity
    var minY = Infinity
    var maxX = -Infinity
    var maxY = -Infinity
    list.forEach(function (board) {
      minX = Math.min(minX, board.x)
      minY = Math.min(minY, board.y)
      maxX = Math.max(maxX, board.x + board.width)
      maxY = Math.max(maxY, board.y + board.height + HEADER)
    })
    var pad = 48
    var width = Math.max(1, maxX - minX)
    var height = Math.max(1, maxY - minY)
    var scale = clamp(Math.min(1, (window.innerWidth - pad * 2) / width, (window.innerHeight - pad * 2) / height), MIN_SCALE, 1)
    view.scale = scale
    view.x = (window.innerWidth - width * scale) / 2 - minX * scale
    view.y = (window.innerHeight - height * scale) / 2 - minY * scale
    applyView()
  }

  function note(container, message, detail) {
    var box = document.createElement('div')
    box.className = 'board-note'
    var title = document.createElement('div')
    title.textContent = message
    box.appendChild(title)
    if (detail) {
      var file = document.createElement('div')
      file.textContent = detail
      box.appendChild(file)
    }
    container.appendChild(box)
  }

  function place(element, board) {
    element.style.left = board.x + 'px'
    element.style.top = board.y + 'px'
    element.style.width = board.width + 'px'
    element.style.height = board.height + HEADER + 'px'
  }

  function syncInteract(entry) {
    var on = entry === interactive
    var label = on ? text.stopInteract : text.interact
    entry.interact.textContent = label
    entry.interact.setAttribute('aria-pressed', on ? 'true' : 'false')
    entry.interact.setAttribute('aria-label', label + ': ' + (entry.board.title || entry.board.id))
  }

  function setInteractive(entry) {
    if (entry === interactive) return
    var previous = interactive
    interactive = entry
    if (previous) {
      previous.element.classList.remove('interactive')
      syncInteract(previous)
    }
    if (entry) {
      entry.element.classList.add('interactive')
      syncInteract(entry)
      var frame = entry.content.querySelector('iframe')
      if (frame) frame.focus()
    }
  }

  function leaveOnEscape(event) {
    if (event.key !== 'Escape' || !interactive) return
    var entry = interactive
    setInteractive(null)
    entry.interact.focus()
  }
  document.addEventListener('keydown', leaveOnEscape)

  function beginDrag(event, entry, mode) {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    activeDrag = {
      entry: entry,
      mode: mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: entry.board.x, y: entry.board.y, width: entry.board.width, height: entry.board.height },
    }
    document.body.classList.add('dragging')
  }

  function loadFrame(entry, bust) {
    var board = entry.board
    var content = entry.content
    content.textContent = ''
    if (!isSafeBoardFile(board.file)) {
      note(content, text.unsafe, String(board.file))
      return Promise.resolve()
    }
    var url = boardUrl(board.file)
    if (!url) {
      note(content, text.unsafe, board.file)
      return Promise.resolve()
    }
    return fetch(url.toString(), { cache: 'no-store' }).then(
      function (response) {
        if (!response.ok) {
          note(content, text.missing, board.file)
          return
        }
        var frame = document.createElement('iframe')
        frame.className = 'board-frame'
        frame.title = board.title || board.id
        frame.src = bust ? url.toString() + '?t=' + Date.now() : url.toString()
        frame.addEventListener('load', function () {
          var frameDocument = frame.contentDocument
          if (frameDocument) frameDocument.addEventListener('keydown', leaveOnEscape)
        })
        content.appendChild(frame)
      },
      function () {
        note(content, text.missing, board.file)
      },
    )
  }

  function createEntry(board) {
    var element = document.createElement('div')
    element.className = 'board'
    element.setAttribute('data-board', board.id)
    var bar = document.createElement('div')
    bar.className = 'board-bar'
    var title = document.createElement('span')
    title.className = 'board-title'
    var open = document.createElement('button')
    open.className = 'board-open'
    open.type = 'button'
    open.textContent = text.open
    var interact = document.createElement('button')
    interact.className = 'board-open board-interact'
    interact.type = 'button'
    var content = document.createElement('div')
    content.style.cssText = 'flex:1;min-height:0;display:flex'
    var handle = document.createElement('div')
    handle.className = 'board-resize'
    bar.appendChild(title)
    bar.appendChild(interact)
    bar.appendChild(open)
    element.appendChild(bar)
    element.appendChild(content)
    element.appendChild(handle)
    var entry = { board: board, element: element, title: title, content: content, interact: interact }
    bar.addEventListener('pointerdown', function (event) {
      if (event.target === open || event.target === interact) return
      beginDrag(event, entry, 'move')
    })
    handle.addEventListener('pointerdown', function (event) {
      beginDrag(event, entry, 'resize')
    })
    open.addEventListener('click', function () {
      emit({ type: 'open', id: entry.board.id })
    })
    interact.addEventListener('click', function () {
      setInteractive(interactive === entry ? null : entry)
    })
    stage.appendChild(element)
    return entry
  }

  function render(manifestBoards, bust) {
    var list = Array.isArray(manifestBoards) ? manifestBoards.filter(validBoard) : []
    var seen = new Set()
    var loading = []
    list.forEach(function (board) {
      seen.add(board.id)
      var entry = boards.get(board.id)
      var fileChanged = !entry || entry.board.file !== board.file
      if (!entry) {
        entry = createEntry(board)
        boards.set(board.id, entry)
      }
      entry.board = board
      entry.title.textContent = board.title || board.id
      syncInteract(entry)
      place(entry.element, board)
      if (fileChanged || bust) loading.push(loadFrame(entry, bust))
    })
    boards.forEach(function (entry, id) {
      if (seen.has(id)) return
      entry.element.remove()
      boards.delete(id)
    })
    notice.textContent = list.length === 0 ? text.empty : ''
    if (!fitted) {
      fitted = true
      fit(list)
    }
    return Promise.all(loading)
  }

  function validBoard(board) {
    return (
      board &&
      typeof board.id === 'string' &&
      typeof board.file === 'string' &&
      [board.x, board.y, board.width, board.height].every(function (value) {
        return typeof value === 'number' && isFinite(value)
      })
    )
  }

  function readManifest() {
    return fetch(manifestUrl.toString(), { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('manifest')
      return response.json()
    })
  }

  function refresh() {
    return readManifest().then(
      function (manifest) {
        return render(manifest.boards, true)
      },
      function () {
        notice.textContent = text.failed
      },
    )
  }

  document.addEventListener('pointermove', function (event) {
    if (!activeDrag) return
    var drag = activeDrag
    var dx = (event.clientX - drag.startX) / view.scale
    var dy = (event.clientY - drag.startY) / view.scale
    var board = drag.entry.board
    if (drag.mode === 'move') {
      board.x = drag.origin.x + dx
      board.y = drag.origin.y + dy
    } else {
      board.width = Math.max(MIN_BOARD, drag.origin.width + dx)
      board.height = Math.max(MIN_BOARD, drag.origin.height + dy)
    }
    place(drag.entry.element, board)
  })

  function endDrag() {
    if (!activeDrag) return
    var board = activeDrag.entry.board
    var origin = activeDrag.origin
    var entry = activeDrag.entry
    activeDrag = null
    document.body.classList.remove('dragging')
    board.x = Math.round(board.x)
    board.y = Math.round(board.y)
    board.width = Math.round(board.width)
    board.height = Math.round(board.height)
    place(entry.element, board)
    if (board.x === origin.x && board.y === origin.y && board.width === origin.width && board.height === origin.height) return
    emit({ type: 'move', id: board.id, x: board.x, y: board.y, width: board.width, height: board.height })
  }
  document.addEventListener('pointerup', endDrag)
  document.addEventListener('pointercancel', endDrag)

  var panning = null
  viewport.addEventListener('pointerdown', function (event) {
    if (event.target.closest('.board-bar, .board-resize')) return
    if (event.button !== undefined && event.button !== 0) return
    panning = { startX: event.clientX, startY: event.clientY, x: view.x, y: view.y }
    viewport.classList.add('panning')
  })
  viewport.addEventListener('dblclick', function (event) {
    if (event.target.closest('.board-bar, .board-resize')) return
    var board = event.target.closest('.board')
    var entry = board && boards.get(board.getAttribute('data-board'))
    if (entry) setInteractive(entry)
  })
  document.addEventListener('pointermove', function (event) {
    if (!panning) return
    view.x = panning.x + event.clientX - panning.startX
    view.y = panning.y + event.clientY - panning.startY
    applyView()
  })
  function endPan() {
    panning = null
    viewport.classList.remove('panning')
  }
  document.addEventListener('pointerup', endPan)
  document.addEventListener('pointercancel', endPan)

  viewport.addEventListener(
    'wheel',
    function (event) {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.01))
        return
      }
      view.x -= event.deltaX
      view.y -= event.deltaY
      applyView()
    },
    { passive: false },
  )

  function setScheme(scheme) {
    if (scheme !== 'light' && scheme !== 'dark') return
    document.documentElement.setAttribute('data-scheme', scheme)
    document.documentElement.style.colorScheme = scheme
  }

  window.__dreamcoderCanvas = {
    refresh: refresh,
    setScheme: setScheme,
    view: function () {
      return { x: view.x, y: view.y, scale: view.scale }
    },
    boardTitle: function (documentUrl) {
      var pathname
      try {
        pathname = new URL(documentUrl, location.href).pathname
      } catch (error) {
        return null
      }
      var found = null
      boards.forEach(function (entry) {
        var url = isSafeBoardFile(entry.board.file) ? boardUrl(entry.board.file) : null
        if (!found && url && url.pathname === pathname) found = entry.board.title || entry.board.id
      })
      return found
    },
  }

  applyView()
  readManifest().then(
    function (manifest) {
      return render(manifest.boards, false)
    },
    function () {
      notice.textContent = text.failed
    },
  )
})()
