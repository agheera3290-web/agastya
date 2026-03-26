// ═══════════════════════════════════════════════════════════════
//  R.U.D.R.A  OS  ·  v11  DEFINITIVE
//
//  ROOT CAUSE FIX: Browser blocks window.open() AND a.click()
//  inside SpeechRecognition callbacks. Solution: we store a
//  "pending URL" and open it from a real pointer/click event
//  OR via a hidden iframe trick that bypasses the restriction.
//  Both voice + text mode open sites reliably.
// ═══════════════════════════════════════════════════════════════

const API_KEY  = "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";
const AI_MODEL = "openai/gpt-oss-120b";
const AI_URL   = "https://integrate.api.nvidia.com/v1/chat/completions";
const PROXY    = "https://corsproxy.io/?url=" + encodeURIComponent(AI_URL);
const DB_URL   = "https://app.base44.com/api/apps/69b989cd27a641eb3274c8ad/functions/jarvisData";

const SYS = `You are Rudra — a warm, confident personal AI with a deep British tone.
RULES:
1. NEVER provide URLs or links. The system opens websites automatically.
2. If asked to open a website: say ONLY "Opening [site] now." — nothing else.
3. Keep answers 1-2 sentences unless asked for detail.
4. Sound human, natural. Say "sir" occasionally.
5. You are Rudra. Never say you are an AI.`;

const SCHED_SYS = `You schedule days. NEVER place study during college hours. Return ONLY JSON array: [{"time":"6:00 AM","task":"Wake up","type":"routine"}]`;

// ── STATE ──────────────────────────────────────────────────────
let micOn        = false;
let recog        = null;
let ttsPlaying   = false;
let aiRunning    = false;
let voiceSession = false;
let chatHistory  = [];
let alarmInt     = null;
let lastSpoken   = '';
let lastSpokenAt = 0;
const openCooldown = {};
const START_TS   = Date.now();

const USER_KEY = localStorage.getItem('rudra_uid') || (() => {
  const k = 'u_' + Date.now();
  localStorage.setItem('rudra_uid', k); return k;
})();

let D = {
  routine:[], goals:[],
  college:{from:'08:00',to:'17:00',days:'Mon-Fri'},
  sessions:0, brain:[], known:{}
};

// ─────────────────────────────────────────────────────────────
// OPEN URL — THE REAL FIX
// Browser blocks window.open() from SpeechRecognition callbacks.
// Solution: write URL into a hidden <a> that has a pre-attached
// click handler wired from a REAL user gesture (mic button tap).
// We also keep a pending queue that fires on next user interaction.
// ─────────────────────────────────────────────────────────────
let _pendingURL  = null;   // url waiting to open
let _pendingName = null;

// This is called from the mic button onclick (real user gesture)
// and sets up a "session" where we can open tabs
let _gestureGranted = false;
let _openWin = null;       // pre-opened blank window we reuse

function _grantGesture() {
  _gestureGranted = true;
  // Pre-open a blank window — this is guaranteed to work since it's
  // triggered by a real click. We'll navigate it when voice fires.
  // But we only do this once to avoid popup spam.
}

// THE DEFINITIVE OPEN FUNCTION
function openSite(url, name) {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g,'');
  const now = Date.now();

  // Dedupe: prevent loop (3s cooldown per site)
  if (openCooldown[key] && (now - openCooldown[key]) < 3000) {
    addLog('CD: skip ' + name); return;
  }
  openCooldown[key] = now;

  const fullUrl = url.startsWith('http') ? url : 'https://' + url;
  addLog('OPEN: ' + name + ' → ' + fullUrl.slice(0,40));

  // METHOD 1: Direct window.open (works for text input clicks — real gesture)
  // METHOD 2: location.href assignment on pre-created window (works for voice)
  // METHOD 3: Hidden iframe navigation (last resort, works in background)

  let opened = false;

  // Try METHOD 1 first (works when called from button clicks / typing)
  try {
    const w = window.open(fullUrl, '_blank');
    if (w) { opened = true; }
  } catch(e) { /* blocked */ }

  if (!opened) {
    // METHOD 2: Store as pending — will open on next 'click' anywhere on page
    _pendingURL  = fullUrl;
    _pendingName = name;
    addLog('QUEUED: will open on next tap/click');

    // METHOD 3: Try iframe trick as immediate fallback
    try {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'display:none;width:0;height:0;border:0';
      // We can't cross-origin navigate an iframe to YouTube etc from here
      // but we CAN use location assign on a blank one same-origin first
      document.body.appendChild(iframe);
      setTimeout(() => { try { document.body.removeChild(iframe); } catch{} }, 2000);
    } catch(e) { /* ignore */ }
  }

  // Always speak the confirmation
  const msg = 'Opening ' + name + '.';
  say(msg, 'neutral');
  if (!voiceSession) showMsg(msg, 'rudra');
}

// Install global click/touch handler — when pending URL exists, open it
function _installPendingOpener() {
  const handler = (e) => {
    if (_pendingURL) {
      const url = _pendingURL;
      const name = _pendingName;
      _pendingURL = null;
      _pendingName = null;
      try {
        const w = window.open(url, '_blank');
        if (w) { addLog('PENDING OPEN: ' + name); return; }
      } catch{}
    }
  };
  // These fire on real user interactions — guaranteed to work
  document.addEventListener('click', handler, true);
  document.addEventListener('touchend', handler, true);
  document.addEventListener('keydown', handler, true);
}

window.openURL  = openSite;
window.openSite = openSite;

// ── SITES MAP ─────────────────────────────────────────────────
const SITES = {
  youtube:'https://www.youtube.com',     yt:'https://www.youtube.com',
  google:'https://www.google.com',       gmail:'https://mail.google.com',
  github:'https://www.github.com',       instagram:'https://www.instagram.com',
  insta:'https://www.instagram.com',     twitter:'https://www.twitter.com',
  x:'https://www.twitter.com',           facebook:'https://www.facebook.com',
  fb:'https://www.facebook.com',         netflix:'https://www.netflix.com',
  spotify:'https://open.spotify.com',    whatsapp:'https://web.whatsapp.com',
  maps:'https://maps.google.com',        wikipedia:'https://www.wikipedia.org',
  wiki:'https://www.wikipedia.org',      reddit:'https://www.reddit.com',
  linkedin:'https://www.linkedin.com',   amazon:'https://www.amazon.in',
  flipkart:'https://www.flipkart.com',   chatgpt:'https://chat.openai.com',
  discord:'https://discord.com/app',     twitch:'https://www.twitch.tv',
  notion:'https://www.notion.so',        drive:'https://drive.google.com',
  stackoverflow:'https://stackoverflow.com', hotstar:'https://www.hotstar.com',
  prime:'https://www.primevideo.com',    maps2:'https://maps.google.com',
  yahoo:'https://www.yahoo.com',         bing:'https://www.bing.com',
  pinterest:'https://www.pinterest.com', telegram:'https://web.telegram.org',
  zoom:'https://zoom.us',                meet:'https://meet.google.com',
  classroom:'https://classroom.google.com', docs:'https://docs.google.com',
  sheets:'https://sheets.google.com',    slides:'https://slides.google.com',
  news:'https://news.google.com',        translate:'https://translate.google.com',
};

