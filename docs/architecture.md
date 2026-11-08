# Architecture

Cross-module rules that the code does not state in one place. Module layout and field names are in the source.

## Boundaries

- The manifest injects one MAIN-world bundle, `playback.js` (built by `scripts/build.mjs` from `src/core/` and `src/page/`), at `document_start`. The isolated `content.js` bridges it to `background.js`. Minimum Chrome/Edge is 120.
- `src/page/playback-kernel.js` alone decides measurement, racing, request targets and recovery for the current video. `network-probe.js` returns measurements and never picks a target. The floating control and the dashboard only read state and send whitelisted commands.
- `bilismooth.config.v4` in extension storage is the single settings authority. The background serializes every read/patch as read latest → whitelist merge → write → receipt. The MAIN world reads a startup cache synchronously, then takes the authoritative config. A page reload waits for the save receipt.

## Routing

- Startup never probes. A race compares at most two challengers, each with one closed Range request of at most 768 KiB body (1.5 MiB per race), 4 s deadline, no cookies, the player's signed URL. At least 10 s between races, doubling after each automatic race; at most four whole-video switches per cid. Every threshold lives in `src/core/delivery-policy.js`; changing one also changes the privacy policy and store text, which quote these limits.
- Fixed routes accept only valid bilivideo UPOS hosts. Akamai is used only through the original signed URL Bilibili served for the current representation, never by swapping the host of a UPOS URL. Native backup URLs and their order are kept.
- Regional history (`bilismooth.delivery-history.v1.<timezone>|<language>`) only orders challengers. It never sets the current video's target and never causes a request.
- "Test other routes" saves nothing. "Reset network records" clears the current session's network state and the current region's history, keeps per-cid switch counts and cooldowns, and starts no probe.

## Evidence

- Unknown values stay unknown (`null`, shown as —); nothing is interpolated or repeated from an older sample. Speed is bytes over wall time across complete 3 s windows, observed idle zeros included.
- "Smooth" requires recent, visible, healthy frame evidence. Region locks, unavailable videos and paid-only videos are read from data already on the page, add no requests, and are never shown as buffering or stalls. `-404` alone does not prove deletion or a region lock.
- Diagnostics exports keep hosts, times and Ranges. They never contain signed URLs, cookies, page titles or page text.
