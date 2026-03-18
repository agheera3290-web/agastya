// ═══════════════════════════════════════════════════════════════
//  J.A.R.V.I.S + RUDRA  ·  v6 FINAL
//  Model: openai/gpt-oss-120b via NVIDIA
//  FIXED: No AbortSignal.timeout (Brave compat), direct CORS call
// ═══════════════════════════════════════════════════════════════

const JARVIS_KEY = "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";
const RUDRA_KEY  = "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";
const AI_MODEL   = "openai/gpt-oss-120b";
const AI_URL     = "https://integrate.api.nvidia.com/v1/chat/completions";
// CORS proxy only as fallback (direct call has access-control-allow-origin: *)
const PROXY      = "https://corsproxy.io/?url=" + encodeURIComponent(AI_URL);
const BASE44_FN  = "https://app.base44.com/api/apps/69b989cd27a641eb3274c8ad/functions/jarvisData";

const JARVIS_PROMPT = `You are J.A.R.V.I.S — Just A Rather Very Intelligent System. You are a warm, brilliant, slightly British AI assistant. Be concise, emotionally aware, helpful and witty. Never robotic. Say "sir" naturally sometimes.`;
const RUDRA_PROMPT  = `You are Rudra — the strategic planning mind of Jarvis. Specialize in schedules, goals, productivity. Be sharp, structured, actionable.`;

// ── STATE ────────────────────────────────────────────────────
let micActive    = false;
let recognition  = null;
let isSpeaking   = false;
let isProcessing = false;
let voiceMode    = false;
let chatHistory  = [];
let alarmTimer   = null;
let currentAI    = 'jarvis';
const T0         = Date.now();

let USER_KEY = localStorage.getItem('jrv_uid') || (() => {
  const k = 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  localStorage.setItem('jrv_uid', k); return k;
})();

let rudraData = { routine: [], goals: [] };

// ── VOICE SETUP ──────────────────────────────────────────────
let voices = [], selVoice = null;

function pickVoice() {
  voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;

  // Best male British / deep voice order
  const tests = [
    v => v.name === 'Google UK English Male',
    v => v.name.includes('Daniel') && v.lang === 'en-GB',
    v => v.name.includes('Arthur'),
    v => v.name.includes('James'),
    v => v.lang === 'en-GB',
    v => v.name.toLowerCase().includes('male') && v.lang.startsWith('en'),
    v => /david|mark/i.test(v.name) && v.lang.startsWith('en'),
    v => v.lang.startsWith('en')
  ];
  for (const t of tests) {
    const v = voices.find(t);
    if (v) { selVoice = v; console.log('Voice:', v.name); break; }
  }
}

if (window.speechSynthesis) {
  pickVoice();
  window.speechSynthesis.onvoiceschanged = pickVoice;
  // Force load voices (Brave sometimes needs this)
  setTimeout(pickVoice, 500);
  setTimeout(pickVoice, 1500);
}

// ── BOOT ─────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  tickClock(); setInterval(tickClock, 1000);
  tickBars();  setInterval(tickBars, 2500);
  tickBattery();
  getWeather();
  tickGauges(); setInterval(tickGauges, 3000);

  document.getElementById('text-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendText();
  });

  await loadData();
  renderAll();
  setTimeout(greet, 900);
});

// ── CLOCK ─────────────────────────────────────────────────────
function tickClock() {
  const n  = new Date();
  const hm = p2(n.getHours()) + ':' + p2(n.getMinutes());
  const sc = hm + ':' + p2(n.getSeconds());
  const dt = n.toLocaleDateString('en-IN', {weekday:'long',day:'2-digit',month:'short',year:'numeric'}).toUpperCase();

  el('arc-time',      hm);
  el('arc-date',      dt.split(',')[0] || dt);
  el('tb-time-big',   hm);
  el('tb-date',       dt);
  el('tb-cal-num',    n.getDate());
  el('tb-cal-month',  n.toLocaleDateString('en-IN',{month:'long'}).toUpperCase());
  el('tb-cal-day',    n.toLocaleDateString('en-IN',{weekday:'long'}).toUpperCase());
  el('btab-clock',    sc);
  el('btab-datestr',  dt);

  const up = Math.floor((Date.now()-T0)/1000);
  el('uptime-val', p2(Math.floor(up/3600))+':'+p2(Math.floor(up%3600/60))+':'+p2(up%60));
}