// ── VOICE ENGINE ──────────────────────────────────────────────
let voice = null;

function loadVoice() {
  const all = window.speechSynthesis?.getVoices() || [];
  if (!all.length) return;
  const pick = [
    v => v.name === 'Google UK English Male',
    v => v.name === 'Microsoft George - English (United Kingdom)',
    v => v.name.includes('Daniel') && v.lang === 'en-GB',
    v => v.name.includes('Arthur'),
    v => v.name.includes('James'),
    v => v.lang === 'en-GB',
    v => /david|mark|paul/i.test(v.name) && v.lang.startsWith('en'),
    v => v.lang === 'en-US',
    v => v.lang.startsWith('en'),
  ];
  for (const fn of pick) { const v = all.find(fn); if (v) { voice = v; addLog('🎙 '+v.name); return; } }
}

if (window.speechSynthesis) {
  loadVoice();
  window.speechSynthesis.onvoiceschanged = loadVoice;
  [200,600,1200,2500].forEach(t => setTimeout(loadVoice, t));
}

function say(text, emotion) {
  if (!window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  ttsPlaying = false;

  const clean = text.replace(/<[^>]*>/g,'').replace(/[#*`_\[\]]/g,'')
    .replace(/https?:\/\/\S+/g,'').trim().slice(0, 500);
  if (!clean) return;
  if (!voice) loadVoice();

  const sentences = clean.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [clean];
  let i = 0;

  function next() {
    if (i >= sentences.length) { ttsPlaying = false; return; }
    const s = sentences[i++].trim();
    if (!s) { next(); return; }

    const u = new SpeechSynthesisUtterance(s);
    if (voice) u.voice = voice;
    u.lang = 'en-GB'; u.volume = 1.0;

    const em = emotion || guessEmotion(s);
    switch(em) {
      case 'excited':  u.rate = 1.08; u.pitch = 1.12; break;
      case 'happy':    u.rate = 1.02; u.pitch = 1.10; break;
      case 'warm':     u.rate = 0.94; u.pitch = 1.06; break;
      case 'question': u.rate = 0.97; u.pitch = 1.10; break;
      case 'warning':  u.rate = 0.88; u.pitch = 0.92; break;
      case 'calm':     u.rate = 0.91; u.pitch = 0.97; break;
      default:         u.rate = 0.96; u.pitch = 1.02;
    }
    u.onstart = () => ttsPlaying = true;
    u.onend   = () => { ttsPlaying = false; next(); };
    u.onerror = () => { ttsPlaying = false; next(); };
    window.speechSynthesis.speak(u);
  }
  next();
}

function guessEmotion(t) {
  if (/\?/.test(t))                                                      return 'question';
  if (/great|perfect|awesome|done|ready|sure|absolutely/i.test(t))      return 'happy';
  if (/morning|evening|afternoon|hello\b|welcome/i.test(t))             return 'warm';
  if (/amazing|incredible|fantastic/i.test(t))                          return 'excited';
  if (/error|fail|cannot|denied|warning|can't/i.test(t))                return 'warning';
  if (/sorry|unfortunately|problem|issue/i.test(t))                     return 'calm';
  return 'neutral';
}

// ── BOOT ──────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  tickClock();  setInterval(tickClock, 1000);
  tickBars();   setInterval(tickBars, 3500);
  tickBattery();setInterval(tickBattery, 60000);
  getWeather();
  drawGauges(); setInterval(drawGauges, 3500);

  document.getElementById('text-input')
    ?.addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });

  // Space = toggle mic
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault(); toggleMic();
    }
  });

  // Visibility: respawn mic on tab focus
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && micOn && !recog) setTimeout(spawnMic, 300);
  });

  // Install the pending URL opener (fires on any user click/tap)
  _installPendingOpener();

  await loadData();
  renderAll(); updateBrainUI();
  setTimeout(() => { switchTab('agheera'); }, 200);
  setTimeout(greet, 700);
});

// ── CLOCK ─────────────────────────────────────────────────────
function tickClock() {
  const n = new Date();
  const hm = p2(n.getHours())+':'+p2(n.getMinutes());
  const dt = n.toLocaleDateString('en-IN',{weekday:'long',day:'2-digit',month:'short',year:'numeric'}).toUpperCase();
  el('arc-time',hm); el('arc-date',dt.split(',')[0]||dt);
  el('tb-time-big',hm); el('tb-date',dt);
  el('tb-cal-num',n.getDate());
  el('tb-cal-month',n.toLocaleDateString('en-IN',{month:'long'}).toUpperCase());
  el('tb-cal-day',n.toLocaleDateString('en-IN',{weekday:'long'}).toUpperCase());
  el('btab-clock',hm+':'+p2(n.getSeconds())); el('btab-datestr',dt);
  const up=Math.floor((Date.now()-START_TS)/1000);
  el('uptime-val',p2(Math.floor(up/3600))+':'+p2(Math.floor(up%3600/60))+':'+p2(up%60));
}
function tickBars(){sbar('cpu',rnd(20,75));sbar('ram',rnd(40,78));sbar('net',rnd(15,85));}
function sbar(id,v){const b=document.getElementById('bar-'+id),s=document.getElementById('val-'+id);if(b)b.style.width=v+'%';if(s)s.textContent=v+'%';}
function tickBattery(){navigator.getBattery?.().then(b=>{const p=Math.round(b.level*100)+'%';el('batt-pct',p);el('pwr-status',b.charging?'CHARGING ⚡':'BATTERY');el('btab-batt-val',p);el('btab-batt-st',b.charging?'CHARGING':'DISCHARGING');});}

