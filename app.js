// JARVIS / RUDRA — Full HUD Edition
// NVIDIA AI · Weather · Radar · Activity Log

const NVIDIA_API_KEY  = "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";
const NVIDIA_MODEL    = "openai/gpt-oss-120b";
const PROXY_URL       = "https://corsproxy.io/?url=https://integrate.api.nvidia.com/v1/chat/completions";

const SYSTEM_PROMPT = `You are Jarvis, also called Rudra — a highly advanced personal AI assistant.
Respond like a real intelligent human assistant — warm, confident, and emotionally aware.
Be concise unless asked for detail. Never sound robotic.
You can help with anything: knowledge, planning, code, advice, motivation.`;

let micActive=false, recognition=null, isSpeaking=false, inputMode='text', chatHistory=[], alarmTimer=null;
const startTime=Date.now();
const DATA_KEY='rudra_data';
let rudraData=loadData();
let voices=[], selectedVoice=null;

function loadVoices() {
  voices=window.speechSynthesis.getVoices();
  const preferred=['Google UK English Male','Microsoft David','Microsoft Mark','Daniel'];
  for(const name of preferred){const v=voices.find(v=>v.name.includes(name));if(v){selectedVoice=v;break;}}
  if(!selectedVoice) selectedVoice=voices.find(v=>v.lang.startsWith('en')&&/male|david|mark|daniel|james/i.test(v.name));
  if(!selectedVoice) selectedVoice=voices.find(v=>v.lang.startsWith('en'));
}
if(window.speechSynthesis){loadVoices();window.speechSynthesis.onvoiceschanged=loadVoices;}

const messagesEl=document.getElementById('messages');
const textInput=document.getElementById('text-input');
const sendBtn=document.getElementById('send-btn');
const micBtn=document.getElementById('mic-btn');
const micLabel=document.getElementById('mic-label');
const micSub=document.getElementById('mic-sub');
const aiIndicEl=document.getElementById('ai-state');

window.addEventListener('load',()=>{
  updateClock(); setInterval(updateClock,1000);
  setInterval(updateSystemBars,2000);
  fetchWeather(); drawRadar(); renderAll();
  setTimeout(jarvisGreet,600);
  updateBattery(); setInterval(updateBattery,30000);
  updateSystemBars();
});
sendBtn.addEventListener('click',handleTextInput);
textInput.addEventListener('keydown',e=>{if(e.key==='Enter')handleTextInput();});
micBtn.addEventListener('click',toggleMic);

function updateClock(){
  const now=new Date();
  const hm=now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false});
  const sec=now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const dateStr=now.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}).toUpperCase();
  document.getElementById('clock-hm').textContent=hm;
  document.getElementById('clock-date').textContent=dateStr;
  document.getElementById('hud-time').textContent=sec;
  document.getElementById('btab-clock').textContent=sec;
  document.getElementById('btab-date-full').textContent=now.toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const up=Math.floor((Date.now()-startTime)/1000);
  const h=String(Math.floor(up/3600)).padStart(2,'0'),m=String(Math.floor((up%3600)/60)).padStart(2,'0'),s=String(up%60).padStart(2,'0');
  document.getElementById('uptime-val').textContent=`${h}:${m}:${s}`;
}

function updateSystemBars(){
  const fps=Math.floor(55+Math.random()*30),ram=Math.floor(40+Math.random()*30),net=Math.floor(30+Math.random()*50),cpu=Math.floor(20+Math.random()*60);
  setBar('fps',fps);setBar('ram',ram);setBar('net',net);
  document.getElementById('cpu-val').textContent=cpu+'%';
}
function setBar(id,val){document.getElementById(`bar-${id}`).style.width=val+'%';document.getElementById(`val-${id}`).textContent=val+'%';}

function updateBattery(){
  if(!navigator.getBattery)return;
  navigator.getBattery().then(b=>{
    const pct=Math.round(b.level*100)+'%',status=b.charging?'CHARGING ⚡':'DISCHARGING';
    document.getElementById('batt-pct').textContent=pct;
    document.getElementById('pwr-status').textContent=b.charging?'CHARGING ⚡':'ON BATTERY';
    document.getElementById('batt-val2').textContent=pct;
    document.getElementById('hud-batt').textContent=pct;
    document.getElementById('btab-batt-val').textContent=pct;
    document.getElementById('btab-batt-status').textContent=status;
    document.getElementById('batt-icon').textContent=b.charging?'⚡':b.level>0.5?'🔋':b.level>0.2?'🪴':'🔴';
  });
}

