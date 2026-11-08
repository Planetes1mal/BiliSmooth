// Relays dashboard commands from the content script to the runtime contract. The content
// script forwards any action; this is the whitelist.
import settings from '../core/settings.js';
import { COMMANDS, SAVING_COMMANDS } from './ui-contract.js';

export function installControlBridge({ scope, runtime }) {
  scope.addEventListener('message', async event => {
    const message = event.data;
    if (event.source !== scope || event.origin !== scope.location.origin || message?.__biliSmooth !== 'request' ||
      typeof message.id !== 'string' || message.id.length > 100) return;
    const reply = payload => scope.postMessage({ __biliSmooth: 'response', id: message.id, ...payload }, scope.location.origin);
    if (!COMMANDS.includes(message.action)) { reply({ ok: false, error: 'unknown-command' }); return; }
    try {
      let attempted;
      switch (message.action) {
        case 'config': runtime.setConfig(settings.patch(message.patch)); break;
        case 'reset': runtime.resetNetwork(); break;
        case 'resetFloatingPosition':
          if (!scope.BiliSmoothFloating?.resetPosition) throw new Error('floating-unavailable');
          scope.BiliSmoothFloating.resetPosition(); break;
        case 'clearEvents': runtime.clearEvents(); break;
        case 'clearData': runtime.clearData(); break;
        case 'retry': attempted = runtime.retry(); break;
        case 'reload': attempted = runtime.reload(); break;
        case 'applyRoute': attempted = typeof message.patch?.host === 'string' && runtime.applyRoute(message.patch.host); break;
      }
      if (SAVING_COMMANDS.includes(message.action)) await runtime.flushSettings();
      const result = message.action === 'diagnostics' ? runtime.getDiagnostics() : runtime.getState();
      if (attempted !== undefined) result.retryAttempted = result.routeApplied = attempted;
      reply({ ok: true, result });
      if (attempted && message.action === 'reload') scope.setTimeout(() => scope.location.reload(), 100);
    } catch {
      reply({ ok: false, error: SAVING_COMMANDS.includes(message.action) ? 'settings-save-failed' : 'command-failed' });
    }
  });
}