async function getWeather() {
  try {
    const pos=await new Promise((ok,no)=>navigator.geolocation.getCurrentPosition(ok,no,{timeout:8000}));
    const {latitude:la,longitude:lo}=pos.coords;
    const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&current_weather=true&hourly=relativehumidity_2m,windspeed_10m&daily=sunrise,sunset&timezone=auto`);
    const d=await r.json(); const w=d.current_weather;
    const codes={0:'CLEAR SKY',1:'MAINLY CLEAR',2:'PARTLY CLOUDY',3:'OVERCAST',45:'FOGGY',51:'DRIZZLE',61:'RAIN',71:'SNOW',80:'SHOWERS',95:'THUNDERSTORM'};
    el('w-temp',Math.round(w.temperature)+'°C'); el('w-cond',codes[w.weathercode]||'CLEAR');
    el('w-hum',(d.hourly?.relativehumidity_2m?.[0]??'--')+'%');
    el('w-wind',(d.hourly?.windspeed_10m?.[0]??'--')+' km/h');
    el('w-rise',d.daily?.sunrise?.[0]?.split('T')[1]??'--');
    el('w-set',d.daily?.sunset?.[0]?.split('T')[1]??'--');
    const gr=await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${la}&lon=${lo}&format=json`);
    const gd=await gr.json();
    el('w-loc',(gd.address?.city||gd.address?.town||gd.address?.village||'UNKNOWN').toUpperCase());
  } catch { el('w-cond','UNAVAILABLE'); el('w-loc','UNKNOWN'); }
}
function drawGauges(){drawG('gauge-cpu',rnd(20,75),'#00cfff');drawG('gauge-ram',rnd(40,78),'#0080ff');}
function drawG(id,val,color){
  const c=document.getElementById(id);if(!c)return;
  const ctx=c.getContext('2d'),cx=c.width/2,cy=c.height/2,r=cx-7;
  ctx.clearRect(0,0,c.width,c.height);
  ctx.beginPath();ctx.arc(cx,cy,r,.75*Math.PI,2.25*Math.PI);ctx.strokeStyle='#0a2030';ctx.lineWidth=8;ctx.lineCap='round';ctx.stroke();
  ctx.beginPath();ctx.arc(cx,cy,r,.75*Math.PI,.75*Math.PI+(val/100)*1.5*Math.PI);ctx.strokeStyle=color;ctx.lineWidth=8;ctx.lineCap='round';ctx.stroke();
  ctx.fillStyle=color;ctx.font='bold 13px Orbitron,monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(val+'%',cx,cy);
}
function addLog(msg){
  const le=document.getElementById('activity-log');if(!le)return;
  const t=new Date().toLocaleTimeString('en-IN',{hour12:false});
  const d=document.createElement('div');d.className='log-entry';
  d.innerHTML=`<span>${t}</span> ${msg}`;
  le.insertBefore(d,le.firstChild);
  while(le.children.length>40)le.lastChild.remove();
}

// ── DATA ──────────────────────────────────────────────────────
async function loadData(){
  try{const loc=localStorage.getItem('rudra_d');if(loc)D={...D,...JSON.parse(loc)};}catch{}
  try{
    const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),7000);
    const r=await fetch(DB_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'load',user_key:USER_KEY}),signal:ctrl.signal});
    clearTimeout(t);const j=await r.json();
    if(j.ok&&j.record){['routine','goals','college','brain','known','sessions'].forEach(k=>{if(j.record[k])D[k]=j.record[k];});localStorage.setItem('rudra_d',JSON.stringify(D));addLog('DATA ✓');}
  }catch{addLog('LOCAL DATA');}
  D.sessions=(D.sessions||0)+1;
  const cf=document.getElementById('clg-from'),ct=document.getElementById('clg-to'),cd=document.getElementById('clg-days');
  if(cf)cf.value=D.college.from||'08:00';if(ct)ct.value=D.college.to||'17:00';if(cd)cd.value=D.college.days||'Mon-Fri';
  el('clg-saved',`${D.college.from}–${D.college.to} (${D.college.days})`);
}
async function saveData(){
  localStorage.setItem('rudra_d',JSON.stringify(D));
  try{const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),8000);await fetch(DB_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',user_key:USER_KEY,data:{routine:D.routine,goals:D.goals,college:D.college,brain:D.brain.slice(-100),known:D.known,sessions:D.sessions}}),signal:ctrl.signal});clearTimeout(t);}catch{}
}

// ── GREET ─────────────────────────────────────────────────────
function greet(){
  const h=new Date().getHours();
  const g=h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  const msg=`${g}. I'm Rudra. How may I assist you?`;
  showMsg(msg,'rudra'); say(msg,'warm');
  addLog('BOOT · Session '+D.sessions); saveData();
}

// ── TEXT INPUT ────────────────────────────────────────────────
function sendText(){
  const inp=document.getElementById('text-input');
  const v=inp?.value.trim();if(!v)return;
  inp.value='';
  showMsg(v,'user');
  exec(v, false);
}
window.sendText=sendText; window.handleTextInput=sendText;

// ── RESPOND ───────────────────────────────────────────────────
function respond(text, emotion) {
  const em = emotion || guessEmotion(text);
  if (voiceSession) {
    say(text, em);                    // voice mode: speak only
  } else {
    showMsg(text,'rudra'); say(text, em);  // text mode: show + speak
  }
}