async function fetchWeather(){
  try{
    const pos=await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{timeout:5000}));
    const{latitude:lat,longitude:lon}=pos.coords;
    const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=relativehumidity_2m,windspeed_10m`);
    const d=await r.json();const w=d.current_weather;
    const codeMap={0:'CLEAR SKY',1:'MAINLY CLEAR',2:'PARTLY CLOUDY',3:'OVERCAST',45:'FOGGY',48:'FOGGY',51:'DRIZZLE',61:'RAIN',71:'SNOW',80:'SHOWERS',95:'THUNDERSTORM'};
    const desc=codeMap[w.weathercode]||'CLEAR';
    const hum=d.hourly?.relativehumidity_2m?.[0]??'--';const wind=d.hourly?.windspeed_10m?.[0]??'--';
    document.getElementById('weather-temp').textContent=Math.round(w.temperature)+'°C';
    document.getElementById('weather-desc').textContent=desc;
    document.getElementById('w-hum').textContent=hum+'%';
    document.getElementById('w-wind').textContent=wind+' km/h';
    const gr=await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
    const gd=await gr.json();
    const city=gd.address?.city||gd.address?.town||gd.address?.village||'UNKNOWN';
    document.getElementById('w-loc').textContent=city.toUpperCase();
    logActivity(`WEATHER: ${Math.round(w.temperature)}°C ${desc}`);
  }catch{document.getElementById('weather-desc').textContent='UNAVAILABLE';document.getElementById('w-loc').textContent='LOCATION DENIED';}
}

function drawRadar(){
  const canvas=document.getElementById('radar-canvas');if(!canvas)return;
  const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height,cx=W/2,cy=H/2,r=W/2-4;
  let angle=0;
  const blips=Array.from({length:5},()=>({x:cx+(Math.random()*2-1)*r*0.8,y:cy+(Math.random()*2-1)*r*0.8,life:Math.random()}));
  function draw(){
    ctx.fillStyle='#020609';ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='#0d2535';
    for(let i=1;i<=3;i++){ctx.beginPath();ctx.arc(cx,cy,r*i/3,0,Math.PI*2);ctx.stroke();}
    ctx.beginPath();ctx.moveTo(cx,cy-r);ctx.lineTo(cx,cy+r);ctx.stroke();
    ctx.beginPath();ctx.moveTo(cx-r,cy);ctx.lineTo(cx+r,cy);ctx.stroke();
    ctx.save();ctx.translate(cx,cy);ctx.rotate(angle);
    const sweep=ctx.createLinearGradient(0,0,r,0);sweep.addColorStop(0,'#00cfff00');sweep.addColorStop(1,'#00cfff44');
    ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,r,-0.4,0);ctx.closePath();ctx.fillStyle=sweep;ctx.fill();
    ctx.restore();
    ctx.save();ctx.translate(cx,cy);ctx.rotate(angle);ctx.strokeStyle='#00cfff88';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(r,0);ctx.stroke();ctx.restore();
    blips.forEach(b=>{b.life-=0.005;if(b.life<=0){b.x=cx+(Math.random()*2-1)*r*0.8;b.y=cy+(Math.random()*2-1)*r*0.8;b.life=0.8+Math.random()*0.2;}ctx.beginPath();ctx.arc(b.x,b.y,2,0,Math.PI*2);ctx.fillStyle=`rgba(0,207,255,${b.life})`;ctx.fill();});
    angle+=0.03;requestAnimationFrame(draw);
  }draw();
}

function logActivity(msg){
  const el=document.getElementById('activity-log');if(!el)return;
  const now=new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const div=document.createElement('div');div.className='log-entry';
  div.innerHTML=`<span>${now}</span> ${msg}`;el.insertBefore(div,el.firstChild);
  if(el.children.length>30)el.lastChild.remove();
}

function jarvisGreet(){
  const hour=new Date().getHours();
  const greet=hour<12?"Good morning":hour<17?"Good afternoon":"Good evening";
  const msg=`${greet}, sir. Jarvis and Rudra are online. I stop talking the moment you speak.`;
  addMessage(msg,'jarvis');speak(msg);logActivity('BOOT: Systems online');logActivity('AI: NVIDIA online');
}

function handleTextInput(){const val=textInput.value.trim();if(!val)return;inputMode='text';addMessage(val,'user');textInput.value='';routeCommand(val);}

function routeCommand(cmd){
  const c=cmd.toLowerCase().trim();
  logActivity(`CMD: ${cmd.slice(0,30)}`);

  if(/\brudra\b/i.test(c)){openRudra();const dayMatch=c.match(/plan\s+my\s+(\w+)/i);if(dayMatch){setTimeout(()=>{switchTab('schedule');const sel=document.getElementById('schedule-day');if(sel)sel.value=capitalize(dayMatch[1]);generateSchedule();},400);return jarvisRespond(`Opening Rudra and generating your ${capitalize(dayMatch[1])} schedule now.`);}return jarvisRespond("Rudra panel is open. Manage your schedule, goals, and progress.");}
  if(/plan\s+my\s+(\w+)/i.test(c)){const m=c.match(/plan\s+my\s+(\w+)/i);openRudra();setTimeout(()=>{switchTab('schedule');const sel=document.getElementById('schedule-day');if(sel)sel.value=capitalize(m[1]);generateSchedule();},400);return jarvisRespond(`Generating your ${capitalize(m[1])} plan inside Rudra.`);}
  if(/weekly schedule|full week/i.test(c)){openRudra();setTimeout(()=>{switchTab('schedule');generateWeekly();},400);return jarvisRespond("Full weekly schedule generated.");}

  const siteMap={youtube:'https://www.youtube.com',google:'https://www.google.com',github:'https://www.github.com',instagram:'https://www.instagram.com',twitter:'https://www.twitter.com',facebook:'https://www.facebook.com',netflix:'https://www.netflix.com',spotify:'https://www.spotify.com',gmail:'https://mail.google.com',maps:'https://maps.google.com',wikipedia:'https://www.wikipedia.org'};
  for(const[key,url]of Object.entries(siteMap)){if(c.includes(key)){openSite(url,key.toUpperCase());return;}}
  const siteMatch=c.match(/^open\s+(https?:\/\/\S+|www\.\S+|\S+\.\S+)/);
  if(siteMatch){const raw=siteMatch[1];openSite(raw.startsWith('http')?raw:'https://'+raw,raw);return;}

  const songMatch=c.match(/^play\s+(.+)/i);
  if(songMatch){openSite(`https://www.youtube.com/results?search_query=${encodeURIComponent(songMatch[1])}`,'YouTube: '+songMatch[1]);return jarvisRespond(`Searching YouTube for "${songMatch[1]}", sir.`);}

  if(/what.*time|current time|time now/i.test(c)){return jarvisRespond(`The current time is ${new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}, sir.`);}
  if(/what.*date|today.*date|current date/i.test(c)){return jarvisRespond(`Today is ${new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}.`);}
  if(/weather/i.test(c)){const temp=document.getElementById('weather-temp').textContent,desc=document.getElementById('weather-desc').textContent,loc=document.getElementById('w-loc').textContent;return jarvisRespond(`Current weather in ${loc}: ${temp}, ${desc}.`);}
  if(/battery/i.test(c)){if(navigator.getBattery){navigator.getBattery().then(b=>jarvisRespond(`Battery is at ${Math.round(b.level*100)}%, currently ${b.charging?'charging':'discharging'}, sir.`));}else jarvisRespond("Battery info isn't accessible from this browser, sir.");return;}
  if(/stop listening|stop mic|turn off mic/i.test(c)){stopMic();return jarvisRespond("Microphone deactivated, sir.");}
  if(/clear chat|clear history|reset chat/i.test(c)){messagesEl.innerHTML='';chatHistory=[];return jarvisRespond("Chat cleared. Ready for new commands.");}
  if(/^(hello|hi|hey|namaste|sup)$/i.test(c)){return jarvisRespond("Hello sir. All systems are operational. How may I assist you?");}
  if(/who are you|your name|what are you/i.test(c)){return jarvisRespond("I am Jarvis, also known as Rudra — your personal AI assistant, fully operational.");}

  askNvidiaAI(cmd);
}

