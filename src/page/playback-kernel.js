/* BiliSmooth coordinator. One owner for ranking, recovery and request evidence.
 * Address rules, browser hooks and probe I/O have separate replaceable boundaries.
 */
(function (global) {
  'use strict';
  const instances = new WeakMap();
  const RANK_PREFIX = 'bilismooth.routing.rank.v3.', FEEDBACK_PREFIX = 'biliSmooth.playback-feedback.v1.';
  const RANK_TTL_MS = 21600000, STALL_GRACE_MS = 2500, STALL_RETRY_MS = 5000;
  const PROBE_TIMEOUT_MS = 4000, PROBE_MAX_HOSTS = 12, PROBE_BYTES = 786432, EVIDENCE_MAX_AGE_MS = 1500;
  const imported = typeof require === 'function' ? { settings: require('../core/settings.js'), rules: require('../core/routing-policy.js'), requests: require('./request-interceptor.js'), probes: require('./network-probe.js') } : {};
  function create(options = {}) {
    const root = options.scope || global;
    if (instances.has(root)) return instances.get(root);
    const core = root.BiliSmoothRoutingPolicy || global.BiliSmoothRoutingPolicy || imported.rules;
    const settings = root.BiliSmoothSettings || global.BiliSmoothSettings || imported.settings;
    const RequestLayer = root.BiliSmoothRequestInterceptor || global.BiliSmoothRequestInterceptor || imported.requests;
    const Probes = root.BiliSmoothNetworkProbe || global.BiliSmoothNetworkProbe || imported.probes;
    if (!core || !RequestLayer || !Probes) throw Error('BiliSmooth playback dependencies are unavailable');
    const document = root.document, json = root.JSON || JSON;
    const nativeParse = json.parse, nativeStringify = json.stringify, nativeFetch = root.fetch;
    const plainCopy = value => Reflect.apply(nativeParse,json,[Reflect.apply(nativeStringify,json,[value])]);
    const now = () => root.performance?.now?.() ?? Date.now(), wallNow = () => root.Date?.now?.() ?? Date.now();
    const later = (root.setTimeout || global.setTimeout).bind(root), clearLater = (root.clearTimeout || global.clearTimeout).bind(root);
    const every = (root.setInterval || global.setInterval).bind(root), clearEvery = (root.clearInterval || global.clearInterval).bind(root);
    let config = settings.normalize(options.config), destroyed = false, interceptor = null;
    let policy = core.createPolicy(config);
    let watchedVideo = null, watchTimer = null, stallTimer = null, stallDeadlineAt = null, rotateCursor = 0;
    let requestSerial = 0, networkEpoch = 0, feedbackGeneration, recentVideoFailure = null, lastVideoHost = null, lastRecoveryAt = -Infinity;
    let feedback = null, probeEpoch = 0, probeRound = null, probed = false, lastSample = null;
    const initialGuard = config.p2pGuard, recovery = {avoidHost:null,clearTimer:null}, probeTimings = [];
    const state = {installedAt:new Date(wallNow()).toISOString(),status:'idle',rewriteCount:0,lastSource:'',lastMediaHost:null,
      stalls:0,recoveries:0,p2pBlocked:0,ranking:[],probeSamples:[],probedAt:null,probing:false,probeBytes:0,events:[],needReload:false};
    const active = () => !destroyed && config.enabled && config.mode !== 'off';
    const adaptive = () => config.adaptiveRecovery !== false;
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
    const rankingKey = () => RANK_PREFIX+regionKey(), feedbackKey = () => FEEDBACK_PREFIX+regionKey();
    function playbackEvidence() {
      try {const data=options.getPlaybackEvidence?.();return data&&data.player===watchedVideo&&Number.isFinite(data.sampledAt)&&now()>=data.sampledAt&&now()-data.sampledAt<=EVIDENCE_MAX_AGE_MS?data:null;}catch{return null;}
    }
    function requestGeneration() {try{return options.getPlaybackEvidence?.()?.mediaGeneration;}catch{return undefined;}}
    function feedbackRanking(ranking) {return adaptive()&&feedback?feedback.rank(ranking):ranking.slice();}
    function saveFeedback() {try{root.localStorage?.setItem(feedbackKey(),Reflect.apply(nativeStringify,json,[feedback.snapshot()]));}catch{}}
    function cacheSample(sample) {
      const number=(key,fallback=0)=>Number.isFinite(sample[key])&&sample[key]>=0?sample[key]:fallback;
      return {host:sample.host,ttfb:number('ttfb',null),mbps:number('mbps'),bytes:number('bytes'),elapsedMs:number('elapsedMs'),
        ok:sample.ok===true,timedOut:sample.timedOut===true,status:Number.isInteger(sample.status)?sample.status:0,
        error:['http','timeout','network','invalid-url','cancelled','empty-body'].includes(sample.error)?sample.error:''};
    }
    function loadRanking() {
      try {
        const saved=Reflect.apply(nativeParse,json,[root.localStorage?.getItem(rankingKey())||'null']);
        if(!saved||!Number.isFinite(saved.at)||saved.at>wallNow()||wallNow()-saved.at>RANK_TTL_MS||!Array.isArray(saved.ranking))return null;
        const ranking=[...new Set(saved.ranking.filter(host=>config.candidatePool.includes(host)))];
        if(!ranking.length)return null;
        return {ranking,at:saved.at,samples:Array.isArray(saved.samples)?saved.samples.filter(row=>row&&config.candidatePool.includes(row.host)).slice(0,PROBE_MAX_HOSTS).map(cacheSample):[]};
      }catch{return null;}
    }
    function applyRanking(ranking) {
      if(config.selection!=='auto'||!ranking.length)return;
      state.ranking=ranking.slice();config.pcdnHost=feedbackRanking(ranking)[0];policy=core.createPolicy(config);emit({type:'config',config:getConfig()});
    }
    function record(changes, source) {
      if(!changes.length)return;state.rewriteCount+=changes.length;state.lastSource=source;
      for(const row of changes)log('route',{source,reason:row.reason,fromHost:hostOf(row.original),toHost:hostOf(row.url)});
      if(state.status==='idle')state.status='smooth';
    }
    function prepare(value, source) {
      if(!value||typeof value!=='object')return {value,changed:false};
      let original;try{original=plainCopy(value);}catch{original=null;}
      const prepared=policy.prepare(value,{ranking:state.ranking});
      record(prepared.rewrites,source);emit({type:'payload',source,original,prepared:prepared.value,payload:prepared.value});
      if(active()&&prepared.sampleUrl){lastSample=prepared.sampleUrl;scheduleProbe(lastSample);}
      return prepared;
    }
    function route(raw) {
      if(!active())return raw;
      const result=(recovery.avoidHost&&hostOf(raw)===recovery.avoidHost?core.createPolicy({...config,mode:'force'}):policy).route(raw);
      if(result.changed)record([result],'segment');return result.url;
    }
    function stopProbes() {probeEpoch++;probeRound?.abort();probeRound=null;state.probing=false;}
    function scheduleProbe(sampleUrl) {
      if(!active()||probed||config.selection!=='auto'||typeof nativeFetch!=='function')return;
      probed=true;
      const cached=loadRanking();
      if(cached){applyRanking(cached.ranking);state.probeSamples=cached.samples;state.probedAt=new Date(cached.at).toISOString();log('ranking-loaded',{hosts:state.ranking.slice(),probedAt:state.probedAt});return;}
      const hosts=config.candidatePool.slice(0,PROBE_MAX_HOSTS);if(!hosts.length)return;
      const Controller=root.AbortController||global.AbortController, controller=Controller?new Controller():null, epoch=probeEpoch;
      probeRound=controller;state.probing=true;if(state.status==='idle')state.status='optimizing';log('probe-start',{hosts:hosts.slice()});
      const targets=hosts.map(host=>{try{return {host,url:core.addressForHost(sampleUrl,host)};}catch{return {host,url:null};}});
      for(const target of targets)if(target.url)probeTimings.push({url:target.url,startedAt:now()});
      if(probeTimings.length>128)probeTimings.splice(0,probeTimings.length-128);
      Probes.run({scope:root,fetch:nativeFetch,targets,signal:controller?.signal,now,timeoutMs:PROBE_TIMEOUT_MS,maxBytes:PROBE_BYTES,
        onSample(sample){if(destroyed||epoch!==probeEpoch)return;state.probeBytes+=sample.bytes;emit({type:'probe',...sample,totalBytes:state.probeBytes});}
      }).then(result=>{
        if(destroyed||epoch!==probeEpoch)return;
        state.probing=false;probeRound=null;state.probeSamples=result.samples;
        const ranking=result.samples.filter(sample=>sample.ok&&Number.isFinite(sample.ttfb)&&sample.ttfb>=0)
          .slice().sort((left,right)=>(right.mbps||0)-(left.mbps||0)||left.ttfb-right.ttfb).map(sample=>sample.host);
        if(ranking.length){applyRanking(ranking);state.probedAt=new Date(wallNow()).toISOString();state.status='smooth';
          try{root.localStorage?.setItem(rankingKey(),Reflect.apply(nativeStringify,json,[{ranking:state.ranking,samples:state.probeSamples,at:wallNow()}]));}catch{}}
        log('probe-finished',{hosts:state.ranking.slice(),bytes:result.totalBytes});
      },()=>{if(epoch===probeEpoch){probeRound=null;state.probing=false;}});
    }
    function rotateTarget(stallingHost, reason='waiting') {
      const base=state.ranking.length?state.ranking:config.candidatePool;
      const choices=adaptive()?feedbackRanking([...new Set([...base,...config.candidatePool])]):base.slice();
      if(choices.length<2)return false;
      if(adaptive())rotateCursor=Math.max(0,choices.indexOf(config.pcdnHost));
      const previous=config.pcdnHost;
      for(let tried=0;tried<choices.length;tried++){rotateCursor=(rotateCursor+1)%choices.length;const host=choices[rotateCursor];if(host!==previous&&host!==stallingHost){config.pcdnHost=host;break;}}
      if(config.pcdnHost===previous)return false;
      policy=core.createPolicy(config);
      lastRecoveryAt=wallNow();recovery.avoidHost=stallingHost||previous;clearLater(recovery.clearTimer);recovery.clearTimer=later(()=>{recovery.avoidHost=null;},15000);
      log('recovery-attempt',{fromHost:stallingHost||previous,toHost:config.pcdnHost,reason});emit({type:'config',config:getConfig()});return true;
    }
    function beginRequest(originalUrl, url, transport, method, range = '') {
      if (!observedMediaUrl(originalUrl) && !observedMediaUrl(url)) return null;
      // The first request from a replaced player can precede both observation
      // intervals. Synchronize ownership now so it is not tagged as old media.
      watchVideo();
      let kind = 'unknown';
      try { kind = options.classifyRequest?.(originalUrl, url) || kind; } catch (_) {}
      const evidence = playbackEvidence();
      const generation = evidence?.mediaGeneration ?? requestGeneration();
      if (generation !== feedbackGeneration) {
        feedback?.resetWindow(); feedbackGeneration = generation; recentVideoFailure = null;
      }
      const request = { id: 'media-' + (++requestSerial), originalUrl: absolute(originalUrl), url: absolute(url), host: hostOf(url),
        transport, method, range, startedAt: now(), kind, networkEpoch,
        mediaGeneration: generation, player: watchedVideo };
      state.lastMediaHost = request.host || state.lastMediaHost;
      if (kind === 'video' || kind === 'muxed') lastVideoHost = request.host;
      // DOM references are private request ownership, never part of event data.
      const { player, ...observed } = request;
      emit({ type: 'request', ...observed }); return request;
    }
    function reportTransfer(type, request, detail) {
      if (!request) return;
      const responseUrl = detail.responseUrl || '';
      const event = { type, id: request.id, host: responseUrl ? hostOf(responseUrl) : request.host, requestedHost: request.host,
        transport: request.transport, method: request.method, range: request.range, startedAt: request.startedAt,
        elapsedMs: Math.max(0, now() - request.startedAt), bytes: 0, complete: false, ...detail };
      emit(event);
      try { observePlaybackTransfer(request, event); } catch (_) { /* Feedback cannot affect native delivery. */ }
    }
    function playerContext() {
      return { readyState: Number.isFinite(watchedVideo?.readyState) ? watchedVideo.readyState : null,
        paused: !!watchedVideo?.paused, seeking: !!watchedVideo?.seeking, ended: !!watchedVideo?.ended,
        hidden: !!document?.hidden, playhead: Number.isFinite(watchedVideo?.currentTime) ? watchedVideo.currentTime : null };
    }
    function timerEvent(action, reason, extra = {}) {
      log('stall-timer', { action, reason, ...playerContext(), deadlineAt: stallDeadlineAt,
        dueInMs: stallDeadlineAt === null ? null : Math.max(0, stallDeadlineAt - wallNow()), ...extra });
    }
    function cancelStall(reason) {
      if (stallTimer !== null) timerEvent('cancelled', reason);
      clearLater(stallTimer); stallTimer = null; stallDeadlineAt = null;
    }
    function scheduleStall(delayMs, reason) {
      stallDeadlineAt = wallNow() + delayMs;
      stallTimer = later(handleStall, delayMs);
      timerEvent('scheduled', reason, { delayMs });
    }
    function wallBuffer(evidence) {
      if (!Number.isFinite(evidence?.buffer) || evidence.buffer < 0) return Infinity;
      return evidence.buffer / (Number.isFinite(evidence.rate) && evidence.rate > 0 ? evidence.rate : 1);
    }
    function frameNeedsRecovery(evidence = playbackEvidence()) {
      if (!adaptive() || !evidence || document?.hidden || watchedVideo?.paused || watchedVideo?.ended || watchedVideo?.seeking) return false;
      const frame = evidence.frameHealth;
      if (frame?.state !== 'frozen' || !['rvfc', 'quality'].includes(frame.source) ||
          !Number.isFinite(frame.ageMs) || !Number.isFinite(frame.thresholdMs) || frame.ageMs < Math.max(2000, frame.thresholdMs)) return false;
      const recentFailure = recentVideoFailure && recentVideoFailure.generation === evidence.mediaGeneration &&
        now() - recentVideoFailure.at <= 10000;
      return wallBuffer(evidence) <= 0.5 || wallBuffer(evidence) <= 2 && recentFailure;
    }
    function observePlaybackTransfer(request, event) {
      if (!adaptive() || !active() || event.type !== 'transfer' || request.feedbackFinished ||
          !['video', 'muxed'].includes(request.kind) || request.networkEpoch !== networkEpoch) return;
      const evidence = playbackEvidence();
      if (!evidence || request.mediaGeneration !== evidence.mediaGeneration ||
          request.player !== watchedVideo && !(request.player === null && evidence.startupPending)) return;
      const failed = ['timeout', 'network-error', 'http-error'].includes(event.outcome);
      if (!failed && event.outcome !== 'complete') return;
      request.feedbackFinished = true;
      if (failed) recentVideoFailure = { at: now(), generation: evidence.mediaGeneration, host: request.host };
      if (feedback) {
        // Headers, aborts, probes, audio and unverified Fetch timing are never
        // successful video-body evidence. Response hosts own successful bytes.
        const stablePlayback = !watchedVideo.paused && !watchedVideo.seeking && !document?.hidden &&
          evidence.frameHealth?.state === 'healthy' && wallBuffer(evidence) >= 3;
        if (failed || stablePlayback) feedback.record({ host: failed ? request.host : hostOf(event.responseUrl), kind: request.kind,
          transport: request.transport, outcome: event.outcome, status: event.status, bytes: event.bytes, elapsedMs: event.elapsedMs });
        else feedback.resetWindow();
        saveFeedback();
      }
      if (!failed || !config.stallRecovery || config.selection !== 'auto' || document?.hidden ||
          !watchedVideo || watchedVideo.ended || wallNow() - lastRecoveryAt < STALL_RETRY_MS) return;
      // A failure from a previous selected route must not churn the new route.
      if (request.host !== config.pcdnHost) return;
      const startup = evidence.startupPending && watchedVideo.readyState < 3 && wallBuffer(evidence) <= 0.5;
      const starving = !watchedVideo.paused && !watchedVideo.seeking &&
        (watchedVideo.readyState < 3 || frameNeedsRecovery(evidence) || wallBuffer(evidence) <= 1);
      if (!startup && !starving) return;
      const reason = startup ? 'startup-request-failed' : 'video-request-failed';
      if (rotateTarget(request.host, reason)) {
        state.recoveries++; cancelStall(reason);
        // Initial preparation is driven by actual failed native requests. It
        // never calls play(), seeks, or repeatedly rotates a paused player.
        if (!startup) scheduleStall(STALL_RETRY_MS, 'continued-waiting');
      }
    }

    function stallSkipReason() {
      if(!active())return 'disabled';if(document?.hidden)return 'hidden';if(!watchedVideo)return 'no-player';
      if(watchedVideo.paused)return 'paused';if(watchedVideo.ended)return 'ended';
      return watchedVideo.readyState>=3&&!frameNeedsRecovery()?'ready':watchedVideo.seeking?'seeking':'';
    }
    function stallingHost(){return adaptive()&&lastVideoHost||state.lastMediaHost||(observedMediaUrl(watchedVideo?.currentSrc)?hostOf(watchedVideo.currentSrc):null);}
    function handleStall(){
      const skip=stallSkipReason();timerEvent('check',skip||'eligible');stallTimer=null;stallDeadlineAt=null;
      if(skip){timerEvent('skipped',skip);return;}
      if(state.status!=='buffering')state.stalls++;state.status='buffering';
      if(!config.stallRecovery||config.selection!=='auto'){timerEvent('skipped',config.stallRecovery?'fixed-selection':'recovery-disabled');return;}
      if(rotateTarget(stallingHost(),frameNeedsRecovery()?'confirmed-frame-stall':'waiting'))state.recoveries++;
      scheduleStall(STALL_RETRY_MS,'continued-waiting');
    }
    function onWaiting(event){
      const reason=event?.type||'waiting';if(['waiting','stalled'].includes(reason))log('player-event',{source:reason,...playerContext()});
      if(!active()||document?.hidden){const why=active()?'hidden':'disabled';cancelStall(why);timerEvent('skipped',why);return;}
      if(stallTimer!==null){timerEvent('kept','already-scheduled');return;}
      const remaining=adaptive()?Math.max(STALL_GRACE_MS,STALL_RETRY_MS-(wallNow()-lastRecoveryAt)):STALL_GRACE_MS;scheduleStall(remaining,reason);
    }
    function onPlaying(event){
      const reason=event?.type||'playing';if(['playing','canplay'].includes(reason))log('player-event',{source:reason,...playerContext()});
      cancelStall(reason);if(state.status==='buffering'){state.status='smooth';log('playback-resumed');}
    }
    function onSuspend(){log('player-event',{source:'suspend',...playerContext()});}
    function onVisibilityChange(){
      log('player-event',{source:'visibilitychange',...playerContext()});if(document?.hidden){cancelStall('hidden');return;}
      if(watchedVideo&&!watchedVideo.paused&&!watchedVideo.ended&&watchedVideo.readyState<3)onWaiting({type:'visible'});else onPlaying({type:'visible-ready'});
    }
    const playerHandlers=[['waiting',onWaiting],['stalled',onWaiting],['playing',onPlaying],['canplay',onPlaying],['suspend',onSuspend]];
    function unwatchVideo(){for(const [name,fn]of playerHandlers)watchedVideo?.removeEventListener?.(name,fn);}
    function watchVideo(){
      if(destroyed)return;const player=options.getPlayer?options.getPlayer():document?.querySelector?.('video');
      if(player===watchedVideo){
        if(active()&&config.stallRecovery&&config.selection==='auto'&&stallTimer===null&&frameNeedsRecovery())scheduleStall(Math.max(0,STALL_RETRY_MS-(wallNow()-lastRecoveryAt)),'confirmed-frame-stall');return;
      }
      unwatchVideo();cancelStall('player-change');watchedVideo=player||null;recentVideoFailure=null;lastVideoHost=null;feedback?.resetWindow();
      for(const [name,fn]of playerHandlers)watchedVideo?.addEventListener(name,fn,{passive:true});
    }
    function resetNetwork(){
      networkEpoch++;stopProbes();probed=false;state.ranking=[];state.probeSamples=[];state.probedAt=null;
      feedback?.clear();saveFeedback();recentVideoFailure=null;lastVideoHost=null;lastRecoveryAt=-Infinity;rotateCursor=0;
      recovery.avoidHost=null;clearLater(recovery.clearTimer);cancelStall('network-reset');
      try{root.localStorage?.removeItem(rankingKey());}catch{}log('network-reset');
      if(lastSample)scheduleProbe(lastSample);if(watchedVideo&&watchedVideo.readyState<3)onWaiting({type:'network-reset'});return getState();
    }
    function setConfig(next){
      const before=config;config=settings.normalize({...config,...next});policy=core.createPolicy(config);
      if(before.enabled!==config.enabled||config.p2pGuard!==initialGuard)state.needReload=true;
      if(!active()||config.selection!=='auto'){stopProbes();probed=false;}
      if(!active()||!config.stallRecovery){cancelStall(active()?'recovery-disabled':'disabled');clearLater(recovery.clearTimer);recovery.avoidHost=null;}
      if(config.selection==='auto'&&before.selection!=='auto')applyRanking(state.ranking);
      if(active()&&lastSample&&(!before.enabled||before.mode==='off'||before.selection!==config.selection))scheduleProbe(lastSample);
      emit({type:'config',config:getConfig()});return getConfig();
    }
    function getConfig(){return plainCopy(config);}
    function getFlags(){return {needReload:state.needReload,probing:state.probing};}
    function getState(){return {...plainCopy(state),config:getConfig(),effectiveRanking:feedbackRanking([...new Set([...state.ranking,...config.candidatePool])]),playbackFeedback:feedback?.snapshot()||null};}
    function retry(){
      if(!active()||config.selection!=='auto'||!rotateTarget(stallingHost(),'manual'))return false;
      state.recoveries++;
      if(stallTimer!==null){cancelStall('manual-retry');scheduleStall(STALL_RETRY_MS,'continued-waiting');}
      return true;
    }
    function destroy(){
      if(destroyed)return;stopProbes();cancelStall('destroy');clearLater(recovery.clearTimer);clearEvery(watchTimer);unwatchVideo();
      document?.removeEventListener?.('visibilitychange',onVisibilityChange);interceptor?.destroy();if(initialGuard)state.needReload=true;
      destroyed=true;instances.delete(root);
    }
    const api={getConfig,setConfig,getFlags,getState,resetNetwork,retry,rewriteUrl:raw=>active()?(recovery.avoidHost&&hostOf(raw)===recovery.avoidHost?core.createPolicy({...config,mode:'force'}):policy).route(raw).url:raw,destroy};
    instances.set(root,api);
    const Feedback=root.BiliSmoothPlaybackFeedback||global.BiliSmoothPlaybackFeedback;
    if(Feedback){let initial;try{initial=Reflect.apply(nativeParse,json,[root.localStorage?.getItem(feedbackKey())||'null']);}catch{}feedback=Feedback.create({hosts:config.candidatePool,now:wallNow,initial});}
    const cached=loadRanking();if(cached)applyRanking(cached.ranking);
    interceptor=RequestLayer.install({scope:root,active,route,prepare,sharingPolicy:initialGuard,
      begin:info=>beginRequest(info.originalUrl,info.url,info.transport,info.method,info.range),onTransfer:reportTransfer,
      ignoreTiming:entry=>probeTimings.some(probe=>probe.url===entry.name&&entry.startTime>=probe.startedAt-3&&entry.startTime<=probe.startedAt+20),
      onSharingBlock:name=>{state.p2pBlocked++;log('p2p-blocked',{api:name});}});
    document?.addEventListener?.('visibilitychange',onVisibilityChange);watchVideo();watchTimer=every(watchVideo,1500);emit({type:'config',config:getConfig()});return api;
  }
  const api=Object.freeze({create,constants:Object.freeze({RANK_PREFIX,RANK_TTL_MS,STALL_GRACE_MS,STALL_RETRY_MS,PROBE_TIMEOUT_MS,PROBE_MAX_HOSTS,PROBE_BYTES})});
  global.BiliSmoothPlaybackKernel=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