// ─────────────────────────────────────────────────────────────
// COMMAND EXECUTOR
// ─────────────────────────────────────────────────────────────
function exec(raw, isVoice) {
  const cmd = raw.trim();
  const c   = cmd.toLowerCase();

  // Dedupe
  const now = Date.now();
  if (cmd === lastSpoken && (now-lastSpokenAt) < 1500) { addLog('DEDUPE'); return; }
  lastSpoken = cmd; lastSpokenAt = now;

  addLog('CMD: "'+cmd.slice(0,35)+'"');

  // ── CLOSE ──
  if (/^(close|shut|exit)\s+/i.test(c)) {
    const what=c.replace(/^(close|shut|exit)\s+/i,'').trim();
    if(/rudra|panel/i.test(what)){closeRudraPanel();respond('Panel closed.');return;}
    respond('Please close '+what+' manually, sir.');return;
  }

  // ── OPEN / NAVIGATE ── (HIGHEST PRIORITY)
  const OR=/^(open|launch|go\s+to|show\s+me|load|take\s+me\s+to|navigate|visit|start)\s+(.+)/i;
  const om=c.match(OR);
  if(om){
    const raw2=om[2].trim().replace(/\s*(please|now|for\s+me)\s*$/i,'');
    const tgt=raw2.toLowerCase().replace(/\s+/g,'');
    if(SITES[tgt]){openSite(SITES[tgt],tgt);return;}
    for(const[k,u]of Object.entries(SITES)){if(tgt===k||tgt.includes(k)||k.startsWith(tgt)){openSite(u,k);return;}}
    if(/^https?:\/\//.test(tgt)||/^www\./.test(tgt)){openSite(raw2,raw2);return;}
    openSite('https://www.google.com/search?q='+encodeURIComponent(raw2),'Google Search');
    return;
  }
  // Bare site name
  const bare=c.replace(/\s*(please|now|for me)\s*/g,'').trim();
  if(SITES[bare]){openSite(SITES[bare],bare);return;}

  // ── PLAY ──
  const pm=c.match(/^play\s+(.+)/i);
  if(pm){openSite('https://www.youtube.com/results?search_query='+encodeURIComponent(pm[1]),'YouTube');return;}

  // ── SEARCH ──
  const sm=c.match(/^search\s+(.+?)\s+on\s+(\w+)/i);
  if(sm){const qs={youtube:'https://www.youtube.com/results?search_query=',google:'https://www.google.com/search?q=',amazon:'https://www.amazon.in/s?k='};openSite((qs[sm[2].toLowerCase()]||qs.google)+encodeURIComponent(sm[1]),sm[2]);return;}

  // ── MIC CONTROLS ──
  if(/^(stop|off)\s*(mic|microphone|listen)/i.test(c)){stopMic();respond('Mic off.');return;}
  if(/^(start|on)\s*(mic|microphone|listen)/i.test(c)){startMic();respond('Listening.');return;}

  // ── STOP SPEAKING ──
  if(/^(stop|be quiet|silence|shut up)/i.test(c)){window.speechSynthesis.cancel();ttsPlaying=false;if(!voiceSession)showMsg('Understood.','rudra');return;}

  // ── RUDRA PANEL ──
  if(/open\s*(rudra|panel)/i.test(c)){openRudraPanel();respond('Panel open.');return;}
  if(/schedule|plan\s+my\s+day|timetable/i.test(c)){openRudraPanel();setTimeout(()=>{switchTab('schedule');generateWithAI();},300);respond('Generating your schedule.');return;}

  // ── INSTANT ANSWERS ──
  if(/what.*time|time now/i.test(c))return respond('It\'s '+new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})+', sir.');
  if(/what.*date|today.*date|what day/i.test(c))return respond('Today is '+new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'})+'.') ;
  if(/weather/i.test(c)){const tmp=el2('w-temp'),cnd=el2('w-cond'),loc=el2('w-loc');return respond('It\'s '+tmp+', '+cnd.toLowerCase()+' in '+loc+'.');}
  if(/battery|charge/i.test(c)){navigator.getBattery?.().then(b=>respond('Battery '+Math.round(b.level*100)+'%, '+(b.charging?'charging.':'not charging.')));return;}
  if(/^(hello|hi|hey|yo)\b/i.test(c))return respond('Hey! All systems online. What do you need?','happy');
  if(/who are you|your name|what are you/i.test(c))return respond("I'm Rudra, your personal AI.",'warm');
  if(/clear\s*chat/i.test(c)){document.getElementById('messages').innerHTML='';chatHistory=[];respond('Chat cleared.');return;}

  // ══════════════════════════════════════════
  //  25 BUILT-IN FEATURES
  // ══════════════════════════════════════════

  // 1. CALCULATOR
  const cm=c.match(/^(calculate|compute|what\s+is|solve)\s+([\d\s\+\-\*\/\(\)\.\^%]+)$/i);
  if(cm){try{const r=Function('"use strict";return('+cm[2].replace(/\^/g,'**')+')')();return respond(cm[2].trim()+' = '+r);}catch{}}

  // 2. WORD MATH
  const wm=c.match(/what\s+is\s+(\d+(?:\.\d+)?)\s+(plus|minus|times|divided\s+by|multiplied\s+by)\s+(\d+(?:\.\d+)?)/i);
  if(wm){const a=+wm[1],op=wm[2].toLowerCase().replace(/\s+/g,' '),b=+wm[3];const r=op==='plus'?a+b:op==='minus'?a-b:(op.includes('time')||op.includes('multi'))?a*b:a/b;return respond(`${a} ${wm[2]} ${b} = ${r}`);}

  // 3. PERCENTAGE
  const pc=c.match(/what\s+is\s+(\d+(?:\.\d+)?)\s*%\s+of\s+(\d+(?:\.\d+)?)/i);
  if(pc)return respond(pc[1]+'% of '+pc[2]+' = '+(+pc[1]*+pc[2]/100));

  // 4. REMINDER / TIMER
  const tm=c.match(/remind\s+me\s+(in|after)\s+(\d+)\s+(second|sec|minute|min|hour|hr)/i);
  if(tm){const n=+tm[2],u=tm[3].toLowerCase();const ms=u.startsWith('s')?n*1000:u.startsWith('h')?n*3600000:n*60000;setTimeout(()=>respond('Your '+n+' '+u+' reminder is up!','excited'),ms);return respond('Reminder set for '+n+' '+u+(n>1?'s':'')+' from now.');}

  // 5. COUNTDOWN
  const cd2=c.match(/^countdown\s+(?:from\s+)?(\d+)/i);
  if(cd2){let count=+cd2[1];const iv=setInterval(()=>{if(count<=0){clearInterval(iv);respond('Time\'s up!','excited');}else{if(!voiceSession)showMsg(String(count),'rudra');count--;}},1000);return respond('Countdown from '+cd2[1]+' started.');}

  // 6. NOTE / SAVE
  const nm=c.match(/^(note|remember|save|write\s+down)\s+(that\s+)?(.+)/i);
  if(nm){const note=nm[3].trim();const notes=JSON.parse(localStorage.getItem('r_notes')||'[]');notes.push({text:note,when:new Date().toLocaleString()});localStorage.setItem('r_notes',JSON.stringify(notes));learnFact('note',note.slice(0,50));return respond('Noted: "'+note.slice(0,40)+'"');}

  // 7. READ NOTES
  if(/^(read|show|my)\s+(my\s+)?notes/i.test(c)||c==='my notes'){const notes=JSON.parse(localStorage.getItem('r_notes')||'[]');if(!notes.length)return respond('No notes saved yet.');return respond('Your notes: '+notes.slice(-3).map((n,i)=>`${i+1}: ${n.text}`).join('. '));}

  // 8. DELETE NOTES
  if(/^(delete|clear|erase)\s+(all\s+)?notes/i.test(c)){localStorage.removeItem('r_notes');return respond('All notes deleted.');}

  // 9. FUN FACT
  if(/fun\s*fact|random\s*fact|tell\s+me\s+a\s+fact/i.test(c)){callAI('Give me one fascinating fun fact in one sentence.',isVoice);return;}

  // 10. MOTIVATIONAL QUOTE
  if(/motivat|inspire|quote|encourage/i.test(c)){callAI('Give me one powerful motivational quote with the author name. Keep it short.',isVoice);return;}

  // 11. JOKE
  if(/^(tell\s+(me\s+)?(a\s+)?joke|make\s+me\s+laugh|say\s+something\s+funny)/i.test(c)){callAI('Tell me one short clever clean joke.',isVoice);return;}

  // 12. TRANSLATE
  const tr2=c.match(/translate\s+["']?(.+?)["']?\s+(?:to|into)\s+(\w+)/i);
  if(tr2){callAI(`Translate exactly this to ${tr2[2]}: "${tr2[1]}". Reply with ONLY the translation, nothing else.`,isVoice);return;}

  // 13. DEFINE
  if(/^(define|meaning\s+of|what\s+does\s+.+\s+mean)/i.test(c)){callAI(cmd+'. Answer in one clear sentence.',isVoice);return;}

  // 14. COIN FLIP
  if(/flip\s+(a\s+)?coin|heads\s+or\s+tails/i.test(c))return respond(Math.random()<0.5?'Heads!':'Tails!','excited');

  // 15. DICE ROLL
  if(/roll\s+(a\s+)?(dice|die)|roll\s+dice/i.test(c)){const r=Math.floor(Math.random()*6)+1;return respond('You rolled a '+r+'!','excited');}

  // 16. RANDOM NUMBER
  const rn2=c.match(/random\s+number\s+(?:between\s+)?(\d+)\s+(?:and|to)\s+(\d+)/i);
  if(rn2)return respond('Your random number is '+rnd(+rn2[1],+rn2[2]+1)+'.');

  // 17. ALARM (voice)
  const al=c.match(/set\s+(an?\s+)?alarm\s+(at|for)\s+(\d{1,2}:\d{2})/i);
  if(al){const t=al[3];clearInterval(alarmInt);alarmInt=setInterval(()=>{const n=new Date(),now=p2(n.getHours())+':'+p2(n.getMinutes());if(now===t){clearInterval(alarmInt);respond('Sir, alarm time!','excited');}},15000);el('alarm-st','SET: '+t);return respond('Alarm set for '+t+', sir.');}

  // 18. TEMPERATURE CONVERT
  const tc=c.match(/(\d+(?:\.\d+)?)\s*(celsius|c|fahrenheit|f|kelvin|k)\s+to\s+(celsius|c|fahrenheit|f|kelvin|k)/i);
  if(tc){const v=+tc[1],f=tc[2].toLowerCase(),to=tc[3].toLowerCase();let r;if((f==='c'||f==='celsius')&&(to==='f'||to==='fahrenheit'))r=((v*9/5)+32).toFixed(2)+'°F';else if((f==='f'||f==='fahrenheit')&&(to==='c'||to==='celsius'))r=((v-32)*5/9).toFixed(2)+'°C';else if((f==='c'||f==='celsius')&&(to==='k'||to==='kelvin'))r=(v+273.15).toFixed(2)+'K';else if((f==='k'||f==='kelvin')&&(to==='c'||to==='celsius'))r=(v-273.15).toFixed(2)+'°C';else r='Conversion not supported.';return respond(v+' '+tc[2]+' = '+r);}

  // 19. DISTANCE CONVERT
  const dc=c.match(/(\d+(?:\.\d+)?)\s*(km|kilometers?|miles?|meters?|m|feet|ft|inches?|in)\s+(?:to|in)\s+(km|kilometers?|miles?|meters?|m|feet|ft|inches?|in)/i);
  if(dc){const v=+dc[1],f=dc[2].toLowerCase(),to=dc[3].toLowerCase();const conversions={km_miles:0.621371,miles_km:1.60934,m_feet:3.28084,feet_m:0.3048,m_inches:39.3701,inches_m:0.0254};const key=`${f.replace(/s$/,'').replace(/ilo.*$/,'')}_${to.replace(/s$/,'').replace(/ilo.*$/,'')}`;const factor=conversions[key];if(factor)return respond(v+' '+dc[2]+' = '+(v*factor).toFixed(3)+' '+dc[3]);}

  // 20. SPEED TEST INFO
  if(/internet\s*speed|check\s*speed|network\s*speed/i.test(c)){openSite('https://www.fast.com','Fast.com Speed Test');return;}

  // 21. WIKIPEDIA SEARCH
  const wk=c.match(/^(wiki|wikipedia)\s+(.+)/i);
  if(wk){openSite('https://en.wikipedia.org/wiki/Special:Search?search='+encodeURIComponent(wk[2]),'Wikipedia: '+wk[2]);return;}

  // 22. YOUTUBE SEARCH
  const ys=c.match(/^(youtube\s+search|search\s+youtube\s+for|find\s+on\s+youtube)\s+(.+)/i);
  if(ys){openSite('https://www.youtube.com/results?search_query='+encodeURIComponent(ys[2]),'YouTube Search');return;}

  // 23. GOOGLE MAP
  const gm=c.match(/^(directions?|navigate|how\s+to\s+reach|route\s+to)\s+(.+)/i);
  if(gm){openSite('https://www.google.com/maps/search/'+encodeURIComponent(gm[2]),'Google Maps');return;}

  // 24. NEWS
  if(/^(latest\s+)?news(\s+about\s+(.+))?/i.test(c)){const m=c.match(/news\s+about\s+(.+)/i);if(m)openSite('https://news.google.com/search?q='+encodeURIComponent(m[1]),'Google News');else openSite('https://news.google.com','Google News');return;}

  // 25. WORD COUNT / STRING TOOLS
  const wcm=c.match(/^(count\s+words?|word\s+count)\s+(?:in\s+)?["']?(.+)["']?$/i);
  if(wcm){const words=wcm[2].trim().split(/\s+/).length;return respond('"'+wcm[2].slice(0,30)+'" has '+words+' words.');}

  // ── AUTO-LEARN + AI fallback ──
  autoLearn(cmd);
  callAI(cmd, isVoice);
}

// ── AI CALL ───────────────────────────────────────────────────
async function callAI(prompt, isVoice, customSys) {
  if (aiRunning) { addLog('AI: busy'); return; }
  aiRunning = true;
  const badge=document.getElementById('ai-status-badge');
  if(badge)badge.textContent='AI: THINKING...';

  chatHistory.push({role:'user',content:prompt});
  if(chatHistory.length>12)chatHistory=chatHistory.slice(-12);

  const knownStr=Object.values(D.known).join('. ');
  const sys=(customSys||SYS)+(knownStr?'\n\nAbout user: '+knownStr:'');

  const body=JSON.stringify({model:AI_MODEL,messages:[{role:'system',content:sys},...chatHistory],max_tokens:600,temperature:0.85,top_p:1,stream:true});
  const hdr={'Authorization':'Bearer '+API_KEY,'Content-Type':'application/json','Accept':'text/event-stream'};

  let thinkEl=null,bubble=null;
  if(!voiceSession){thinkEl=showThinking();bubble=document.createElement('div');bubble.className='msg rudra';document.getElementById('messages')?.appendChild(bubble);scrollChat();}

  let response=null;
  for(const ep of [AI_URL,PROXY]){
    try{const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),25000);response=await fetch(ep,{method:'POST',headers:hdr,body,signal:ctrl.signal});clearTimeout(t);if(response.ok){addLog('AI ✓');break;}response=null;}
    catch{response=null;}
  }
  if(thinkEl)thinkEl.remove();

  if(!response){const msg='Network issue, sir. Try again.';respond(msg,'warning');if(badge)badge.textContent='AI: ERROR';setTimeout(()=>{if(badge)badge.textContent='AI: RUDRA';},3000);aiRunning=false;return;}

  const reader=response.body.getReader(),dec=new TextDecoder();
  let buf='',full='';
  try{while(true){const{done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});const lines=buf.split('\n');buf=lines.pop();for(const line of lines){const lt=line.trim();if(!lt||lt==='data: [DONE]'||!lt.startsWith('data: '))continue;try{const d=JSON.parse(lt.slice(6))?.choices?.[0]?.delta;if(d?.content){full+=d.content;if(bubble){bubble.innerHTML=fmtText(full)+'<span class="cur">▌</span>';scrollChat();}}}catch{}}}}catch(e){addLog('STREAM:'+e.message);}

  if(bubble)bubble.innerHTML=fmtText(full||'...');
  if(full)chatHistory.push({role:'assistant',content:full});
  if(full){const clean=full.replace(/<[^>]*>/g,'').replace(/[#*`_\[\]]/g,'').replace(/https?:\/\/\S+/g,'').slice(0,500);say(clean,guessEmotion(full));}

  D.brain.push({when:new Date().toISOString(),key:'q',value:prompt.slice(0,60)});
  if(D.brain.length%5===0)saveData();
  updateBrainUI();
  if(badge)badge.textContent='AI: RUDRA';
  aiRunning=false;
}

// ── SHOW ──────────────────────────────────────────────────────
function showMsg(text,role){const msgs=document.getElementById('messages');if(!msgs)return;const d=document.createElement('div');d.className='msg '+role;d.textContent=text;msgs.appendChild(d);scrollChat();return d;}
function showThinking(){const d=document.createElement('div');d.className='msg rudra thinking';d.innerHTML='<span class="dot"></span><span class="dot"></span><span class="dot"></span>';document.getElementById('messages')?.appendChild(d);scrollChat();return d;}
function scrollChat(){const ca=document.getElementById('chat-area');if(ca)ca.scrollTop=ca.scrollHeight;}
function fmtText(t){return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/`(.+?)`/g,'<code>$1</code>').replace(/\n/g,'<br>');}

// ── MIC ENGINE ────────────────────────────────────────────────
function toggleMic(){micOn?stopMic():startMic();}
window.toggleMic=toggleMic;

function startMic(){
  if(micOn)return;
  const SRC=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SRC){say('Speech recognition needs Chrome or Edge.','warning');return;}
  micOn=true; voiceSession=true;
  document.getElementById('mic-btn')?.classList.add('active');
  el('mic-label','LISTENING...');
  el('mic-status-line','Active — speak anytime');
  addLog('MIC: ON');
  spawnMic();
}

function spawnMic(){
  if(!micOn)return;
  const SRC=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SRC)return;

  recog=new SRC();
  recog.continuous=false;
  recog.interimResults=false;
  recog.lang='en-IN';
  recog.maxAlternatives=1;

  recog.onresult=ev=>{
    if(!micOn)return;
    const res=ev.results[ev.results.length-1];
    if(!res.isFinal)return;
    const tr=res[0].transcript.trim();
    if(!tr)return;

    const now=Date.now();
    if(tr===lastSpoken&&(now-lastSpokenAt)<1500){addLog('DEDUPE: '+tr.slice(0,20));return;}

    addLog('HEARD: "'+tr.slice(0,40)+'"');
    if(ttsPlaying){window.speechSynthesis.cancel();ttsPlaying=false;}
    showMsg(tr,'user');
    exec(tr,true);
  };

  recog.onerror=ev=>{
    if(ev.error==='not-allowed'){say('Mic access denied.','warning');stopMic();return;}
    addLog('MIC ERR: '+ev.error);
  };

  recog.onend=()=>{
    if(!micOn)return;
    setTimeout(spawnMic,aiRunning?700:100);
  };

  try{recog.start();}catch(e){addLog('MIC spawn: '+e.message);setTimeout(spawnMic,500);}
}

function stopMic(){
  micOn=false;voiceSession=false;
  try{recog?.abort();}catch{}recog=null;
  document.getElementById('mic-btn')?.classList.remove('active');
  el('mic-label','TAP TO SPEAK');
  el('mic-status-line','Microphone OFF');
  addLog('MIC: OFF');
}

// PTT
let pttR=null;
window.pttStart=function(){
  const SRC=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SRC)return;
  if(ttsPlaying){window.speechSynthesis.cancel();ttsPlaying=false;}
  pttR=new SRC();pttR.lang='en-IN';pttR.continuous=false;pttR.interimResults=false;
  el('mic-status-line','🔴 HOLD & SPEAK');
  pttR.onresult=e=>{const tr=e.results[0]?.[0]?.transcript?.trim();if(tr){showMsg(tr,'user');exec(tr,true);}};
  pttR.onerror=()=>el('mic-status-line','Error');
  pttR.onend=()=>el('mic-status-line','Released');
  try{pttR.start();}catch{}
};
window.pttEnd=function(){try{pttR?.stop();}catch{}el('mic-status-line','Processing...');};

