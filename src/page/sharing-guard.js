// Peer-sharing protection: the page's P2P SDK slots become inert and WebRTC peer constructors are denied.
// Installed only when the p2pGuard setting is on; changing that setting needs a page reload.
const capabilities = {
  localEvents: ['PCDNLoader', 'BPP2PSDK', 'SeederSDK'],
  remotePeer: ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection']
};
export function protectCapabilitySlots(scope, onAttempt) {
  const handlers = {
    localEvents: {
      apply: () => undefined,
      construct: (_target, _arguments, derived) => Object.create(derived.prototype, {
        on: { value: () => undefined, configurable: false, enumerable: false, writable: false }
      })
    },
    remotePeer: {
      invoke(name) {
        onAttempt?.(name);
        throw new (scope.DOMException || globalThis.DOMException)('BiliSmooth sharing protection', 'NotAllowedError');
      }
    }
  };
  for (const [kind, names] of Object.entries(capabilities)) for (const name of names) {
    const current = Object.getOwnPropertyDescriptor(scope, name);
    if (current?.configurable === false) continue;
    // The slot remains stable when a page publishes a later implementation.
    // SDK calls create local inert subscriptions; remote peer calls are denied.
    const constructor = kind === 'remotePeer' && typeof scope[name] === 'function' ? scope[name] : function BiliSmoothCapability() {};
    const gate = new Proxy(constructor, kind === 'localEvents' ? handlers.localEvents : {
      apply: () => handlers.remotePeer.invoke(name), construct: () => handlers.remotePeer.invoke(name)
    });
    Object.defineProperty(scope, name, { configurable: false, enumerable: current?.enumerable ?? true,
      get: () => gate, set: () => undefined });
  }
}