// ── BARS ─────────────────────────────────────────────────────
function tickBars() {
  setBar('cpu', rnd(20,75));
  setBar('ram', rnd(40,78));
  setBar('net', rnd(15,85));
}
function setBar(id, v) {
  const b = document.getElementById('bar-'+id);
  const s = document.getElementById('val-'+id);
  if (b) b.style.width = v+'%';
  if (s) s.textContent  = v+'%';
}

// ── BATTERY ──────────────────────────────────────────────────
function tickBattery() {
  if (!navigator.getBattery) return;
  navigator.getBattery().then(b => {
    const p = Math.round(b.level*100)+'%';
    el('batt-pct',    p);
    el('pwr-status',  b.charging ? 'CHARGING ⚡' : 'BATTERY');
    el('btab-batt-val', p);
    el('btab-batt-st',  b.charging ? 'CHARGING ⚡' : 'DISCHARGING');
  });
}

// ── WEATHER ──────────────────────────────────────────────────
async function getWeather() {
  try {
    const pos = await new Promise((ok,no) =>
      navigator.geolocation.getCurrentPosition(ok, no, {timeout:8000}));
    const {latitude:la, longitude:lo} = pos.coords;
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&current_weather=true&hourly=relativehumidity_2m,windspeed_10m&daily=sunrise,sunset&timezone=auto`);
    const d = await r.json(); const w = d.current_weather;
    const codes = {0:'CLEAR SKY',1:'MAINLY CLEAR',2:'PARTLY CLOUDY',3:'OVERCAST',45:'FOGGY',48:'FOGGY',51:'DRIZZLE',61:'RAIN',71:'SNOW',80:'SHOWERS',95:'THUNDERSTORM'};
    el('w-temp', Math.round(w.temperature)+'°C');
    el('w-cond', codes[w.weathercode]||'CLEAR');
    el('w-hum',  (d.hourly?.relativehumidity_2m?.[0]??'--')+'%');
    el('w-wind', (d.hourly?.windspeed_10m?.[0]??'--')+' km/h');
    el('w-rise', d.daily?.sunrise?.[0]?.split('T')[1]??'--');
    el('w-set',  d.daily?.sunset?.[0]?.split('T')[1]??'--');
    const gr = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${la}&lon=${lo}&format=json`);
    const gd = await gr.json();
    el('w-loc', (gd.address?.city||gd.address?.town||gd.address?.village||'UNKNOWN').toUpperCase());
    addLog('WEATHER: '+Math.round(w.temperature)+'°C');
  } catch { el('w-cond','UNAVAILABLE'); el('w-loc','UNKNOWN'); }
}

// ── GAUGES ───────────────────────────────────────────────────
function tickGauges() {
  drawGauge('gauge-cpu', rnd(20,75), '#00cfff');
  drawGauge('gauge-ram', rnd(40,78), '#0080ff');
}
function drawGauge(id, val, color) {
  const c = document.getElementById(id); if (!c) return;
  const ctx = c.getContext('2d'), cx=c.width/2, cy=c.height/2, r=cx-7;
  ctx.clearRect(0,0,c.width,c.height);
  ctx.beginPath(); ctx.arc(cx,cy,r,.75*Math.PI,2.25*Math.PI);
  ctx.strokeStyle='#0a2030'; ctx.lineWidth=8; ctx.lineCap='round'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,r,.75*Math.PI,.75*Math.PI+(val/100)*1.5*Math.PI);
  ctx.strokeStyle=color; ctx.lineWidth=8; ctx.lineCap='round'; ctx.stroke();
  ctx.fillStyle=color; ctx.font='bold 13px Orbitron,monospace';
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(val+'%',cx,cy);
}

// ── LOG ──────────────────────────────────────────────────────
function addLog(msg) {
  const el = document.getElementById('activity-log'); if (!el) return;
  const t = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const d = document.createElement('div'); d.className = 'log-entry';
  d.innerHTML = `<span>${t}</span> ${msg}`;
  el.insertBefore(d, el.firstChild);
  while (el.children.length > 30) el.lastChild.remove();
}

