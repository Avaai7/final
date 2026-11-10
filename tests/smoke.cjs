// Run with Node.js and Playwright installed: node tests/smoke.cjs
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.MEDIAFIT_BROWSER||'msedge'});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('file:///'+path.resolve(__dirname,'../index.html').replaceAll('\\','/'));
 await page.waitForFunction(()=>window.MediaFit);
 const idle=()=>page.evaluate(()=>MediaFit.whenIdle());
 await idle();
 let results=await page.evaluate(()=>MediaFit.results());
 assert.equal(results.length,3);assert(results.every(r=>!r.error));
 assert(results.every(r=>r.variants.length>=2));
 assert(results.every(r=>Math.max(r.outW,r.outH)<=1920));
 assert(results.every(r=>Number.isFinite(r.ssim)));
 console.log('PASS demo encodes; format candidates; SSIM; default dimensions');
 await page.locator('.format-lab summary').first().click();
 await page.locator('.card-actions button').filter({hasText:'Compare'}).first().click();
 await page.waitForFunction(()=>document.querySelector('#compare').open);
 await page.locator('#compare-slider').fill('25');
 assert.equal(await page.locator('#compare-position').textContent(),'25%');
 await page.locator('#cmp-zoom').click();
 assert.equal(await page.locator('#cmp-zoom').getAttribute('aria-pressed'),'true');
 await page.screenshot({path:path.resolve(__dirname,'../comparison-preview.png')});
 await page.locator('#cmp-close').click();
 console.log('PASS comparison slider, actual-size mode and dialog');
 await page.locator('#settings details summary').click();
 await page.locator('#limit').fill('0');await page.locator('#limit').dispatchEvent('change');await page.waitForTimeout(450);await idle();
 await page.locator('.type-control select').first().selectOption('graphic');await idle();
 results=await page.evaluate(()=>MediaFit.results());assert.equal(results[0].kind,'graphic');
 assert.equal(results[0].outType,'image/png');
 console.log('PASS manual graphic override uses lossless PNG');
 await page.locator('#max-side').fill('800');await page.locator('#max-side').dispatchEvent('change');
 await page.waitForTimeout(450);await idle();
 results=await page.evaluate(()=>MediaFit.results());assert(results.every(r=>Math.max(r.outW,r.outH)<=800));
 console.log('PASS stricter dimension limit');
 const download=page.waitForEvent('download');await page.locator('#export-report').click();const csv=await download;assert.equal(csv.suggestedFilename(),'mediafit-report.csv');
 const zipDownload=page.waitForEvent('download');await page.locator('#download-all').click();const zip=await zipDownload;await zip.saveAs(path.resolve(__dirname,'test-output.zip'));
 console.log('PASS CSV and ZIP downloads');
 // Small, already compressed image with an over-limit long side must be resized.
 await page.evaluate(async()=>{
  MediaFit.clear();const c=document.createElement('canvas');c.width=3000;c.height=20;const x=c.getContext('2d');x.fillStyle='red';x.fillRect(0,0,c.width,c.height);
  const blob=await new Promise(r=>c.toBlob(r,'image/png'));MediaFit.addFiles([new File([blob],'wide.png',{type:'image/png'})]);
 });await idle();results=await page.evaluate(()=>MediaFit.results());assert.equal(results[0].outW,800);assert.equal(results[0].keptOriginal,false);
 console.log('PASS original retention respects dimensions');
 // Adding keeps existing files; GIF and broken input give explicit errors.
 await page.evaluate(()=>MediaFit.addFiles([
  new File([Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='),c=>c.charCodeAt(0))],'animated.gif',{type:'image/gif'}),
  new File(['broken'],'broken.png',{type:'image/png'})
 ]));await idle();results=await page.evaluate(()=>MediaFit.results());assert.equal(results.length,3);assert.match(results[1].error,/GIF is not converted/);assert.match(results[2].error,/Cannot decode/);
 await page.locator('.remove-file').last().click();await idle();assert.equal((await page.evaluate(()=>MediaFit.results())).length,2);
 console.log('PASS append, remove, GIF guard and corrupt-file handling');
 // A transparent graphic must stay pixel-identical when no resize is needed.
 await page.evaluate(async()=>{
  MediaFit.clear();const c=document.createElement('canvas');c.width=c.height=32;
  const x=c.getContext('2d');x.fillStyle='rgba(20,80,200,0.5)';x.fillRect(0,0,16,32);
  const blob=await new Promise(r=>c.toBlob(r,'image/png'));MediaFit.addFiles([new File([blob],'alpha.png',{type:'image/png'})]);
 });await idle();
 const alpha=await page.evaluate(async()=>{
  const it=MediaFit.items[0],r=it.result;const a=await createImageBitmap(it.file),b=await createImageBitmap(r.blob);
  const pixels=img=>{const c=document.createElement('canvas');c.width=c.height=32;const x=c.getContext('2d');x.drawImage(img,0,0);return [...x.getImageData(0,0,32,32).data];};
  const same=JSON.stringify(pixels(a))===JSON.stringify(pixels(b));a.close();b.close();return {same,alpha:r.alpha,type:r.outType};
 });assert(alpha.same&&alpha.alpha&&alpha.type==='image/png');
 await page.locator('#limit').fill('1');await page.locator('#limit').dispatchEvent('change');await page.waitForTimeout(450);await idle();
 results=await page.evaluate(()=>MediaFit.results());assert(results.every(r=>r.outSize<=1000 || !r.reached));
 console.log('PASS transparency pixel equality and budget status');
 await page.locator('#goal-web').check();await page.locator('#goal-upload').check();await page.waitForTimeout(450);await idle();
 await page.locator('#examples').click();await idle();
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:path.resolve(__dirname,'../mobile-preview.png'),fullPage:true});
 await page.locator('#tab-guide').click();assert(await page.locator('#panel-guide').isVisible());
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('#tab-shrink').click();
 await page.setViewportSize({width:1440,height:1000});
 await page.screenshot({path:path.resolve(__dirname,'../desktop-preview.png'),fullPage:true});
 console.log('PASS mobile layout and guide navigation');
 await page.locator('#examples').click();await page.locator('#cancel').click();await idle();assert.equal(await page.evaluate(()=>MediaFit.running),false);
 await page.locator('#clear-all').click();await idle();assert.equal((await page.evaluate(()=>MediaFit.results())).length,0);assert(await page.locator('#empty-state').isVisible());
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS cancellation, clear, empty state; no browser errors');
 fs.writeFileSync(path.resolve(__dirname,'results.txt'),'Passed in '+(process.env.MEDIAFIT_BROWSER||'msedge')+': demo processing; candidates; SSIM; defaults; slider; zoom; manual override; dimension limits; original retention; CSV; ZIP; append; remove; GIF guard; corrupt file; transparency pixel equality; budget status; mobile layout; guide; cancel; clear; no browser errors.\n');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
