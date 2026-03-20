// ═══════════════════════════════════════════════════════════════
//  R.U.D.R.A  OS  ·  v8  FINAL
//  FIXES: loop bug, background tab open URL, interrupt speech,
//         Copilot-style listening, 10 extra features
// ═══════════════════════════════════════════════════════════════

const JARVIS_KEY = "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";
const AI_MODEL   = "openai/gpt-oss-120b";
const AI_URL     = "https://integrate.api.nvidia.com/v1/chat/completions";
const PROXY_URL  = "https://corsproxy.io/?url=" + encodeURIComponent(AI_URL);
const BASE44_FN  = "https://app.base44.com/api/apps/69b989cd27a641eb3274c8ad/functions/jarvisData";

const RUDRA_SYSTEM = `You are Rudra — a brilliant, warm, personal AI assistant with a deep, confident, slightly British tone.
CRITICAL RULES:
1. NEVER provide links, URLs, or markdown links. The system opens websites automatically.
2. If asked to open any website, just say "Opening [site] for you, sir." — nothing more.
3. Be concise, warm, direct. Say "sir" naturally sometimes. Max 3 sentences unless asked for detail.
4. You are Rudra — never say you are an AI or language model.`;

const SCHEDULE_SYSTEM = `You are Rudra's scheduling engine. Create realistic daily schedules. NEVER schedule study/learning during college hours. Return ONLY a JSON array: [{"time":"6:00 AM","task":"Wake up","type":"routine"}]`;

// ── STATE ──────────────────────────────────────────────────────
let micActive    = false;
let recog        = null;       // SpeechRecognition instance
let isSpeaking   = false;
let isProcessing = false;      // AI call in progress
let voiceMode    = false;
let chatHistory  = [];
let alarmTimer   = null;
let lastHeard    = '';         // dedupe — don't process same phrase twice in a row
let cmdLock      = false;      // prevent double-fire from recognition events
const T0         = Date.now();

// Tab management for close-by-voice
const openedTabs = {};         // name → window reference

// User key
let USER_KEY = localStorage.getItem('rudra_uid') || (() => {
  const k = 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  localStorage.setItem('rudra_uid', k); return k;
})();

let rudraData = {
  routine:[], goals:[],
  college:{from:'08:00',to:'17:00',days:'Mon-Fri'},
  sessions:0, brain:[], known:{}
};

// ── SITE MAP (used everywhere — single source of truth) ────────
const SITES = {
  youtube:    'https://www.youtube.com',
  yt:         'https://www.youtube.com',
  google:     'https://www.google.com',
  github:     'https://www.github.com',
  instagram:  'https://www.instagram.com',
  insta:      'https://www.instagram.com',
  twitter:    'https://www.twitter.com',
  x:          'https://www.twitter.com',
  facebook:   'https://www.facebook.com',
  fb:         'https://www.facebook.com',
  netflix:    'https://www.netflix.com',
  spotify:    'https://open.spotify.com',
  gmail:      'https://mail.google.com',
  maps:       'https://maps.google.com',
  wikipedia:  'https://www.wikipedia.org',
  wiki:       'https://www.wikipedia.org',
  whatsapp:   'https://web.whatsapp.com',
  reddit:     'https://www.reddit.com',
  linkedin:   'https://www.linkedin.com',
  amazon:     'https://www.amazon.in',
  flipkart:   'https://www.flipkart.com',
  chatgpt:    'https://chat.openai.com',
  discord:    'https://discord.com/app',
  twitch:     'https://www.twitch.tv',
  stackoverflow: 'https://stackoverflow.com',
  notion:     'https://www.notion.so',
  drive:      'https://drive.google.com',
  meets:      'https://meet.google.com',
};

// ── VOICE ──────────────────────────────────────────────────────
let selVoice = null;
function pickVoice() {
  const vs = window.speechSynthesis.getVoices();
  if (!vs.length) return;
  const order = [
    v => v.name === 'Google UK English Male',
    v => v.name.includes('Daniel') && v.lang === 'en-GB',
    v => v.name.includes('Arthur'),
    v => v.name.includes('James'),
    v => v.lang === 'en-GB',
    v => /david|mark/i.test(v.name) && v.lang.startsWith('en'),
    v => v.name.toLowerCase().includes('male') && v.lang.startsWith('en'),
    v => v.lang.startsWith('en'),
  ];
  for (const fn of order) {
    const v = vs.find(fn);
    if (v) { selVoice = v; addLog('VOICE: ' + v.name); break; }
  }
}
if (window.speechSynthesis) {
  pickVoice();
  window.speechSynthesis.onvoiceschanged = pickVoice;
  [500, 1500, 3000].forEach(t => setTimeout(pickVoice, t));
}

// ── BOOT ───────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  tickClock(); setInterval(tickClock, 1000);
  tickBars();  setInterval(tickBars, 3500);
  tickBattery(); setInterval(tickBattery, 30000);
  getWeather();
  tickGauges(); setInterval(tickGauges, 3500);

  document.getElementById('text-input')
    .addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });

  // Visibility change — restart mic when returning to tab
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && micActive && !isSpeaking) {
      addLog('TAB: Foreground — mic check');
      ensureMicRunning();
    }
  });

  await loadData();
  renderAll(); updateBrainUI();

  // FEATURE: Keyboard shortcut — Space to talk (when not typing)
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      if (!micActive) startMic();
    }
  });

  setTimeout(greet, 800);
});

// ── CLOCK ──────────────────────────────────────────────────────
function tickClock() {
  const n = new Date();
  const hm = p2(n.getHours())+':'+p2(n.getMinutes());
  const dt = n.toLocaleDateString('en-IN',{weekday:'long',day:'2-digit',month:'short',year:'numeric'}).toUpperCase();
  el('arc-time', hm);
  el('arc-date', dt.split(',')[0]||dt);
  el('tb-time-big', hm);
  el('tb-date', dt);
  el('tb-cal-num', n.getDate());
  el('tb-cal-month', n.toLocaleDateString('en-IN',{month:'long'}).toUpperCase());
  el('tb-cal-day', n.toLocaleDateString('en-IN',{weekday:'long'}).toUpperCase());
  el('btab-clock', hm+':'+p2(n.getSeconds()));
  el('btab-datestr', dt);
  const up = Math.floor((Date.now()-T0)/1000);
  el('uptime-val', p2(Math.floor(up/3600))+':'+p2(Math.floor(up%3600/60))+':'+p2(up%60));
}

