// Actual MV3 integration. Local video documents exercise UI and messages, not CDN performance.
'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const {createEvidenceOutput,assertBuildMatches}=require('./validation-support.cjs');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const evidence=createEvidenceOutput({root,suite:'extension-control',version,legacyDirectory:path.join(root,'outputs'),reportFile:`extension-control-${version}.json`});
const checks=[],errors=[],blocked=[],uncovered=[];
const check=(name,passed,detail)=>{checks.push({name,passed:!!passed,...(detail===undefined?{}:{detail})});if(!passed)throw Error(name);};
(async()=>{
 let context,fatal;
 const directory=await fs.mkdtemp(path.join(root,'work','extension-control-'));
 const build=JSON.parse(await fs.readFile(path.join(root,'dist/extension/BUILD.json'),'utf8'));
 await assertBuildMatches(root);
 const profile=path.join(directory,'profile'),extension=path.join(directory,'extension'),screens=evidence===path.join(root,'outputs')?path.join(root,`outputs/control-ui-${version}`):evidence;
 await fs.mkdir(screens,{recursive:true});await fs.cp(path.join(root,'dist/extension'),extension,{recursive:true});
 try{
  // Reserve realistic side-column room for the readable detail card; narrow
  // no-fit behavior has its own floating regression rather than this flow test.
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1440,height:768},acceptDownloads:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());if(url.protocol==='chrome-extension:')return route.continue();
   if(url.hostname==='www.bilibili.com')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><title>Local control fixture ${url.pathname.slice(-1)}</title><style>body{margin:0;font:14px Arial;background:#f6f7f8;color:#18191c}header{height:64px;background:white;padding:20px 40px}main{width:calc(100% - 426px);max-width:1200px;margin:24px auto}h1{font-size:22px;font-weight:500}.bpx-player-container{position:relative;width:880px;max-width:100%;aspect-ratio:16/9;background:#17181a;border-radius:6px}video{width:100%;height:100%}.fixture-note{color:#61666d}</style></head><body><header>Local integration document</header><main><h1>Local video fixture ${url.pathname.slice(-1)}</h1><p class="fixture-note">Layout and extension messaging only; no real playback measurement.</p><div class="bpx-player-container"><video width="880" height="495"></video></div></main><script>window.fixtureBoot=Date.now();window.stateRequests=0;addEventListener('message',event=>{if(event.data?.__biliSmooth==='request'&&event.data.action==='state')stateRequests++});</script></body></html>`});
   blocked.push(url.origin);return route.abort();
  });
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).hostname;
  // Import structurally recognizable preferences without depending on a product-specific key.
  await worker.evaluate(()=>chrome.storage.local.set({'prior.preferences':{schemaVersion:4,enabled:false,selection:'fixed',pcdnHost:'upos-sz-mirrorcos.bilivideo.com',theme:'dark',lang:'en',accent:'teal'},bilismoothTheme:'dark'}));
  const source=await context.newPage();await source.goto('https://www.bilibili.com/video/BVcontrolA');
  await source.waitForFunction(()=>window.BiliSmoothSession?.getState().startupReady&&window.BiliSmoothFloating);
  const second=await context.newPage();await second.goto('https://www.bilibili.com/video/BVcontrolB');
  await second.waitForFunction(()=>window.BiliSmoothSession?.getState().startupReady&&window.BiliSmoothFloating);
  const sourceId=await worker.evaluate(async()=> (await chrome.tabs.query({url:'https://www.bilibili.com/video/BVcontrolA'}))[0].id);
  const secondId=await worker.evaluate(async()=> (await chrome.tabs.query({url:'https://www.bilibili.com/video/BVcontrolB'}))[0].id);
  const initial=await source.evaluate(()=>BiliSmoothSession.getState());
  check('Real content bridge retains migrated preferences before declaring startup ready',initial.version===version&&!initial.config.enabled&&initial.config.selection==='fixed'&&initial.config.theme==='dark'&&initial.config.accent==='teal');
  check('Exactly one initially collapsed in-page control exists',await source.locator('#bilismooth-floating').count()===1&&await source.locator('#bilismooth-floating').getAttribute('data-expanded')==='false');
  await source.bringToFront();
  const edgeBox=await source.locator('#bilismooth-floating #bs-edge').boundingBox();
  await source.mouse.move(edgeBox.x+edgeBox.width/2,edgeBox.y+edgeBox.height/2);
  await source.waitForFunction(()=>document.querySelector('#bilismooth-floating').dataset.phase==='preview');
  await source.locator('#bilismooth-floating #bs-move').click();
  await source.locator('#bilismooth-floating #bs-route').waitFor();
  await source.locator('#bilismooth-floating .bs-enable .bs-switch').click();
  await source.waitForFunction(()=>BiliSmoothSession.getConfig().enabled&&BiliSmoothSession.getState().settingsSave.status==='saved');
  await second.waitForFunction(()=>BiliSmoothSession.getConfig().enabled);
  const active=await worker.evaluate(async()=> (await chrome.tabs.query({active:true,currentWindow:true}))[0]?.id);
  check('In-page setting saves through the real worker, reaches another video, and keeps its source active',active===sourceId&&context.pages().filter(page=>page.url().includes('/control/index.html')).length===0);
  const created=context.waitForEvent('page');await source.locator('#bilismooth-floating [data-action="dashboard"]').click();
  const control=await created;await control.waitForURL(`chrome-extension://${id}/control/index.html?tab=${sourceId}`);
  await control.waitForFunction(version=>window.BiliSmoothView?.getSnapshot().startupReady&&BiliSmoothView.getSnapshot().version===version,version);
  const show=async name=>control.locator(`nav [data-page="${name}"]`).click();
  const choose=async(trigger,value)=>{await trigger.click();await control.locator(`.bs-choice-layer[data-state="open"] [role="option"][data-value="${value}"]`).click();};
  const set=async(key,value)=>{
    await show(['theme','accent','lang'].includes(key)?'settings':'routes');
    const fields=control.locator(`[data-config="${key}"]`);
    if(await fields.first().getAttribute('data-choice'))await choose(fields.first(),value);
    else {const input=control.locator(`[data-config="${key}"][value="${value}"]`);await control.locator('label').filter({has:input}).last().click();}
    await control.waitForFunction(({key,value})=>BiliSmoothView.getSnapshot().config[key]===value&&![...document.querySelectorAll(`[data-config="${key}"]`)].some(node=>node.disabled),{key,value});
  };
  await control.locator('#video-select').click();
  check('Floating dashboard action associates the source and lists both actual video tabs',new URL(control.url()).searchParams.get('tab')===String(sourceId)&&await control.locator('.bs-choice-layer[data-state="open"] [role="option"]').count()>=2);
  await control.keyboard.press('Escape');
  const brand=await control.evaluate(()=>({version:document.querySelector('meta[name="bilismooth-version"]').content,logo:document.querySelector('.brand img')?.getAttribute('src')||[...document.images].find(image=>image.alt==='')?.getAttribute('src'),favicon:document.querySelector('link[rel="icon"]').getAttribute('href'),manifest:chrome.runtime.getManifest()}));
  check('Installed control and toolbar load the versioned brand assets',brand.version===version&&/\/32\.[a-f0-9]{12}\.png$/.test(brand.favicon)&&JSON.stringify(brand.manifest.icons)===JSON.stringify(brand.manifest.action.default_icon));
  await control.evaluate(()=>history.replaceState(null,'',location.pathname+'#main'));
  await worker.evaluate(async sourceId=>openControl({id:sourceId,url:'https://www.bilibili.com/video/BVcontrolA'}),sourceId);
  check('Toolbar action still locates and reuses the dashboard after skip-link navigation',context.pages().filter(page=>page.url().split(/[?#]/)[0]===`chrome-extension://${id}/control/index.html`).length===1);
  await set('theme','light');await set('accent','bili');
  await second.waitForFunction(()=>BiliSmoothSession.getConfig().theme==='light'&&BiliSmoothSession.getConfig().accent==='bili');
  await source.bringToFront();await source.waitForFunction(()=>document.querySelector('#bilismooth-floating').dataset.theme==='light'&&document.querySelector('#bilismooth-floating').dataset.accent==='bili');
  check('Dashboard appearance reaches both the runtime and in-page surface',await source.locator('#bilismooth-floating').getAttribute('data-accent')==='bili');
  await source.screenshot({path:path.join(screens,'installed-floating-light.png')});
  await control.bringToFront();await set('accent','pink');
  await source.bringToFront();await source.waitForFunction(()=>document.querySelector('#bilismooth-floating').dataset.accent==='pink');
  const surfaceColor=await source.locator('#bilismooth-floating').evaluate(node=>getComputedStyle(node).getPropertyValue('--accent').trim());
  const dashboardColor=await control.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  // Pink is a paired, low-saturation surface, not the old saturated brand ink.
  check('Actual computed accent agrees across dashboard and shadow surface',surfaceColor===dashboardColor&&surfaceColor.toLowerCase()==='#f2dde3',{surfaceColor,dashboardColor});
  await control.bringToFront();await show('routes');
  await control.locator('#fixed-host').fill('upos-sz-mirrorhw.bilivideo.com');await control.locator('#apply-host').click();
  await control.waitForFunction(()=>BiliSmoothView.getSnapshot().targetHost==='upos-sz-mirrorhw.bilivideo.com'&&!document.querySelector('#apply-host').disabled);
  const applied=await source.evaluate(()=>BiliSmoothSession.getState());
  check('Manual route reaches runtime and waits for saved acknowledgement',applied.config.selection==='fixed'&&applied.targetHost==='upos-sz-mirrorhw.bilivideo.com'&&applied.settingsSave.status==='saved');
  check('Fixed routing disables automatic alternate-route action',await control.locator('[data-command="retry"]').first().isDisabled());
  await source.bringToFront();await source.waitForFunction(()=>document.querySelector('#bilismooth-floating').shadowRoot.querySelector('#bs-route').value==='host:upos-sz-mirrorhw.bilivideo.com');
  check('Manual route from the dashboard is reflected in the in-page selector',await source.locator('#bs-route').evaluate(node=>node.value)==='host:upos-sz-mirrorhw.bilivideo.com');
  await control.bringToFront();await show('settings');
  const motion=control.locator('#motion');if(await motion.isChecked())await control.locator('label').filter({has:motion}).last().click();
  await source.bringToFront();await source.waitForFunction(()=>document.querySelector('#bilismooth-floating').dataset.motion==='off');
  check('Saved motion preference propagates to the real in-page surface',await source.locator('#bilismooth-floating').getAttribute('data-motion')==='off');
  await control.bringToFront();await show('overview');
  await choose(control.locator('#video-select'),String(secondId));
  await control.waitForFunction(id=>Number(document.querySelector('#video-select').value)===id&&BiliSmoothView.getSnapshot().startupReady,secondId);
  check('Multi-video selection retains explicit command ownership',new URL(control.url()).searchParams.get('tab')===String(secondId));
  const downloadPromise=control.waitForEvent('download');await control.locator('#export').click();const download=await downloadPromise;
  const downloadPath=path.join(directory,'diagnostics.json');await download.saveAs(downloadPath);const exported=JSON.parse(await fs.readFile(downloadPath,'utf8'));
  check('Actual diagnostic download is versioned and excludes page identities',exported.version===version&&Array.isArray(exported.events)&&!JSON.stringify(exported).includes('BVcontrol')&&!JSON.stringify(exported).includes('Local control fixture'));
  await control.waitForFunction(()=>!document.querySelector('#export').disabled);
  const boot=await second.evaluate(()=>fixtureBoot),response=await control.evaluate(()=>BiliSmoothLive.command('reload'));
  check('Reload replies after settings persistence',response.settingsSave.status==='saved');
  await second.waitForFunction(previous=>window.fixtureBoot!==previous&&window.BiliSmoothSession?.getState().startupReady&&window.BiliSmoothFloating,boot);
  check('Reloaded video retains preferences and mounts one surface',await second.evaluate(()=>BiliSmoothSession.getConfig().pcdnHost==='upos-sz-mirrorhw.bilivideo.com'&&BiliSmoothSession.getConfig().theme==='light'&&document.querySelectorAll('#bilismooth-floating').length===1));
  await control.bringToFront();await control.evaluate(()=>BiliSmoothLive.refresh(true));
  await set('accent','bili');await set('lang','zh');await show('overview');
  await control.screenshot({path:path.join(screens,'installed-light.png'),fullPage:true});
  await set('theme','dark');await show('overview');await control.screenshot({path:path.join(screens,'installed-dark.png'),fullPage:true});
  await control.setViewportSize({width:360,height:850});
  check('Installed narrow dashboard keeps all pages without horizontal overflow',await control.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await control.screenshot({path:path.join(screens,'installed-narrow.png'),fullPage:true});
  check('No uncaught extension page errors',errors.length===0,errors);check('Local integration makes no external asset requests',blocked.length===0,blocked);
 }catch(error){fatal=error.stack||String(error);checks.push({name:'actual extension control flow completes',passed:false,detail:fatal});}
 finally{
  await context?.close();const scope=Object.keys(build.sourceSha256).filter(file=>file.startsWith('src/'));
  const report={version,at:new Date().toISOString(),passed:checks.every(item=>item.passed),checks,fatal,uncovered,scope,sourceSha256:Object.fromEntries(scope.map(file=>[file,build.sourceSha256[file]])),limits:['Actual MV3, local HTML video elements, native storage/messages and source-tab identity. No real video decode or CDN performance claim.',...uncovered]};
  const output=path.join(evidence,`extension-control-${version}.json`);await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,passed:report.passed,checks:checks.length,fatal}));if(!report.passed)process.exitCode=1;
 }
})();
