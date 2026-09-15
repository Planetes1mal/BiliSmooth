'use strict';
// One disposable real-page visual inspection. No route/settings changes or media benchmark.
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { chromium } = require('playwright');
const { createEvidenceOutput, assertBuildMatches } = require('./validation-support.cjs');
const root = path.resolve(__dirname, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const version = require('../package.json').version;
const output = createEvidenceOutput({ root, suite: 'real-surface', version, legacyDirectory: path.join(root, 'outputs'), reportFile: `real-surface-${version}.json` });
const report = { version, startedAt: new Date().toISOString(), url: 'https://www.bilibili.com/video/BV1u2bg6XECo/', scope: 'Real webpage coexistence, rounded entry/preview/panel, observed playback projection, read-only choice opening/closing, readable detail panel and real runtime connection. Automatic placement prefers free space; explicit expansion and user positioning preserve their anchor and may cover webpage content. Actual overlaps are recorded, not treated as a hard avoidance guarantee. No dashboard, performance comparison, manual probe, route, quality, login or user Chrome changes.', viewport: { width: 2048, height: 991 }, environment: { disposableProfile: true, headless: true, authenticated: false, responseInterception: false, throttling: false }, navigation: [], errors: [], screenshots: [], checks: [], coexistence: [], uncovered: ['This visual inspection does not measure playback performance or exercise fullscreen transitions.']  };
function visualState() {
 const host = document.getElementById('bilismooth-floating'), shadow = host?.shadowRoot;
 const measuredViewport=window.BiliSmoothSurfaceStyles?.viewport?.(window);
 const usable=measuredViewport||{left:0,top:0,right:document.documentElement.clientWidth,bottom:document.documentElement.clientHeight,width:document.documentElement.clientWidth,height:document.documentElement.clientHeight,originX:0,originY:0,scaleX:1,scaleY:1};
 const insideUsable=(bounds,margin=0)=>!!bounds&&bounds.x>=usable.left+margin-.5&&bounds.y>=usable.top+margin-.5&&bounds.right<=usable.right-margin+.5&&bounds.bottom<=usable.bottom-margin+.5;
 const rect = node => { if (!node) return null; const r = node.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom }; };
 const visible = node => { if (!node || node.hidden) return false; const r=rect(node),style=getComputedStyle(node); return r.width>0&&r.height>0&&style.visibility!=='hidden'&&style.display!=='none'; };
 const intersect = (a,b) => a&&b ? Math.max(0,Math.min(a.right,b.right)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)) : null;
 const panel = rect(host), player = rect(document.querySelector('.bpx-player-container,.bilibili-player,#bilibili-player')), nativeControls = rect(document.querySelector('.bpx-player-control-bottom'));
 const runtime = window.BiliSmoothRuntime, session = window.BiliSmoothSession;
 const stateRead = runtime?.getViewState ? 'getViewState' : 'getState';
 const state = runtime?.[stateRead]?.(), config = state?.config||runtime?.getConfig?.(), media = document.querySelector('video');
 const body=shadow?.getElementById('bs-body'), route=shadow?.getElementById('bs-route'), menu=shadow?.querySelector('.bs-choice-layer[data-state="open"]');
 const menuRect=visible(menu)?rect(menu):null;
 const recommendationSelector='.right-container,.recommend-list-v1,.video-pod,.multi-page-v1';
 const overlapPolicy=node=>node.closest(recommendationSelector)?'recommendation-or-collection':'other-webpage-content';
 const protectedRegions = [];
 for(const selector of ['.right-container','.recommend-list-v1','.video-pod','.multi-page-v1','.danmaku-box','.video-toolbar-container','[role=dialog]','[aria-modal=true]']){
  for(const node of document.querySelectorAll(selector))if(visible(node))protectedRegions.push({selector,policy:overlapPolicy(node),rect:rect(node),overlapPx2:visible(host)?intersect(panel,rect(node)):0,menuOverlapPx2:menuRect?intersect(menuRect,rect(node)):0});
 }
 const interactiveCollisions = [], menuInteractiveCollisions = [];
 for(const node of document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=link],[contenteditable=true],[tabindex]:not([tabindex="-1"])')){
  if(node===host||host?.contains(node)||!visible(node)||!visible(host))continue;
  const bounds=rect(node), policy=overlapPolicy(node), overlap=intersect(panel,bounds), menuOverlap=menuRect?intersect(menuRect,bounds):0;
  const detail={tag:node.tagName,role:node.getAttribute('role'),policy,rect:bounds};
  if(overlap>0)interactiveCollisions.push({...detail,overlapPx2:overlap});
  if(menuOverlap>0)menuInteractiveCollisions.push({...detail,overlapPx2:menuOverlap});
 }

 const activeSignal=shadow?.querySelector(host?.dataset.phase==='edge'?'.bs-entry-face':host?.dataset.phase==='panel'?'#bs-panel-glyph .bs-status-signal':'#bs-state-glyph .bs-status-signal');
 return {
  page:location.origin+location.pathname,title:document.title,readyState:document.readyState,rootTheme:document.documentElement.className,
  viewport:{width:innerWidth,height:innerHeight,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,dpr:devicePixelRatio,usable,measuredBy:measuredViewport?'shared.viewport':'documentElement-fallback'},
  runtime:{present:!!runtime,sessionPresent:!!session,floatingPresent:!!window.BiliSmoothFloating,stateRead,version:state?.version,mediaPresent:state?.media?.present,playback:state?.media?.playback,projectedPlayback:window.BiliSmoothSurfaceStyles?.projectPlayback?.(state,true),frameHealth:state?.media?.frameHealth?.state,observedAt:state?.observedAt,actualHost:state?.actualHost||null,settingsSave:state?.settingsSave,config:config?{theme:config.theme,accent:config.accent,enabled:config.enabled,mode:config.mode,selection:config.selection,floatingFields:config.floatingFields,floatingEntryEnabled:config.floatingEntryEnabled,floatingEntryType:config.floatingEntryType,floatingEdgeSnap:config.floatingEdgeSnap}:null},
  nativeVideo:media?{paused:media.paused,readyState:media.readyState,width:media.videoWidth,height:media.videoHeight}:null,
  floating:host?{
   phase:host.dataset.phase,edge:host.dataset.edge,expanded:host.dataset.expanded,theme:host.dataset.theme,accent:host.dataset.accent,motion:host.dataset.motion,state:host.dataset.state,visible:visible(host),hiddenReason:host.dataset.hiddenReason,inert:host.inert,rect:panel,
   bodyHidden:body?.hidden,bodyInert:body?.inert,text:body?.innerText,edgeHitArea:rect(shadow.getElementById('bs-edge')),entryRadius:shadow.getElementById('bs-edge')?getComputedStyle(shadow.getElementById('bs-edge')).borderRadius:null,entryType:shadow.querySelector('.bs-entry-face')?.dataset.entryType,cssWidth:panel?.width/(usable.scaleX||1),
   capsule:{scrollWidth:shadow.getElementById('bs-move')?.scrollWidth,clientWidth:shadow.getElementById('bs-move')?.clientWidth,text:shadow.getElementById('bs-move')?.innerText,state:shadow.getElementById('bs-capsule-state')?.textContent,speed:shadow.getElementById('bs-capsule-speed')?.textContent,speedUnit:shadow.getElementById('bs-capsule-speed-unit')?.textContent,buffer:shadow.getElementById('bs-capsule-buffer')?.textContent},
   signal:{present:!!activeSignal,state:activeSignal?.dataset.entryState||activeSignal?.dataset.playback,frames:activeSignal?.querySelectorAll('.bs-status-frame').length||0,logoPaths:activeSignal?.querySelectorAll('.bs-entry-logo-piece').length||0,animations:Array.from(activeSignal?.getAnimations({subtree:true})||[]).map(a=>({playState:a.playState,duration:a.effect.getTiming().duration,iterations:String(a.effect.getTiming().iterations)}))},
   choice:{present:!!window.BiliSmoothChoice,triggerTag:route?.tagName,value:route?.value,menuVisible:visible(menu),menuRect,withinViewport:insideUsable(menuRect),nativeSelectCount:shadow.querySelectorAll('select').length},
   bodyScrollWidth:body?.scrollWidth,bodyClientWidth:body?.clientWidth,bodyScrollHeight:body?.scrollHeight,bodyClientHeight:body?.clientHeight,
   withinViewport:visible(host)&&insideUsable(panel,8)
  }:null,
  player,nativeControls,protectedRegions,interactiveCollisions,menuInteractiveCollisions,
  overlapPx2:{player:visible(host)?intersect(panel,player):0,nativeControls:visible(host)?intersect(panel,nativeControls):0},
  loginDialogVisible:Array.from(document.querySelectorAll('[class*=login]')).some(e=>{const r=rect(e);return r.width>200&&r.height>100&&visible(e);})
 };
}
async function observeSignal(page) {
 return page.evaluate(async()=>{
  const host=document.getElementById('bilismooth-floating'),shadow=host?.shadowRoot,frames=[];
  const glyph=shadow?.querySelector(host?.dataset.phase==='edge'?'.bs-entry-face':host?.dataset.phase==='panel'?'#bs-panel-glyph .bs-status-signal':'#bs-state-glyph .bs-status-signal');
  if(!glyph)return frames;
  const start=performance.now();
  do { frames.push({afterMs:performance.now()-start,state:host.dataset.state,motion:host.dataset.motion,visible:!host.hidden&&glyph.getBoundingClientRect().width>0,parts:Array.from(glyph.querySelectorAll('.bs-entry-logo-piece,.bs-entry-logo-flow,.bs-status-sequence,.bs-status-frame')).map(node=>{const s=getComputedStyle(node);return {transform:s.transform,opacity:s.opacity};})});await new Promise(requestAnimationFrame); } while(performance.now()-start<300);
  return frames;
 });
}
function check(name,passed,detail) { report.checks.push({name,passed:!!passed,...(detail===undefined?{}:{detail})}); }
function checkPlacement(name,state) {
 const floating=state.floating,regions=state.protectedRegions||[],collisions=state.interactiveCollisions||[];
 check(name+' stays inside the usable client viewport with an 8px margin',floating?.visible&&floating.withinViewport,{rect:floating?.rect,usable:state.viewport.usable,measuredBy:state.viewport.measuredBy});
 report.coexistence.push({name,phase:floating?.phase,playerAndNativeControls:state.overlapPx2,regions:regions.filter(row=>row.overlapPx2>0),interactiveCollisions:collisions});
}
async function observeMotion(page) {
 return page.evaluate(async()=>{
  const body=document.getElementById('bilismooth-floating').shadowRoot.querySelector('.bs-shell,.bs-shell-shape'),frames=[];
  const start=performance.now();
  do { const s=getComputedStyle(body);frames.push({afterMs:performance.now()-start,hidden:body.hidden,inert:body.inert,opacity:s.opacity,transform:s.transform,animations:body.getAnimations({subtree:true}).map(a=>({playState:a.playState,currentTime:a.currentTime,duration:a.effect.getTiming().duration,easing:a.effect.getTiming().easing}))});await new Promise(requestAnimationFrame); } while(performance.now()-start<550);
  return frames;
 });
}
(async()=>{
 await fs.mkdir(output,{recursive:true});await fs.mkdir(path.join(root,'work'),{recursive:true});
 const settled = process.argv.includes('--settled');
 const priorPath = process.argv.find(value => value.startsWith('--prior='))?.slice(8);
 if (settled && !priorPath) throw Error('--settled requires --prior=<previous report path> and a new run label');
 const prior = settled ? JSON.parse(await fs.readFile(path.resolve(root, priorPath),'utf8')) : null;
 const work=prior ? path.join(root,prior.workDirectory) : await fs.mkdtemp(path.join(root,'work',`real-surface-${version}-`)),extension=path.join(work,'extension');
 if(!prior)await fs.cp(path.join(root,'dist/extension'),extension,{recursive:true});
 await assertBuildMatches(root, extension);
 if(prior){
  const priorDirectory = path.dirname(path.resolve(root, priorPath));
  await fs.copyFile(path.resolve(root, priorPath),path.join(output,`real-surface-${version}-initial-loading.json`));
  for(const state of ['collapsed','expanded','blocked']){try{await fs.copyFile(path.join(priorDirectory,`real-surface-${version}-${state}.png`),path.join(output,`real-surface-${version}-initial-loading-${state}.png`));}catch(e){if(e.code!=='ENOENT')throw e;}}
  report.followupReason='Initial capture preceded native page images/control initialization and animation finalization. This followup reuses the same disposable profile and immutable copied extension, waits for native readiness and collapsed final state; no settings or route changes.';
 }
 report.workDirectory=path.relative(root,work).replaceAll('\\','/');
 report.build=JSON.parse(await fs.readFile(path.join(extension,'BUILD.json'),'utf8'));
 const manifest=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8'));
 if(manifest.version!==report.version)throw Error('Unexpected extension version '+manifest.version);
 report.runtimeFileSha256=Object.fromEntries(await Promise.all(['manifest.json','playback.js','content.js','background.js','settings.js','surface.js','entry-display.js','choice.js'].map(async file=>[file,hash(await fs.readFile(path.join(extension,file)))])));
 report.hashesMatchBuild=Object.entries(report.runtimeFileSha256).every(([file,sha])=>report.build.outputSha256[file]===sha);
 if(!report.hashesMatchBuild)throw Error('Immutable candidate copy differs from BUILD.json');
 report.surfaceSourceSha256=Object.fromEntries(['src/page/floating-control.js','src/ui/surface.js','src/ui/entry-display.js','src/ui/choice.js','src/ui/motion-runtime.js'].map(file=>[file,report.build.sourceSha256[file]]));
 let context;
 try{
  context=await chromium.launchPersistentContext(path.join(work,'profile'),{channel:'chromium',headless:true,viewport:report.viewport,colorScheme:'light',ignoreDefaultArgs:['--hide-scrollbars'],args:['--disable-features=OverlayScrollbar,OverlayScrollbars','--show-scrollbars','--disable-background-networking',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  report.browserVersion=context.browser()?.version();
  const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('response',response=>{if(response.request().isNavigationRequest()&&response.request().frame()===page.mainFrame()){const u=new URL(response.url());report.navigation.push({at:new Date().toISOString(),status:response.status(),page:u.origin+u.pathname});}});
  try{await page.goto(report.url,{waitUntil:'domcontentloaded',timeout:25000});}catch(e){report.navigationError=String(e);}
  try{await page.waitForFunction(()=>document.querySelector('video')&&document.getElementById('bilismooth-floating')?.shadowRoot&&window.BiliSmoothRuntime,undefined,{timeout:20000});}catch(e){report.pageReadyError=String(e);}
  try{await page.waitForFunction(()=>document.readyState==='complete'&&document.querySelector('video')?.readyState>=2&&document.querySelector('.bpx-player-control-bottom')?.getBoundingClientRect().height>0&&Array.from(document.querySelectorAll('.video-page-card-small img,.recommend-list-v1 img,.right-container img')).some(i=>i.naturalWidth>0),undefined,{timeout:20000});}catch(e){report.nativeSettledError=String(e);}
  // Observe any native autoplay without starting or benchmarking playback; then pause.
  report.beforePause=await page.evaluate(visualState);report.signalMotion=await observeSignal(page);
  await page.evaluate(()=>document.querySelectorAll('video').forEach(v=>v.pause()));
  try{await page.waitForFunction(()=>{const h=document.getElementById('bilismooth-floating');return !h||h.dataset.state!=='smooth';},undefined,{timeout:3500});}catch(e){report.pauseStateError=String(e);}
  report.initial=await page.evaluate(visualState);
  console.log(JSON.stringify({stage:'page-access',navigation:report.navigation,title:report.initial.title,runtime:report.initial.runtime.present,floating:!!report.initial.floating}));
  const shot=async(name)=>{const file=`real-surface-${version}-${name}.png`;await page.screenshot({path:path.join(output,file),fullPage:false});report.screenshots.push({file:path.relative(root,path.join(output,file)).split(path.sep).join('/'),sha256:hash(await fs.readFile(path.join(output,file)))});const host=page.locator('#bilismooth-floating');if(await host.isVisible()){const crop=`real-surface-${version}-${name}-detail.png`;await host.screenshot({path:path.join(output,crop)});report.screenshots.push({file:path.relative(root,path.join(output,crop)).split(path.sep).join('/'),sha256:hash(await fs.readFile(path.join(output,crop)))});}};
  if(report.initial.floating?.visible&&report.initial.nativeVideo&&report.navigation.at(-1)?.status<400){
   const host=page.locator('#bilismooth-floating');
   check('Initial surface uses the rounded 54px status logo entry',report.initial.floating.phase==='edge'&&Math.abs(report.initial.floating.edgeHitArea?.width-54*report.initial.viewport.usable.scaleX)<=.5&&Math.abs(report.initial.floating.edgeHitArea?.height-54*report.initial.viewport.usable.scaleY)<=.5&&report.initial.floating.entryRadius==='19px'&&report.initial.floating.entryType==='status-logo'&&report.initial.floating.expanded==='false'&&report.initial.floating.bodyHidden&&report.initial.floating.bodyInert);
   check('Geometry uses the shared usable viewport rather than innerWidth',report.initial.viewport.measuredBy==='shared.viewport',report.initial.viewport);
   check('Real surface uses the lightweight runtime view',report.initial.runtime.present&&report.initial.runtime.sessionPresent&&report.initial.runtime.stateRead==='getViewState');
   checkPlacement('Edge tab',report.initial);
   check('Paused native video does not retain smooth status or active signal motion',report.initial.nativeVideo.paused&&report.initial.floating.state!=='smooth'&&report.initial.floating.signal.animations.length===0&&report.initial.floating.signal.state===report.initial.runtime.projectedPlayback);
   const eligible=report.signalMotion.filter(frame=>frame.state==='smooth'&&frame.motion==='on'&&frame.visible&&frame.parts.length>0);
   if(eligible.length>1&&eligible.length===report.signalMotion.length)check('Native autoplay supplied visible healthy status motion',new Set(eligible.map(frame=>JSON.stringify(frame.parts))).size>1,{frames:eligible.length,windowMs:eligible.at(-1).afterMs});
   else report.uncovered.push('Native autoplay did not supply a sustained eligible smooth status sample before pausing; no playback was started to force one.');
   await page.mouse.move(10,10);await shot('edge');
   const edgeBox=await host.locator('#bs-edge').boundingBox();
   await page.mouse.move(edgeBox.x+edgeBox.width/2,edgeBox.y+edgeBox.height/2);report.previewMotion=await observeMotion(page);
   report.preview=await page.evaluate(visualState);await shot('preview');
   check('Hover reveals metrics while actions stay hidden and inert',report.preview.floating.phase==='preview'&&report.preview.floating.bodyHidden&&report.preview.floating.bodyInert&&!!report.preview.floating.capsule.state&&!!report.preview.floating.capsule.speed&&!!report.preview.floating.capsule.buffer);
   check('Metric preview retains its approved 256px width and ordered frame signal',Math.abs(report.preview.floating.cssWidth-256)<=.5&&report.preview.floating.signal.frames===10&&report.preview.floating.signal.state===report.preview.runtime.projectedPlayback);
   checkPlacement('Metric preview',report.preview);
   check('Metric preview does not truncate its chosen fields horizontally',report.preview.floating.capsule.scrollWidth<=report.preview.floating.capsule.clientWidth,report.preview.floating.capsule);
   report.panelOpenedBy='explicit-preview-click';
   await host.locator('#bs-move').click();report.openMotion=await observeMotion(page);
   await page.evaluate(()=>document.querySelectorAll('video').forEach(v=>v.pause()));
   await page.mouse.move(10,10);await page.waitForTimeout(220);
   report.expanded=await page.evaluate(visualState);await shot('expanded');
   check('Click pins a visible operable independent panel after pointer leaves',report.expanded.floating?.visible&&report.expanded.floating.phase==='panel'&&report.expanded.floating.expanded==='true'&&!report.expanded.floating.bodyHidden&&!report.expanded.floating.bodyInert);
   checkPlacement('Expanded panel',report.expanded);
   check('Explicit detail panel retains its approved readable 312px width',Math.abs(report.expanded.floating.cssWidth-312)<=.5,{cssWidth:report.expanded.floating.cssWidth,clientWidth:report.expanded.floating.rect.width,ideal:312});
   check('Panel status uses the observed playback projection',report.expanded.floating.signal.frames===10&&report.expanded.floating.signal.state===report.expanded.runtime.projectedPlayback);
   check('Expanded panel has no horizontal content overflow',report.expanded.floating.bodyScrollWidth<=report.expanded.floating.bodyClientWidth);
   check('Route choice uses the shared custom button rather than a native select',report.expanded.floating.choice.present&&report.expanded.floating.choice.triggerTag==='BUTTON'&&report.expanded.floating.choice.nativeSelectCount===0);
   if(report.expanded.floating.visible){
    const before=report.expanded.floating.choice.value;
    await host.locator('#bs-route').click();
    await host.locator('.bs-choice-layer[data-state="open"]').waitFor({state:'visible'});await page.waitForTimeout(180);
    report.choiceOpen=await page.evaluate(visualState);
    const menu=report.choiceOpen.floating.choice.menuRect;
    check('Read-only route menu opens within viewport and the readable panel width',!!menu&&menu.width<=report.expanded.floating.rect.width+.5&&report.choiceOpen.floating.choice.withinViewport);
    report.coexistence.push({name:'Explicit route menu',menuRect:menu,regions:report.choiceOpen.protectedRegions.filter(row=>row.menuOverlapPx2>0),interactiveCollisions:report.choiceOpen.menuInteractiveCollisions});
    await page.keyboard.press('Escape');report.choiceClosed=await page.evaluate(visualState);
    check('Escape closes only the route menu and commits no route',!report.choiceClosed.floating.choice.menuVisible&&report.choiceClosed.floating.expanded==='true'&&report.choiceClosed.floating.choice.value===before);
   }
   const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:5000});
   report.bridge=await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({url:['https://www.bilibili.com/video/*','https://www.bilibili.com/bangumi/play/*']});const tab=tabs[0];if(!tab)return {ok:false,error:'No video tab'};const r=await chrome.tabs.sendMessage(tab.id,{channel:'bilismooth',action:'state'});const s=r?.result||r?.state;return {responseOk:r?.ok,responseKeys:Object.keys(r||{}),version:s?.version,mediaPresent:s?.media?.present,actualHost:s?.actualHost||null};});
   if(report.expanded.floating.visible){
    await host.locator('#bs-close').click();report.closeMotion=await observeMotion(page);
    check('Panel retract button returns to metric preview',await host.getAttribute('data-phase')==='preview');
    await page.keyboard.press('Escape');await observeMotion(page);
   }else{
    report.blocker={stage:'expanded',surfaceHiddenReason:report.expanded.floating.hiddenReason||'not-visible'};
    await page.evaluate(()=>window.BiliSmoothFloating?.collapse());report.closeMotion=[];
   }
   await page.waitForFunction(()=>{const h=document.getElementById('bilismooth-floating');return h.dataset.expanded==='false'&&h.shadowRoot.getElementById('bs-body').hidden;},undefined,{timeout:5000});
   report.collapsedAgain=await page.evaluate(visualState);
   check('Content bridge confirms the loaded real runtime version',report.bridge.responseOk&&report.bridge.version===version&&report.bridge.mediaPresent,report.bridge);
   check('Close finalizes hidden and inert panel content',report.collapsedAgain.floating.expanded==='false'&&report.collapsedAgain.floating.bodyHidden&&report.collapsedAgain.floating.bodyInert);
   checkPlacement('Collapsed again',report.collapsedAgain);
   if(report.initial.floating.motion==='on'&&report.expanded.floating.visible){
    check('Preview and panel use the locally bundled spring animation',report.previewMotion.some(frame=>frame.animations.length>0)&&report.openMotion.some(frame=>frame.animations.length>0));
    check('Closing settles from a real geometry animation',report.closeMotion.some(frame=>frame.animations.length>0)&&report.collapsedAgain.floating.phase==='edge');
   }else report.uncovered.push('Open/close transitions were not assessed because motion was disabled or the expanded surface was not visible.');
   if(process.argv.includes('--themes')){
    report.themeScope='Visual preferences changed only in this disposable extension profile. Original page telemetry and responses remain untouched.';
    report.themeSurfaces=[];
    for(const preferences of [{theme:'light',accent:'graphite'},{theme:'dark',accent:'graphite'},{theme:'dark',accent:'peach'},{theme:'dark',accent:'teal'}]){
     await page.evaluate(async value=>{window.BiliSmoothRuntime.setConfig({...value,floatingEntryType:'combined'});await window.BiliSmoothRuntime.flushSettings();},preferences);
     await page.waitForFunction(value=>{const h=document.getElementById('bilismooth-floating');return h?.dataset.theme===value.theme&&h.dataset.accent===value.accent&&h.shadowRoot.querySelector('.bs-entry-face')?.dataset.entryType==='combined';},preferences);
     await page.evaluate(()=>window.BiliSmoothFloating.collapse());await page.mouse.move(10,10);await page.waitForTimeout(500);
     const prefix='theme-'+preferences.theme+'-'+preferences.accent;
     await shot(prefix+'-entry');
     const entry=await page.evaluate(visualState),box=await host.locator('#bs-edge').boundingBox();
     await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(600);await shot(prefix+'-preview');
     await host.locator('#bs-move').click();await page.mouse.move(10,10);await page.waitForTimeout(500);await shot(prefix+'-panel');
     const panel=await page.evaluate(visualState);report.themeSurfaces.push({preferences,entry,panel});
     check(prefix+' renders real entry and panel with no horizontal overflow',entry.floating.phase==='edge'&&panel.floating.phase==='panel'&&panel.floating.bodyScrollWidth<=panel.floating.bodyClientWidth);
     await host.locator('#bs-close').click();await page.waitForTimeout(350);await page.keyboard.press('Escape');await page.waitForTimeout(350);
    }
   }
   report.status=report.checks.every(row=>row.passed)?'real-surface-observed':'issues-observed';
  }else{await shot('blocked');report.status='blocked';report.blocker={navigation:report.navigation.at(-1),visibleText:(await page.locator('body').innerText()).slice(0,2000),missingVideo:!report.initial.nativeVideo,missingFloating:!report.initial.floating,surfaceHiddenReason:report.initial.floating?.hiddenReason||null};}
 }catch(e){report.fatal=String(e.stack||e);report.status='incomplete';}
 finally{if(context)await context.close();}
 report.finishedAt=new Date().toISOString();
 await fs.writeFile(path.join(output,`real-surface-${version}.json`),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,fatal:report.fatal,bridge:report.bridge,initial:report.initial?.floating?.rect,expanded:report.expanded?.floating?.rect,overlap:report.expanded?.overlapPx2,output:path.join(output,`real-surface-${version}.json`)}));
})().catch(e=>{console.error(e);process.exitCode=1;});