function tickBars() {
  setBar('cpu',rnd(20,75)); setBar('ram',rnd(40,78)); setBar('net',rnd(15,85));
}
function setBar(id,v) {
  const b=document.getElementById('bar-'+id), s=document.getElementById('val-'+id);
  if(b)b.style.width=v+'%'; if(s)s.textContent=v+'%';
}

function tickBattery() {
  navigator.getBattery?.().then(b=>{
    const p=Math.round(b.level*100)+'%';
    el('batt-pct',p); el('pwr-status',b.charging?'CHARGING ⚡':'BATTERY');
    el('btab-batt-val',p); el('btab-batt-st',b.charging?'CHARGING ⚡':'DISCHARGING');
  });
}

async function getWeather() {
  try {
    const pos = await new Promise((ok,no)=>navigator.geolocation.getCurrentPosition(ok,no,{timeout:8000}));
    const {latitude:la, longitude:lo} = pos.coords;
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&current_weather=true&hourly=relativehumidity_2m,windspeed_10m&daily=sunrise,sunset&timezone=auto`);
    const d = await r.json(); const w = d.current_weather;
    const codes={0:'CLEAR SKY',1:'MAINLY CLEAR',2:'PARTLY CLOUDY',3:'OVERCAST',45:'FOGGY',51:'DRIZZLE',61:'RAIN',71:'SNOW',80:'SHOWERS',95:'THUNDERSTORM'};
    el('w-temp',Math.round(w.temperature)+'°C'); el('w-cond',codes[w.weathercode]||'CLEAR');
    el('w-hum',(d.hourly?.relativehumidity_2m?.[0]??'--')+'%');
    el('w-wind',(d.hourly?.windspeed_10m?.[0]??'--')+' km/h');
    el('w-rise',d.daily?.sunrise?.[0]?.split('T')[1]??'--');
    el('w-set',d.daily?.sunset?.[0]?.split('T')[1]??'--');
    const gr = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${la}&lon=${lo}&format=json`);
    const gd = await gr.json();
    el('w-loc',(gd.address?.city||gd.address?.town||gd.address?.village||'UNKNOWN').toUpperCase());
    addLog('WEATHER OK');
  } catch { el('w-cond','UNAVAILABLE'); el('w-loc','UNKNOWN'); }
}

function tickGauges() {
  drawGauge('gauge-cpu',rnd(20,75),'#00cfff');
  drawGauge('gauge-ram',rnd(40,78),'#0080ff');
}
function drawGauge(id,val,color) {
  const c=document.getElementById(id); if(!c) return;
  const ctx=c.getContext('2d'), cx=c.width/2, cy=c.height/2, r=cx-7;
  ctx.clearRect(0,0,c.width,c.height);
  ctx.beginPath(); ctx.arc(cx,cy,r,.75*Math.PI,2.25*Math.PI);
  ctx.strokeStyle='#0a2030'; ctx.lineWidth=8; ctx.lineCap='round'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,r,.75*Math.PI,.75*Math.PI+(val/100)*1.5*Math.PI);
  ctx.strokeStyle=color; ctx.lineWidth=8; ctx.lineCap='round'; ctx.stroke();
  ctx.fillStyle=color; ctx.font='bold 13px Orbitron,monospace';
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(val+'%',cx,cy);
}

function addLog(msg) {
  const le=document.getElementById('activity-log'); if(!le)return;
  const t=new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const d=document.createElement('div'); d.className='log-entry';
  d.innerHTML=`<span>${t}</span> ${msg}`;
  le.insertBefore(d,le.firstChild);
  while(le.children.length>30) le.lastChild.remove();
}

// ── DATA ───────────────────────────────────────────────────────
async function loadData() {
  try {
    const loc=localStorage.getItem('rudra_data');
    if(loc) rudraData={...rudraData,...JSON.parse(loc)};
  } catch {}
  try {
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(),7000);
    const r=await fetch(BASE44_FN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'load',user_key:USER_KEY}),signal:ctrl.signal});
    clearTimeout(t);
    const j=await r.json();
    if(j.ok&&j.record){
      ['routine','goals','college','brain','known','sessions'].forEach(k=>{if(j.record[k])rudraData[k]=j.record[k];});
      localStorage.setItem('rudra_data',JSON.stringify(rudraData));
      addLog('DATA: Cloud ✓');
    }
  } catch { addLog('DATA: Local only'); }
  rudraData.sessions=(rudraData.sessions||0)+1;
  if(rudraData.college){
    const cf=document.getElementById('clg-from'), ct=document.getElementById('clg-to'), cd=document.getElementById('clg-days');
    if(cf)cf.value=rudraData.college.from||'08:00';
    if(ct)ct.value=rudraData.college.to||'17:00';
    if(cd)cd.value=rudraData.college.days||'Mon-Fri';
    el('clg-saved',`Saved: ${rudraData.college.from}–${rudraData.college.to} (${rudraData.college.days})`);
  }
}
async function saveData() {
  localStorage.setItem('rudra_data',JSON.stringify(rudraData));
  try {
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(),8000);
    await fetch(BASE44_FN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',user_key:USER_KEY,data:{routine:rudraData.routine,goals:rudraData.goals,college:rudraData.college,brain:rudraData.brain.slice(-100),known:rudraData.known,sessions:rudraData.sessions}}),signal:ctrl.signal});
    clearTimeout(t);
  } catch {}
}

// ── GREET ──────────────────────────────────────────────────────
function greet() {
  const h=new Date().getHours();
  const g=h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  const msg=`${g}. I'm Rudra. How may I assist you?`;
  addMsg(msg,'rudra');
  speakIt(msg,'warm');
  addLog('BOOT OK · Session '+rudraData.sessions);
  saveData();
}

// ── TEXT INPUT ─────────────────────────────────────────────────
function sendText() {
  const v=document.getElementById('text-input').value.trim();
  if(!v)return;
  voiceMode=false;
  addMsg(v,'user');
  document.getElementById('text-input').value='';
  routeCmd(v);
}
window.sendText=sendText; window.handleTextInput=sendText;

