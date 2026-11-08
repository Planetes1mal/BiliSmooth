// Prepares playinfo payloads the page receives outside network calls: JSON.parse results
// and the page globals the player reads at startup.
import { signalText } from './request-rules.js';

export const PAYLOAD_GLOBALS = ['__playinfo__', '__INITIAL_STATE__', '__NEPTUNE_IS_MY_WAIFU__'];

export function installPayloadHooks({ scope, json, transform, isDisposed }) {
  const parse = json.parse, restores = [];
  function parseForPage(text, ...args) {
    const value = Reflect.apply(parse, this, [text, ...args]);
    return !isDisposed() && signalText(text) ? transform(value, 'JSON.parse').value : value;
  }
  json.parse = parseForPage;
  function connectGlobal(name) {
    const previous = Object.getOwnPropertyDescriptor(scope, name);
    if (previous?.configurable === false) return;
    let assigned = !!previous, value;
    try { value = scope[name]; } catch { return; }
    if (value) value = transform(value, name).value;
    const get = () => value, set = input => { assigned = true; value = transform(input, name).value; };
    try {
      Object.defineProperty(scope, name, { configurable: true, enumerable: true, get, set });
      restores.push(() => {
        const current = Object.getOwnPropertyDescriptor(scope, name); if (current?.get !== get || current?.set !== set) return;
        if (previous?.get || previous?.set) Object.defineProperty(scope, name, previous);
        else if (!assigned) delete scope[name];
        else Object.defineProperty(scope, name, { configurable: true, enumerable: true, writable: true, ...previous, value });
      });
    } catch {}
  }
  for (const name of PAYLOAD_GLOBALS) connectGlobal(name);
  return {
    restore() {
      if (json.parse === parseForPage) json.parse = parse;
      for (const restore of restores.reverse()) restore();
    }
  };
}
