# Architecture

The rules that span modules and the contract between the playback core and the UI. Module internals, field names and thresholds are in the source; `src/core/delivery-policy.js` holds every number.

## Layout

- `src/core/`: pure modules, no browser state. Settings, routing policy, media catalog, delivery session, delivery policy, throughput, regional history.
- `src/page/`: the MAIN-world session. `main.js` is the bundle entry. `session.js` composes the page side (player observer, startup timeline, stall episodes, speed meter, video metadata, transfer accounting, settings sync, event log). `playback-kernel.js` composes the delivery side (request ledger, router, race coordinator, delivery monitor, history store, snapshots) over `request-interceptor.js` (fetch hook, XHR hook, payload hooks, synthetic timeout, sharing guard). `ui-contract.js` and `control-bridge.js` are the only surface the UIs reach.
- `src/extension/`: `content.js` (isolated world) relays settings and dashboard commands; `background.js` is the settings authority and opens the dashboard tab.
- `src/ui/` and `src/page/floating-control.js`: the dashboard and the floating control, classic scripts. They read `BiliSmoothRuntime` and `BiliSmoothSettings` and nothing else from the core.
- Build: esbuild bundles `src/page/main.js` into `playback.js` and appends the UI scripts unchanged; `settings.js` and `settings-migration.js` are bundled as classic scripts for `content.js` and `background.js`. The version is injected at build time from `package.json`; nothing in `src/` carries it.

## Boundaries

- The kernel alone decides measurement, racing, request targets and recovery for the current video. The session observes playback and accounts transfers; it never routes. `network-probe.js` returns measurements and never picks a target. The UIs read state and send whitelisted commands.
- Every module receives its collaborators as arguments (`scope`, `document`, clocks, sibling modules). No core module reads a `BiliSmooth*` global; the tests pass a fake `scope` and never run a VM.
- Two clocks, both taken from `scope`: `performance.now()` orders events and measures durations; `Date.now()` stamps records, logs and persisted history.
- `bilismooth.config.v4` in extension storage is the single settings authority. The background serializes every read or patch as read latest → whitelist merge → write → receipt. The MAIN world reads the same-origin startup cache synchronously, then takes the authoritative config; every page edit is a patch with a save receipt (`settings-sync.js`). A page reload waits for the receipt.
- A settings change that cannot apply in place sets `needReload` with a reason: a routing key after a manifest was delivered, the sharing guard, or a failed storage read or write.

## Routing

- Startup never probes. A race compares at most two challengers, each with one closed Range request of at most 768 KiB body (1.5 MiB per race), 4 s deadline, no cookies, the player's signed URL. At least 10 s between races, doubling after each automatic race; at most four whole-video switches per cid. Changing a threshold also changes the privacy policy and store text, which quote these limits; the store tool's review fails on a mismatch.
- A race starts from one verdict of `delivery-policy.decide` (stuck, shortfall, errors) on an in-flight video Range, or from the user. The raced Range is a contender too: if any attempt of it completes before the winner, the current host is kept.
- A winner moves the fragment or the whole video. A fragment win leaves the video on its host; a stuck Range retries on the winner through the player's own timeout callback, at most once per Range, and the mechanism disables itself for the page if the player does not retry within 3 s.
- Fixed routes accept only valid bilivideo UPOS hosts. Akamai is used only through the original signed URL Bilibili served for the current representation, never by swapping the host of a UPOS URL. Native backup URLs and their order are kept.
- Regional history (`bilismooth.delivery-history.v1.<timezone>|<language>`) only orders challengers. It never sets the current video's target and never causes a request.
- "Test other routes" saves nothing. "Reset network records" bumps the network epoch: old requests, measurements, fragment hosts and failures stop counting; per-cid switch counts and cooldowns stay; the current region's history is cleared; no probe starts.

## Evidence

- Unknown values stay unknown (`null`, shown as —); nothing is interpolated or repeated from an older sample. Speed is video bytes over wall time across complete 3 s windows, observed idle zeros included; a transfer counts only for the current media generation and network epoch.
- "Smooth" requires recent, visible, healthy frame evidence. Region locks, unavailable videos and paid-only videos are read from data already on the page, add no requests, and are never shown as buffering or stalls. `-404` alone does not prove deletion or a region lock.
- A stall episode counts observed buffering or frozen time only; seeking and gaps between observations are kept apart. Recovery needs 2 s of healthy frames.
- Diagnostics exports keep hosts, times and Ranges. They never contain signed URLs, cookies, page titles or page text; `videoMeta` is for the UI only.

## Core↔UI contract

`src/page/ui-contract.js` defines everything a UI may read or do; `main.js` publishes it as `globalThis.BiliSmoothRuntime`. The module header lists every field. Add a field there when a UI needs more; never read a core module from the UI.

- Reads: `getViewState()` is the compact view for every render of the floating control. It reads cached observations only: no DOM scan, no frame sample, no copy of the kernel's session record. `getState()` is the full state for the dashboard, once per second: the view plus `startup`, `startupHistory`, `session`, `counters`, `recoveryAttempts`, `audioHost`, `networkEpoch`, `speedSamples`, `sampledAt`, `events`. `getDiagnostics()` is the export. `getConfig()` is the normalized settings. `subscribe(fn)` fires after every change.
- Commands: `setConfig(patch)` and `flushSettings()` (resolves on the storage receipt, rejects with the storage error), `applyRoute(host)`, `retry()`, `resetNetwork()`, `reload()` (persists, then the caller reloads), `clearEvents()`, `clearData()`. `rewriteUrl(url)` is a check hook, not a UI command.
- The floating control calls the object directly and uses `BiliSmoothSettings` to validate what it sends. The dashboard sends command names through the content script; `control-bridge.js` maps `COMMANDS` to the contract, awaits `flushSettings()` for `SAVING_COMMANDS`, and replies with the full state (or diagnostics for `diagnostics`). `content.js` forwards any action; the bridge's whitelist decides and answers `unknown-command`. `resetFloatingPosition` is answered by the floating control's own `BiliSmoothFloating.resetPosition`.
- The UI tests stub exactly this object; a change to its shape changes `test/browser/*` fixtures too.