function openSite(url,label){
  const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  jarvisRespond(`Opening ${label} for you, sir.`);logActivity(`OPEN: ${label}`);
}

async function askNvidiaAI(userMessage){
  chatHistory.push({role:"user",content:userMessage});
  if(chatHistory.length>20)chatHistory=chatHistory.slice(-20);
  const thinkEl=showThinking();
  if(aiIndicEl){aiIndicEl.textContent='THINKING';aiIndicEl.style.color='#00cfff';}
  const msgDiv=document.createElement('div');msgDiv.className='msg jarvis streaming';
  messagesEl.appendChild(msgDiv);messagesEl.parentElement.scrollTop=messagesEl.parentElement.scrollHeight;
  let fullText='';
  try{
    const body=JSON.stringify({model:NVIDIA_MODEL,messages:[{role:"system",content:buildSystemPrompt()},...chatHistory],temperature:0.85,top_p:1,max_tokens:1024,stream:true});
    const headers={'Content-Type':'application/json','Authorization':`Bearer ${NVIDIA_API_KEY}`};
    let response;
    try{response=await fetch('https://integrate.api.nvidia.com/v1/chat/completions',{method:'POST',headers,body});}catch{response=await fetch(PROXY_URL,{method:'POST',headers,body});}
    if(!response.ok)throw new Error(`API ${response.status}`);
    removeThinking(thinkEl);
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let buffer='';
    while(true){
      const{done,value}=await reader.read();if(done)break;
      buffer+=decoder.decode(value,{stream:true});
      const lines=buffer.split('\n');buffer=lines.pop();
      for(const line of lines){
        const t=line.trim();if(!t||t==='data: [DONE]'||!t.startsWith('data: '))continue;
        try{const json=JSON.parse(t.slice(6));const delta=json.choices?.[0]?.delta;if(!delta)continue;if(delta.reasoning_content)showReasoning(msgDiv,delta.reasoning_content);if(delta.content){fullText+=delta.content;streamText(msgDiv,fullText);messagesEl.parentElement.scrollTop=messagesEl.parentElement.scrollHeight;}}catch{}
      }
    }
    msgDiv.classList.remove('streaming');msgDiv.innerHTML=fmtResponse(fullText);
    chatHistory.push({role:"assistant",content:fullText});
    logActivity(`AI: Reply ${fullText.length}ch`);
    speak(fullText.replace(/<[^>]*>/g,'').replace(/[#*`]/g,'').slice(0,500));
  }catch(err){
    removeThinking(thinkEl);
    const errMsg="I'm having trouble reaching the AI right now, sir. Please check your connection.";
    msgDiv.textContent=errMsg;msgDiv.classList.remove('streaming');speak(errMsg);
    console.error('AI error:',err);
  }
  if(aiIndicEl){aiIndicEl.textContent='NVIDIA';aiIndicEl.style.color='#00cfff';}
}

function buildSystemPrompt(){let p=SYSTEM_PROMPT;if(rudraData.routine.length>0){p+='\n\nUser Daily Routine:\n';rudraData.routine.forEach(r=>{p+=`- ${r.time}: ${r.task}\n`;});}if(rudraData.goals.length>0){p+='\nLearning Goals:\n';rudraData.goals.forEach(g=>{p+=`- ${g.name} (${g.duration}, ${g.progress||0}% done)\n`;});}return p;}
function streamText(el,text){el.innerHTML=fmtResponse(text)+'<span class="cursor">▌</span>';}
let reasoningEl=null;
function showReasoning(container,token){if(!reasoningEl||!container.contains(reasoningEl)){reasoningEl=document.createElement('div');reasoningEl.className='reasoning';container.appendChild(reasoningEl);}reasoningEl.textContent+=token;}
function fmtResponse(text){return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/`(.+?)`/g,'<code>$1</code>').replace(/\n/g,'<br>');}
function showThinking(){const el=document.createElement('div');el.className='msg jarvis thinking';el.innerHTML='<span class="dot"></span><span class="dot"></span><span class="dot"></span>';messagesEl.appendChild(el);messagesEl.parentElement.scrollTop=messagesEl.parentElement.scrollHeight;return el;}
function removeThinking(el){if(el?.parentNode)el.parentNode.removeChild(el);}

function jarvisRespond(text){addMessage(text,'jarvis');speak(text);logActivity(`JARVIS: ${text.slice(0,30)}`);}
function addMessage(text,role){const div=document.createElement('div');div.className=`msg ${role}`;div.textContent=text;messagesEl.appendChild(div);messagesEl.parentElement.scrollTop=messagesEl.parentElement.scrollHeight;return div;}

function toggleMic(){micActive?stopMic():startMic();}

function startMic(){
  if(!('webkitSpeechRecognition'in window||'SpeechRecognition'in window)){jarvisRespond("Speech recognition is not supported in this browser, sir. Please use Chrome.");return;}
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  recognition=new SR();recognition.continuous=true;recognition.interimResults=false;recognition.lang='en-IN';
  recognition.onstart=()=>{micActive=true;inputMode='voice';micBtn.classList.add('active');micLabel.textContent='LISTENING...';micSub.textContent='Click to stop';document.getElementById('voice-state').textContent='ACTIVE';logActivity('MIC: Activated');};
  recognition.onresult=(e)=>{const transcript=Array.from(e.results).slice(e.resultIndex).map(r=>r[0].transcript).join('').trim();if(!transcript)return;if(isSpeaking)stopSpeech();addMessage(transcript,'user');routeCommand(transcript);};
  recognition.onerror=(e)=>{if(e.error==='not-allowed'){jarvisRespond("Microphone access denied. Please allow mic permissions, sir.");stopMic();}};
  recognition.onend=()=>{if(micActive){try{recognition.start();}catch{}}};
  recognition.start();
}

function stopMic(){micActive=false;inputMode='text';if(recognition){try{recognition.stop();}catch{}}micBtn.classList.remove('active');micLabel.textContent='TAP MIC TO SPEAK';micSub.textContent='Tap mic and speak';document.getElementById('voice-state').textContent='READY';logActivity('MIC: Deactivated');}

function speak(text,rate=0.92,pitch=0.8){
  if(!window.speechSynthesis)return;stopSpeech();
  const clean=text.replace(/<[^>]*>/g,'').replace(/[#*`]/g,'');
  const utter=new SpeechSynthesisUtterance(clean);
  if(selectedVoice)utter.voice=selectedVoice;
  utter.lang='en-GB';utter.rate=rate;utter.pitch=pitch;utter.volume=1;
  if(/\?/.test(clean)){utter.rate=0.98;utter.pitch=0.85;}
  else if(/warning|error|fail|cannot|denied/i.test(clean)){utter.rate=0.85;utter.pitch=0.78;}
  else if(/great|online|ready|complete|done|perfect/i.test(clean)){utter.rate=0.98;utter.pitch=0.88;}
  utter.onstart=()=>{isSpeaking=true;if(recognition&&micActive){try{recognition.stop();}catch{}}};
  utter.onend=()=>{isSpeaking=false;if(micActive){try{recognition.start();}catch{}}};
  utter.onerror=()=>{isSpeaking=false;};
  window.speechSynthesis.speak(utter);
}
function stopSpeech(){if(window.speechSynthesis?.speaking)window.speechSynthesis.cancel();isSpeaking=false;}

window.btabClick=function(btn,tab){document.querySelectorAll('.btab').forEach(b=>b.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('.btab-pane').forEach(p=>p.classList.add('hidden'));document.getElementById(`btab-${tab}`).classList.remove('hidden');};

window.setAlarm=function(){const t=document.getElementById('alarm-time').value;if(!t)return;if(alarmTimer)clearInterval(alarmTimer);document.getElementById('alarm-status').textContent=`SET: ${t}`;logActivity(`ALARM SET: ${t}`);alarmTimer=setInterval(()=>{const now=new Date();const cur=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');if(cur===t){clearInterval(alarmTimer);document.getElementById('alarm-status').textContent='⚡ TRIGGERED!';jarvisRespond("Sir, your alarm is going off. Rise and shine!");logActivity('ALARM: TRIGGERED');}},10000);};

window.fetchJoke=async function(){try{const r=await fetch('https://v2.jokeapi.dev/joke/Programming,Misc?type=single&blacklistFlags=nsfw,racist');const d=await r.json();const j=d.joke||`${d.setup} — ${d.delivery}`;document.getElementById('joke-text').textContent=j;jarvisRespond(j);}catch{document.getElementById('joke-text').textContent='Could not fetch joke.';}};

window.qCmd=function(cmd){const map={time:()=>routeCommand('what time is it'),joke:()=>fetchJoke(),weather:()=>routeCommand('weather'),yt:()=>openSite('https://www.youtube.com','YOUTUBE')};if(map[cmd])map[cmd]();};

function openRudra(){document.getElementById('rudra-panel').classList.remove('hidden');document.getElementById('overlay').classList.remove('hidden');}
function closeRudra(){document.getElementById('rudra-panel').classList.add('hidden');document.getElementById('overlay').classList.add('hidden');}
window.closeRudra=closeRudra;window.openRudra=openRudra;

function switchTab(tab){document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));document.querySelectorAll('.tab-content').forEach(c=>c.classList.toggle('hidden',c.id!==`tab-${tab}`));}
window.switchTab=switchTab;

function loadData(){try{return JSON.parse(localStorage.getItem(DATA_KEY))||{routine:[],goals:[],progress:[]};}catch{return{routine:[],goals:[],progress:[]};}} 
function saveData(){localStorage.setItem(DATA_KEY,JSON.stringify(rudraData));}

window.addRoutine=function(){const time=document.getElementById('routine-time').value.trim();const task=document.getElementById('routine-task').value.trim();if(!time||!task)return;rudraData.routine.push({id:Date.now(),time,task});saveData();renderRoutine();document.getElementById('routine-time').value='';document.getElementById('routine-task').value='';};
function renderRoutine(){const el=document.getElementById('routine-list');el.innerHTML='';[...rudraData.routine].sort((a,b)=>a.time.localeCompare(b.time)).forEach(r=>{el.innerHTML+=`<div class="entry-item"><span class="entry-text">${r.time} — ${r.task}</span><button class="edit-btn" onclick="editRoutine(${r.id})">✏️</button><button class="del-btn" onclick="deleteRoutine(${r.id})">🗑</button></div>`;});}
window.deleteRoutine=function(id){rudraData.routine=rudraData.routine.filter(r=>r.id!==id);saveData();renderRoutine();};
window.editRoutine=function(id){const i=rudraData.routine.find(r=>r.id===id);if(!i)return;const t=prompt("Time:",i.time);const k=prompt("Task:",i.task);if(t!==null)i.time=t.trim();if(k!==null)i.task=k.trim();saveData();renderRoutine();};

window.addGoal=function(){const name=document.getElementById('goal-name').value.trim();const dur=document.getElementById('goal-duration').value.trim();if(!name||!dur)return;rudraData.goals.push({id:Date.now(),name,duration:dur,progress:0});saveData();renderGoals();renderProgress();document.getElementById('goal-name').value='';document.getElementById('goal-duration').value='';};
function renderGoals(){const el=document.getElementById('goals-list');el.innerHTML='';rudraData.goals.forEach(g=>{el.innerHTML+=`<div class="entry-item"><span class="entry-text">${g.name}</span><span class="entry-meta">${g.duration}</span><button class="edit-btn" onclick="editGoal(${g.id})">✏️</button><button class="del-btn" onclick="deleteGoal(${g.id})">🗑</button></div>`;});}
window.deleteGoal=function(id){rudraData.goals=rudraData.goals.filter(g=>g.id!==id);saveData();renderGoals();renderProgress();};
window.editGoal=function(id){const i=rudraData.goals.find(g=>g.id===id);if(!i)return;const n=prompt("Goal:",i.name);const d=prompt("Duration:",i.duration);if(n!==null)i.name=n.trim();if(d!==null)i.duration=d.trim();saveData();renderGoals();renderProgress();};

window.generateSchedule=function(){const day=document.getElementById('schedule-day').value;renderSchedTable(buildDaySched(day),day);};
window.generateWeekly=function(){const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];document.getElementById('schedule-output').innerHTML=days.map(d=>`<h4 style="color:#ff6b35;margin:12px 0 4px;font-size:11px;letter-spacing:2px;">${d}</h4>`+buildTableHTML(buildDaySched(d))).join('');};
function buildDaySched(day){const isWE=['Saturday','Sunday'].includes(day);const slots=[];rudraData.routine.forEach(r=>slots.push({time:r.time,task:r.task}));if(rudraData.goals.length>0){const ss=isWE?[['9:00 AM','10:30 AM'],['11:00 AM','12:30 PM'],['3:00 PM','4:30 PM'],['5:00 PM','6:30 PM']]:[['6:00 AM','7:00 AM'],['4:00 PM','5:30 PM'],['8:00 PM','9:30 PM']];rudraData.goals.forEach((g,i)=>{const s=ss[i%ss.length];slots.push({time:`${s[0]}–${s[1]}`,task:`📚 ${g.name}`});});}if(rudraData.routine.length===0){slots.push({time:'6:00 AM',task:'Wake up'},{time:'7:00 AM',task:'Exercise'},{time:'8:00 AM',task:'Breakfast'});if(!isWE)slots.push({time:'9:00 AM–5:00 PM',task:'College/Work'});slots.push({time:'9:00 PM',task:'Wind down'},{time:'10:30 PM',task:'Sleep'});}slots.sort((a,b)=>{const f=t=>{const m=t.match(/(\d+):(\d+)\s*(AM|PM)/i);if(!m)return 9999;let h=parseInt(m[1]);const mn=parseInt(m[2]);if(m[3].toUpperCase()==='PM'&&h!==12)h+=12;if(m[3].toUpperCase()==='AM'&&h===12)h=0;return h*60+mn;};return f(a.time)-f(b.time);});return slots;}
function buildTableHTML(slots){return `<table class="sched-table"><thead><tr><th>TIME</th><th>TASK</th></tr></thead><tbody>${slots.map(s=>`<tr><td contenteditable="true">${s.time}</td><td contenteditable="true">${s.task}</td></tr>`).join('')}</tbody></table>`;}
function renderSchedTable(slots,day){document.getElementById('schedule-output').innerHTML=`<h4 style="color:#ff6b35;margin-bottom:8px;font-size:11px;letter-spacing:2px;">${day}</h4>`+buildTableHTML(slots);}

function renderProgress(){const el=document.getElementById('progress-list');el.innerHTML='';if(!rudraData.goals.length){el.innerHTML='<p style="color:#446688;font-size:10px;">No goals set. Add them in AGHEERA tab.</p>';return;}rudraData.goals.forEach(g=>{const pct=g.progress||0;el.innerHTML+=`<div class="progress-item"><div class="prog-header"><span class="prog-title">${g.name} <small style="color:#446688">(${g.duration})</small></span><span class="prog-pct" id="ph-${g.id}">${pct}%</span></div><div class="prog-bar-bg"><div class="prog-bar-fill" id="pb-${g.id}" style="width:${pct}%"></div></div><div class="prog-controls"><input type="range" min="0" max="100" value="${pct}" oninput="updateProgress(${g.id},this.value)"/><span style="font-size:10px;color:#446688" id="pp-${g.id}">${pct}%</span></div></div>`;});}
window.updateProgress=function(id,val){const g=rudraData.goals.find(g=>g.id===id);if(!g)return;g.progress=parseInt(val);saveData();const pb=document.getElementById(`pb-${g.id}`);const pp=document.getElementById(`pp-${g.id}`);const ph=document.getElementById(`ph-${g.id}`);if(pb)pb.style.width=val+'%';if(pp)pp.textContent=val+'%';if(ph)ph.textContent=val+'%';};

function renderAll(){renderRoutine();renderGoals();renderProgress();}
function capitalize(s){return s.charAt(0).toUpperCase()+s.slice(1).toLowerCase();}