const fs=require("node:fs/promises"),path=require("node:path");
const {chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,".."),out=path.join(root,"src/extension/icons");await fs.mkdir(out,{recursive:true});
 const svg=await fs.readFile(path.join(root,"src/ui/icon.svg"),"utf8");
 const browser=await chromium.launch({headless:true});
 try { const page=await browser.newPage();
  for(const size of [16,32,48,128]) {
   const padding=size===128?16:0,artSize=size-padding*2;
   await page.setContent(`<style>body{margin:0}.icon{width:${size}px;height:${size}px;box-sizing:border-box;padding:${padding}px}svg{display:block;width:${artSize}px;height:${artSize}px}</style><div class="icon">${svg}</div>`);
   await page.locator(".icon").screenshot({path:path.join(out,`${size}.png`),omitBackground:true});
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
