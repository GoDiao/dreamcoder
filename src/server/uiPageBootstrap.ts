const UI_PAGE_BOOTSTRAP_SCRIPT = `(function () {
  var host = window.parent;
  if (!host || host === window) return;
  var initializeId = 1;
  var lastHeight = -1;
  var frame = 0;
  var observing = false;
  function send(message) {
    message.jsonrpc = '2.0';
    host.postMessage(message, '*');
  }
  function applyContext(context) {
    if (!context || typeof context !== 'object') return;
    var root = document.documentElement;
    if (context.theme !== 'light' && context.theme !== 'dark') return;
    root.style.colorScheme = context.theme;
    if (root.dataset.theme === context.theme) return;
    root.dataset.theme = context.theme;
    window.dispatchEvent(new Event('dreamcoder:theme'));
  }
  function reportSize() {
    frame = 0;
    var height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (height === lastHeight) return;
    lastHeight = height;
    send({ method: 'ui/notifications/size-changed', params: { width: window.innerWidth, height: height } });
  }
  function scheduleSize() {
    if (!frame) frame = requestAnimationFrame(reportSize);
  }
  function observeSize() {
    if (observing) return;
    observing = true;
    var observer = new ResizeObserver(scheduleSize);
    observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
    scheduleSize();
  }
  function reportError(message) {
    send({ method: 'notifications/message', params: { level: 'error', logger: 'page', data: String(message).slice(0, 1000) } });
  }
  window.addEventListener('message', function (event) {
    if (event.source !== host) return;
    var message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;
    if (message.id === initializeId && message.result) {
      applyContext(message.result.hostContext);
      send({ method: 'ui/notifications/initialized' });
      observeSize();
    } else if (message.method === 'ui/notifications/host-context-changed') {
      applyContext(message.params);
    }
  });
  window.addEventListener('error', function (event) {
    reportError(event.message || 'Script error');
  });
  window.addEventListener('unhandledrejection', function (event) {
    reportError(event.reason && event.reason.message ? event.reason.message : event.reason);
  });
  send({
    id: initializeId,
    method: 'ui/initialize',
    params: { protocolVersion: '2026-01-26', appInfo: { name: 'dreamcoder-page', version: '1' }, appCapabilities: {} }
  });
})();`

const UI_PAGE_DEFAULT_STYLE = 'html,body{margin:0}'

export const UI_PAGE_BOOTSTRAP_HTML = `<style>${UI_PAGE_DEFAULT_STYLE}</style><script>${UI_PAGE_BOOTSTRAP_SCRIPT}</script>`