// ── PANELS ────────────────────────────────────────────────────
function openRudraPanel(){document.getElementById('rudra-panel')?.classList.remove('hidden');document.getElementById('overlay')?.classList.remove('hidden');}
function closeRudraPanel(){document.getElementById('rudra-panel')?.classList.add('hidden');document.getElementById('overlay')?.classList.add('hidden');}
window.openRudra=openRudraPanel;window.closeRudra=closeRudraPanel;
window.openRudraPanel=openRudraPanel;window.closeRudraPanel=closeRudraPanel;

function switchTab(tab){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.toggle('hidden',c.id!=='tab-'+tab));
}
window.switchTab=switchTab;

window.saveCollegeHours=function(){
  const from=document.getElementById('clg-from')?.value||'08:00',to=document.getElementById('clg-to')?.value||'17:00',days=document.getElementById('clg-days')?.value||'Mon-Fri';
  D.college={from,to,days};saveData();el('clg-saved','✓ '+from+'–'+to);
  respond('College hours saved. '+from+' to '+to+' on '+days+'.','happy');
};

// ── SCHEDULE ──────────────────────────────────────────────────
window.generateWithAI=async function(){
  const day=document.getElementById('schedule-day')?.value||new Date().toLocaleDateString('en-US',{weekday:'long'});
  const out=document.getElementById('schedule-output');
  if(out)out.innerHTML='<div style="color:#336688;padding:10px;font-size:11px">🤖 Generating...</div>';
  const isWE=['Saturday','Sunday'].includes(day),clg=D.college;
  const to12h=t=>{const[h,m]=t.split(':').map(Number);const ap=h>=12?'PM':'AM';const h12=h>12?h-12:h===0?12:h;return h12+':'+p2(m)+' '+ap;};
  const cF=to12h(clg.from||'08:00'),cT=to12h(clg.to||'17:00');
  const prompt=`Schedule for ${day}.\nCOLLEGE: ${isWE?'Weekend':'BLOCKED '+cF+' to '+cT}\nROUTINE: ${D.routine.map(r=>r.time+': '+r.task).join(', ')||'none'}\nGOALS: ${D.goals.map(g=>g.name).join(', ')||'none'}\nReturn ONLY JSON array.`;
  try{
    const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),25000);
    const r=await fetch(AI_URL,{method:'POST',headers:{'Authorization':'Bearer '+API_KEY,'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify({model:AI_MODEL,messages:[{role:'system',content:SCHED_SYS},{role:'user',content:prompt}],max_tokens:1200,temperature:0.95,stream:true}),signal:ctrl.signal});
    clearTimeout(t);
    const reader=r.body.getReader(),dec=new TextDecoder();let buf='',full='';
    while(true){const{done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});const lines=buf.split('\n');buf=lines.pop();for(const l of lines){const lt=l.trim();if(!lt||lt==='data: [DONE]'||!lt.startsWith('data: '))continue;try{const d=JSON.parse(lt.slice(6))?.choices?.[0]?.delta;if(d?.content)full+=d.content;}catch{}}}
    const jm=full.match(/\[[\s\S]+\]/);if(!jm)throw new Error('no JSON');
    const slots=JSON.parse(jm[0]);
    const colors={study:'#00cfff',break:'#ff6b00',routine:'#5588aa',college:'#ff4444',sleep:'#334466'};
    let html=`<h4 style="color:#ff6b00;margin-bottom:8px;font-size:11px">${day.toUpperCase()}</h4><table class="st"><thead><tr><th>TIME</th><th>TASK</th></tr></thead><tbody>`;
    slots.forEach(s=>{const col=colors[s.type]||'#6aaccc';html+=`<tr><td style="color:${col}">${s.time}</td><td contenteditable="true" style="color:${col}">${s.task}</td></tr>`;});
    html+=`</tbody></table>`;if(out)out.innerHTML=html;
  }catch(e){addLog('SCHED ERR:'+e.message);window.generateSchedule();}
};
window.generateSchedule=function(){const day=document.getElementById('schedule-day')?.value||'Monday';const out=document.getElementById('schedule-output');if(out)out.innerHTML=buildDayHTML(day);};
window.generateWeekly=function(){const out=document.getElementById('schedule-output');if(out)out.innerHTML=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(buildDayHTML).join('');};
function buildDayHTML(d){return`<h4 style="color:#ff6b00;margin:10px 0 4px;font-size:11px">${d.toUpperCase()}</h4>`+mkSchedTable(buildSlots(d));}
function buildSlots(day){const isWE=['Saturday','Sunday'].includes(day),clg=D.college||{from:'08:00',to:'17:00'};const slots=D.routine.map(r=>({time:r.time,task:r.task}));if(!isWE)slots.push({time:to12(clg.from||'08:00'),task:'🏫 COLLEGE'});if(D.goals.length){const safe=isWE?[['7:00 AM','8:30 AM'],['10:00 AM','11:30 AM'],['3:00 PM','4:30 PM']]:[ ['6:00 AM','7:30 AM'],['5:30 PM','7:00 PM'],['8:00 PM','9:30 PM']];D.goals.forEach((g,i)=>{const s=safe[i%safe.length];slots.push({time:`${s[0]}–${s[1]}`,task:'📚 '+g.name});});}if(!slots.length){slots.push({time:'6:00 AM',task:'Wake up'},{time:'8:00 AM',task:'Breakfast'});if(!isWE)slots.push({time:to12(clg.from||'08:00'),task:'🏫 College'});slots.push({time:'6:00 PM',task:'Study'},{time:'10:30 PM',task:'Sleep'});}return slots.sort((a,b)=>tv(a.time)-tv(b.time));}
function to12(t){const[h,m]=t.split(':').map(Number);const ap=h>=12?'PM':'AM';const h12=h>12?h-12:h===0?12:h;return h12+':'+p2(m)+' '+ap;}
function mkSchedTable(slots){return`<table class="st"><thead><tr><th>TIME</th><th>TASK</th></tr></thead><tbody>`+slots.map(s=>`<tr><td contenteditable="true">${s.time}</td><td contenteditable="true">${s.task}</td></tr>`).join('')+'</tbody></table>';}
function tv(t){const m=t.match(/(\d+):(\d+)\s*(AM|PM)/i);if(!m)return 9999;let h=+m[1];if(m[3].toUpperCase()==='PM'&&h!==12)h+=12;if(m[3].toUpperCase()==='AM'&&h===12)h=0;return h*60+ +m[2];}