// ── DATA ─────────────────────────────────────────────────────
async function loadData() {
  try {
    const loc = localStorage.getItem('jrv_data');
    if (loc) rudraData = {...rudraData, ...JSON.parse(loc)};
  } catch {}
  try {
    const r = await fetchWithTimeout(BASE44_FN, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({action:'load', user_key: USER_KEY})
    }, 6000);
    const j = await r.json();
    if (j.ok && j.record) {
      rudraData.routine = j.record.routine || rudraData.routine;
      rudraData.goals   = j.record.goals   || rudraData.goals;
      localStorage.setItem('jrv_data', JSON.stringify(rudraData));
      addLog('DATA: Cloud loaded ✓');
    }
  } catch { addLog('DATA: Local only'); }
}

async function saveData() {
  localStorage.setItem('jrv_data', JSON.stringify(rudraData));
  try {
    await fetchWithTimeout(BASE44_FN, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({action:'save', user_key: USER_KEY, data: rudraData})
    }, 6000);
    addLog('DATA: Saved ✓');
  } catch { addLog('DATA: Local save only'); }
}

// ── FETCH WITH TIMEOUT (Brave-compatible) ────────────────────
// Does NOT use AbortSignal.timeout() — uses setTimeout + AbortController
function fetchWithTimeout(url, opts, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

// ── GREETING ─────────────────────────────────────────────────
function greet() {
  const h = new Date().getHours();
  const g = h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  const msg = g+". I'm Jarvis. How may I assist you?";
  addMsg(msg, 'jarvis');
  speakIt(msg, 'warm');
  addLog('BOOT COMPLETE');
}

// ── TEXT SEND ────────────────────────────────────────────────
function sendText() {
  const v = document.getElementById('text-input').value.trim();
  if (!v) return;
  voiceMode = false;
  addMsg(v, 'user');
  document.getElementById('text-input').value = '';
  route(v);
}
window.handleTextInput = sendText;

// ── ROUTER ───────────────────────────────────────────────────
function route(cmd) {
  const c = cmd.toLowerCase().trim();
  addLog('CMD: ' + cmd.slice(0,35));

  // Switch AI
  if (/switch.*rudra|rudra.*mode|use rudra/i.test(c)) { currentAI='rudra'; return respond("Rudra AI online. I'll handle planning."); }
  if (/switch.*jarvis|jarvis.*mode|use jarvis/i.test(c)) { currentAI='jarvis'; return respond("Jarvis AI back online."); }

  // Rudra panel
  if (/rudra|schedule|timetable|plan my|weekly plan/i.test(c)) {
    openRudra();
    const dm = c.match(/plan\s+(?:my\s+)?(\w+)/i);
    if (dm) { setTimeout(()=>{ switchTab('schedule'); setSched(cap(dm[1])); }, 350); }
    else if (/schedule|timetable/i.test(c)) { setTimeout(()=>switchTab('schedule'), 350); }
    return respond(dm ? `Opening Rudra and generating your ${cap(dm[1])} schedule.` : "Rudra panel open.");
  }

  // Sites
  const sites = {
    youtube:'https://www.youtube.com', google:'https://www.google.com',
    github:'https://www.github.com', instagram:'https://www.instagram.com',
    twitter:'https://www.twitter.com', x:'https://www.twitter.com',
    facebook:'https://www.facebook.com', netflix:'https://www.netflix.com',
    spotify:'https://open.spotify.com', gmail:'https://mail.google.com',
    maps:'https://maps.google.com', wikipedia:'https://www.wikipedia.org',
    whatsapp:'https://web.whatsapp.com', reddit:'https://www.reddit.com',
    linkedin:'https://www.linkedin.com', amazon:'https://www.amazon.in',
    flipkart:'https://www.flipkart.com', chatgpt:'https://chat.openai.com',
    discord:'https://discord.com/app', twitch:'https://www.twitch.tv'
  };
  for (const [k,url] of Object.entries(sites)) {
    if (c.includes(k)) { openURL(url, k); return; }
  }

  // open <url>
  const um = c.match(/open\s+(https?:\/\/\S+|www\.\S+)/i);
  if (um) { openURL(um[1].startsWith('http')?um[1]:'https://'+um[1], um[1]); return; }

  // search <q> on <site>
  const sm = c.match(/search\s+(.+?)\s+(?:on|in)\s+(\w+)/i);
  if (sm) {
    const [,q,s] = sm;
    const eu = {youtube:`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,google:`https://www.google.com/search?q=${encodeURIComponent(q)}`};
    openURL(eu[s.toLowerCase()]||`https://www.google.com/search?q=${encodeURIComponent(q)}`, s+': '+q);
    return;
  }

  // play <song>
  const pm = c.match(/^play\s+(.+)/i);
  if (pm) { openURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(pm[1])}`,'YouTube'); respond(`Searching for "${pm[1]}".`); return; }

  // Desktop apps — explain clearly
  if (/\b(brave|chrome|firefox|edge|safari|opera|vlc|notepad|terminal)\b/i.test(c)) {
    const app = c.match(/\b(brave|chrome|firefox|edge|safari|opera|vlc|notepad|terminal)\b/i)?.[1];
    return respond(`I can't open desktop apps like ${app} from a web page — that's a browser security rule. I can open any website for you though. Just say "open YouTube" or "search something on Google".`);
  }

  // Quick answers
  if (/what.*time|current time|time now/i.test(c)) {
    return respond(`It's ${new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}, sir.`);
  }
  if (/what.*date|today|what day/i.test(c)) {
    return respond(`Today is ${new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}.`);
  }
  if (/weather/i.test(c)) {
    const tmp=document.getElementById('w-temp').textContent;
    const cnd=document.getElementById('w-cond').textContent;
    const loc=document.getElementById('w-loc').textContent;
    return respond(`It's ${tmp} and ${cnd.toLowerCase()} in ${loc}.`);
  }
  if (/battery/i.test(c)) {
    navigator.getBattery?.().then(b=>respond(`Battery at ${Math.round(b.level*100)}%, ${b.charging?'charging':'not charging'}.`));
    return;
  }
  if (/stop mic|mic off|stop listen/i.test(c)) { stopMic(); return respond("Microphone off."); }
  if (/clear chat|clear screen|reset chat/i.test(c)) { document.getElementById('messages').innerHTML=''; chatHistory=[]; return respond("Chat cleared."); }
  if (/^(hello|hi|hey)\b/i.test(c)) return respond("Hello sir. Systems operational. What do you need?");
  if (/who are you|what are you/i.test(c)) return respond("I'm Jarvis — your personal AI assistant. Rudra module also online for planning.");

  // → AI
  askAI(cmd);
}

// ── OPEN URL ─────────────────────────────────────────────────
function openURL(url, label) {
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 200);
  respond('Opening ' + label + ' for you.');
  addLog('OPEN: ' + label);
}
window.openSite = openURL;

