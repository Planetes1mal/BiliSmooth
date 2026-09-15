const fs=require("node:fs/promises"),path=require("node:path");
const {chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,".."),out=path.join(root,"src/extension/icons");await fs.mkdir(out,{recursive:true});
 const svg=await fs.readFile(path.join(root,"src/ui/icon.svg"),"utf8");
 const browser=await chromium.launch({headless:true});
 try { const page=await browser.newPage();
  for(const size of [16,32,48,128]) {
   await page.setContent(`<style>body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
   await page.locator("svg").screenshot({path:path.join(out,`${size}.png`),omitBackground:true});
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