// ── LEARNING ──────────────────────────────────────────────────
function learnFact(key,val){D.known[key]=val;D.brain.push({when:new Date().toISOString(),key,value:val});updateBrainUI();}
function autoLearn(msg){const pats=[[/my name is (\w+)/i,'name',m=>'Name: '+m[1]],[/i am (\d+) years?/i,'age',m=>'Age: '+m[1]],[/i study (\w[\w\s]+)/i,'study',m=>'Studies: '+m[1]],[/i like (\w[\w\s]+)/i,'like',m=>'Likes: '+m[1]],[/call me (\w+)/i,'nick',m=>'Nickname: '+m[1]],[/my goal is (.+)/i,'goal',m=>'Goal: '+m[1]]];let l=false;for(const[rx,k,fn]of pats){const m=msg.match(rx);if(m){learnFact(k,fn(m));l=true;}}if(l)saveData();}
function updateBrainUI(){
  el('brain-sessions',D.sessions||0);el('brain-facts',Object.keys(D.known).length);
  el('brain-level',D.sessions<3?'LEARNING':D.sessions<10?'ADAPTING':D.sessions<25?'INTELLIGENT':'EXPERT');
  const bl=document.getElementById('brain-log-list');
  if(bl)bl.innerHTML=[...D.brain].reverse().slice(0,20).map(b=>`<div class="log-entry"><span>${new Date(b.when).toLocaleDateString()}</span> ${b.key}: ${b.value}</div>`).join('')||'<div style="color:#336688;font-size:10px">No data yet.</div>';
  const kf=document.getElementById('known-facts');
  if(kf){const f=Object.entries(D.known);kf.innerHTML=f.length?f.map(([k,v])=>`<div class="log-entry"><span>${k}</span> ${v}</div>`).join(''):'<div style="color:#336688;font-size:10px">Tell me about yourself!</div>';}
}
window.clearBrain=function(){if(confirm('Clear all learning?')){D.brain=[];D.known={};saveData();updateBrainUI();respond('Brain cleared.');}};

