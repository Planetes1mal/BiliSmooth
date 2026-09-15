(function (scope) {
  'use strict';
  const session = scope.BiliSmoothSession;
  if (!session) return;
  const commands = new Set(['state', 'config', 'reset', 'retry', 'applyRoute', 'clearData', 'clearEvents', 'diagnostics', 'boost', 'reload', 'resetFloatingPosition']);
  const saves = new Set(['config', 'applyRoute', 'clearData', 'boost', 'reload']);
  scope.addEventListener('message', async event => {
    const message = event.data;
    if (event.source !== scope || event.origin !== scope.location.origin || message?.__biliSmooth !== 'request' ||
      typeof message.id !== 'string' || message.id.length > 100 || !commands.has(message.action)) return;
    try {
      let attempted;
      switch (message.action) {
        case 'config': session.setConfig(scope.BiliSmoothSettings.patch(message.patch)); break;
        case 'reset': session.resetNetwork(); break;
        case 'resetFloatingPosition':
          if (!scope.BiliSmoothFloating?.resetPosition) throw new Error('floating-unavailable');
          scope.BiliSmoothFloating.resetPosition(); break;
        case 'clearEvents': session.clearEvents(); break;
        case 'clearData': session.clearData(); break;
        case 'retry': attempted = session.retry(); break;
        case 'boost': attempted = session.boost(); break;
        case 'reload': attempted = session.reload(); break;
        case 'applyRoute': attempted = typeof message.patch?.host === 'string' && session.applyRoute(message.patch.host); break;
      }
      if (saves.has(message.action)) await session.flushSettings();
      const result = message.action === 'diagnostics' ? session.getDiagnostics() : session.getState();
      if (attempted !== undefined) result.retryAttempted = result.routeApplied = attempted;
      scope.postMessage({ __biliSmooth: 'response', id: message.id, ok: true, result }, scope.location.origin);
      if (attempted && ['reload', 'boost'].includes(message.action)) scope.setTimeout(() => scope.location.reload(), 100);
    } catch {
      scope.postMessage({ __biliSmooth: 'response', id: message.id, ok: false,
        error: saves.has(message.action) ? 'settings-save-failed' : 'command-failed' }, scope.location.origin);
    }
  });
})(globalThis);
