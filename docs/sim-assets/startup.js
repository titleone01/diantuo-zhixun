(function () {
  'use strict';
  var root = document.getElementById('root');
  var initial = document.getElementById('dt-startup');
  if (!root || !initial) return;
  var template = initial.cloneNode(true);
  var started = false;
  var legacy = /MSIE|Trident\/|Edge\//.test(navigator.userAgent);
  var supported = !legacy && 'noModule' in document.createElement('script') &&
    typeof window.fetch === 'function' && typeof window.Promise === 'function' &&
    typeof window.Map === 'function' && typeof window.Set === 'function' &&
    typeof window.AbortController === 'function' && typeof window.ResizeObserver === 'function' &&
    typeof window.DOMMatrixReadOnly === 'function' && typeof Object.fromEntries === 'function' &&
    window.crypto && typeof window.crypto.getRandomValues === 'function';
  function show(kind) {
    if (!supported) kind = 'browser';
    var view = document.getElementById('dt-startup');
    if (!view) { root.textContent = ''; view = template.cloneNode(true); root.appendChild(view); }
    var browser = kind === 'browser';
    view.querySelector('[data-startup-title]').textContent = browser ? '请使用新版浏览器打开' : '实训工作台暂时未能打开';
    view.querySelector('[data-startup-message]').textContent = browser ?
      '当前浏览器版本过旧或处于兼容模式。请使用新版 Microsoft Edge 或 Chrome；360、QQ等浏览器请切换到极速模式。' :
      '页面资源可能未加载完整，或启动时遇到错误。请检查网络后重新加载；若仍无法打开，请将下方提示代码告诉管理员。';
    view.querySelector('[data-startup-code]').textContent = browser ? 'BROWSER_UNSUPPORTED' : kind === 'resource' ? 'APP_RESOURCE_FAILED' : 'APP_START_FAILED';
    view.querySelector('[data-startup-actions]').removeAttribute('hidden');
    view.querySelector('[data-startup-reload]').onclick = function () { window.location.reload(); };
  }
  window.diantuoStartup = {
    supported: !!supported,
    complete: function () { started = true; window.clearTimeout(timer); },
    failed: function () { window.setTimeout(function () { show('runtime'); }, 0); }
  };
  window.addEventListener('error', function (event) {
    var target = event.target;
    if (target && target.tagName === 'SCRIPT' && target.type === 'module') show('resource');
    else if (!started && event.message) show('runtime');
  }, true);
  var timer = window.setTimeout(function () { if (!started) show('resource'); }, 25000);
  if (!supported) { window.clearTimeout(timer); show('browser'); }
}());