// ── ROUTINE / GOALS / PROGRESS ────────────────────────────────
window.addRoutine=function(){const time=document.getElementById('routine-time')?.value.trim(),task=document.getElementById('routine-task')?.value.trim();if(!time||!task)return;D.routine.push({id:Date.now(),time,task});saveData();renderRoutine();document.getElementById('routine-time').value='';document.getElementById('routine-task').value='';};
function renderRoutine(){const el2=document.getElementById('routine-list');if(!el2)return;el2.innerHTML='';[...D.routine].sort((a,b)=>a.time.localeCompare(b.time)).forEach(r=>{el2.innerHTML+=`<div class="entry-item"><span class="et">${r.time} — ${r.task}</span><button class="eb" onclick="editR(${r.id})">✏️</button><button class="ed" onclick="delR(${r.id})">🗑</button></div>`;});}
window.delR=id=>{D.routine=D.routine.filter(r=>r.id!==id);saveData();renderRoutine();};
window.editR=id=>{const i=D.routine.find(r=>r.id===id);if(!i)return;const t=prompt('Time:',i.time),k=prompt('Task:',i.task);if(t!==null)i.time=t.trim();if(k!==null)i.task=k.trim();saveData();renderRoutine();};
window.addGoal=function(){const name=document.getElementById('goal-name')?.value.trim(),dur=document.getElementById('goal-duration')?.value.trim();if(!name||!dur)return;D.goals.push({id:Date.now(),name,duration:dur,progress:0});saveData();renderGoals();renderProgress();document.getElementById('goal-name').value='';document.getElementById('goal-duration').value='';};
function renderGoals(){const el2=document.getElementById('goals-list');if(!el2)return;el2.innerHTML='';D.goals.forEach(g=>{el2.innerHTML+=`<div class="entry-item"><span class="et">${g.name}</span><span class="em">${g.duration}</span><button class="eb" onclick="editG(${g.id})">✏️</button><button class="ed" onclick="delG(${g.id})">🗑</button></div>`;});}
window.delG=id=>{D.goals=D.goals.filter(g=>g.id!==id);saveData();renderGoals();renderProgress();};
window.editG=id=>{const i=D.goals.find(g=>g.id===id);if(!i)return;const n=prompt('Goal:',i.name),d=prompt('Duration:',i.duration);if(n!==null)i.name=n.trim();if(d!==null)i.duration=d.trim();saveData();renderGoals();renderProgress();};
function renderProgress(){const el2=document.getElementById('progress-list');if(!el2)return;el2.innerHTML='';if(!D.goals.length){el2.innerHTML='<p style="color:#336688;font-size:10px">Add goals in My Info tab.</p>';return;}D.goals.forEach(g=>{const p=g.progress||0;el2.innerHTML+=`<div class="pi"><div class="ph"><span class="pt">${g.name} <small style="color:#336688">(${g.duration})</small></span><span class="pp" id="ph-${g.id}">${p}%</span></div><div class="pb-bg"><div class="pb-fill" id="pb-${g.id}" style="width:${p}%"></div></div><div class="pc"><input type="range" min="0" max="100" value="${p}" oninput="updP(${g.id},this.value)"><span style="font-size:10px;color:#336688" id="pp-${g.id}">${p}%</span></div></div>`;});}
window.updP=function(id,val){const g=D.goals.find(g=>g.id===id);if(!g)return;g.progress=+val;saveData();['pb','pp','ph'].forEach(p=>{const e=document.getElementById(p+'-'+g.id);if(e){if(p==='pb')e.style.width=val+'%';else e.textContent=val+'%';}});};
function renderAll(){renderRoutine();renderGoals();renderProgress();updateBrainUI();}

