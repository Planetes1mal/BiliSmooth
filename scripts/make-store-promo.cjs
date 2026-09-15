const fs=require('node:fs/promises'),path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'docs/chrome-web-store/assets');
(async()=>{
 const args=process.argv.slice(2);
 if(args.includes('--help')){
  console.log(`Usage: npm run store:artwork -- [--marquee-only]

Regenerates extension PNG icons from src/ui/icon.svg, then creates the store
128 px icon, 440 × 280 small promo and 1400 × 560 marquee. Promos are opaque
24-bit RGB PNGs. --marquee-only leaves the existing icon and small promo intact.
Requires Playwright Chromium.
Run npm run build afterwards before capturing the extension interface.
This command does not upload or publish anything.`);
  return;
 }
 if(args.some(arg=>arg!=='--marquee-only'))throw new Error('Unknown argument. Use --help.');
 const marqueeOnly=args.includes('--marquee-only');
 if(!marqueeOnly){
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['scripts/make-icons.cjs'],{cwd:root,shell:false,stdio:'inherit'});
  child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(`Icon generation failed (${code}).`)));
 });
 }
 const {chromium}=require('playwright');
 await fs.mkdir(out,{recursive:true});if(!marqueeOnly)await fs.copyFile(path.join(root,'src/extension/icons/128.png'),path.join(out,'icon-128.png'));
 const logo=await fs.readFile(path.join(root,'src/ui/icon.svg'),'utf8');
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage({viewport:{width:440,height:280},deviceScaleFactor:1});
  if(!marqueeOnly){
  await page.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;background:#193D34;color:#F4F9F5;font-family:Arial,sans-serif;width:440px;height:280px;overflow:hidden}.route{position:absolute;inset:0;width:440px;height:280px}.brand{position:absolute;top:57px;left:36px;display:flex;align-items:center;gap:16px}.logo{width:62px;height:62px}.logo svg{width:100%;height:100%}h1{font-size:35px;letter-spacing:-1.4px;margin:0;font-weight:700}.panel{position:absolute;bottom:47px;left:36px;width:217px;height:55px;border:1px solid #659987;border-radius:18px;background:#244E42;display:flex;align-items:center;gap:15px;padding:0 18px}.play{width:0;height:0;border-top:9px solid transparent;border-bottom:9px solid transparent;border-left:14px solid #D8EAE3}.bars{display:flex;gap:4px;align-items:center;height:25px}.bars i{width:5px;background:#B6D9C9;border-radius:3px}.progress{height:5px;background:#426B5D;width:74px;border-radius:5px;overflow:hidden}.progress:after{content:'';display:block;width:51px;height:5px;background:#D8EAE3}</style></head><body><svg class="route" viewBox="0 0 440 280" fill="none"><path d="M289 195H337C357 195 363 175 363 151V28" stroke="#416B5D" stroke-width="2"/><path d="M289 195H396C417 195 423 207 423 230V282" stroke="#416B5D" stroke-width="2"/><path d="M289 195H440" stroke="#8EB7A4" stroke-width="3"/><circle cx="305" cy="195" r="5" fill="#D8EAE3"/><circle cx="364" cy="79" r="4" fill="#6A9180"/><circle cx="396" cy="195" r="5" fill="#D8EAE3"/></svg><div class="brand"><div class="logo">${logo}</div><h1>BiliSmooth</h1></div><div class="panel"><span class="play"></span><div class="bars"><i style="height:9px"></i><i style="height:17px"></i><i style="height:25px"></i><i style="height:14px"></i></div><div class="progress"></div></div></body></html>`);
  await page.screenshot({path:path.join(out,'promo-small-440x280.png')});
  }
  await page.setViewportSize({width:1400,height:560});
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
   *{box-sizing:border-box}body{margin:0;width:1400px;height:560px;overflow:hidden;background:#193D34;color:#F4F9F5;font-family:Arial,"Microsoft YaHei",sans-serif}
   .brand{position:absolute;left:100px;top:116px;display:flex;align-items:center;gap:25px}.logo{width:92px;height:92px}.logo svg{width:100%;height:100%}h1{margin:0;font-size:76px;letter-spacing:-3px;font-weight:700}
   .description{position:absolute;left:103px;top:246px;margin:0;color:#C2DCCE;font-size:29px;letter-spacing:3px;font-weight:400}
   .controls{position:absolute;left:103px;top:355px;width:357px;height:86px;border:1px solid #629480;border-radius:26px;background:#244E42;display:flex;align-items:center;gap:25px;padding:0 28px}
   .play{width:0;height:0;border-top:13px solid transparent;border-bottom:13px solid transparent;border-left:21px solid #D8EAE3}.bars{display:flex;gap:7px;align-items:center;height:40px}.bars i{width:7px;background:#B6D9C9;border-radius:4px}
   .progress{height:7px;background:#426B5D;width:119px;border-radius:5px;overflow:hidden}.progress:after{content:'';display:block;width:84px;height:7px;background:#D8EAE3}
   .illustration{position:absolute;inset:0;width:1400px;height:560px}
  </style></head><body>
   <svg class="illustration" viewBox="0 0 1400 560" fill="none" aria-hidden="true">
    <path d="M460 398H675Q749 398 749 324V44" stroke="#426B5D" stroke-width="2"/>
    <path d="M460 398H975Q1040 398 1040 463V560" stroke="#426B5D" stroke-width="2"/>
    <path d="M460 398H769Q839 398 839 328V225Q839 170 894 170H1086" stroke="#98C4AF" stroke-width="4"/>
    <circle cx="588" cy="398" r="8" fill="#D8EAE3"/><circle cx="749" cy="89" r="6" fill="#628A76"/>
    <circle cx="1037" cy="442" r="6" fill="#628A76"/>
    <rect x="969" y="85" width="281" height="190" rx="30" fill="#244E42" stroke="#689782" stroke-width="2"/>
    <rect x="987" y="103" width="245" height="153" rx="19" fill="#315C4C"/>
    <path d="M1084 142L1084 216L1140 179Z" fill="#D8EAE3"/>
    <path d="M996 324H1218Q1284 324 1284 390V486" stroke="#426B5D" stroke-width="2"/>
    <circle cx="1181" cy="324" r="6" fill="#628A76"/>
    <rect x="886" y="310" width="196" height="99" rx="28" fill="#D8EAE3"/>
    <rect x="916" y="348" width="9" height="24" rx="4.5" fill="#345F4C"/>
    <rect x="934" y="340" width="9" height="40" rx="4.5" fill="#345F4C"/>
    <rect x="952" y="330" width="9" height="60" rx="4.5" fill="#345F4C"/>
    <rect x="970" y="340" width="9" height="40" rx="4.5" fill="#345F4C"/>
    <path d="M1004 359H1050" stroke="#345F4C" stroke-width="7" stroke-linecap="round"/>
    <circle cx="1284" cy="486" r="8" fill="#8EB7A4"/>
   </svg>
   <div class="brand"><div class="logo">${logo}</div><h1>BiliSmooth</h1></div>
   <p class="description">B 站播放助手</p>
   <div class="controls"><span class="play"></span><div class="bars"><i style="height:14px"></i><i style="height:27px"></i><i style="height:40px"></i><i style="height:22px"></i></div><div class="progress"></div></div>
  </body></html>`);
  await page.screenshot({path:path.join(out,'promo-marquee-1400x560.png'),omitBackground:false});
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