// ── OPEN URL — works from background tab ───────────────────────
// KEY FIX: window.open() works even from background tabs.
// We store the reference so close-by-voice works.
function openURL(url, name) {
  try {
    const tab = window.open(url, '_blank', 'noopener,noreferrer');
    if (tab) {
      openedTabs[name.toLowerCase()] = tab;
      addLog('OPEN: '+name);
    }
  } catch(e) {
    addLog('OPEN ERR: '+e.message);
  }
  // Say it but DON'T set isProcessing — never block the router
  addMsg('Opening '+name+' for you.','rudra');
  if(voiceMode) speakIt('Opening '+name,'neutral');
}
window.openURL  = openURL;
window.openSite = openURL;

// ── CLOSE URL by voice ─────────────────────────────────────────
function closeTab(name) {
  const key = name.toLowerCase();
  // Try exact match
  if(openedTabs[key]) {
    try { openedTabs[key].close(); delete openedTabs[key]; respond('Closed '+name+'.'); return; }
    catch {}
  }
  // Try partial match
  for(const[k,tab] of Object.entries(openedTabs)) {
    if(k.includes(key)||key.includes(k)) {
      try { tab.close(); delete openedTabs[k]; respond('Closed '+k+'.'); return; } catch {}
    }
  }
  respond(`No open ${name} tab found. Please close it manually.`);
}

// ── ROUTER — THE BRAIN — runs SYNCHRONOUSLY, never loops ───────
function routeCmd(cmd) {
  // ── DEDUPE: ignore if exact same phrase heard within 1.5s ──
  const now = Date.now();
  if(cmd === lastHeard && (now - lastHeardTime) < 1500) {
    addLog('DEDUPE: skipped "'+cmd.slice(0,25)+'"'); return;
  }
  lastHeard = cmd; lastHeardTime = now;

  const c = cmd.toLowerCase().trim();
  addLog('CMD: "'+cmd.slice(0,35)+'"');

  // ══ PRIORITY 1: CLOSE commands ══
  const closeM = c.match(/^(?:close|shut|exit|kill)\s+(.+)/i);
  if(closeM) {
    const what = closeM[1].trim();
    if(/rudra|panel/i.test(what)) { closeRudraPanel(); return respond('Panel closed.'); }
    closeTab(what); return;
  }

  // ══ PRIORITY 2: OPEN / LAUNCH site ══
  // Catches: "open youtube", "launch google", "go to instagram", "show me netflix"
  const openM = c.match(/^(?:open|launch|go\s+to|show\s+me|load|start|take\s+me\s+to)\s+(.+)/i);
  if(openM) {
    const target = openM[1].trim().toLowerCase().replace(/\s+/g,'');
    // exact match
    if(SITES[target]) { openURL(SITES[target], target); return; }
    // partial match
    for(const[k,u] of Object.entries(SITES)) {
      if(target.includes(k)||k.includes(target)) { openURL(u,k); return; }
    }
    // custom URL
    if(target.startsWith('http')||target.startsWith('www')) {
      openURL(target.startsWith('http')?target:'https://'+target, target); return;
    }
    // fallback: search on google
    openURL('https://www.google.com/search?q='+encodeURIComponent(openM[1]),'Google: '+openM[1]);
    return;
  }

  // ══ PRIORITY 3: SITE names said alone ══
  // "youtube", "instagram", "open yt please" etc
  for(const[k,u] of Object.entries(SITES)) {
    if(c===k || c==='open '+k || c==='go '+k) { openURL(u,k); return; }
  }

  // ══ PRIORITY 4: PLAY ══
  const playM = c.match(/^play\s+(.+)/i);
  if(playM) {
    openURL('https://www.youtube.com/results?search_query='+encodeURIComponent(playM[1]),'YouTube');
    respond('Playing "'+playM[1]+'" on YouTube.');
    return;
  }

  // ══ PRIORITY 5: SEARCH ══
  const searchM = c.match(/^search\s+(.+?)\s+(?:on|in)\s+(\w+)/i);
  if(searchM) {
    const q=searchM[1], site=searchM[2].toLowerCase();
    const su={youtube:'https://www.youtube.com/results?search_query=',google:'https://www.google.com/search?q=',amazon:'https://www.amazon.in/s?k='};
    openURL((su[site]||su.google)+encodeURIComponent(q), site+': '+q); return;
  }

  // ══ PRIORITY 6: RUDRA PANEL ══
  if(/open\s*(rudra|panel)|rudra\s*panel/i.test(c)) { openRudraPanel(); return respond('Rudra panel open.'); }
  if(/close\s*(rudra|panel)/i.test(c)) { closeRudraPanel(); return respond('Panel closed.'); }

  // ══ PRIORITY 7: SCHEDULE ══
  if(/schedule|timetable|plan\s+my|my\s+day|daily\s+plan/i.test(c)) {
    openRudraPanel(); setTimeout(()=>{switchTab('schedule');generateWithAI();},350);
    return respond('Generating your smart schedule.');
  }

  // ══ PRIORITY 8: QUICK ANSWERS — no AI needed ══
  if(/what.*time|time now|current time/i.test(c))
    return respond('It\'s '+new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})+', sir.');
  if(/what.*date|today.*date|what day/i.test(c))
    return respond('Today is '+new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'})+'.') ;
  if(/weather/i.test(c)) {
    const tmp=document.getElementById('w-temp')?.textContent||'--';
    const cnd=document.getElementById('w-cond')?.textContent||'--';
    const loc=document.getElementById('w-loc')?.textContent||'--';
    return respond('It\'s '+tmp+' and '+cnd.toLowerCase()+' in '+loc+'.');
  }
  if(/battery|charge/i.test(c)) {
    navigator.getBattery?.().then(b=>respond('Battery at '+Math.round(b.level*100)+'%, '+(b.charging?'charging':'not charging')+'.')); return;
  }
  if(/stop.*mic|mic.*off|stop.*listen/i.test(c)) { stopMic(); return respond('Microphone off.'); }
  if(/start.*mic|mic.*on|start.*listen|listen/i.test(c)) { startMic(); return respond('Listening.'); }
  if(/clear.*chat|clear.*screen|reset.*chat/i.test(c)) {
    document.getElementById('messages').innerHTML=''; chatHistory=[];
    return respond('Chat cleared.');
  }
  if(/^(hello|hi|hey|yo)\b/i.test(c)) return respond('Hello sir. Systems online. What do you need?');
  if(/who are you|your name|what are you/i.test(c)) return respond("I'm Rudra — your personal AI assistant.");
  if(/stop.*talk|be quiet|shut up|stop speaking/i.test(c)) {
    window.speechSynthesis.cancel(); isSpeaking=false;
    return respond('Understood.'); // just text, no speech
  }

  // ══ FEATURE: Calculator ══
  if(/calculate|what is\s+[\d+\-*\/\^().\s]+|solve\s+[\d+\-*\/\^().\s]+/i.test(c)) {
    const mathM = c.match(/(?:calculate|what\s+is|solve)\s+([\d+\-*\/\^().\s]+)/i);
    if(mathM) {
      try {
        const expr = mathM[1].replace(/\^/g,'**');
        const result = Function('"use strict"; return ('+expr+')')();
        return respond(mathM[1].trim()+' = '+result);
      } catch {}
    }
  }

  // ══ FEATURE: Reminder (in-session) ══
  const remM = c.match(/remind\s+me\s+(?:in|after)\s+(\d+)\s+(minute|min|second|sec|hour)/i);
  if(remM) {
    const num=parseInt(remM[1]);
    const unit=remM[2].toLowerCase();
    const ms=unit.startsWith('s')?num*1000:unit.startsWith('h')?num*3600000:num*60000;
    setTimeout(()=>{
      const m='Reminder: '+num+' '+unit+(num>1?'s':'')+' have passed.';
      addMsg(m,'rudra'); speakIt(m,'excited');
    },ms);
    return respond('Reminder set for '+num+' '+unit+(num>1?'s':'')+' from now.');
  }

  // ══ FEATURE: Note taking ══
  const noteM = c.match(/(?:note|remember|save)\s+(?:that\s+)?(.+)/i);
  if(noteM) {
    const note=noteM[1].trim();
    const notes=JSON.parse(localStorage.getItem('rudra_notes')||'[]');
    notes.push({text:note,when:new Date().toLocaleString()});
    localStorage.setItem('rudra_notes',JSON.stringify(notes));
    learnFact('note_'+Date.now(),note);
    return respond('Noted: "'+note+'"');
  }

  // ══ FEATURE: Read notes ══
  if(/(?:read|show|what are)\s+(?:my\s+)?notes|my\s+notes/i.test(c)) {
    const notes=JSON.parse(localStorage.getItem('rudra_notes')||'[]');
    if(!notes.length) return respond('No notes saved yet.');
    const last3=notes.slice(-3).map((n,i)=>`${i+1}. ${n.text}`).join('. ');
    return respond('Your last notes: '+last3);
  }

  // ══ FEATURE: Math words ══
  if(/what is (\d+) (?:plus|minus|times|divided by|multiplied by) (\d+)/i.test(c)) {
    const m=c.match(/what is (\d+) (plus|minus|times|divided by|multiplied by) (\d+)/i);
    if(m){
      const a=+m[1],op=m[2],b=+m[3];
      const r=op==='plus'?a+b:op==='minus'?a-b:op==='times'||op==='multiplied by'?a*b:a/b;
      return respond(m[1]+' '+op+' '+m[3]+' = '+r);
    }
  }

  // → AUTO-LEARN + AI
  learnFromMessage(cmd);
  askAI(cmd);
}