// ── AI CALL ──────────────────────────────────────────────────
async function askAI(msg) {
  if (isProcessing) { addLog('AI: Blocked (busy)'); return; }
  isProcessing = true;

  // Pause mic while AI responds
  if (recognition && micActive) try { recognition.abort(); } catch {}

  const key    = currentAI === 'rudra' ? RUDRA_KEY : JARVIS_KEY;
  const prompt = currentAI === 'rudra' ? RUDRA_PROMPT : JARVIS_PROMPT;
  const badge  = document.getElementById('ai-status-badge');

  chatHistory.push({role:'user', content:msg});
  if (chatHistory.length > 12) chatHistory = chatHistory.slice(-12);

  const thinkEl = showThinking();
  if (badge) badge.textContent = 'AI: THINKING...';

  // Create reply bubble
  const bubble = document.createElement('div');
  bubble.className = 'msg jarvis';
  document.getElementById('messages').appendChild(bubble);
  scrollChat();

  const payload = JSON.stringify({
    model:       AI_MODEL,
    messages:    [{role:'system',content:prompt}, ...chatHistory],
    max_tokens:  1024,
    temperature: 0.85,
    top_p:       1,
    stream:      true
  });
  const hdrs = {
    'Authorization': 'Bearer ' + key,
    'Content-Type':  'application/json',
    'Accept':        'text/event-stream'
  };

  let response = null;
  let errMsg   = '';

  // Try direct first (CORS is allowed), then proxy fallback
  const endpoints = [AI_URL, PROXY];
  for (const ep of endpoints) {
    try {
      addLog('AI: Trying ' + (ep === AI_URL ? 'direct' : 'proxy') + '...');
      // Use manual AbortController (NOT AbortSignal.timeout — not in Brave)
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      response = await fetch(ep, {method:'POST', headers:hdrs, body:payload, signal:ctrl.signal});
      clearTimeout(timer);
      if (response.ok) { addLog('AI: Connected ✓'); break; }
      errMsg = 'HTTP ' + response.status;
      response = null;
    } catch(e) {
      errMsg = e.name === 'AbortError' ? 'Timeout' : e.message;
      addLog('AI: ' + errMsg.slice(0,40));
      response = null;
    }
  }

  thinkEl.remove();

  if (!response) {
    const em = `I couldn't connect to my neural network (${errMsg}). Please check your internet connection and try again.`;
    bubble.innerHTML = em;
    if (voiceMode) speakIt(em, 'calm');
    if (badge) badge.textContent = 'AI: ERROR';
    setTimeout(() => { if (badge) badge.textContent = currentAI==='rudra'?'AI: RUDRA':'AI: JARVIS'; }, 3000);
    isProcessing = false;
    resumeMic();
    return;
  }

  // Stream the response
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buf  = '';
  let full = '';

  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buf += decoder.decode(value, {stream:true});
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        const t = line.trim();
        if (!t || t === 'data: [DONE]' || !t.startsWith('data: ')) continue;
        try {
          const j = JSON.parse(t.slice(6));
          const d = j.choices?.[0]?.delta;
          if (!d) continue;
          // Collect reasoning (hidden, not shown)
          const rc = d.reasoning_content || d.reasoning;
          // Collect actual content
          if (d.content) {
            full += d.content;
            bubble.innerHTML = fmtText(full) + '<span class="cur">▌</span>';
            scrollChat();
          }
        } catch {}
      }
    }
  } catch(e) { addLog('AI stream err: ' + e.message); }

  // Finalize
  bubble.innerHTML = fmtText(full || '...');
  if (full) chatHistory.push({role:'assistant', content:full});
  addLog('AI: ' + full.length + 'ch reply');

  // Speak in voice mode
  if (voiceMode && full) speakIt(full.replace(/<[^>]*>/g,'').slice(0,600), detectEm(full));

  if (badge) badge.textContent = currentAI==='rudra'?'AI: RUDRA':'AI: JARVIS';
  isProcessing = false;
  resumeMic();
}

