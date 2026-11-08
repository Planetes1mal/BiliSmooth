// MAIN-world entry of the playback bundle. Publishes the runtime contract as BiliSmoothRuntime
// and the settings module as BiliSmoothSettings for the UI scripts that follow in the bundle.
import settings from '../core/settings.js';
import { createSession } from './session.js';
import { installControlBridge } from './control-bridge.js';

const scope = globalThis;
if (!scope.BiliSmoothRuntime) {
  const version = typeof __BILISMOOTH_VERSION__ === 'string' ? __BILISMOOTH_VERSION__ : 'dev';
  const runtime = createSession({ scope, version });
  scope.BiliSmoothSettings = settings;
  scope.BiliSmoothRuntime = runtime;
  installControlBridge({ scope, runtime });
}
