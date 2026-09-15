const fs=require('node:fs/promises'),path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'docs/chrome-web-store/assets');
(async()=>{
 const args=process.argv.slice(2);
 if(args.includes('--help')){
  console.log(`Usage: npm run store:artwork

Regenerates extension PNG icons from src/ui/icon.svg, then creates the store
128 px icon and 440 × 280 promotional image. Requires Playwright Chromium.
Run npm run build afterwards before capturing the extension interface.
This command does not upload or publish anything.`);
  return;
 }
 if(args.length)throw new Error('Unknown argument. Use --help.');
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['scripts/make-icons.cjs'],{cwd:root,shell:false,stdio:'inherit'});
  child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(`Icon generation failed (${code}).`)));
 });
 const {chromium}=require('playwright');
 await fs.mkdir(out,{recursive:true});await fs.copyFile(path.join(root,'src/extension/icons/128.png'),path.join(out,'icon-128.png'));
 const logo=await fs.readFile(path.join(root,'src/ui/icon.svg'),'utf8');
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage({viewport:{width:440,height:280},deviceScaleFactor:1});
  await page.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;background:#193D34;color:#F4F9F5;font-family:Arial,sans-serif;width:440px;height:280px;overflow:hidden}.route{position:absolute;inset:0;width:440px;height:280px}.brand{position:absolute;top:57px;left:36px;display:flex;align-items:center;gap:16px}.logo{width:62px;height:62px}.logo svg{width:100%;height:100%}h1{font-size:35px;letter-spacing:-1.4px;margin:0;font-weight:700}.panel{position:absolute;bottom:47px;left:36px;width:217px;height:55px;border:1px solid #659987;border-radius:18px;background:#244E42;display:flex;align-items:center;gap:15px;padding:0 18px}.play{width:0;height:0;border-top:9px solid transparent;border-bottom:9px solid transparent;border-left:14px solid #D8EAE3}.bars{display:flex;gap:4px;align-items:center;height:25px}.bars i{width:5px;background:#B6D9C9;border-radius:3px}.progress{height:5px;background:#426B5D;width:74px;border-radius:5px;overflow:hidden}.progress:after{content:'';display:block;width:51px;height:5px;background:#D8EAE3}</style></head><body><svg class="route" viewBox="0 0 440 280" fill="none"><path d="M289 195H337C357 195 363 175 363 151V28" stroke="#416B5D" stroke-width="2"/><path d="M289 195H396C417 195 423 207 423 230V282" stroke="#416B5D" stroke-width="2"/><path d="M289 195H440" stroke="#8EB7A4" stroke-width="3"/><circle cx="305" cy="195" r="5" fill="#D8EAE3"/><circle cx="364" cy="79" r="4" fill="#6A9180"/><circle cx="396" cy="195" r="5" fill="#D8EAE3"/></svg><div class="brand"><div class="logo">${logo}</div><h1>BiliSmooth</h1></div><div class="panel"><span class="play"></span><div class="bars"><i style="height:9px"></i><i style="height:17px"></i><i style="height:25px"></i><i style="height:14px"></i></div><div class="progress"></div></div></body></html>`);
  await page.screenshot({path:path.join(out,'promo-small-440x280.png')});
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