// ── DEDUPE HELPER ──────────────────────────────────────────────
let lastHeardTime = 0;

// ── RESPOND ────────────────────────────────────────────────────
function respond(txt) {
  addMsg(txt,'rudra');
  if(voiceMode) speakIt(txt,'neutral');
  addLog('RUDRA: '+txt.slice(0,40));
}

function addMsg(txt, role) {
  const msgs=document.getElementById('messages');
  if(!msgs)return;
  const d=document.createElement('div');
  d.className='msg '+role;
  d.textContent=txt;
  msgs.appendChild(d);
  scrollChat();
  return d;
}
function scrollChat(){const ca=document.getElementById('chat-area');if(ca)ca.scrollTop=ca.scrollHeight;}

function showThinking(){
  const d=document.createElement('div');
  d.className='msg rudra thinking';
  d.innerHTML='<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  document.getElementById('messages')?.appendChild(d);
  scrollChat(); return d;
}

function fmtText(t){
  return t
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/`(.+?)`/g,'<code>$1</code>')
    .replace(/\n/g,'<br>');
}

// ── AI ─────────────────────────────────────────────────────────
async function askAI(msg) {
  if(isProcessing){addLog('AI: busy, skipping'); return;}
  isProcessing=true;

  const badge=document.getElementById('ai-status-badge');
  chatHistory.push({role:'user',content:msg});
  if(chatHistory.length>14) chatHistory=chatHistory.slice(-14);

  const thinkEl=showThinking();
  if(badge) badge.textContent='AI: THINKING...';

  const bubble=document.createElement('div');
  bubble.className='msg rudra';
  document.getElementById('messages')?.appendChild(bubble);
  scrollChat();

  // Enrich system with known facts
  const knownStr=Object.values(rudraData.known).join('. ');
  const sys=RUDRA_SYSTEM+(knownStr?'\n\nAbout user: '+knownStr:'');

  const payload=JSON.stringify({
    model:AI_MODEL,
    messages:[{role:'system',content:sys},...chatHistory],
    max_tokens:800, temperature:0.88, top_p:1, stream:true
  });
  const hdrs={'Authorization':'Bearer '+JARVIS_KEY,'Content-Type':'application/json','Accept':'text/event-stream'};

  let response=null, errMsg='';
  for(const ep of [AI_URL, PROXY_URL]){
    try{
      const ctrl=new AbortController();
      const timer=setTimeout(()=>ctrl.abort(),25000);
      response=await fetch(ep,{method:'POST',headers:hdrs,body:payload,signal:ctrl.signal});
      clearTimeout(timer);
      if(response.ok){addLog('AI: ✓');break;}
      errMsg='HTTP '+response.status; response=null;
    } catch(e){errMsg=e.name==='AbortError'?'Timeout':e.message; response=null;}
  }

  thinkEl.remove();

  if(!response){
    const em='Network issue ('+errMsg+'). Try again.';
    bubble.textContent=em;
    if(voiceMode) speakIt(em,'calm');
    if(badge) badge.textContent='AI: ERROR';
    setTimeout(()=>{if(badge)badge.textContent='AI: RUDRA';},3000);
    isProcessing=false; return;
  }

  // Stream response
  const reader=response.body.getReader(), dec=new TextDecoder();
  let buf='', full='';
  try{
    while(true){
      const{done,value}=await reader.read();
      if(done)break;
      buf+=dec.decode(value,{stream:true});
      const lines=buf.split('\n'); buf=lines.pop();
      for(const line of lines){
        const t=line.trim();
        if(!t||t==='data: [DONE]'||!t.startsWith('data: '))continue;
        try{
          const d=JSON.parse(t.slice(6))?.choices?.[0]?.delta;
          if(d?.content){full+=d.content; bubble.innerHTML=fmtText(full)+'<span class="cur">▌</span>'; scrollChat();}
        } catch{}
      }
    }
  }catch(e){addLog('STREAM: '+e.message);}

  bubble.innerHTML=fmtText(full||'...');
  if(full) chatHistory.push({role:'assistant',content:full});
  addLog('AI: '+full.length+'ch');

  // Learn from conversation
  if(full.length>30){
    rudraData.brain.push({when:new Date().toISOString(),key:'q',value:msg.slice(0,60)});
    if(rudraData.brain.length%5===0) saveData();
    updateBrainUI();
  }

  if(voiceMode&&full){
    const spokenText=full.replace(/<[^>]*>/g,'').replace(/[#*`_\[\]]/g,'').slice(0,500);
    speakIt(spokenText, detectEm(full));
  }
  if(badge) badge.textContent='AI: RUDRA';
  isProcessing=false;
}

// ── SPEAK — Copilot style: stops when user talks ───────────────
function speakIt(text, emotion='neutral') {
  if(!window.speechSynthesis)return;
  window.speechSynthesis.cancel();
  isSpeaking=false;

  const clean=text.replace(/<[^>]*>/g,'').replace(/[#*`_\[\]]/g,'').trim().slice(0,500);
  if(!clean)return;
  if(!selVoice) pickVoice();

  const sentences=clean.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g)||[clean];
  let i=0;

  function nextSentence(){
    if(i>=sentences.length){isSpeaking=false; return;}
    const s=sentences[i++].trim(); if(!s){nextSentence();return;}
    const u=new SpeechSynthesisUtterance(s);
    if(selVoice) u.voice=selVoice;
    u.lang='en-GB'; u.volume=1;
    // Deep male voice settings
    const e=detectEm(s);
    if(e==='excited')     {u.rate=0.96; u.pitch=0.88;}
    else if(e==='warning'){u.rate=0.83; u.pitch=0.76;}
    else if(e==='warm')   {u.rate=0.87; u.pitch=0.84;}
    else if(e==='question'){u.rate=0.89; u.pitch=0.84;}
    else if(e==='calm')   {u.rate=0.85; u.pitch=0.80;}
    else                  {u.rate=0.87; u.pitch=0.82;}
    u.onstart=()=>{ isSpeaking=true; };
    u.onend=nextSentence;
    u.onerror=()=>{ isSpeaking=false; nextSentence(); };
    window.speechSynthesis.speak(u);
  }
  nextSentence();
}

function detectEm(t){
  if(/\?/.test(t))return'question';
  if(/error|fail|cannot|denied|blocked|warning|alert/i.test(t))return'warning';
  if(/great|perfect|done|ready|online|excellent|awesome/i.test(t))return'excited';
  if(/morning|evening|afternoon|hello|welcome|good\s/i.test(t))return'warm';
  if(/sorry|trouble|can't|couldn't|issue|problem/i.test(t))return'calm';
  return'neutral';
}

// ═══════════════════════════════════════════════════════════════
//  MIC ENGINE — Copilot-style
//  • Interrupts Rudra when you start talking
//  • Self-heals — never dies
//  • Works in background tabs
//  • No repeating / no loop
// ═══════════════════════════════════════════════════════════════
function toggleMic(){ micActive?stopMic():startMic(); }
window.toggleMic=toggleMic;

function startMic(){
  if(micActive)return; // already running
  const SRC=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SRC){
    addMsg('Speech recognition needs Chrome/Edge. Use HOLD TO TALK on mobile.','rudra');
    return;
  }
  micActive=true; voiceMode=true;
  document.getElementById('mic-btn')?.classList.add('active');
  el('mic-label','LISTENING...');
  el('mic-status-line','Say your command');
  addLog('MIC: ON');
  spawnRecognition();
}

function spawnRecognition(){
  if(!micActive)return;
  const SRC=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SRC)return;

  recog=new SRC();
  recog.continuous=false;       // single-shot — prevents loop
  recog.interimResults=true;    // lets us detect speech start → interrupt Rudra
  recog.lang='en-IN';
  recog.maxAlternatives=1;

  let finalFired=false;

  recog.onstart=()=>{ finalFired=false; };

  // ── INTERRUPT: user starts speaking → stop Rudra talking ──
  recog.onspeechstart=()=>{
    if(isSpeaking){
      window.speechSynthesis.cancel();
      isSpeaking=false;
      addLog('INTERRUPTED by user');
    }
  };

  recog.onresult=e=>{
    if(!micActive)return;
    let interim='', final='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      if(e.results[i].isFinal) final+=e.results[i][0].transcript;
      else interim+=e.results[i][0].transcript;
    }

    // Show interim in status bar (live preview)
    if(interim) el('mic-status-line','Hearing: "'+interim.slice(0,30)+'..."');

    if(final.trim()&&!finalFired){
      finalFired=true;
      const tr=final.trim();
      addLog('HEARD: "'+tr.slice(0,40)+'"');

      // Skip if exactly same as 1.5s ago (echo protection)
      const now=Date.now();
      if(tr===lastHeard&&(now-lastHeardTime)<1500){
        addLog('ECHO: skipped'); return;
      }
      lastHeard=tr; lastHeardTime=now;

      addMsg(tr,'user');
      // Route IMMEDIATELY — don't wait for AI
      routeCmd(tr);
    }
  };

  recog.onerror=e=>{
    addLog('MIC ERR: '+e.error);
    if(e.error==='not-allowed'){
      addMsg('Mic access denied. Allow microphone in browser settings.','rudra');
      stopMic();
    }
    // All other errors: onend will restart
  };

  recog.onend=()=>{
    if(!micActive)return;
    // Self-heal: restart after small delay
    // Longer delay if AI is still processing
    const delay=isProcessing?700:120;
    setTimeout(()=>{ if(micActive) spawnRecognition(); }, delay);
  };

  try{ recog.start(); }
  catch(e){
    addLog('MIC spawn err: '+e.message);
    // Retry after 500ms
    setTimeout(()=>{ if(micActive) spawnRecognition(); },500);
  }
}