// ── RESPOND ──────────────────────────────────────────────────
function respond(txt, em='neutral') {
  addMsg(txt, 'jarvis');
  if (voiceMode) speakIt(txt, em);
  addLog('JRV: ' + txt.slice(0,35));
}

function addMsg(txt, role) {
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  d.textContent = txt;
  document.getElementById('messages').appendChild(d);
  scrollChat();
  return d;
}

function scrollChat() {
  const ca = document.getElementById('chat-area');
  if (ca) ca.scrollTop = ca.scrollHeight;
}

// ── THINKING DOTS ────────────────────────────────────────────
function showThinking() {
  const d = document.createElement('div');
  d.className = 'msg jarvis thinking';
  d.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  document.getElementById('messages').appendChild(d);
  scrollChat();
  return d;
}

// ── TEXT FORMAT ──────────────────────────────────────────────
function fmtText(t) {
  return t
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/`(.+?)`/g,'<code>$1</code>')
    .replace(/\n/g,'<br>');
}

// ── SPEAK ─────────────────────────────────────────────────────
// Sentence-by-sentence, deep male voice, natural emotion
function speakIt(text, emotion='neutral') {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  isSpeaking = false;

  const clean = text.replace(/<[^>]*>/g,'').replace(/[#*`_]/g,'').trim().slice(0,600);
  if (!clean) return;

  // Force voice reload if not picked yet
  if (!selVoice) pickVoice();

  const sentences = clean.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [clean];
  let i = 0;

  function next() {
    if (i >= sentences.length) {
      isSpeaking = false;
      resumeMic();
      return;
    }
    const s = sentences[i++].trim();
    if (!s) { next(); return; }

    const u = new SpeechSynthesisUtterance(s);

    // Apply voice — retry if not loaded yet
    if (selVoice) u.voice = selVoice;
    u.lang   = 'en-GB';
    u.volume = 1;

    // Emotion-based speech parameters
    const e = detectEm(s);
    if      (e==='excited')  { u.rate=1.02; u.pitch=0.92; }
    else if (e==='warning')  { u.rate=0.85; u.pitch=0.78; }
    else if (e==='warm')     { u.rate=0.90; u.pitch=0.90; }
    else if (e==='question') { u.rate=0.93; u.pitch=0.93; }
    else if (e==='calm')     { u.rate=0.87; u.pitch=0.83; }
    else                     { u.rate=0.91; u.pitch=0.86; }

    u.onstart = () => {
      isSpeaking = true;
      if (recognition && micActive) try { recognition.abort(); } catch {}
    };
    u.onend   = next;
    u.onerror = () => { isSpeaking = false; next(); };

    window.speechSynthesis.speak(u);
  }
  next();
}

function detectEm(t) {
  if (/\?/.test(t))                                                              return 'question';
  if (/error|fail|cannot|denied|blocked|warning|alert/i.test(t))                return 'warning';
  if (/great|perfect|done|ready|online|excellent|wonderful|awesome/i.test(t))   return 'excited';
  if (/morning|evening|afternoon|hello|assist|welcome|good\s/i.test(t))         return 'warm';
  if (/sorry|trouble|unfortunately|couldn't|can't|issue|problem/i.test(t))      return 'calm';
  return 'neutral';
}

// ── MIC ───────────────────────────────────────────────────────
function toggleMic() { micActive ? stopMic() : startMic(); }
window.toggleMic = toggleMic;

function startMic() {
  const SRC = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SRC) { addMsg("Speech recognition needs Chrome or Edge browser.", 'jarvis'); return; }

  recognition = new SRC();
  recognition.continuous     = false;   // one shot → manual restart = no feedback loop
  recognition.interimResults = false;
  recognition.lang           = 'en-IN';

  recognition.onstart = () => {
    micActive = true; voiceMode = true;
    document.getElementById('mic-btn')?.classList.add('active');
    el('mic-label',       'LISTENING...');
    el('mic-status-line', 'Click to stop');
    addLog('MIC: Active');
  };

  recognition.onresult = e => {
    if (!micActive) return;
    const tr = e.results[0]?.[0]?.transcript?.trim();
    if (!tr) return;
    addLog('HEARD: "' + tr.slice(0,35) + '"');
    if (isSpeaking) { window.speechSynthesis.cancel(); isSpeaking=false; }
    if (isProcessing) { addLog('MIC: Skipped (busy)'); return; }
    addMsg(tr, 'user');
    route(tr);
  };

  recognition.onerror = e => {
    addLog('MIC ERR: ' + e.error);
    if (e.error === 'not-allowed') {
      addMsg("Microphone access denied. Allow mic in browser settings.", 'jarvis');
      stopMic();
    }
  };

  recognition.onend = () => {
    if (micActive && !isSpeaking && !isProcessing) {
      setTimeout(() => {
        if (micActive) try { recognition.start(); } catch {}
      }, 300);
    }
  };

  try { recognition.start(); } catch(e) { addLog('MIC start err: ' + e.message); }
}

function stopMic() {
  micActive = false; voiceMode = false;
  try { recognition?.abort(); } catch {}
  document.getElementById('mic-btn')?.classList.remove('active');
  el('mic-label',       'TAP TO SPEAK');
  el('mic-status-line', 'Microphone OFF');
  addLog('MIC: Stopped');
}

function resumeMic() {
  if (!micActive || isSpeaking || isProcessing) return;
  setTimeout(() => {
    if (micActive && !isSpeaking && !isProcessing) {
      try { recognition.start(); } catch {}
    }
  }, 350);
}

// ── TABS ──────────────────────────────────────────────────────
window.btabClick = function(btn, tab) {
  document.querySelectorAll('.btab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.btab-pane').forEach(p => p.classList.add('hidden'));
  document.getElementById('btab-'+tab)?.classList.remove('hidden');
};

// ── ALARM ────────────────────────────────────────────────────
window.setAlarm = function() {
  const t = document.getElementById('alarm-time')?.value; if (!t) return;
  clearInterval(alarmTimer);
  el('alarm-st', 'SET: '+t); addLog('ALARM: '+t);
  alarmTimer = setInterval(() => {
    const n = new Date(), now = p2(n.getHours())+':'+p2(n.getMinutes());
    if (now === t) {
      clearInterval(alarmTimer);
      el('alarm-st','⚡ TRIGGERED!');
      const m = "Sir, your alarm is going off. Time to get moving!";
      addMsg(m,'jarvis'); speakIt(m,'excited'); addLog('ALARM TRIGGERED');
    }
  }, 15000);
};

// ── JOKE ─────────────────────────────────────────────────────
window.fetchJoke = async function() {
  try {
    const r = await fetch('https://v2.jokeapi.dev/joke/Programming,Misc?type=single&blacklistFlags=nsfw,racist');
    const d = await r.json();
    const j = d.joke || `${d.setup} — ${d.delivery}`;
    el('joke-text', j); respond(j, 'excited');
  } catch { el('joke-text','Could not fetch a joke right now.'); }
};

// ── QUICK ────────────────────────────────────────────────────
window.qCmd = function(cmd) {
  ({
    time:    () => respond(`It's ${new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}, sir.`),
    weather: () => route('weather'),
    yt:      () => openURL('https://www.youtube.com','YouTube'),
    joke:    () => fetchJoke()
  })[cmd]?.();
};

// ── RUDRA PANEL ───────────────────────────────────────────────
function openRudra()  { document.getElementById('rudra-panel')?.classList.remove('hidden'); document.getElementById('overlay')?.classList.remove('hidden'); }
function closeRudra() { document.getElementById('rudra-panel')?.classList.add('hidden');    document.getElementById('overlay')?.classList.add('hidden'); }
window.openRudra  = openRudra;
window.closeRudra = closeRudra;

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id!=='tab-'+tab));
}
window.switchTab = switchTab;

