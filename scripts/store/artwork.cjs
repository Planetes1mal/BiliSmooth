const fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(require('../lib/local.cjs').store,'listing','global');
// Extension PNG icons rendered from the vector logo; the 128 px icon gets a 16 px margin.
async function makeIcons(browser){
 const iconDir=path.join(root,'src/extension/icons');await fs.mkdir(iconDir,{recursive:true});
 const svg=await fs.readFile(path.join(root,'src/ui/icon.svg'),'utf8');
 const page=await browser.newPage();
 for(const size of [16,32,48,128]){
  const padding=size===128?16:0,artSize=size-padding*2;
  await page.setContent(`<style>body{margin:0}.icon{width:${size}px;height:${size}px;box-sizing:border-box;padding:${padding}px}svg{display:block;width:${artSize}px;height:${artSize}px}</style><div class="icon">${svg}</div>`);
  await page.locator('.icon').screenshot({path:path.join(iconDir,`${size}.png`),omitBackground:true});
 }
 await page.close();
}
(async()=>{
 const args=process.argv.slice(2);
 if(args.includes('--help')){
  console.log(`Usage: npm run store:artwork -- [--marquee-only]

Regenerates extension PNG icons from src/ui/icon.svg, then writes the store
icon-128.png, small-440x280.png and marquee-1400x560.png into
local/store/listing/global/. Promos are opaque 24-bit RGB PNGs.
--marquee-only leaves the icons and small promo intact. Requires Playwright Chromium.
Run npm run build afterwards before capturing the extension interface.
This command does not upload or publish anything.`);
  return;
 }
 if(args.some(arg=>arg!=='--marquee-only'))throw new Error('Unknown argument. Use --help.');
 const marqueeOnly=args.includes('--marquee-only');
 const logo=await fs.readFile(path.join(root,'src/ui/icon.svg'),'utf8');
 await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({headless:true,args:['--mute-audio']});try{
  if(!marqueeOnly){await makeIcons(browser);await fs.copyFile(path.join(root,'src/extension/icons/128.png'),path.join(out,'icon-128.png'));}
  const page=await browser.newPage({viewport:{width:440,height:280},deviceScaleFactor:1});
  if(!marqueeOnly){
  await page.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;background:#19243D;color:#F4F6F9;font-family:Arial,sans-serif;width:440px;height:280px;overflow:hidden}.route{position:absolute;inset:0;width:440px;height:280px}.brand{position:absolute;top:57px;left:36px;display:flex;align-items:center;gap:16px}.logo{width:62px;height:62px}.logo svg{width:100%;height:100%}h1{font-size:35px;letter-spacing:-1.4px;margin:0;font-weight:700}.panel{position:absolute;bottom:47px;left:36px;width:217px;height:55px;border:1px solid #657599;border-radius:18px;background:#24314E;display:flex;align-items:center;gap:15px;padding:0 18px}.play{width:0;height:0;border-top:9px solid transparent;border-bottom:9px solid transparent;border-left:14px solid #E0E7F9}.bars{display:flex;gap:4px;align-items:center;height:25px}.bars i{width:5px;background:#B6C1D9;border-radius:3px}.progress{height:5px;background:#424E6B;width:74px;border-radius:5px;overflow:hidden}.progress:after{content:'';display:block;width:51px;height:5px;background:#E0E7F9}</style></head><body><svg class="route" viewBox="0 0 440 280" fill="none"><path d="M289 195H337C357 195 363 175 363 151V28" stroke="#414E6B" stroke-width="2"/><path d="M289 195H396C417 195 423 207 423 230V282" stroke="#414E6B" stroke-width="2"/><path d="M289 195H440" stroke="#8E9AB7" stroke-width="3"/><circle cx="305" cy="195" r="5" fill="#E0E7F9"/><circle cx="364" cy="79" r="4" fill="#6A7691"/><circle cx="396" cy="195" r="5" fill="#E0E7F9"/></svg><div class="brand"><div class="logo">${logo}</div><h1>BiliSmooth</h1></div><div class="panel"><span class="play"></span><div class="bars"><i style="height:9px"></i><i style="height:17px"></i><i style="height:25px"></i><i style="height:14px"></i></div><div class="progress"></div></div></body></html>`);
  await page.screenshot({path:path.join(out,'small-440x280.png')});
  }
  await page.setViewportSize({width:1400,height:560});
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
   *{box-sizing:border-box}body{margin:0;width:1400px;height:560px;overflow:hidden;background:#19243D;color:#F4F6F9;font-family:Arial,"Microsoft YaHei",sans-serif}
   .brand{position:absolute;left:100px;top:116px;display:flex;align-items:center;gap:25px}.logo{width:92px;height:92px}.logo svg{width:100%;height:100%}h1{margin:0;font-size:76px;letter-spacing:-3px;font-weight:700}
   .description{position:absolute;left:103px;top:246px;margin:0;color:#C2CADC;font-size:29px;letter-spacing:3px;font-weight:400}
   .controls{position:absolute;left:103px;top:355px;width:357px;height:86px;border:1px solid #627194;border-radius:26px;background:#24314E;display:flex;align-items:center;gap:25px;padding:0 28px}
   .play{width:0;height:0;border-top:13px solid transparent;border-bottom:13px solid transparent;border-left:21px solid #E0E7F9}.bars{display:flex;gap:7px;align-items:center;height:40px}.bars i{width:7px;background:#B6C1D9;border-radius:4px}
   .progress{height:7px;background:#424E6B;width:119px;border-radius:5px;overflow:hidden}.progress:after{content:'';display:block;width:84px;height:7px;background:#E0E7F9}
   .illustration{position:absolute;inset:0;width:1400px;height:560px}
  </style></head><body>
   <svg class="illustration" viewBox="0 0 1400 560" fill="none" aria-hidden="true">
    <path d="M460 398H675Q749 398 749 324V44" stroke="#424E6B" stroke-width="2"/>
    <path d="M460 398H975Q1040 398 1040 463V560" stroke="#424E6B" stroke-width="2"/>
    <path d="M460 398H769Q839 398 839 328V225Q839 170 894 170H1086" stroke="#98A5C4" stroke-width="4"/>
    <circle cx="588" cy="398" r="8" fill="#E0E7F9"/><circle cx="749" cy="89" r="6" fill="#626E8A"/>
    <circle cx="1037" cy="442" r="6" fill="#626E8A"/>
    <rect x="969" y="85" width="281" height="190" rx="30" fill="#24314E" stroke="#687697" stroke-width="2"/>
    <rect x="987" y="103" width="245" height="153" rx="19" fill="#313E5C"/>
    <path d="M1084 142L1084 216L1140 179Z" fill="#E0E7F9"/>
    <path d="M996 324H1218Q1284 324 1284 390V486" stroke="#424E6B" stroke-width="2"/>
    <circle cx="1181" cy="324" r="6" fill="#626E8A"/>
    <rect x="886" y="310" width="196" height="99" rx="28" fill="#E0E7F9"/>
    <rect x="916" y="348" width="9" height="24" rx="4.5" fill="#34415F"/>
    <rect x="934" y="340" width="9" height="40" rx="4.5" fill="#34415F"/>
    <rect x="952" y="330" width="9" height="60" rx="4.5" fill="#34415F"/>
    <rect x="970" y="340" width="9" height="40" rx="4.5" fill="#34415F"/>
    <path d="M1004 359H1050" stroke="#34415F" stroke-width="7" stroke-linecap="round"/>
    <circle cx="1284" cy="486" r="8" fill="#8E9AB7"/>
   </svg>
   <div class="brand"><div class="logo">${logo}</div><h1>BiliSmooth</h1></div>
   <p class="description">B 站播放助手</p>
   <div class="controls"><span class="play"></span><div class="bars"><i style="height:14px"></i><i style="height:27px"></i><i style="height:40px"></i><i style="height:22px"></i></div><div class="progress"></div></div>
  </body></html>`);
  await page.screenshot({path:path.join(out,'marquee-1400x560.png'),omitBackground:false});
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
