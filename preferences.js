/* Preferences contain no user media. All UI continues to work if storage is disabled. */
(() => {
  const theme=document.querySelector('#theme');
  function apply(value){document.documentElement.dataset.theme=value;theme.value=value;try{localStorage.setItem('mediafit-theme',value);}catch(e){}}
  try{const saved=localStorage.getItem('mediafit-theme');apply(['light','dark','system'].includes(saved)?saved:'system');}catch(e){apply('system');}
  theme.addEventListener('change',()=>apply(theme.value));
  const caps=[['PNG export',true],['WebP export',window.MediaFit.support.webp],['Video export',!!window.MediaFitVideo?.formats.length],['MP4 recording',!!window.MediaFitVideo?.formats.some(f=>f.ext==='mp4')],['Local audio routing',!!(window.AudioContext||window.webkitAudioContext)]];
  const list=document.querySelector('#capability-list');
  for(const [name,ok]of caps){const li=document.createElement('li');const label=document.createElement('span');label.textContent=name;const state=document.createElement('strong');state.textContent=ok?'Available':'Unavailable';state.className=ok?'cap-ok':'cap-no';li.append(label,state);list.append(li);}
})();
