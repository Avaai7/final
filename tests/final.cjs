// Functional final-edition tests. Requires Playwright and installed Edge / Chrome.
const {chromium}=require('playwright');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const channel=process.env.MEDIAFIT_BROWSER||'msedge';
 const browser=await chromium.launch({channel,headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.log('BROWSER ERROR',e.message);});
 await page.goto('file:///'+path.resolve(__dirname,'../index.html').replaceAll('\\','/'));
 await page.waitForFunction(()=>window.MediaFitVideo);await page.evaluate(()=>MediaFit.whenIdle());
 console.log('Formats:',await page.evaluate(()=>MediaFitVideo.formats));
 // Edit only the first file: crop, rotate and fit to specified bounds.
 await page.locator('.card-actions button').filter({hasText:/^Edit$/}).first().click();
 await page.waitForFunction(()=>!document.querySelector('#editor-apply').disabled);
 await page.locator('#edit-crop').selectOption('1');await page.locator('#edit-rotation').selectOption('90');
 await page.locator('#edit-width').fill('320');await page.locator('#edit-height').fill('320');await page.locator('#edit-limit').fill('0');
 await page.locator('#editor-apply').click();await page.evaluate(()=>MediaFit.whenIdle());
 const edited=await page.evaluate(()=>MediaFit.results());assert.equal(edited[0].outW,320);assert.equal(edited[0].outH,320);assert(edited[0].notes.some(n=>n.includes('Rotated')));assert(edited[1].outW!==320);
 assert.equal(await page.locator('.custom-chip').count(),1);console.log('PASS per-file settings, crop, rotation, bounded resize and original isolation');
 await page.locator('.format-lab summary').first().click();const trialPromise=page.waitForEvent('download');await page.locator('.variant-download').first().click();assert((await trialPromise).suggestedFilename().endsWith('.jpg'));console.log('PASS selectable format export');
 await page.locator('#theme').selectOption('dark');assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
 await page.locator('#tab-help').click();assert(await page.locator('#capability-list').isVisible());await page.screenshot({path:path.resolve(__dirname,'../help-preview.png'),fullPage:true});
 await page.locator('#theme').selectOption('light');await page.locator('#tab-video').click();
 await page.locator('#video-demo').click();
 try{await page.waitForFunction(()=>MediaFitVideo.input&&!MediaFitVideo.running,null,{timeout:20000});}catch(e){console.log('Demo failure state:',await page.evaluate(()=>({status:document.querySelector('#video-status').textContent,busy:MediaFitVideo.running,duration:document.querySelector('#video-source').duration,hidden:document.hidden})));throw e;}
 const original=await page.evaluate(()=>({width:MediaFitVideo.input.width,height:MediaFitVideo.input.height,duration:MediaFitVideo.input.duration,size:MediaFitVideo.input.file.size}));
 console.log('Demo:',original);assert.equal(original.width,960);assert(original.duration>3.5&&original.duration<5);
 await page.locator('#video-resolution').selectOption('360');await page.locator('#video-bitrate').fill('0.3');await page.locator('#video-start').fill('0.5');await page.locator('#video-end').fill('3');
 await page.locator('#video-compress').click();await page.waitForFunction(()=>!MediaFitVideo.running&&MediaFitVideo.result,{timeout:25000});
 const result=await page.evaluate(()=>{const {blob,...r}=MediaFitVideo.result;return r;});console.log('WebM result:',result);
 assert.equal(result.width,640);assert.equal(result.height,360);assert(result.duration>=2.3&&result.duration<2.8);assert(result.outputBytes>1000);assert(result.outputBytes<original.size);assert.equal(result.muted,false);
 await page.waitForFunction(()=>document.querySelector('#video-result').readyState>=2);
 const playback=await page.evaluate(()=>({w:document.querySelector('#video-result').videoWidth,duration:document.querySelector('#video-result').duration}));
 assert.equal(playback.w,640);assert(Number.isFinite(playback.duration)&&playback.duration>2);console.log('PASS actual video compression, resize, trim, finite output duration and playable result');
 const rms=await page.evaluate(async()=>{const a=new AudioContext();try{const b=await a.decodeAudioData(await MediaFitVideo.result.blob.arrayBuffer());const d=b.getChannelData(0);return Math.sqrt(d.reduce((s,v)=>s+v*v,0)/d.length);}finally{await a.close();}});
 console.log('Audio RMS:',rms);assert(rms>.005,'Preserved source audio must not be silent');console.log('PASS audio is present and non-silent');
 const downloadPromise=page.waitForEvent('download');await page.locator('#video-download').click();const download=await downloadPromise;await download.saveAs(path.resolve(__dirname,'video-with-audio.webm'));
 const reportPromise=page.waitForEvent('download');await page.locator('#video-report').click();assert.equal((await reportPromise).suggestedFilename(),'mediafit-video-report.json');
 const snapshotPromise=page.waitForEvent('download');await page.locator('#video-snapshot').click();assert.equal((await snapshotPromise).suggestedFilename(),'mediafit-frame.png');console.log('PASS video download, metadata report and frame PNG');
 await page.screenshot({path:path.resolve(__dirname,'../video-preview.png'),fullPage:true});
 // Muted MP4 if supported, otherwise muted WebM.
 const mp4=await page.evaluate(()=>MediaFitVideo.formats.some(f=>f.id==='mp4'));
 if(mp4){
  await page.locator('#video-format').selectOption('mp4');await page.locator('#video-compress').click();await page.waitForFunction(()=>!MediaFitVideo.running&&MediaFitVideo.result,null,{timeout:25000});
  const mp4rms=await page.evaluate(async()=>{window.mp4Source=new File([MediaFitVideo.result.blob],'source.mp4',{type:'video/mp4'});const a=new AudioContext();try{const b=await a.decodeAudioData(await MediaFitVideo.result.blob.arrayBuffer());const d=b.getChannelData(0);return Math.sqrt(d.reduce((s,v)=>s+v*v,0)/d.length);}finally{await a.close();}});assert(mp4rms>.005);console.log('PASS MP4 AAC retains non-silent audio');
 }
 await page.locator('#video-mute').check();await page.locator('#video-compress').click();
 await page.waitForFunction(()=>!MediaFitVideo.running&&MediaFitVideo.result,{timeout:25000});
 const silent=await page.evaluate(()=>{const {blob,...r}=MediaFitVideo.result;return r;});assert(silent.muted);assert(silent.name.endsWith(mp4?'.mp4':'.webm'));
 await page.waitForFunction(()=>document.querySelector('#video-result').readyState>=2);assert.equal(await page.locator('#video-result').evaluate(v=>v.videoWidth),640);
 const mutedAudio=await page.evaluate(async()=>{const a=new AudioContext();try{const b=await a.decodeAudioData(await MediaFitVideo.result.blob.arrayBuffer());return b.numberOfChannels;}catch(e){return 0;}finally{await a.close();}});assert.equal(mutedAudio,0);console.log('PASS mute removes audio track and '+(mp4?'MP4':'WebM')+' plays');
 const muteDownload=page.waitForEvent('download');await page.locator('#video-download').click();await(await muteDownload).saveAs(path.resolve(__dirname,'video-muted.'+(mp4?'mp4':'webm')));
 await page.locator('#video-start').fill('4');await page.locator('#video-end').fill('1');await page.evaluate(()=>MediaFitVideo.compress());assert.match(await page.locator('#video-status').textContent(),/valid trim range/);
 await page.locator('#video-start').fill('0');await page.locator('#video-end').fill('3.8');await page.locator('#video-compress').click();await page.waitForFunction(()=>MediaFitVideo.running);
 await page.locator('#video-cancel').click();await page.waitForFunction(()=>!MediaFitVideo.running);assert.equal(await page.evaluate(()=>MediaFitVideo.result),null);assert.match(await page.locator('#video-status').textContent(),/cancelled/);console.log('PASS invalid trim validation and cancellation with no partial export');
 await page.evaluate(()=>MediaFit.clear());await page.locator('#video-compress').click();await page.waitForFunction(()=>MediaFitVideo.running);
 await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=c.height=32;c.getContext('2d').fillRect(0,0,32,32);const blob=await new Promise(r=>c.toBlob(r,'image/png'));MediaFit.addFiles([new File([blob],'queued.png',{type:'image/png'})]);});
 await page.evaluate(()=>MediaFit.whenIdle());assert.equal(await page.evaluate(()=>MediaFit.results()[0].outW),32);assert.equal(await page.evaluate(()=>MediaFitVideo.running),false);console.log('PASS images queued during video process automatically afterward');
 // Real mobile width, help, expanded lab and large text must not overflow the page.
 await page.setViewportSize({width:390,height:844});
 for(const tab of ['video','help','guide','shrink']){await page.locator('#tab-'+tab).click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile overflow: '+tab);}
 await page.locator('#text-toggle').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#text-toggle').click();
 await page.locator('#tab-video').click();await page.screenshot({path:path.resolve(__dirname,'../video-mobile-preview.png'),fullPage:true});
 await page.locator('#video-clear').click();assert.equal(await page.evaluate(()=>MediaFitVideo.input),null);assert(await page.locator('#video-empty').isVisible());
 await page.evaluate(()=>MediaFitVideo.load(new File(['bad'],'bad.mp4',{type:'video/mp4'})));assert.match(await page.locator('#video-status').textContent(),/cannot play/);console.log('PASS mobile panels, large text, remove and invalid video');
 if(mp4){await page.evaluate(()=>MediaFitVideo.load(window.mp4Source));assert(await page.evaluate(()=>!!MediaFitVideo.input));await page.locator('#video-format').selectOption('webm');assert(await page.locator('#video-settings').evaluate(f=>f.checkValidity()),'Default fractional duration must be valid');await page.locator('#video-compress').click();await page.waitForFunction(()=>!MediaFitVideo.running&&MediaFitVideo.result,null,{timeout:25000});assert((await page.evaluate(()=>MediaFitVideo.result.name)).endsWith('.webm'));console.log('PASS MP4 input transcodes to WebM');}
 await page.locator('#theme').selectOption('dark');await page.reload();await page.waitForFunction(()=>window.MediaFitVideo);assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');assert(await page.locator('#panel-video').isVisible());await page.locator('#theme').selectOption('light');
 assert.equal(errors.length,0,errors.join('\n'));console.log('PASS preferences, URL navigation and no uncaught errors');
 fs.writeFileSync(path.resolve(__dirname,'final-results-'+channel+'.txt'),'PASS: per-file crop/rotation/resize; isolated settings; variant download; theme; help; demo generation; video compression; bitrate/resolution; trim; output duration; audio RMS '+rms+'; WebM playback/download; report; snapshot; mute with no audio track; '+(mp4?'MP4 AAC audio + playback + input transcoding':'WebM playback')+'; invalid range; cancel; image queue during video; mobile panels; large text; clear; corrupt video; persisted theme; URL navigation; no browser errors.\n');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