// ── ROUTINE ───────────────────────────────────────────────────
window.addRoutine = function() {
  const time = document.getElementById('routine-time')?.value.trim();
  const task = document.getElementById('routine-task')?.value.trim();
  if (!time||!task) return;
  rudraData.routine.push({id:Date.now(), time, task});
  saveData(); renderRoutine();
  document.getElementById('routine-time').value='';
  document.getElementById('routine-task').value='';
};
function renderRoutine() {
  const el2 = document.getElementById('routine-list'); if (!el2) return;
  el2.innerHTML='';
  [...rudraData.routine].sort((a,b)=>a.time.localeCompare(b.time)).forEach(r => {
    el2.innerHTML += `<div class="entry-item"><span class="et">${r.time} — ${r.task}</span>
      <button class="eb" onclick="editR(${r.id})">✏️</button>
      <button class="ed" onclick="delR(${r.id})">🗑</button></div>`;
  });
}
window.delR  = id => { rudraData.routine=rudraData.routine.filter(r=>r.id!==id); saveData(); renderRoutine(); };
window.editR = id => {
  const i=rudraData.routine.find(r=>r.id===id); if(!i) return;
  const t=prompt('Time:',i.time), k=prompt('Task:',i.task);
  if(t!==null) i.time=t.trim(); if(k!==null) i.task=k.trim();
  saveData(); renderRoutine();
};