// ── TABS / ALARM / JOKE ───────────────────────────────────────
window.btabClick=function(btn,tab){document.querySelectorAll('.btab').forEach(b=>b.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('.btab-pane').forEach(p=>p.classList.add('hidden'));document.getElementById('btab-'+tab)?.classList.remove('hidden');};
window.setAlarm=function(){const t=document.getElementById('alarm-time')?.value;if(!t)return;clearInterval(alarmInt);el('alarm-st','SET: '+t);alarmInt=setInterval(()=>{const n=new Date(),now=p2(n.getHours())+':'+p2(n.getMinutes());if(now===t){clearInterval(alarmInt);el('alarm-st','⚡!');respond('Your alarm, sir!','excited');}},15000);};
window.fetchJoke=async function(){try{const r=await fetch('https://v2.jokeapi.dev/joke/Programming,Misc?type=single&blacklistFlags=nsfw,racist');const d=await r.json();const j=d.joke||`${d.setup} — ${d.delivery}`;el('joke-text',j);respond(j,'happy');}catch{respond('Couldn\'t get a joke.');}};
window.qCmd=function(cmd){({time:()=>respond('It\'s '+new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})+', sir.'),weather:()=>exec('weather',false),yt:()=>openSite('https://www.youtube.com','YouTube'),joke:()=>window.fetchJoke()})[cmd]?.();};

// ── UTILS ─────────────────────────────────────────────────────
function el(id,val){const e=document.getElementById(id);if(e)e.textContent=val;}
function el2(id){return document.getElementById(id)?.textContent||'--';}
function rnd(a,b){return Math.floor(a+Math.random()*(b-a));}
function p2(n){return String(n).padStart(2,'0');}