function stopMic(){
  micActive=false; voiceMode=false;
  try{ recog?.abort(); }catch{}
  recog=null;
  document.getElementById('mic-btn')?.classList.remove('active');
  el('mic-label','TAP TO SPEAK');
  el('mic-status-line','Microphone OFF');
  addLog('MIC: OFF');
}

function ensureMicRunning(){
  // Called on tab visibility change — restart recog if it stopped
  if(micActive&&(!recog)){
    addLog('MIC: respawn after tab switch');
    spawnRecognition();
  }
}

// ── PUSH TO TALK (mobile) ──────────────────────────────────────
let pttRecog=null;
window.pttStart=function(){
  if(!window.SpeechRecognition&&!window.webkitSpeechRecognition)return;
  const SRC=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(isSpeaking){window.speechSynthesis.cancel();isSpeaking=false;}
  pttRecog=new SRC(); pttRecog.lang='en-IN'; pttRecog.continuous=false; pttRecog.interimResults=false;
  voiceMode=true;
  el('mic-status-line','🔴 RECORDING — speak now');
  pttRecog.onresult=e=>{
    const tr=e.results[0]?.[0]?.transcript?.trim();
    if(tr){addMsg(tr,'user'); routeCmd(tr);}
  };
  pttRecog.onerror=()=>el('mic-status-line','Error — try again');
  pttRecog.onend=()=>el('mic-status-line','Released');
  try{pttRecog.start();}catch{}
};
window.pttEnd=function(){ try{pttRecog?.stop();}catch{} el('mic-status-line','Processing...'); };