// ── GOALS ─────────────────────────────────────────────────────
window.addGoal = function() {
  const name=document.getElementById('goal-name')?.value.trim();
  const dur =document.getElementById('goal-duration')?.value.trim();
  if(!name||!dur) return;
  rudraData.goals.push({id:Date.now(), name, duration:dur, progress:0});
  saveData(); renderGoals(); renderProgress();
  document.getElementById('goal-name').value='';
  document.getElementById('goal-duration').value='';
};
function renderGoals() {
  const el2=document.getElementById('goals-list'); if(!el2) return;
  el2.innerHTML='';
  rudraData.goals.forEach(g=>{
    el2.innerHTML+=`<div class="entry-item"><span class="et">${g.name}</span><span class="em">${g.duration}</span>
      <button class="eb" onclick="editG(${g.id})">✏️</button>
      <button class="ed" onclick="delG(${g.id})">🗑</button></div>`;
  });
}
window.delG  = id => { rudraData.goals=rudraData.goals.filter(g=>g.id!==id); saveData(); renderGoals(); renderProgress(); };
window.editG = id => {
  const i=rudraData.goals.find(g=>g.id===id); if(!i) return;
  const n=prompt('Goal:',i.name), d=prompt('Duration:',i.duration);
  if(n!==null) i.name=n.trim(); if(d!==null) i.duration=d.trim();
  saveData(); renderGoals(); renderProgress();
};

