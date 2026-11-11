/* Browser-native video studio. No uploads, third-party runtime or microphone access. */
(() => {
  'use strict';
  const $=s=>document.querySelector(s);
  const bytes=n=>n<1e6?(n/1000).toFixed(0)+' KB':(n/1e6).toFixed(2)+' MB';
  const seconds=n=>Number(n).toFixed(1)+' s';
  const status=message=>{$('#video-status').textContent=message;};
  const recorderAvailable=!!(window.MediaRecorder&&HTMLCanvasElement.prototype.captureStream);
  const supported=type=>{try{return recorderAvailable&&MediaRecorder.isTypeSupported(type);}catch(e){return false;}};
  const formats=[];
  const webm=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(supported);
  const mp4=['video/mp4;codecs=avc1.42001E,mp4a.40.2','video/mp4;codecs=avc1.424028,mp4a.40.2'].find(supported);
  if(webm)formats.push({id:'webm',label:webm.includes('vp9')?'WebM · VP9 + Opus':'WebM · VP8 + Opus',mime:webm,ext:'webm'});
  if(mp4)formats.push({id:'mp4',label:'MP4 · H.264 + AAC',mime:mp4,ext:'mp4'});
  for(const f of formats){const o=document.createElement('option');o.value=f.id;o.textContent=f.label;$('#video-format').append(o);}
  if(!formats.length){const o=document.createElement('option');o.textContent='Video encoding unavailable';$('#video-format').append(o);}
  $('#video-support').textContent=formats.length?'Available: '+formats.map(f=>f.ext.toUpperCase()).join(' / '):'Video export is not supported here. Try a recent Chrome or Edge.';
  let input=null,sourceUrl=null,result=null,resultUrl=null,loading=false,busy=false,token=0,abort=null;
  const source=$('#video-source'),output=$('#video-result');
  const fields=['video-preset','video-format','video-resolution','video-bitrate','video-fps','video-mute'];
  function settings(){
    const end=$('#video-end').value.trim();
    return {format:$('#video-format').value,resolution:Number($('#video-resolution').value),bitrate:Number($('#video-bitrate').value),fps:Number($('#video-fps').value),mute:$('#video-mute').checked,start:Number($('#video-start').value),end:end===''?input?.duration:Number(end)};
  }
  function bounds(s){
    let scale=1;const w=input.width,h=input.height;
    if(s.resolution){const short=s.resolution,long=Math.round(short*16/9);scale=Math.min(1,(w>=h?long:short)/w,(w>=h?short:long)/h);}
    return {width:Math.max(2,Math.floor(w*scale/2)*2),height:Math.max(2,Math.floor(h*scale/2)*2)};
  }
  function validate(s){
    if(!input)throw new Error('Choose a video first.');
    if(!formats.some(f=>f.id===s.format))throw new Error('Choose a supported output format.');
    if(!Number.isFinite(s.bitrate)||s.bitrate<0.15||s.bitrate>20)throw new Error('Video bitrate must be between 0.15 and 20 Mbps.');
    if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end>input.duration+0.05||s.end<=s.start||s.start>=input.duration)throw new Error('Choose a valid trim range within the video duration.');
    if(s.end-s.start<0.25)throw new Error('Select at least 0.25 seconds of video.');
  }
  function estimate(){
    const f=formats.find(f=>f.id===$('#video-format').value);
    $('#video-codec-note').textContent=f?f.label+'. Availability is checked in this browser.':'No supported encoder.';
    if(!input){$('#video-estimate').textContent='Choose a clip';return;}
    try{
      const s=settings();validate(s);const dimensions=bounds(s);
      const size=((s.bitrate*1e6+(s.mute?0:128000))*(s.end-s.start)/8)*1.03;
      $('#video-estimate').textContent='≈ '+bytes(size);
      $('#video-estimate-detail').textContent=dimensions.width+'×'+dimensions.height+' px · '+seconds(s.end-s.start)+' · actual size may differ';
    }catch(e){$('#video-estimate').textContent='Check settings';$('#video-estimate-detail').textContent=e.message;}
  }
  function setBusy(value){
    const finished=busy&&!value;
    busy=value;
    $('#video-settings').querySelectorAll('input,select').forEach(el=>el.disabled=value);
    $('#video-compress').disabled=value||loading||!input||!formats.length;
    $('#video-cancel').hidden=!value;
    for(const id of ['video-file','video-demo','video-clear'])$('#'+id).disabled=value||(id==='video-clear'&&!input)||(id==='video-demo'&&!formats.length);
    source.controls=!value;
    if(finished)queueMicrotask(()=>window.dispatchEvent(new Event('mediafit-video-idle')));
  }
  function metadata(container,values){
    const dl=$(container);dl.replaceChildren();
    for(const [key,value]of values){const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;div.append(dt,dd);dl.append(div);}
  }
  function dropResult(){output.pause();output.removeAttribute('src');output.load();if(resultUrl)URL.revokeObjectURL(resultUrl);resultUrl=null;result=null;$('#video-result-card').hidden=true;}
  function clear(){
    if(busy)return;token++;source.pause();source.removeAttribute('src');source.load();if(sourceUrl)URL.revokeObjectURL(sourceUrl);
    sourceUrl=null;input=null;loading=false;dropResult();$('#video-empty').hidden=false;$('#video-source-card').hidden=true;$('#video-progress-box').hidden=true;$('#video-start').value=0;$('#video-end').value='';estimate();setBusy(false);status('Video removed. Choose another clip or try the demo.');
  }
  function mediaEvent(video,event,timeout=20000){
    return new Promise((resolve,reject)=>{
      const finish=(error)=>{clearTimeout(timer);video.removeEventListener(event,ok);video.removeEventListener('error',bad);error?reject(error):resolve();};
      const ok=()=>finish(),bad=()=>finish(new Error('This browser cannot play this video. Try MP4 with H.264 or WebM.'));
      const timer=setTimeout(()=>finish(new Error('Video loading timed out. Try a smaller, supported clip.')),timeout);
      video.addEventListener(event,ok,{once:true});video.addEventListener('error',bad,{once:true});
    });
  }
  async function load(file){
    if(busy)return;
    if(file.size>150e6){status('The input limit is 150 MB. Choose a smaller video.');return;}
    if(!file.type.startsWith('video/')&&!/\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name)){status('Choose a browser-playable video file.');return;}
    clear();const version=++token;loading=true;$('#video-compress').disabled=true;status('Reading video metadata…');
    sourceUrl=URL.createObjectURL(file);const url=sourceUrl;
    try{
      const ready=mediaEvent(source,'loadedmetadata');source.src=url;source.load();await ready;
      if(version!==token)return;
      if(!Number.isFinite(source.duration)||source.duration<=0)throw new Error('This clip has no readable finite duration. Export it with duration metadata first.');
      if(source.duration>300.05)throw new Error('This browser workflow is limited to videos up to 5 minutes. Trim the source first.');
      if(!source.videoWidth||source.videoWidth*source.videoHeight>3840*2160)throw new Error('Input resolution is unsupported or exceeds the 4K pixel limit.');
      input={file,width:source.videoWidth,height:source.videoHeight,duration:source.duration};
      $('#video-source-name').textContent=file.name;
      metadata('#video-metadata',[['Size',bytes(file.size)],['Duration',seconds(input.duration)],['Resolution',input.width+'×'+input.height],['Container',file.type.split(';')[0].replace('video/','').toUpperCase()||'Video']]);
      $('#video-empty').hidden=true;$('#video-source-card').hidden=false;$('#video-start').max=input.duration;$('#video-end').max=input.duration;
      $('#video-end').value=Math.floor(input.duration*1000)/1000;
      status('Ready. Adjust your settings, then compress. Original audio is routed locally; no microphone permission is needed.');
    }catch(e){if(version===token){input=null;$('#video-source-card').hidden=true;$('#video-empty').hidden=false;status(e.message);}}
    finally{if(version===token){loading=false;setBusy(false);estimate();}}
  }

  // MediaRecorder WebM often lacks Duration. Add it to Segment/Info without
  // transcoding. Streaming outputs have no seek indexes whose offsets move.
  async function webmDuration(blob,milliseconds){
    const data=new Uint8Array(await blob.arrayBuffer());
    function vint(at,isId=false){
      const first=data[at];if(!first)throw new Error('Invalid EBML');let n=1;while(n<=8&&!(first&(1<<(8-n))))n++;
      let value=isId?first:first&((1<<(8-n))-1);let unknown=!isId&&value===((1<<(8-n))-1);
      for(let i=1;i<n;i++){value=value*256+data[at+i];unknown=unknown&&data[at+i]===255;}
      return {n,value,unknown};
    }
    function element(at){const id=vint(at,true),size=vint(at+id.n);return {id:id.value,start:at,head:id.n+size.n,data:at+id.n+size.n,size:size.unknown?data.length-at-id.n-size.n:size.value,unknown:size.unknown,idBytes:id.n,sizeBytes:size.n};}
    function sizeBytes(value,n){const b=new Uint8Array(n);for(let i=n-1;i>=0;i--){b[i]=value%256;value=Math.floor(value/256);}if(value)throw new Error('EBML size overflow');b[0]|=1<<(8-n);return b;}
    try{
      let segment,at=0;while(at<data.length){const e=element(at);if(e.id===0x18538067){segment=e;break;}at=e.data+e.size;}
      if(!segment)return blob;let info;at=segment.data;
      while(at<data.length){const e=element(at);if(e.id===0x114d9b74||e.id===0x1c53bb6b)return blob;if(e.id===0x1549a966){info=e;break;}at=e.data+e.size;}
      if(!info)return blob;
      const parts=[];let scale=1e6;at=info.data;
      while(at<info.data+info.size){const e=element(at);if(e.id===0x2ad7b1){scale=0;for(let i=e.data;i<e.data+e.size;i++)scale=scale*256+data[i];}if(e.id!==0x4489&&e.id!==0xbf)parts.push(data.slice(e.start,e.data+e.size));at=e.data+e.size;}
      const duration=new Uint8Array(11);duration.set([0x44,0x89,0x88]);new DataView(duration.buffer).setFloat64(3,milliseconds*1e6/scale,false);parts.push(duration);
      const payloadLength=parts.reduce((sum,p)=>sum+p.length,0);let n=info.sizeBytes;while(payloadLength>=2**(7*n)-1)n++;
      const infoHead=[data.slice(info.start,info.start+info.idBytes),sizeBytes(payloadLength,n)];
      const newInfo=new Blob([...infoHead,...parts]);const delta=newInfo.size-(info.head+info.size);
      const segmentHead=segment.unknown?data.slice(segment.start,segment.data):new Uint8Array([...data.slice(segment.start,segment.start+segment.idBytes),...sizeBytes(segment.size+delta,segment.sizeBytes)]);
      return new Blob([data.slice(0,segment.start),segmentHead,data.slice(segment.data,info.start),newInfo,data.slice(info.data+info.size)],{type:blob.type});
    }catch(e){return blob;}
  }

  async function compress(){
    if(busy)return;
    let s;
    try{if(window.MediaFit.running)throw new Error('Wait for image processing to finish, then start the video.');s=settings();validate(s);}catch(e){status(e.message);return;}
    const chosen=formats.find(f=>f.id===s.format),dims=bounds(s),selectedDuration=s.end-s.start;
    source.pause();output.pause();dropResult();setBusy(true);$('#video-progress-box').hidden=false;$('#video-phase').textContent='Preparing encoder';$('#video-progress').value=0;$('#video-percent').textContent='0%';status('Preparing a local export…');
    const engine=document.createElement('video');engine.className='video-engine';engine.muted=true;engine.playsInline=true;engine.preload='auto';document.body.append(engine);
    const canvas=document.createElement('canvas');canvas.width=dims.width;canvas.height=dims.height;const ctx=canvas.getContext('2d',{alpha:false});
    let stream,audioContext,audioSource,recorder,frameTimer,updateTimer,watchdog,wakeLock,recorderDone,cancelled=false,timedOut=false,lastFrame=-1,started=0,pausedAt=0,pauseTotal=0;
    const resources=[];
    const stop=()=>{engine.pause();if(recorder&&recorder.state!=='inactive')recorder.stop();};
    abort=()=>{cancelled=true;stop();};
    const onVisibility=()=>{
      if(!recorder||recorder.state==='inactive')return;
      if(document.hidden&&recorder.state==='recording'){engine.pause();recorder.pause();pausedAt=performance.now();$('#video-phase').textContent='Paused — return to this tab';}
      else if(!document.hidden&&recorder.state==='paused'){pauseTotal+=performance.now()-pausedAt;pausedAt=0;recorder.resume();engine.play().catch(()=>abort());$('#video-phase').textContent='Encoding on your device';}
    };
    try{
      const ready=mediaEvent(engine,'loadeddata');engine.src=sourceUrl;engine.load();await ready;if(cancelled)throw new DOMException('Cancelled','AbortError');
      if(s.start>0){const sought=mediaEvent(engine,'seeked');engine.currentTime=s.start;await sought;}
      ctx.drawImage(engine,0,0,dims.width,dims.height);stream=canvas.captureStream(s.fps);resources.push(...stream.getTracks());
      if(!s.mute){
        const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw new Error('Audio routing is unavailable. Select Remove audio or try another browser.');
        audioContext=new Audio();await audioContext.resume();audioSource=audioContext.createMediaElementSource(engine);const destination=audioContext.createMediaStreamDestination();audioSource.connect(destination);
        // After routing into Web Audio, unmute the element so the graph receives
        // audio samples. The graph connects only to the export, never speakers.
        engine.muted=false;
        for(const track of destination.stream.getAudioTracks()){stream.addTrack(track);resources.push(track);}
      }
      const mime=s.mute?chosen.mime.replace(',opus','').replace(',mp4a.40.2',''):chosen.mime;
      if(!supported(mime))throw new Error('The selected codec combination is unavailable. Choose another format.');
      recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:Math.round(s.bitrate*1e6),audioBitsPerSecond:128000});
      const chunks=[];
      recorderDone=new Promise((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=resolve;recorder.onerror=e=>reject(new Error(e.error?.message||'The browser video encoder failed.'));});
      engine.addEventListener('ended',stop,{once:true});engine.addEventListener('error',()=>abort(),{once:true});
      const draw=()=>{
        if(cancelled||engine.ended)return;
        if(engine.currentTime!==lastFrame){ctx.drawImage(engine,0,0,dims.width,dims.height);stream.getVideoTracks()[0]?.requestFrame?.();lastFrame=engine.currentTime;}
        if(engine.currentTime>=s.end-0.015)stop();
      };
      recorder.start(500);started=performance.now();
      document.addEventListener('visibilitychange',onVisibility);
      try{wakeLock=await navigator.wakeLock?.request('screen');}catch(e){}
      if(cancelled){stop();await recorderDone;throw new DOMException('Cancelled','AbortError');}
      await engine.play();if(document.hidden)onVisibility();frameTimer=setInterval(draw,Math.max(10,1000/s.fps));
      $('#video-phase').textContent='Encoding on your device';
      updateTimer=setInterval(()=>{
        const done=Math.max(0,Math.min(selectedDuration,engine.currentTime-s.start));const percent=Math.min(99,Math.round(done/selectedDuration*100));
        $('#video-progress').value=percent;$('#video-percent').textContent=percent+'%';
        $('#video-elapsed').textContent=seconds(done)+' / '+seconds(selectedDuration)+' of source · '+dims.width+'×'+dims.height+' px';
      },100);
      watchdog=setInterval(()=>{const active=(performance.now()-started-pauseTotal-(pausedAt?performance.now()-pausedAt:0))/1000;if(active>selectedDuration*2+30){cancelled=true;timedOut=true;stop();}},1000);
      await recorderDone;
      if(cancelled)throw new DOMException('Cancelled','AbortError');
      const encodedDuration=Math.min(selectedDuration,Math.max(.001,engine.currentTime-s.start));
      let blob=new Blob(chunks,{type:recorder.mimeType||mime});if(!blob.size)throw new Error('The browser produced an empty video. Try another format.');
      if(chosen.ext==='webm')blob=await webmDuration(blob,encodedDuration*1000);
      result={blob,name:input.file.name.replace(/\.[^.]+$/,'')+'-mediafit.'+chosen.ext,width:dims.width,height:dims.height,duration:encodedDuration,sourceDuration:input.duration,sourceBytes:input.file.size,outputBytes:blob.size,format:chosen.label,mime:blob.type,requestedBitrate:s.bitrate,trimStart:s.start,trimEnd:s.end,muted:s.mute,fpsCap:s.fps,elapsedMs:performance.now()-started-pauseTotal};
      resultUrl=URL.createObjectURL(blob);output.src=resultUrl;output.load();
      $('#video-result-card').hidden=false;$('#video-progress').value=100;$('#video-percent').textContent='100%';$('#video-phase').textContent='Export complete';
      metadata('#video-result-metadata',[['File size',bytes(blob.size)],['Duration',seconds(encodedDuration)],['Resolution',dims.width+'×'+dims.height],['Container',chosen.ext.toUpperCase()]]);
      const saved=Math.round((1-blob.size/input.file.size)*100);
      $('#video-verdict').className='notice'+(saved>0?' success':'');
      $('#video-verdict').textContent=saved>0?'Export is '+saved+'% smaller than the full original file.'+(s.start>0||s.end<input.duration-.05?' The trim also contributes to this reduction.':''):'Export is '+Math.abs(saved)+'% larger or similar in size. Keep the original, or try a lower bitrate / resolution.';
      status('Export ready. Preview the result and download it. '+(s.mute?'Audio was removed.':'Audio was included; a silent source remains silent.'));
    }catch(e){if(timedOut){status('Processing timed out. Try a shorter clip or lower resolution.');$('#video-phase').textContent='Timed out';}else if(e.name==='AbortError'){status('Processing cancelled. No partial export was saved.');$('#video-phase').textContent='Cancelled';}else{status(e.message);$('#video-phase').textContent='Export failed';}}
    finally{
      clearInterval(frameTimer);clearInterval(updateTimer);clearInterval(watchdog);document.removeEventListener('visibilitychange',onVisibility);stop();
      if(recorderDone)await recorderDone.catch(()=>{});
      resources.forEach(t=>t.stop());stream?.getTracks().forEach(t=>t.stop());audioSource?.disconnect();await audioContext?.close().catch(()=>{});await wakeLock?.release().catch(()=>{});
      engine.removeAttribute('src');engine.load();engine.remove();canvas.width=canvas.height=0;abort=null;setBusy(false);
    }
  }
  // Generate a short local demo rather than downloading a remote video.
  async function demo(){
    if(busy||!formats.length)return;
    if(window.MediaFit.running){status('Wait for image processing to finish, then load the demo.');return;}
    setBusy(true);status('Creating a 4-second demo on your device…');
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d');
    let stream,recorder,audio,oscillator,timer,stopped=false,demoCancelled=false;const chunks=[];
    abort=()=>{demoCancelled=true;if(recorder&&recorder.state!=='inactive')recorder.stop();};
    try{
      stream=canvas.captureStream(30);const Audio=window.AudioContext||window.webkitAudioContext;
      if(Audio){audio=new Audio();await audio.resume();oscillator=audio.createOscillator();oscillator.frequency.value=440;const gain=audio.createGain();gain.gain.value=.06;const destination=audio.createMediaStreamDestination();oscillator.connect(gain);gain.connect(destination);stream.addTrack(destination.stream.getAudioTracks()[0]);oscillator.start();}
      const format=formats.find(f=>f.id==='webm')||formats[0];recorder=new MediaRecorder(stream,{mimeType:format.mime,videoBitsPerSecond:8e6});
      const done=new Promise((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=resolve;recorder.onerror=()=>reject(new Error('Could not generate a demo in this browser.'));});
      const start=performance.now();
      const draw=()=>{const t=(performance.now()-start)/1000;ctx.fillStyle='#0e1726';ctx.fillRect(0,0,960,540);
        for(let i=0;i<100;i++){const x=(i*97+t*(30+i%7*12))%1050-45,y=70+(i*53)%450;ctx.fillStyle=i%3?'#19698f':'#f4a261';ctx.globalAlpha=.25+(i%5)*.1;ctx.beginPath();ctx.arc(x,y,8+i%17,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
        ctx.fillStyle='#f2f5f8';ctx.font='bold 68px Segoe UI, sans-serif';ctx.fillText('Small file.',75,220);ctx.fillStyle='#4cc9f0';ctx.fillText('Big possibilities.',75,305);
        ctx.font='24px Segoe UI, sans-serif';ctx.fillStyle='#b6c2d3';ctx.fillText('MediaFit / private video studio',78,365);ctx.fillStyle='#4cc9f0';ctx.fillRect(78,420,Math.min(800,t/4*800),5);stream.getVideoTracks()[0]?.requestFrame?.();
      };
      draw();recorder.start();timer=setInterval(draw,33);const autoStop=setTimeout(()=>{if(recorder.state!=='inactive')recorder.stop();},4000);await done;clearTimeout(autoStop);stopped=true;
      if(demoCancelled){status('Demo generation cancelled.');return;}
      let blob=new Blob(chunks,{type:recorder.mimeType});if(format.ext==='webm')blob=await webmDuration(blob,4000);
      setBusy(false);await load(new File([blob],'mediafit-demo.'+format.ext,{type:blob.type}));
    }catch(e){status(e.message);}
    finally{clearInterval(timer);if(recorder&&!stopped&&recorder.state!=='inactive')recorder.stop();oscillator?.stop();stream?.getTracks().forEach(t=>t.stop());await audio?.close().catch(()=>{});canvas.width=canvas.height=0;abort=null;setBusy(false);}
  }
  $('#video-file').addEventListener('change',e=>{if(e.target.files[0])load(e.target.files[0]);e.target.value='';});
  $('#video-settings').addEventListener('submit',e=>{e.preventDefault();compress();});
  $('#video-settings').addEventListener('input',estimate);
  $('#video-preset').addEventListener('change',()=>{const p={balanced:[720,1.5,30],small:[480,.6,24],quality:[1080,4,30]}[$('#video-preset').value];$('#video-resolution').value=p[0];$('#video-bitrate').value=p[1];$('#video-fps').value=p[2];savePreferences();estimate();});
  $('#video-settings').addEventListener('change',()=>{savePreferences();estimate();});
  function savePreferences(){const data={};for(const id of fields)data[id]=id==='video-mute'?$('#'+id).checked:$('#'+id).value;try{localStorage.setItem('mediafit-video-settings-v1',JSON.stringify(data));}catch(e){}}
  try{const data=JSON.parse(localStorage.getItem('mediafit-video-settings-v1')||'null');if(data)for(const id of fields){if(id==='video-mute')$('#'+id).checked=!!data[id];else if(typeof data[id]==='string'&&(!['video-format','video-resolution','video-fps','video-preset'].includes(id)||[...$('#'+id).options].some(o=>o.value===data[id])))$('#'+id).value=data[id];}}catch(e){}
  $('#video-cancel').addEventListener('click',()=>abort?.());$('#video-clear').addEventListener('click',clear);$('#video-demo').addEventListener('click',demo);
  $('#video-download').addEventListener('click',()=>{if(result)MediaFit.saveFile(result.name,result.blob);});
  $('#video-report').addEventListener('click',()=>{if(result){const {blob,...report}=result;MediaFit.saveFile('mediafit-video-report.json',new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));}});
  $('#video-snapshot').addEventListener('click',()=>{if(!result||output.readyState<2){status('Wait until the result preview has loaded.');return;}const c=document.createElement('canvas');c.width=result.width;c.height=result.height;c.getContext('2d').drawImage(output,0,0);c.toBlob(blob=>{if(blob)MediaFit.saveFile('mediafit-frame.png',blob);c.width=c.height=0;},'image/png');});
  const drop=$('#video-drop');['dragenter','dragover'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('is-over');}));['dragleave','drop'].forEach(type=>drop.addEventListener(type,()=>drop.classList.remove('is-over')));drop.addEventListener('drop',e=>{e.preventDefault();if(e.dataTransfer?.files[0])load(e.dataTransfer.files[0]);});
  window.MediaFitVideo={formats,get running(){return busy;},get input(){return input;},get result(){return result;},load,compress,clear,demo};
  window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
  setBusy(false);estimate();
})();
