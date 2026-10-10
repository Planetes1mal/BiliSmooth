/* Per-video delivery coordination. Address rules, browser hooks and race I/O remain separate. */
(function (global) {
  'use strict';
  const instances = new WeakMap();
  const RANK_PREFIX = 'bilismooth.routing.rank.v4.', FEEDBACK_PREFIX = 'biliSmooth.playback-feedback.v1.', HISTORY_PREFIX = 'bilismooth.delivery-history.v1.';
  const imported = typeof require === 'function' ? { settings: require('../core/settings.js'), rules: require('../core/routing-policy.js'), requests: require('./request-interceptor.js'), probes: require('./network-probe.js'), delivery: require('../core/delivery-session.js'), throughput: require('../core/throughput.js'), deliveryPolicy: require('../core/delivery-policy.js'), feedback: require('../core/playback-feedback.js') } : {};
  const DeliveryPolicy = global.BiliSmoothDeliveryPolicy || imported.deliveryPolicy, C = DeliveryPolicy.constants;
  function create(options = {}) {
    const root = options.scope || global;
    if (instances.has(root)) return instances.get(root);
    const core = root.BiliSmoothRoutingPolicy || global.BiliSmoothRoutingPolicy || imported.rules;
    const settings = root.BiliSmoothSettings || global.BiliSmoothSettings || imported.settings;
    const RequestLayer = root.BiliSmoothRequestInterceptor || global.BiliSmoothRequestInterceptor || imported.requests;
    const Probes = root.BiliSmoothNetworkProbe || global.BiliSmoothNetworkProbe || imported.probes;
    const DeliverySession = root.BiliSmoothDeliverySession || global.BiliSmoothDeliverySession || imported.delivery;
    const Throughput = root.BiliSmoothThroughput || global.BiliSmoothThroughput || imported.throughput;
    const Feedback = root.BiliSmoothPlaybackFeedback || global.BiliSmoothPlaybackFeedback || imported.feedback;
    if (!core || !RequestLayer || !Probes || !DeliverySession || !Throughput || !Feedback) throw Error('BiliSmooth playback dependencies are unavailable');
    const document = root.document, json = root.JSON || JSON;
    const nativeParse = json.parse, nativeStringify = json.stringify, nativeFetch = root.fetch;
    const plainCopy = value => Reflect.apply(nativeParse,json,[Reflect.apply(nativeStringify,json,[value])]);
    const now = () => root.performance?.now?.() ?? Date.now(), wallNow = () => root.Date?.now?.() ?? Date.now();
    const every = (root.setInterval || global.setInterval).bind(root), clearEvery = (root.clearInterval || global.clearInterval).bind(root);
    let config = settings.normalize(options.config), destroyed = false, interceptor = null, history;
    let policy = core.createPolicy(config), watchedVideo = null, watchTimer = null, mediaGeneration;
    let requestSerial = 0, networkEpoch = 0, measuredRace = null;
    const delivery = DeliverySession.create({ pool: config.candidatePool }), preparedPayloads = new WeakSet(), measurements = new Map();
    const videoRequests = new Map(), recentFragments = new Map(), syntheticHistory = new Map(), retention = new Map();
    const initialGuard = config.p2pGuard;
    const state = { installedAt: new Date(wallNow()).toISOString(), status: 'idle', rewriteCount: 0, lastSource: '',
      lastMediaHost: null, p2pBlocked: 0, events: [], needReload: false };
    const active = () => !destroyed && config.enabled && config.mode !== 'off';
    const hostOf = raw => { try {return new URL(raw,root.location?.href).hostname;} catch {return '';} };
    const absolute = raw => {try{return new URL(String(raw),root.location?.href).href;}catch{return String(raw || '');}};
    function emit(event) {if (!destroyed) try {options.onEvent?.({at:wallNow(),...event});}catch{}}
    function log(type, details = {}) {const event={type,at:wallNow(),...details};state.events.push(event);if(state.events.length>60)state.events.shift();emit(event);}
    function observedMediaUrl(raw, depth = 0) {
      try {
        const url = new URL(raw,root.location?.href);
        if (!['http:','https:'].includes(url.protocol)) return false;
        if (url.hostname===config.proxyHost && url.pathname==='/' && depth===0) return observedMediaUrl(url.searchParams.get('url'),1);
        if (!/\.(m4s|mp4|flv|m3u8)$/i.test(url.pathname) && !/^\/(upgcxcode|v1\/resource|live-bvc)\//.test(url.pathname)) return false;
        const kind=policy.describe(url);
        return kind.distribution||kind.international||kind.shared||kind.scheduler||!!url.port;
      } catch {return false;}
    }
    function regionKey() {try{return (root.Intl||Intl).DateTimeFormat().resolvedOptions().timeZone+'|'+(root.navigator?.language||'');}catch{return 'unknown';}}
    const historyKey = () => HISTORY_PREFIX + regionKey();
    function playbackEvidence() {
      try {const data=options.getPlaybackEvidence?.();return data&&data.player===watchedVideo&&Number.isFinite(data.sampledAt)&&now()>=data.sampledAt&&now()-data.sampledAt<=C.PLAYBACK_EVIDENCE_MAX_AGE_MS?data:null;}catch{return null;}
    }
    function requestGeneration() {try{return options.getPlaybackEvidence?.()?.mediaGeneration;}catch{return undefined;}}
    function saveHistory() {try{root.localStorage?.setItem(historyKey(),Reflect.apply(nativeStringify,json,[history.snapshot()]));}catch{}}
    function migrateLegacyHistory() {
      try {
        const storage = root.localStorage;
        const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
        for (const key of keys) {
          if (key.startsWith(RANK_PREFIX)) { storage.removeItem(key); continue; }
          if (!key.startsWith(FEEDBACK_PREFIX)) continue;
          const nextKey = HISTORY_PREFIX + key.slice(FEEDBACK_PREFIX.length);
          const oldText = storage.getItem(key), nextText = storage.getItem(nextKey);
          let legacy, initial;
          try { legacy = Reflect.apply(nativeParse, json, [oldText]); } catch {}
          try { initial = Reflect.apply(nativeParse, json, [nextText]); } catch {}
          const migrated = Feedback.createHistory({ now: wallNow, initial });
          if (migrated.importFailures(legacy)) storage.setItem(nextKey, Reflect.apply(nativeStringify, json, [migrated.snapshot()]));
          storage.removeItem(key);
        }
      } catch { /* A failed write retains its old key; the next page start retries migration. */ }
    }
    function record(changes, source) {
      if(!changes.length)return;state.rewriteCount+=changes.length;state.lastSource=source;
      for(const row of changes)log('route',{source,reason:row.reason,fromHost:hostOf(row.original),toHost:hostOf(row.url)});
      if(state.status==='idle')state.status='smooth';
    }
    function prepare(value, source) {
      if(!value||typeof value!=='object')return {value,changed:false};
      if (!preparedPayloads.has(value)) delivery.collect(value);
      if (measuredRace && measuredRace.cid !== delivery.current()?.cid) stopMeasuredRace();
      let original;try{original=plainCopy(value);}catch{original=null;}
      const prepared=policy.prepare(value);
      preparedPayloads.add(prepared.value);
      record(prepared.rewrites,source);emit({type:'payload',source,original,prepared:prepared.value,payload:prepared.value});
      return prepared;
    }
    function retained(cid) {
      if (!retention.has(cid)) retention.set(cid, { switchCount: 0, nextTestAt: 0, nextAutomaticAt: 0, automaticDelayMs: 0,
        raced: new Set(), fragments: new Map(), failures: [], races: [], switches: [], runnerUp: null });
      return retention.get(cid);
    }
    function fragmentKey(raw, range) {
      const rep = delivery.get(raw);
      return rep && ['video', 'audio'].includes(rep.kind) && /^bytes=\d+-\d+$/.test(range) ? `${rep.cid}|${rep.key}|${range}` : null;
    }
    function fragmentState(row, key) {
      if (!row.fragments.has(key)) row.fragments.set(key, { host: null, failedHosts: new Set() });
      return row.fragments.get(key);
    }
    function noteHostFailure(request, host) {
      if (request.deliveryFailureRecorded) return;
      request.deliveryFailureRecorded = true;
      const row = retained(request.cid), at = wallNow();
      row.failures = row.failures.filter(failure => at - failure.at <= C.ERROR_WINDOW_MS);
      row.failures.push({ host, at });
      if (history.recordFailure(host, at)) saveHistory();
    }
    function planRoute(raw, { range = '' } = {}) {
      const session = delivery.current(), representation = delivery.get(raw), facts = policy.describe(raw);
      if (config.selection === 'auto' && session && representation?.cid === session.cid
        && facts.media && (facts.distribution || facts.international) && !facts.shared && !facts.live && !facts.scheduler && !facts.relaySource) {
        const row = retained(session.cid), fragment = row.fragments.get(fragmentKey(raw, range));
        let host = fragment?.host || (session.activeEpoch === networkEpoch ? session.activeHost : null);
        if (fragment?.failedHosts.size) {
          host = fragment.host && !fragment.failedHosts.has(fragment.host) ? fragment.host
            : row.runnerUp && !fragment.failedHosts.has(row.runnerUp) ? row.runnerUp : null;
          const url = host && delivery.addressForHost(raw, host);
          return { original: raw, url: url || raw, changed: !!url && url !== raw, reason: 'fragment-retry', targetHost: host };
        }
        const url = host && delivery.addressForHost(raw, host);
        if (url) return { original: raw, url, changed: url !== raw, reason: 'measured-route', targetHost: host };
      }
      return policy.route(raw);
    }
    function route(raw, context) {
      if (!active()) return raw;
      const result = planRoute(raw, context);
      if (result.changed) record([result], 'segment');
      return result.url;
    }
    function beginRequest(originalUrl, url, transport, method, range = '') {
      if (!observedMediaUrl(originalUrl) && !observedMediaUrl(url)) return null;
      // The first request from a replaced player can precede both observation
      // intervals. Synchronize ownership now so it is not tagged as old media.
      watchVideo();
      let kind = 'unknown';
      try { kind = options.classifyRequest?.(originalUrl, url) || kind; } catch (_) {}
      const representation = delivery.request(originalUrl) || delivery.request(url);
      const evidence = playbackEvidence();
      const generation = evidence?.mediaGeneration ?? requestGeneration();
      if (generation !== mediaGeneration) {
        mediaGeneration = generation; clearMediaRequests();
      }
      const request = { id: 'media-' + (++requestSerial), originalUrl: absolute(originalUrl), url: absolute(url), host: hostOf(url),
        transport, method, range, startedAt: now(), kind, networkEpoch,
        cid: representation?.cid ?? null, representationKind: representation?.kind ?? null,
        mediaGeneration: generation, player: watchedVideo };
      if (request.representationKind === 'video' && transport === 'xhr') {
        request.bytes = 0; request.firstByteAt = null; request.hiddenOverlap = !!document?.hidden; videoRequests.set(request.id, request);
      }
      state.lastMediaHost = request.host || state.lastMediaHost;
      // DOM references are private request ownership, never part of event data.
      const { player, ...observed } = request;
      emit({ type: 'request', ...observed }); evaluateDelivery(); return request;
    }
    function reportTransfer(type, request, detail) {
      if (!request) return;
      const responseUrl = detail.responseUrl || '';
      const event = { type, id: request.id, host: responseUrl ? hostOf(responseUrl) : request.host, requestedHost: request.host,
        transport: request.transport, method: request.method, range: request.range, startedAt: request.startedAt,
        elapsedMs: Math.max(0, now() - request.startedAt), bytes: 0, complete: false, ...detail };
      emit(event);
      if (videoRequests.has(request.id)) {
        request.bytes = event.bytes; request.firstByteAt = event.firstByteAt; request.hiddenOverlap = event.hiddenOverlap;
        if (type === 'transfer') {
          videoRequests.delete(request.id);
          if (event.complete) { request.completedAt = event.completedAt; recentFragments.set(request.cid, request); }
        }
      }
      if (type === 'transfer' && request.cid && request.networkEpoch === networkEpoch) {
        const key = fragmentKey(request.originalUrl, request.range);
        if (key && !event.hiddenOverlap) {
          const failed = ['timeout', 'network-error', 'http-error'].includes(event.outcome)
            || event.outcome === 'aborted' && !(event.bytes > 0) && event.elapsedMs >= C.NO_RESPONSE_MS
              && (playbackEvidence()?.startupPending || !watchedVideo?.seeking && !watchedVideo?.paused);
          if (failed) {
            fragmentState(retained(request.cid), key).failedHosts.add(event.host);
            if (request.representationKind === 'video') noteHostFailure(request, event.host);
          } else if (event.complete) retained(request.cid).fragments.delete(key);
        }
        let meter = measurements.get(request.cid);
        if (!meter) { meter = Throughput.create(); measurements.set(request.cid, meter); }
        meter.record({ host: event.host, kind: request.representationKind, transport: request.transport,
          range: /^bytes=\d+-\d*$/.test(request.range) ? request.range : '', bytes: event.bytes, elapsedMs: event.elapsedMs,
          firstByteMs: event.firstByteMs, completedAt: event.completedAt, hidden: event.hiddenOverlap,
          outcome: event.complete ? event.outcome : 'incomplete' });
      }
      evaluateDelivery();
    }
    function stopMeasuredRace() { const round = measuredRace; measuredRace = null; round?.controller.abort(); }
    function testRoutes({ request: selectedRequest, trigger = 'manual' } = {}) {
      const session = delivery.current();
      if (!active() || config.selection !== 'auto' || document?.hidden || measuredRace || !session || typeof nativeFetch !== 'function') return false;
      const row = retained(session.cid), at = wallNow();
      if (row.switchCount >= C.MAX_SWITCHES_PER_VIDEO || at < row.nextTestAt || trigger !== 'manual' && at < row.nextAutomaticAt) return false;
      const request = selectedRequest || [...videoRequests.values()].find(item => item.cid === session.cid && !item.hiddenOverlap) || recentFragments.get(session.cid);
      if (!request || request.hiddenOverlap) return false;
      const match = /^bytes=(\d+)-(\d+)$/.exec(request.range);
      if (!match) return false;
      const start = request.completedAt ? Number(match[2]) + 1 : Number(match[1]) + request.bytes;
      const end = request.completedAt ? start + C.RACE_SAMPLE_BYTES - 1 : Math.min(Number(match[2]), start + C.RACE_SAMPLE_BYTES - 1);
      if (start > end) return false;
      const rep = delivery.get(request.originalUrl), currentHost = request.host;
      const candidates = [...new Set([...rep.urls.keys(), ...config.candidatePool])].filter(host => host !== currentHost)
        .map(host => ({ host, url: delivery.addressForHost(request.originalUrl, host) })).filter(target => target.url);
      const targets = history.challengers(candidates.map(target => target.host)).map(host => candidates.find(target => target.host === host));
      if (!targets.length) return false;
      const sustained = measurements.get(session.cid)?.snapshot().find(row => row.host === currentHost)?.goodputBps || 0;
      row.failures = row.failures.filter(failure => at - failure.at <= C.ERROR_WINDOW_MS);
      const requiredBps = session.requiredBps * (watchedVideo?.playbackRate || 1);
      const keepHost = trigger === 'stuck' && requiredBps > 0 && sustained >= requiredBps * C.SHORTFALL_RATE_FACTOR
        && !row.failures.some(failure => failure.host === currentHost);
      if (trigger === 'stuck') noteHostFailure(request, currentHost);
      const rate = request.bytes * 8000 / ((request.completedAt || now()) - request.startedAt) || (request.completedAt ? sustained : 0);
      const currentMs = rate > 0 ? (end - start + 1) * 8000 / rate : Infinity;
      const record = { at, networkEpoch, currentHost, requestId: request.id, trigger, range: `bytes=${start}-${end}`, contenders: targets.map(target => target.host),
        currentMs: Number.isFinite(currentMs) ? currentMs : null, verdict: null, winner: null, runnerUp: null, samples: [], switched: false };
      row.races.push(record);
      session.lastRace = record;
      function decided() {
        row.automaticDelayMs = row.automaticDelayMs ? row.automaticDelayMs * C.RACE_COOLDOWN_MULTIPLIER : C.RACE_COOLDOWN_MS;
        row.nextTestAt = wallNow() + C.RACE_COOLDOWN_MS; row.nextAutomaticAt = wallNow() + row.automaticDelayMs;
      }
      const round = { cid: session.cid, controller: new root.AbortController() }, raceStartedAt = now(); measuredRace = round;
      log('race', { reason: 'started', id: request.id, host: currentHost });
      Probes.race({ scope: root, now, fetch: nativeFetch, signal: round.controller.signal, range: { start, end }, targets,
        onWinner(sample) {
          if (measuredRace !== round) return;
          record.winner = sample.host; record.samples = [sample];
          // The raced request is a contender too: finishing first means the current host won.
          if (request.completedAt > raceStartedAt) { record.verdict = 'current-fastest'; decided(); }
          else if (DeliveryPolicy.beatsCurrent(sample.elapsedMs, currentMs)) {
            const previousHost = session.activeEpoch === networkEpoch && session.activeHost || currentHost;
            const scope = keepHost || previousHost === sample.host ? 'fragment' : 'video';
            fragmentState(row, fragmentKey(request.originalUrl, request.range)).host = sample.host;
            if (scope === 'fragment') {
              if (!session.activeHost || session.activeEpoch !== networkEpoch) session.activeHost = currentHost;
              record.verdict = 'fragment';
            } else {
              session.activeHost = sample.host; row.switchCount++; record.switched = true; record.verdict = 'switched';
            }
            session.activeEpoch = networkEpoch;
            const change = { at: wallNow(), fromHost: currentHost, toHost: sample.host, scope, range: request.range };
            row.switches.push(change); log('switch', { ...change, id: request.id, reason: trigger });
            decided();
            interceptor.syntheticTimeout(request.id);
          } else { record.verdict = sample.elapsedMs >= currentMs ? 'current-fastest' : 'below-margin'; decided(); }
        }
      }).then(result => {
        if (measuredRace !== round) return;
        measuredRace = null; history.recordRace(result.samples); saveHistory(); record.samples = result.samples; record.runnerUp = result.runnerUp?.host || null; row.runnerUp = record.runnerUp;
        if (!record.winner) { record.verdict = 'no-completion'; decided(); }
        log('race', { reason: 'finished', id: request.id, host: record.winner || currentHost, bytes: result.totalBytes });
      });
      return true;
    }
    function playerContext() {
      return { readyState: Number.isFinite(watchedVideo?.readyState) ? watchedVideo.readyState : null,
        paused: !!watchedVideo?.paused, seeking: !!watchedVideo?.seeking, ended: !!watchedVideo?.ended,
        hidden: !!document?.hidden, playhead: Number.isFinite(watchedVideo?.currentTime) ? watchedVideo.currentTime : null };
    }
    function wallBuffer(evidence) {
      if (!Number.isFinite(evidence?.buffer) || evidence.buffer < 0) return Infinity;
      return evidence.buffer / (Number.isFinite(evidence.rate) && evidence.rate > 0 ? evidence.rate : 1);
    }
    function clearMediaRequests() { videoRequests.clear(); recentFragments.clear(); stopMeasuredRace(); state.lastMediaHost = null; }
    function onPlayerEvent(event) {
      log('player-event', { source: event.type, ...playerContext() });
      if (event.type === 'emptied') clearMediaRequests();
      else if (['pause', 'seeking', 'ended', 'error'].includes(event.type) && !playbackEvidence()?.startupPending) stopMeasuredRace();
    }
    const playerEvents = ['waiting', 'stalled', 'playing', 'canplay', 'suspend', 'pause', 'seeking', 'seeked', 'emptied', 'ended', 'error'];
    function unwatchVideo() { for (const name of playerEvents) watchedVideo?.removeEventListener(name, onPlayerEvent); }
    function watchVideo() {
      const player = options.getPlayer ? options.getPlayer() : document?.querySelector?.('video');
      if (player === watchedVideo) return;
      unwatchVideo(); clearMediaRequests(); watchedVideo = player || null;
      for (const name of playerEvents) watchedVideo?.addEventListener(name, onPlayerEvent, { passive: true });
    }
    function onVisibilityChange() {
      if (document.hidden) { for (const request of videoRequests.values()) request.hiddenOverlap = true; stopMeasuredRace(); }
    }
    function evaluateDelivery() {
      if (destroyed) return;
      watchVideo();
      if (!active() || config.selection !== 'auto' || !config.stallRecovery || document?.hidden || !watchedVideo || watchedVideo.ended || watchedVideo.error) return;
      const evidence = playbackEvidence(), session = delivery.current();
      if (!evidence || !session || !evidence.startupPending && (watchedVideo.paused || watchedVideo.seeking)) return;
      const row = retained(session.cid), at = now();
      for (const request of videoRequests.values()) {
        if (request.cid !== session.cid || request.networkEpoch !== networkEpoch || request.mediaGeneration !== evidence.mediaGeneration
          || request.player !== watchedVideo && !(request.player === null && evidence.startupPending) || request.hiddenOverlap) continue;
        const key = fragmentKey(request.originalUrl, request.range), range = /^bytes=(\d+)-(\d+)$/.exec(request.range);
        if (!range || row.raced.has(key)) continue;
        const rangeBytes = Number(range[2]) - Number(range[1]) + 1;
        if (request.bytes >= rangeBytes) continue;
        const rate = request.bytes * 8000 / (at - request.startedAt) || 0;
        const measured = measurements.get(session.cid)?.snapshot().find(host => host.host === request.host);
        const trigger = DeliveryPolicy.decide({ requestAgeMs: at - request.startedAt,
          firstByteMs: request.firstByteAt === null ? null : request.firstByteAt - request.startedAt,
          rangeBytes, transferMs: request.firstByteAt === null ? 0 : at - request.firstByteAt, loadedBytes: request.bytes,
          goodputBps: rate, remainingMs: rate > 0 ? (rangeBytes - request.bytes) * 8000 / rate : Infinity,
          bufferWallSeconds: wallBuffer(evidence), requiredBps: session.requiredBps * evidence.rate,
          recent: { bytes: measured?.recentBytes || 0, elapsedMs: measured?.recentMs || 0, goodputBps: measured?.recentBps ?? null },
          now: wallNow(), failedAt: row.failures.filter(failure => failure.host === request.host).map(failure => failure.at) });
        if (trigger && testRoutes({ request, trigger })) { row.raced.add(key); break; }
      }
    }
    function resetNetwork() {
      networkEpoch++; clearMediaRequests(); measurements.clear(); history.clear(); saveHistory();
      for (const row of retention.values()) { row.fragments.clear(); row.failures = []; row.runnerUp = null; }
      log('network-reset'); return getState();
    }
    function setConfig(next) {
      const before = config; config = settings.normalize({ ...config, ...next }); policy = core.createPolicy(config);
      if (before.enabled !== config.enabled || config.p2pGuard !== initialGuard) state.needReload = true;
      if (!active() || config.selection !== 'auto' || !config.stallRecovery) stopMeasuredRace();
      emit({ type: 'config', config: getConfig() }); return getConfig();
    }
    function getConfig() { return plainCopy(config); }
    function deliveryView() {
      const session = delivery.current(), row = session && retained(session.cid);
      const last = session?.lastRace?.networkEpoch === networkEpoch ? session.lastRace : null;
      const request = session && ([...videoRequests.values()].find(item => item.cid === session.cid && !item.hiddenOverlap) || recentFragments.get(session.cid));
      const status = measuredRace ? 'testing' : last?.verdict === 'switched' ? 'switched' : last?.verdict === 'current-fastest' ? 'current-fastest' : last ? 'compared' : 'native';
      return { status, nativeHost: session?.nativeHost || null, activeHost: session?.activeEpoch === networkEpoch ? session.activeHost : null,
        nextTestAt: row?.nextTestAt || 0,
        canTest: !!(active() && config.selection === 'auto' && !document?.hidden && !measuredRace && request && !request.hiddenOverlap
          && /^bytes=\d+-\d+$/.test(request.range) && row.switchCount < C.MAX_SWITCHES_PER_VIDEO && wallNow() >= row.nextTestAt && typeof nativeFetch === 'function'),
        comparedHosts: row ? [...new Set(row.races.flatMap(race => [race.currentHost, ...race.contenders]))].length : 0 };
    }
    function getFlags() { return { needReload: state.needReload, delivery: deliveryView() }; }
    function sessionSnapshot() {
      const session = delivery.snapshot();
      const row = session && retained(session.cid);
      return session ? { ...session, hosts: measurements.get(session.cid)?.snapshot() || [],
        nativeHost: delivery.current().nativeHost || null, switchCount: row.switchCount, nextTestAt: row.nextTestAt, nextAutomaticAt: row.nextAutomaticAt,
        races: plainCopy(row.races), switches: plainCopy(row.switches),
        activeHost: delivery.current().activeEpoch === networkEpoch ? delivery.current().activeHost : null,
        syntheticTimeouts: { ...interceptor.syntheticStatus(), events: plainCopy(syntheticHistory.get(session.cid) || []) },
        racing: measuredRace?.cid === session.cid, lastRace: delivery.current().lastRace ? plainCopy(delivery.current().lastRace) : null } : null;
    }
    function getState() { return { ...plainCopy(state), config: getConfig(), session: sessionSnapshot() }; }
    function retry() { return testRoutes(); }
    function destroy() {
      if (destroyed) return; stopMeasuredRace(); clearEvery(watchTimer); unwatchVideo();
      document?.removeEventListener?.('visibilitychange', onVisibilityChange); interceptor?.destroy();
      if (initialGuard) state.needReload = true;
      destroyed = true; instances.delete(root);
    }
    const api = { getConfig, setConfig, getFlags, getState, resetNetwork, retry, testRoutes,
      rewriteUrl: (raw, context) => active() ? planRoute(raw, context).url : raw, destroy };
    instances.set(root, api);
    migrateLegacyHistory();
    let savedHistory; try { savedHistory = Reflect.apply(nativeParse, json, [root.localStorage?.getItem(historyKey()) || 'null']); } catch {}
    history = Feedback.createHistory({ now: wallNow, random: root.Math?.random, initial: savedHistory });
    interceptor=RequestLayer.install({scope:root,active,route,prepare,sharingPolicy:initialGuard,
      fragmentKey: (raw, range) => delivery.get(raw)?.kind === 'video' ? fragmentKey(raw, range) : null,
      onSynthetic(event) {
        const { cid, at, ...record } = event;
        if (!syntheticHistory.has(cid)) syntheticHistory.set(cid, []);
        syntheticHistory.get(cid).push({ ...record, at: wallNow() });
        log('synthetic-timeout', { phase: event.phase, id: event.id, host: event.host, reason: event.reason, delayMs: event.delayMs });
      },
      begin:info=>beginRequest(info.originalUrl,info.url,info.transport,info.method,info.range),onTransfer:reportTransfer,
      onSharingBlock:name=>{state.p2pBlocked++;log('p2p-blocked',{api:name});}});
    document?.addEventListener?.('visibilitychange', onVisibilityChange); watchVideo();
    watchTimer = every(evaluateDelivery, C.DELIVERY_TICK_MS); emit({ type: 'config', config: getConfig() }); return api;
  }
  const api = Object.freeze({ create });
  global.BiliSmoothPlaybackKernel = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