// ── SCHEDULE ──────────────────────────────────────────────────
function setSched(day) { const s=document.getElementById('schedule-day'); if(s) s.value=day; generateSchedule(); }
window.generateSchedule = function() {
  const day=document.getElementById('schedule-day')?.value||'Monday';
  document.getElementById('schedule-output').innerHTML =
    `<h4 style="color:#ff6b00;margin-bottom:5px;font-size:11px;letter-spacing:2px">${day.toUpperCase()}</h4>`+makeTable(buildDay(day));
};
window.generateWeekly = function() {
  const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  document.getElementById('schedule-output').innerHTML=days.map(d=>
    `<h4 style="color:#ff6b00;margin:10px 0 4px;font-size:11px;letter-spacing:2px">${d.toUpperCase()}</h4>`+makeTable(buildDay(d))
  ).join('');
};
function buildDay(day) {
  const isWE=['Saturday','Sunday'].includes(day);
  const slots=rudraData.routine.map(r=>({time:r.time,task:r.task}));
  if(rudraData.goals.length){
    const w=isWE?[['9:00 AM','10:30 AM'],['11:00 AM','12:30 PM'],['3:00 PM','4:30 PM']]:
                 [['6:00 AM','7:00 AM'],['4:00 PM','5:30 PM'],['8:00 PM','9:30 PM']];
    rudraData.goals.forEach((g,i)=>{ const s=w[i%w.length]; slots.push({time:`${s[0]}–${s[1]}`,task:`📚 ${g.name}`}); });
  }
  if(!rudraData.routine.length){
    slots.push({time:'6:00 AM',task:'Wake up'},{time:'7:00 AM',task:'Exercise'},{time:'8:00 AM',task:'Breakfast'});
    if(!isWE) slots.push({time:'9:00 AM–5:00 PM',task:'College / Work'});
    slots.push({time:'9:00 PM',task:'Wind down'},{time:'10:30 PM',task:'Sleep'});
  }
  return slots.sort((a,b)=>tv(a.time)-tv(b.time));
}
function tv(t) {
  const m=t.match(/(\d+):(\d+)\s*(AM|PM)/i); if(!m) return 9999;
  let h=parseInt(m[1]);
  if(m[3].toUpperCase()==='PM'&&h!==12) h+=12;
  if(m[3].toUpperCase()==='AM'&&h===12) h=0;
  return h*60+parseInt(m[2]);
}
function makeTable(slots) {
  return `<table class="st"><thead><tr><th>TIME</th><th>TASK</th></tr></thead><tbody>`+
    slots.map(s=>`<tr><td contenteditable="true">${s.time}</td><td contenteditable="true">${s.task}</td></tr>`).join('')+
    `</tbody></table>`;
}

// ── PROGRESS ──────────────────────────────────────────────────
function renderProgress() {
  const el2=document.getElementById('progress-list'); if(!el2) return;
  el2.innerHTML='';
  if(!rudraData.goals.length){ el2.innerHTML='<p style="color:#336688;font-size:10px;padding:4px">Add goals in Agheera tab.</p>'; return; }
  rudraData.goals.forEach(g=>{
    const p=g.progress||0;
    el2.innerHTML+=`<div class="pi">
      <div class="ph"><span class="pt">${g.name} <small style="color:#336688">(${g.duration})</small></span><span class="pp" id="ph-${g.id}">${p}%</span></div>
      <div class="pb-bg"><div class="pb-fill" id="pb-${g.id}" style="width:${p}%"></div></div>
      <div class="pc"><input type="range" min="0" max="100" value="${p}" oninput="updP(${g.id},this.value)">
      <span style="font-size:10px;color:#336688" id="pp-${g.id}">${p}%</span></div></div>`;
  });
}
window.updP = function(id,val) {
  const g=rudraData.goals.find(g=>g.id===id); if(!g) return;
  g.progress=+val; saveData();
  ['pb','pp','ph'].forEach(p=>{ const e=document.getElementById(p+'-'+g.id); if(e){ if(p==='pb') e.style.width=val+'%'; else e.textContent=val+'%'; } });
};

function renderAll() { renderRoutine(); renderGoals(); renderProgress(); }

// ── UTILS ─────────────────────────────────────────────────────
function el(id, val) { const e=document.getElementById(id); if(e) e.textContent=val; }
function rnd(a,b) { return Math.floor(a+Math.random()*(b-a)); }
function p2(n) { return String(n).padStart(2,'0'); }
function cap(s) { return s?s[0].toUpperCase()+s.slice(1).toLowerCase():s; }