// ── RUDRA PANEL ────────────────────────────────────────────────
function openRudraPanel(){document.getElementById('rudra-panel')?.classList.remove('hidden');document.getElementById('overlay')?.classList.remove('hidden');}
function closeRudraPanel(){document.getElementById('rudra-panel')?.classList.add('hidden');document.getElementById('overlay')?.classList.add('hidden');}
window.openRudra=openRudraPanel; window.closeRudra=closeRudraPanel;
window.openRudraPanel=openRudraPanel; window.closeRudraPanel=closeRudraPanel;

function switchTab(tab){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.toggle('hidden',c.id!=='tab-'+tab));
}
window.switchTab=switchTab;

// ── COLLEGE HOURS ─────────────────────────────────────────────
window.saveCollegeHours=function(){
  const from=document.getElementById('clg-from')?.value||'08:00';
  const to=document.getElementById('clg-to')?.value||'17:00';
  const days=document.getElementById('clg-days')?.value||'Mon-Fri';
  rudraData.college={from,to,days};
  saveData();
  el('clg-saved','✓ Saved: '+from+'–'+to+' ('+days+')');
  respond('College hours saved. '+from+' to '+to+' on '+days+'. I\'ll never schedule anything during those times.');
};

// ── AI SMART SCHEDULE ─────────────────────────────────────────
window.generateWithAI=async function(){
  const day=document.getElementById('schedule-day')?.value||new Date().toLocaleDateString('en-US',{weekday:'long'});
  const out=document.getElementById('schedule-output');
  if(out) out.innerHTML='<div style="color:#336688;padding:10px;font-size:11px">🤖 AI generating fresh schedule...</div>';

  const isWE=['Saturday','Sunday'].includes(day);
  const clg=rudraData.college;
  const to12=t=>{const[h,m]=t.split(':').map(Number);const ap=h>=12?'PM':'AM';const h12=h>12?h-12:h===0?12:h;return h12+':'+p2(m)+' '+ap;};
  const clgFrom=to12(clg.from||'08:00'), clgTo=to12(clg.to||'17:00');

  const prompt=`Create a fresh, varied schedule for ${day}.
COLLEGE HOURS: ${isWE?'No college (weekend)':'BLOCKED '+clgFrom+' to '+clgTo+' — do NOT schedule study or learning here'}
ROUTINE: ${rudraData.routine.map(r=>r.time+': '+r.task).join(', ')||'none'}
GOALS: ${rudraData.goals.map(g=>g.name+' ('+g.duration+')').join(', ')||'none'}
RULES: Vary the schedule. Study before/after college only. Include meals, exercise, breaks, sleep. Be specific (e.g. "Code for 45 min", not just "Study").
Return ONLY a JSON array: [{"time":"6:00 AM","task":"Wake up","type":"routine"}]`;

  try{
    const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),25000);
    const r=await fetch(AI_URL,{method:'POST',headers:{'Authorization':'Bearer '+JARVIS_KEY,'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify({model:AI_MODEL,messages:[{role:'system',content:SCHEDULE_SYSTEM},{role:'user',content:prompt}],max_tokens:1200,temperature:0.95,stream:true}),signal:ctrl.signal});
    clearTimeout(t);
    const reader=r.body.getReader(), dec=new TextDecoder(); let buf='',full='';
    while(true){
      const{done,value}=await reader.read(); if(done)break;
      buf+=dec.decode(value,{stream:true}); const lines=buf.split('\n'); buf=lines.pop();
      for(const line of lines){const lt=line.trim();if(!lt||lt==='data: [DONE]'||!lt.startsWith('data: '))continue;try{const d=JSON.parse(lt.slice(6))?.choices?.[0]?.delta;if(d?.content)full+=d.content;}catch{}}
    }
    const jm=full.match(/\[[\s\S]+\]/);
    if(!jm)throw new Error('no JSON');
    const slots=JSON.parse(jm[0]);
    const colors={study:'#00cfff',break:'#ff6b00',routine:'#5588aa',college:'#ff4444',sleep:'#334466'};
    let html=`<h4 style="color:#ff6b00;margin-bottom:8px;font-size:11px;letter-spacing:2px">🤖 ${day.toUpperCase()} · ${new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</h4>`;
    html+=`<table class="st"><thead><tr><th>TIME</th><th>TASK</th></tr></thead><tbody>`;
    slots.forEach(s=>{const col=colors[s.type]||'#6aaccc';html+=`<tr><td style="color:${col}">${s.time}</td><td contenteditable="true" style="color:${col}">${s.task}</td></tr>`;});
    html+=`</tbody></table><div style="font-size:9px;color:#336688;margin-top:5px">College blocked: ${isWE?'Weekend':clgFrom+'–'+clgTo} · Click cells to edit</div>`;
    if(out) out.innerHTML=html;
    addLog('SCHED: AI done for '+day);
  }catch(e){ addLog('SCHED ERR: '+e.message); window.generateSchedule(); }
};

window.generateWeekly=function(){
  const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const out=document.getElementById('schedule-output');
  if(out) out.innerHTML=days.map(d=>buildDayHTML(d)).join('');
};
window.generateSchedule=function(){
  const day=document.getElementById('schedule-day')?.value||'Monday';
  const out=document.getElementById('schedule-output');
  if(out) out.innerHTML=buildDayHTML(day);
};
function buildDayHTML(day){
  return `<h4 style="color:#ff6b00;margin:10px 0 4px;font-size:11px;letter-spacing:2px">${day.toUpperCase()}</h4>`+makeTable(buildDaySlots(day));
}
function buildDaySlots(day){
  const isWE=['Saturday','Sunday'].includes(day);
  const clg=rudraData.college||{from:'08:00',to:'17:00'};
  const slots=rudraData.routine.map(r=>({time:r.time,task:r.task}));
  if(!isWE) slots.push({time:to12h(clg.from||'08:00'),task:'🏫 COLLEGE / CLASS'});
  if(rudraData.goals.length){
    const safe=isWE?[['7:00 AM','8:30 AM'],['10:00 AM','11:30 AM'],['3:00 PM','4:30 PM'],['7:00 PM','8:30 PM']]:[['6:00 AM','7:30 AM'],['5:30 PM','7:00 PM'],['8:00 PM','9:30 PM']];
    rudraData.goals.forEach((g,i)=>{const s=safe[i%safe.length];slots.push({time:`${s[0]}–${s[1]}`,task:'📚 '+g.name});});
  }
  if(!slots.length){
    slots.push({time:'6:00 AM',task:'Wake up'},{time:'7:00 AM',task:'Exercise'},{time:'8:00 AM',task:'Breakfast'});
    if(!isWE) slots.push({time:to12h(clg.from||'08:00'),task:'🏫 College'});
    slots.push({time:'6:00 PM',task:'Self study'},{time:'9:00 PM',task:'Wind down'},{time:'10:30 PM',task:'Sleep'});
  }
  return slots.sort((a,b)=>tv(a.time)-tv(b.time));
}
function to12h(t){const[h,m]=t.split(':').map(Number);const ap=h>=12?'PM':'AM';const h12=h>12?h-12:h===0?12:h;return h12+':'+p2(m)+' '+ap;}
function makeTable(slots){return `<table class="st"><thead><tr><th>TIME</th><th>TASK</th></tr></thead><tbody>`+slots.map(s=>`<tr><td contenteditable="true">${s.time}</td><td contenteditable="true">${s.task}</td></tr>`).join('')+'</tbody></table>';}
function tv(t){const m=t.match(/(\d+):(\d+)\s*(AM|PM)/i);if(!m)return 9999;let h=parseInt(m[1]);if(m[3].toUpperCase()==='PM'&&h!==12)h+=12;if(m[3].toUpperCase()==='AM'&&h===12)h=0;return h*60+parseInt(m[2]);}

// ── LEARNING ──────────────────────────────────────────────────
function learnFact(key,value){
  rudraData.known[key]=value;
  rudraData.brain.push({when:new Date().toISOString(),key,value});
  updateBrainUI();
}
function learnFromMessage(msg){
  const pats=[
    [/my name is (\w+)/i,'name',m=>'Name: '+m[1]],
    [/i am (\d+) years?/i,'age',m=>'Age: '+m[1]],
    [/i study (\w[\w\s]+)/i,'study',m=>'Studies: '+m[1]],
    [/i like (\w[\w\s]+)/i,'interest',m=>'Likes: '+m[1]],
    [/call me (\w+)/i,'nickname',m=>'Nickname: '+m[1]],
    [/i wake up at (\S+)/i,'wake',m=>'Wakes at: '+m[1]],
    [/my goal is (.+)/i,'goal',m=>'Goal: '+m[1]],
  ];
  let learned=false;
  for(const[rx,key,fn]of pats){const m=msg.match(rx);if(m){learnFact(key,fn(m));learned=true;}}
  if(learned)saveData();
}
function updateBrainUI(){
  el('brain-sessions',rudraData.sessions||0);
  el('brain-facts',Object.keys(rudraData.known).length);
  const lvl=rudraData.sessions<3?'LEARNING':rudraData.sessions<10?'ADAPTING':rudraData.sessions<25?'INTELLIGENT':'EXPERT';
  el('brain-level',lvl);
  const bl=document.getElementById('brain-log-list');
  if(bl) bl.innerHTML=[...rudraData.brain].reverse().slice(0,20).map(b=>`<div class="log-entry"><span>${new Date(b.when).toLocaleDateString()}</span> ${b.key}: ${b.value}</div>`).join('')||'<div style="color:#336688;font-size:10px;padding:4px">No data yet.</div>';
  const kf=document.getElementById('known-facts');
  if(kf){const f=Object.entries(rudraData.known);kf.innerHTML=f.length?f.map(([k,v])=>`<div class="log-entry"><span>${k}</span> ${v}</div>`).join(''):'<div style="color:#336688;font-size:10px;padding:4px">Tell me about yourself!</div>';}
}
window.clearBrain=function(){if(confirm('Clear all learning data?')){rudraData.brain=[];rudraData.known={};saveData();updateBrainUI();respond('Brain cleared. Starting fresh.');}};

// ── ROUTINE ───────────────────────────────────────────────────
window.addRoutine=function(){
  const time=document.getElementById('routine-time')?.value.trim();
  const task=document.getElementById('routine-task')?.value.trim();
  if(!time||!task)return;
  rudraData.routine.push({id:Date.now(),time,task});
  saveData(); renderRoutine();
  document.getElementById('routine-time').value='';
  document.getElementById('routine-task').value='';
};
function renderRoutine(){
  const el2=document.getElementById('routine-list');if(!el2)return;
  el2.innerHTML='';
  [...rudraData.routine].sort((a,b)=>a.time.localeCompare(b.time)).forEach(r=>{
    el2.innerHTML+=`<div class="entry-item"><span class="et">${r.time} — ${r.task}</span><button class="eb" onclick="editR(${r.id})">✏️</button><button class="ed" onclick="delR(${r.id})">🗑</button></div>`;
  });
}
window.delR=id=>{rudraData.routine=rudraData.routine.filter(r=>r.id!==id);saveData();renderRoutine();};
window.editR=id=>{const i=rudraData.routine.find(r=>r.id===id);if(!i)return;const t=prompt('Time:',i.time),k=prompt('Task:',i.task);if(t!==null)i.time=t.trim();if(k!==null)i.task=k.trim();saveData();renderRoutine();};

// ── GOALS ─────────────────────────────────────────────────────
window.addGoal=function(){
  const name=document.getElementById('goal-name')?.value.trim();
  const dur=document.getElementById('goal-duration')?.value.trim();
  if(!name||!dur)return;
  rudraData.goals.push({id:Date.now(),name,duration:dur,progress:0});
  saveData();renderGoals();renderProgress();
  document.getElementById('goal-name').value='';
  document.getElementById('goal-duration').value='';
};
function renderGoals(){
  const el2=document.getElementById('goals-list');if(!el2)return;
  el2.innerHTML='';
  rudraData.goals.forEach(g=>{el2.innerHTML+=`<div class="entry-item"><span class="et">${g.name}</span><span class="em">${g.duration}</span><button class="eb" onclick="editG(${g.id})">✏️</button><button class="ed" onclick="delG(${g.id})">🗑</button></div>`;});
}
window.delG=id=>{rudraData.goals=rudraData.goals.filter(g=>g.id!==id);saveData();renderGoals();renderProgress();};
window.editG=id=>{const i=rudraData.goals.find(g=>g.id===id);if(!i)return;const n=prompt('Goal:',i.name),d=prompt('Duration:',i.duration);if(n!==null)i.name=n.trim();if(d!==null)i.duration=d.trim();saveData();renderGoals();renderProgress();};

// ── PROGRESS ──────────────────────────────────────────────────
function renderProgress(){
  const el2=document.getElementById('progress-list');if(!el2)return;
  el2.innerHTML='';
  if(!rudraData.goals.length){el2.innerHTML='<p style="color:#336688;font-size:10px;padding:4px">Add goals in My Info tab.</p>';return;}
  rudraData.goals.forEach(g=>{
    const p=g.progress||0;
    el2.innerHTML+=`<div class="pi"><div class="ph"><span class="pt">${g.name} <small style="color:#336688">(${g.duration})</small></span><span class="pp" id="ph-${g.id}">${p}%</span></div><div class="pb-bg"><div class="pb-fill" id="pb-${g.id}" style="width:${p}%"></div></div><div class="pc"><input type="range" min="0" max="100" value="${p}" oninput="updP(${g.id},this.value)"><span style="font-size:10px;color:#336688" id="pp-${g.id}">${p}%</span></div></div>`;
  });
}
window.updP=function(id,val){const g=rudraData.goals.find(g=>g.id===id);if(!g)return;g.progress=+val;saveData();['pb','pp','ph'].forEach(p=>{const e=document.getElementById(p+'-'+g.id);if(e){if(p==='pb')e.style.width=val+'%';else e.textContent=val+'%';}});};

function renderAll(){renderRoutine();renderGoals();renderProgress();updateBrainUI();}

// ── TABS ─────────────────────────────────────────────────────
window.btabClick=function(btn,tab){
  document.querySelectorAll('.btab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.btab-pane').forEach(p=>p.classList.add('hidden'));
  document.getElementById('btab-'+tab)?.classList.remove('hidden');
};

// ── ALARM ─────────────────────────────────────────────────────
window.setAlarm=function(){
  const t=document.getElementById('alarm-time')?.value;if(!t)return;
  clearInterval(alarmTimer);
  el('alarm-st','SET: '+t); addLog('ALARM: '+t);
  alarmTimer=setInterval(()=>{
    const n=new Date(), now=p2(n.getHours())+':'+p2(n.getMinutes());
    if(now===t){clearInterval(alarmTimer);el('alarm-st','⚡ TRIGGERED!');const m='Sir, your alarm is going off!';addMsg(m,'rudra');speakIt(m,'excited');addLog('ALARM TRIGGERED');}
  },15000);
};

// ── JOKE ─────────────────────────────────────────────────────
window.fetchJoke=async function(){
  try{const r=await fetch('https://v2.jokeapi.dev/joke/Programming,Misc?type=single&blacklistFlags=nsfw,racist');const d=await r.json();const j=d.joke||`${d.setup} — ${d.delivery}`;el('joke-text',j);respond(j);}
  catch{el('joke-text','Couldn\'t fetch a joke.');}
};

// ── QUICK BUTTONS ─────────────────────────────────────────────
window.qCmd=function(cmd){
  ({
    time:()=>respond('It\'s '+new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})+', sir.'),
    weather:()=>routeCmd('weather'),
    yt:()=>openURL('https://www.youtube.com','YouTube'),
    joke:()=>window.fetchJoke()
  })[cmd]?.();
};

// ── UTILS ─────────────────────────────────────────────────────
function el(id,val){const e=document.getElementById(id);if(e)e.textContent=val;}
function rnd(a,b){return Math.floor(a+Math.random()*(b-a));}
function p2(n){return String(n).padStart(2,'0');}
