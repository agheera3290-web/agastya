// ═══════════════════════════════════════════════════════════════
//  J.A.R.V.I.S + RUDRA  ·  v5 FINAL
//  Jarvis AI: openai/gpt-oss-120b (key 1)
//  Rudra AI:  openai/gpt-oss-120b (key 2)
//  Fixed: CORS, voice loop, site open, data save
// ═══════════════════════════════════════════════════════════════

// ─── API KEYS ────────────────────────────────────────────────
const JARVIS_KEY = "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";
const RUDRA_KEY  = "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";
const AI_MODEL   = "openai/gpt-oss-120b";
// NVIDIA endpoint — we use a CORS-safe proxy chain
const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1/chat/completions";

// Multiple CORS proxies — we try them in order
const PROXIES = [
  url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => url  // direct last (works in Brave with proper CORS headers)
];

const BASE44_FN = "https://app.base44.com/api/apps/69b989cd27a641eb3274c8ad/functions/jarvisData";

// ─── SYSTEM PROMPTS ──────────────────────────────────────────
const JARVIS_PROMPT = `You are J.A.R.V.I.S — Just A Rather Very Intelligent System.
You are the world's most advanced AI assistant, built for a specific user.
Speak like a warm, highly intelligent British assistant — never robotic, never stiff.
Be concise, emotionally aware, witty when appropriate, and always helpful.
You can open websites, answer questions, help plan, write code, give advice — anything.
Say "sir" naturally sometimes. Adapt tone: excited for good news, calm for problems.`;

const RUDRA_PROMPT = `You are Rudra — the strategic planning mind of the Jarvis system.
You specialize in schedules, learning plans, goal setting, and productivity optimization.
You are analytical, sharp, and give structured, actionable advice.
Never give vague answers — always be specific and implementable.`;

// ─── STATE ───────────────────────────────────────────────────
let micActive    = false;
let recognition  = null;
let isSpeaking   = false;
let isProcessing = false;
let voiceMode    = false;
let chatHistory  = [];
let alarmTimer   = null;
let currentAI    = 'jarvis';   // 'jarvis' or 'rudra'
const SESSION_START = Date.now();

// Unique user key (browser fingerprint for data persistence)
let USER_KEY = localStorage.getItem('jrv_uid');
if (!USER_KEY) {
  USER_KEY = 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  localStorage.setItem('jrv_uid', USER_KEY);
}

let rudraData = { routine: [], goals: [] };

// ─── VOICE ───────────────────────────────────────────────────
let voices = [], selectedVoice = null;

function loadVoices() {
  voices = window.speechSynthesis.getVoices();
  // Priority chain for deep male British voice
  const order = [
    v => v.name === 'Google UK English Male',
    v => v.name.includes('Daniel') && v.lang.includes('en-GB'),
    v => v.name.includes('Arthur'),
    v => v.name.includes('James'),
    v => v.lang === 'en-GB',
    v => v.name.toLowerCase().includes('male') && v.lang.startsWith('en'),
    v => /david|mark|alex/i.test(v.name) && v.lang.startsWith('en'),
    v => v.lang.startsWith('en-GB') || v.lang.startsWith('en-US'),
    v => v.lang.startsWith('en')
  ];
  for (const test of order) {
    const found = voices.find(test);
    if (found) { selectedVoice = found; break; }
  }
}
window.speechSynthesis && (loadVoices(), (window.speechSynthesis.onvoiceschanged = loadVoices));

// ─── DOM REFS ────────────────────────────────────────────────
const $msg    = () => document.getElementById('messages');
const $input  = () => document.getElementById('text-input');
const $micBtn = () => document.getElementById('mic-btn');
const $aiBadge= () => document.getElementById('ai-status-badge');

// ─── BOOT ────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  tickClock(); setInterval(tickClock, 1000);
  tickBars();  setInterval(tickBars, 2500);
  tickBattery(); setInterval(tickBattery, 60000);
  getWeather();
  tickGauges(); setInterval(tickGauges, 3000);

  await loadData();
  renderAll();

  setTimeout(greet, 800);

  document.getElementById('text-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendText();
  });
});

// ─── CLOCK ───────────────────────────────────────────────────
function tickClock() {
  const n  = new Date();
  const hm = pad2(n.getHours()) + ':' + pad2(n.getMinutes());
  const sc = hm + ':' + pad2(n.getSeconds());
  const dt = n.toLocaleDateString('en-IN', { weekday:'long', day:'2-digit', month:'short', year:'numeric' }).toUpperCase();

  set('arc-time',     hm);
  set('arc-date',     dt.split(',')[0]);
  set('tb-time-big',  hm);
  set('tb-date',      dt);
  set('tb-cal-num',   n.getDate());
  set('tb-cal-month', n.toLocaleDateString('en-IN',{month:'long'}).toUpperCase());
  set('tb-cal-day',   n.toLocaleDateString('en-IN',{weekday:'long'}).toUpperCase());
  set('btab-clock',   sc);
  set('btab-datestr', dt);

  const up = Math.floor((Date.now() - SESSION_START) / 1000);
  set('uptime-val', `${pad2(Math.floor(up/3600))}:${pad2(Math.floor(up%3600/60))}:${pad2(up%60)}`);
}

// ─── SYSTEM BARS ─────────────────────────────────────────────
function tickBars() {
  bar('cpu', rnd(20, 75));
  bar('ram', rnd(40, 78));
  bar('net', rnd(15, 85));
}
function bar(id, v) {
  const b = document.getElementById('bar-'+id);
  const s = document.getElementById('val-'+id);
  if (b) b.style.width = v+'%';
  if (s) s.textContent  = v+'%';
}

// ─── BATTERY ─────────────────────────────────────────────────
function tickBattery() {
  navigator.getBattery?.().then(b => {
    const p  = Math.round(b.level * 100) + '%';
    const st = b.charging ? 'CHARGING ⚡' : 'BATTERY';
    set('batt-pct',    p);
    set('pwr-status',  st);
    set('btab-batt-val', p);
    set('btab-batt-st',  b.charging ? 'CHARGING ⚡' : 'DISCHARGING');
  });
}

// ─── WEATHER ─────────────────────────────────────────────────
async function getWeather() {
  try {
    const pos = await new Promise((ok, no) =>
      navigator.geolocation.getCurrentPosition(ok, no, { timeout: 8000 }));
    const { latitude: la, longitude: lo } = pos.coords;

    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}` +
      `&current_weather=true&hourly=relativehumidity_2m,windspeed_10m&daily=sunrise,sunset&timezone=auto`
    );
    const d = await r.json(), w = d.current_weather;
    const codes = {0:'CLEAR SKY',1:'MAINLY CLEAR',2:'PARTLY CLOUDY',3:'OVERCAST',
      45:'FOGGY',48:'FOGGY',51:'DRIZZLE',61:'RAIN',71:'SNOW',80:'SHOWERS',95:'THUNDERSTORM'};

    set('w-temp', Math.round(w.temperature) + '°C');
    set('w-cond', codes[w.weathercode] || 'CLEAR');
    set('w-hum',  (d.hourly?.relativehumidity_2m?.[0] ?? '--') + '%');
    set('w-wind', (d.hourly?.windspeed_10m?.[0] ?? '--') + ' km/h');
    set('w-rise', d.daily?.sunrise?.[0]?.split('T')[1] ?? '--');
    set('w-set',  d.daily?.sunset?.[0]?.split('T')[1] ?? '--');

    const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${la}&lon=${lo}&format=json`);
    const gd  = await geo.json();
    const city = (gd.address?.city || gd.address?.town || gd.address?.village || 'UNKNOWN').toUpperCase();
    set('w-loc', city);
    log(`WEATHER: ${Math.round(w.temperature)}°C · ${codes[w.weathercode]||'CLEAR'} · ${city}`);
  } catch(e) {
    set('w-cond', 'LOCATION OFF'); set('w-loc', 'UNKNOWN');
  }
}

// ─── GAUGES ──────────────────────────────────────────────────
function tickGauges() {
  gauge('gauge-cpu', rnd(20,75), '#00cfff');
  gauge('gauge-ram', rnd(40,78), '#0080ff');
}
function gauge(id, val, color) {
  const c = document.getElementById(id); if (!c) return;
  const ctx = c.getContext('2d'), cx=c.width/2, cy=c.height/2, r=cx-7;
  ctx.clearRect(0,0,c.width,c.height);
  // background
  ctx.beginPath(); ctx.arc(cx,cy,r,.75*Math.PI,2.25*Math.PI);
  ctx.strokeStyle='#0a2030'; ctx.lineWidth=8; ctx.lineCap='round'; ctx.stroke();
  // value
  ctx.beginPath(); ctx.arc(cx,cy,r,.75*Math.PI,.75*Math.PI+(val/100)*1.5*Math.PI);
  ctx.strokeStyle=color; ctx.lineWidth=8; ctx.lineCap='round'; ctx.stroke();
  // text
  ctx.fillStyle=color; ctx.font='bold 13px Orbitron,monospace';
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(val+'%',cx,cy);
}

// ─── ACTIVITY LOG ────────────────────────────────────────────
function log(msg) {
  const el = document.getElementById('activity-log'); if (!el) return;
  const now = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const d = document.createElement('div'); d.className='log-entry';
  d.innerHTML = `<span>${now}</span> ${msg}`;
  el.insertBefore(d, el.firstChild);
  while (el.children.length > 30) el.lastChild.remove();
}

// ─── DATA PERSISTENCE (Base44 + localStorage fallback) ───────
async function loadData() {
  // Try local first (fast)
  try {
    const loc = localStorage.getItem('jrv_data');
    if (loc) rudraData = { ...rudraData, ...JSON.parse(loc) };
  } catch {}

  // Try cloud
  try {
    const r = await fetch(BASE44_FN, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action:'load', user_key: USER_KEY })
    });
    const j = await r.json();
    if (j.ok && j.record) {
      rudraData.routine = j.record.routine || rudraData.routine;
      rudraData.goals   = j.record.goals   || rudraData.goals;
      localStorage.setItem('jrv_data', JSON.stringify(rudraData));
      log('DATA: Loaded from cloud ✓');
    }
  } catch { log('DATA: Using local storage'); }
}

async function saveData() {
  localStorage.setItem('jrv_data', JSON.stringify(rudraData));
  try {
    await fetch(BASE44_FN, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action:'save', user_key: USER_KEY, data: rudraData })
    });
    log('DATA: Saved to cloud ✓');
  } catch { log('DATA: Saved locally'); }
}

// ─── GREETING ────────────────────────────────────────────────
function greet() {
  const h = new Date().getHours();
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const msg = `${g}. I'm Jarvis. How may I assist you?`;
  addMsg(msg, 'jarvis');
  speak(msg, 'warm');
  log('BOOT COMPLETE · ' + new Date().toLocaleTimeString());
}

// ─── TEXT INPUT ──────────────────────────────────────────────
function sendText() {
  const v = $input().value.trim(); if (!v) return;
  voiceMode = false;
  addMsg(v, 'user');
  $input().value = '';
  route(v);
}
window.handleTextInput = sendText;
window.sendText = sendText;

// ─── MAIN COMMAND ROUTER ─────────────────────────────────────
function route(cmd) {
  const c = cmd.toLowerCase().trim();
  log(`CMD: "${cmd.slice(0,40)}"`);

  // ── Switch AI mode ──
  if (/\brudra\b/i.test(c) && !/open|schedule|plan/i.test(c)) {
    if (/\bmode\b|\bswitch\b|\buse\b/i.test(c)) {
      currentAI = 'rudra';
      return respond("Rudra AI activated. I'll handle planning and strategy now.");
    }
  }
  if (/\bjarvis\b.*\bmode\b|\bswitch.*jarvis/i.test(c)) {
    currentAI = 'jarvis';
    return respond("Jarvis AI back online.");
  }

  // ── Rudra panel ──
  if (/open.*rudra|rudra.*panel|show.*rudra/i.test(c)) {
    openRudra();
    return respond("Rudra panel open, sir.");
  }
  if (/\brudra\b/i.test(c)) {
    openRudra();
    const dm = c.match(/plan\s+(?:my\s+)?(\w+)/i);
    if (dm) {
      setTimeout(() => { switchTab('schedule'); setSched(cap(dm[1])); }, 350);
      return respond(`Opening Rudra and generating your ${cap(dm[1])} plan.`);
    }
    return respond("Rudra panel is open. Manage your schedule and goals here.");
  }

  // ── Website/app opening ──
  // Comprehensive site map — handles voice commands like "open brave", "search youtube"
  const siteMap = {
    youtube:   'https://www.youtube.com',
    google:    'https://www.google.com',
    github:    'https://www.github.com',
    instagram: 'https://www.instagram.com',
    twitter:   'https://www.twitter.com',
    x:         'https://www.twitter.com',
    facebook:  'https://www.facebook.com',
    netflix:   'https://www.netflix.com',
    spotify:   'https://open.spotify.com',
    gmail:     'https://mail.google.com',
    maps:      'https://maps.google.com',
    wikipedia: 'https://www.wikipedia.org',
    whatsapp:  'https://web.whatsapp.com',
    reddit:    'https://www.reddit.com',
    linkedin:  'https://www.linkedin.com',
    amazon:    'https://www.amazon.in',
    flipkart:  'https://www.flipkart.com',
    chatgpt:   'https://chat.openai.com',
    discord:   'https://discord.com/app',
    twitch:    'https://www.twitch.tv',
    stackoverflow: 'https://stackoverflow.com'
  };

  // Check for "open <sitename>" or just "<sitename>"
  for (const [key, url] of Object.entries(siteMap)) {
    if (c.includes(key)) {
      openURL(url, key);
      return;
    }
  }

  // "open brave" / "open chrome" / "open firefox" → inform user
  if (/\b(brave|chrome|firefox|edge|opera|safari)\b/i.test(c)) {
    const browser = c.match(/\b(brave|chrome|firefox|edge|opera|safari)\b/i)?.[1];
    const note = `Sir, I can't launch desktop apps like ${browser} directly from a web page — that's a browser security restriction. However, I can open any website inside your current browser. Just say "open YouTube" or "search for something" and I'll handle it.`;
    respond(note);
    return;
  }

  // "open <url>"
  const urlMatch = c.match(/open\s+(https?:\/\/[^\s]+|www\.[^\s]+)/i);
  if (urlMatch) {
    const raw = urlMatch[1];
    openURL(raw.startsWith('http') ? raw : 'https://' + raw, raw);
    return;
  }

  // "search <query> on/in <site>"
  const searchMatch = c.match(/search\s+(.+?)\s+(?:on|in)\s+(\w+)/i);
  if (searchMatch) {
    const [, query, site] = searchMatch;
    const engines = {
      youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      google:  `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      amazon:  `https://www.amazon.in/s?k=${encodeURIComponent(query)}`
    };
    const url = engines[site.toLowerCase()] || `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    openURL(url, `${site}: ${query}`);
    return;
  }

  // "play <song>" → YouTube
  const playMatch = c.match(/^play\s+(.+)/i);
  if (playMatch) {
    openURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(playMatch[1])}`, 'YouTube: ' + playMatch[1]);
    respond(`Searching YouTube for "${playMatch[1]}", sir.`);
    return;
  }

  // ── Quick built-in answers ──
  if (/what.*time|current time|time now/i.test(c)) {
    const t = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    return respond(`It's ${t}, sir.`);
  }
  if (/what.*date|today.*date|current date|what day/i.test(c)) {
    return respond(`Today is ${new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}.`);
  }
  if (/weather/i.test(c)) {
    const tmp = document.getElementById('w-temp').textContent;
    const cnd = document.getElementById('w-cond').textContent;
    const loc = document.getElementById('w-loc').textContent;
    return respond(`It's ${tmp} and ${cnd.toLowerCase()} in ${loc}.`);
  }
  if (/battery|batt/i.test(c)) {
    navigator.getBattery?.().then(b =>
      respond(`Battery at ${Math.round(b.level*100)}%, ${b.charging?'charging':'not charging'}.`)
    ) ?? respond("Battery API not available in this browser.");
    return;
  }
  if (/stop mic|stop listen|turn off mic|mic off/i.test(c)) {
    stopMic(); return respond("Microphone deactivated.");
  }
  if (/clear chat|reset chat|clear screen/i.test(c)) {
    $msg().innerHTML = ''; chatHistory = [];
    return respond("Chat cleared. Ready for commands.");
  }
  if (/^(hello|hi|hey|namaste|sup)\b/i.test(c)) {
    return respond("Hello sir. All systems operational. What can I do for you?");
  }
  if (/who are you|what are you|your name/i.test(c)) {
    return respond("I'm Jarvis — your personal AI system. Rudra module also online for planning.");
  }
  if (/schedule|plan my|timetable/i.test(c)) {
    const dm = c.match(/plan\s+(?:my\s+)?(\w+)/i);
    openRudra();
    setTimeout(() => {
      switchTab('schedule');
      if (dm) setSched(cap(dm[1]));
    }, 350);
    return respond(dm ? `Generating your ${cap(dm[1])} plan now.` : "Opening your schedule planner.");
  }

  // ── Everything else → NVIDIA AI ──
  askAI(cmd);
}

// ─── OPEN URL (guaranteed synchronous before any async) ──────
function openURL(url, label) {
  // Method: create anchor & click — works in all browsers including Brave
  try {
    const a    = document.createElement('a');
    a.href     = url;
    a.target   = '_blank';
    a.rel      = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 100);
    respond(`Opening ${label} for you, sir.`);
    log(`OPEN: ${label}`);
  } catch(e) {
    respond(`Couldn't open ${label}. Please check popup blocker settings.`);
  }
}
window.openSite = openURL;

// ─── NVIDIA AI (with auto proxy fallback) ────────────────────
async function askAI(userMsg) {
  // Block duplicate concurrent calls
  if (isProcessing) { log('AI: Blocked duplicate'); return; }
  isProcessing = true;

  // Pause mic recognition while processing
  if (recognition && micActive) {
    try { recognition.abort(); } catch {}
  }

  const key    = currentAI === 'rudra' ? RUDRA_KEY : JARVIS_KEY;
  const prompt = currentAI === 'rudra' ? RUDRA_PROMPT : JARVIS_PROMPT;
  const badge  = $aiBadge();

  chatHistory.push({ role:'user', content: userMsg });
  if (chatHistory.length > 14) chatHistory = chatHistory.slice(-14);

  const thinkEl = thinking();
  if (badge) badge.textContent = 'AI: THINKING...';

  // Create reply bubble
  const bubble = document.createElement('div');
  bubble.className = 'msg jarvis';
  $msg().appendChild(bubble);
  $msg().parentElement.scrollTop = 99999;

  let full = '';

  const body = JSON.stringify({
    model:       AI_MODEL,
    messages:    [{ role:'system', content: prompt }, ...chatHistory],
    max_tokens:  1024,
    temperature: 0.85,
    top_p:       1,
    stream:      true
  });

  const headers = {
    'Authorization': `Bearer ${key}`,
    'Content-Type':  'application/json',
    'Accept':        'text/event-stream'
  };

  let response = null;
  let lastErr  = '';

  // Try proxy chain
  for (const makeURL of PROXIES) {
    const endpoint = makeURL(NVIDIA_BASE);
    try {
      log(`AI: Trying ${endpoint.slice(0,40)}...`);
      const r = await fetch(endpoint, { method:'POST', headers, body, signal: AbortSignal.timeout(25000) });
      if (r.ok) { response = r; log('AI: Connected ✓'); break; }
      lastErr = `HTTP ${r.status}`;
    } catch(e) {
      lastErr = e.message;
      log(`AI: Failed — ${e.message.slice(0,40)}`);
    }
  }

  if (!response) {
    doneThinking(thinkEl);
    const errMsg = `Network issue — couldn't reach AI (${lastErr}). Check your connection and try again.`;
    bubble.innerHTML = fmt(errMsg);
    if (voiceMode) speak(errMsg, 'calm');
    if (badge) badge.textContent = currentAI === 'rudra' ? 'AI: RUDRA' : 'AI: JARVIS';
    isProcessing = false;
    resumeMic();
    return;
  }

  doneThinking(thinkEl);

  // Stream response
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream:true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        const t = line.trim();
        if (!t || t === 'data: [DONE]' || !t.startsWith('data: ')) continue;
        try {
          const j = JSON.parse(t.slice(6));
          const d = j.choices?.[0]?.delta;
          if (!d) continue;
          // reasoning tokens (thinking models)
          // Handle both reasoning field names
          const rc = d.reasoning_content || d.reasoning;
          if (rc) showReasoning(bubble, rc);
          if (d.content) {
            full += d.content;
            bubble.innerHTML = fmt(full) + '<span class="cur">▌</span>';
            $msg().parentElement.scrollTop = 99999;
          }
        } catch {}
      }
    }
  } catch(e) { log('AI: Stream error: ' + e.message); }

  // Finalize
  bubble.innerHTML = fmt(full || '(No response from AI)');
  if (full) chatHistory.push({ role:'assistant', content: full });
  log(`AI: ${full.length}ch reply`);

  // Speak if voice mode
  if (voiceMode && full) {
    speak(full.replace(/<[^>]*>/g,'').slice(0, 600), detectEmotion(full));
  }

  if (badge) badge.textContent = currentAI === 'rudra' ? 'AI: RUDRA' : 'AI: JARVIS';
  isProcessing = false;
  resumeMic();
}

// ─── RESPOND (write always, speak only in voice mode) ────────
function respond(text, emotion='neutral') {
  addMsg(text, 'jarvis');
  if (voiceMode) speak(text, emotion);
  log(`JRV: ${text.slice(0,35)}`);
}

function addMsg(text, role) {
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  d.textContent = text;
  $msg().appendChild(d);
  $msg().parentElement.scrollTop = 99999;
  return d;
}

// ─── AI HELPERS ──────────────────────────────────────────────
function thinking() {
  const el = document.createElement('div');
  el.className = 'msg jarvis thinking';
  el.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  $msg().appendChild(el);
  $msg().parentElement.scrollTop = 99999;
  return el;
}
function doneThinking(el) { el?.parentNode?.removeChild(el); }

let _reasonEl = null;
function showReasoning(parent, tok) {
  if (!_reasonEl || !parent.contains(_reasonEl)) {
    _reasonEl = document.createElement('div');
    _reasonEl.className = 'reasoning';
    parent.appendChild(_reasonEl);
  }
  _reasonEl.textContent += tok;
}

function fmt(t) {
  return t
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/`(.+?)`/g,'<code>$1</code>')
    .replace(/\n/g,'<br>');
}

// ─── SPEAK (human sentence-by-sentence) ──────────────────────
function speak(text, emotion='neutral') {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  isSpeaking = false;

  const clean = text.replace(/<[^>]*>/g,'').replace(/[#*`_]/g,'').trim().slice(0, 600);
  if (!clean) return;

  const sentences = clean.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [clean];
  let i = 0;

  function next() {
    if (i >= sentences.length) {
      isSpeaking = false;
      resumeMic();
      return;
    }
    const s = sentences[i++].trim();
    if (!s) return next();

    const u = new SpeechSynthesisUtterance(s);
    if (selectedVoice) u.voice = selectedVoice;
    u.lang   = 'en-GB';
    u.volume = 1;

    // Emotion → voice parameters
    const e = detectEmotion(s);
    switch(e) {
      case 'excited':  u.rate=1.02; u.pitch=0.95; break;
      case 'warning':  u.rate=0.86; u.pitch=0.80; break;
      case 'warm':     u.rate=0.90; u.pitch=0.92; break;
      case 'question': u.rate=0.94; u.pitch=0.93; break;
      case 'calm':     u.rate=0.88; u.pitch=0.85; break;
      default:         u.rate=0.92; u.pitch=0.87;
    }

    u.onstart = () => {
      isSpeaking = true;
      // Stop mic while speaking (prevents echo/feedback)
      if (recognition && micActive) try { recognition.abort(); } catch {}
    };
    u.onend   = next;
    u.onerror = () => { isSpeaking = false; next(); };

    window.speechSynthesis.speak(u);
  }
  next();
}

function detectEmotion(t) {
  if (/\?/.test(t))                                                         return 'question';
  if (/warning|error|fail|cannot|denied|alert|critical|blocked/i.test(t))  return 'warning';
  if (/great|perfect|done|ready|online|excellent|wonderful|awesome/i.test(t)) return 'excited';
  if (/morning|evening|afternoon|hello|assist|welcome|good/i.test(t))      return 'warm';
  if (/sorry|trouble|unfortunately|issue|couldn't|problem|can't/i.test(t)) return 'calm';
  return 'neutral';
}

// ─── MIC ─────────────────────────────────────────────────────
function toggleMic() { micActive ? stopMic() : startMic(); }
window.toggleMic = toggleMic;

function startMic() {
  const SRClass = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SRClass) {
    addMsg("Speech recognition requires Google Chrome or Microsoft Edge.", 'jarvis');
    return;
  }

  recognition = new SRClass();
  recognition.continuous     = false;  // one result → manual restart (prevents loop bugs)
  recognition.interimResults = false;
  recognition.lang           = 'en-IN';
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    micActive = true; voiceMode = true;
    $micBtn()?.classList.add('active');
    set('mic-label',       'LISTENING...');
    set('mic-status-line', 'Click to stop');
    log('MIC: Active');
  };

  recognition.onresult = e => {
    if (!micActive) return;
    const transcript = e.results[0]?.[0]?.transcript?.trim();
    if (!transcript) return;
    log(`HEARD: "${transcript.slice(0,40)}"`);

    if (isSpeaking) { window.speechSynthesis.cancel(); isSpeaking = false; }
    if (isProcessing) { log('MIC: Skipped — AI busy'); return; }

    addMsg(transcript, 'user');
    route(transcript);
  };

  recognition.onerror = e => {
    log(`MIC ERR: ${e.error}`);
    if (e.error === 'not-allowed') {
      addMsg("Microphone access denied. Please allow mic permission in browser settings.", 'jarvis');
      stopMic();
    }
    // 'no-speech', 'aborted' etc. → just restart below
  };

  recognition.onend = () => {
    // Restart only if still supposed to be active, not speaking, not processing
    if (micActive && !isSpeaking && !isProcessing) {
      setTimeout(() => {
        if (micActive) {
          try { recognition.start(); }
          catch { log('MIC: restart failed'); }
        }
      }, 350);
    }
  };

  try { recognition.start(); }
  catch(e) { log('MIC: start error: ' + e.message); }
}

function stopMic() {
  micActive = false; voiceMode = false;
  try { recognition?.abort(); } catch {}
  $micBtn()?.classList.remove('active');
  set('mic-label',       'TAP TO SPEAK');
  set('mic-status-line', 'Microphone OFF');
  log('MIC: Stopped');
}

function resumeMic() {
  if (!micActive || isSpeaking || isProcessing) return;
  setTimeout(() => {
    if (micActive && !isSpeaking && !isProcessing) {
      try { recognition.start(); }
      catch { /* already running */ }
    }
  }, 400);
}

// ─── BOTTOM TABS ─────────────────────────────────────────────
window.btabClick = function(btn, tab) {
  document.querySelectorAll('.btab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.btab-pane').forEach(p => p.classList.add('hidden'));
  document.getElementById('btab-' + tab)?.classList.remove('hidden');
};

// ─── ALARM ───────────────────────────────────────────────────
window.setAlarm = function() {
  const t = document.getElementById('alarm-time')?.value; if (!t) return;
  clearInterval(alarmTimer);
  set('alarm-st', 'SET: ' + t);
  log('ALARM SET: ' + t);
  alarmTimer = setInterval(() => {
    const n = new Date();
    const now = pad2(n.getHours()) + ':' + pad2(n.getMinutes());
    if (now === t) {
      clearInterval(alarmTimer);
      set('alarm-st', '⚡ TRIGGERED!');
      const m = "Sir, your alarm is going off. Time to get moving!";
      addMsg(m, 'jarvis');
      speak(m, 'excited');
      log('ALARM: TRIGGERED');
    }
  }, 15000);
};

// ─── JOKE ────────────────────────────────────────────────────
window.fetchJoke = async function() {
  try {
    const r = await fetch('https://v2.jokeapi.dev/joke/Programming,Misc?type=single&blacklistFlags=nsfw,racist');
    const d = await r.json();
    const j = d.joke || `${d.setup} — ${d.delivery}`;
    set('joke-text', j);
    respond(j, 'excited');
  } catch { set('joke-text', 'Could not fetch joke. Try again.'); }
};

// ─── QUICK BUTTONS ───────────────────────────────────────────
window.qCmd = function(cmd) {
  const map = {
    time:    () => respond(`It's ${new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}, sir.`),
    weather: () => route('weather'),
    yt:      () => openURL('https://www.youtube.com','YouTube'),
    joke:    () => fetchJoke()
  };
  map[cmd]?.();
};

// ─── RUDRA PANEL ─────────────────────────────────────────────
function openRudra() {
  document.getElementById('rudra-panel')?.classList.remove('hidden');
  document.getElementById('overlay')?.classList.remove('hidden');
}
function closeRudra() {
  document.getElementById('rudra-panel')?.classList.add('hidden');
  document.getElementById('overlay')?.classList.add('hidden');
}
window.openRudra  = openRudra;
window.closeRudra = closeRudra;

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== 'tab-' + tab));
}
window.switchTab = switchTab;

// ─── ROUTINE ─────────────────────────────────────────────────
window.addRoutine = function() {
  const time = document.getElementById('routine-time')?.value.trim();
  const task = document.getElementById('routine-task')?.value.trim();
  if (!time || !task) return;
  rudraData.routine.push({ id: Date.now(), time, task });
  saveData(); renderRoutine();
  document.getElementById('routine-time').value = '';
  document.getElementById('routine-task').value = '';
};

function renderRoutine() {
  const el = document.getElementById('routine-list'); if (!el) return;
  el.innerHTML = '';
  [...rudraData.routine]
    .sort((a, b) => a.time.localeCompare(b.time))
    .forEach(r => {
      el.innerHTML += `<div class="entry-item">
        <span class="et">${r.time} — ${r.task}</span>
        <button class="eb" onclick="editR(${r.id})">✏️</button>
        <button class="ed" onclick="delR(${r.id})">🗑</button>
      </div>`;
    });
}
window.delR  = id => { rudraData.routine = rudraData.routine.filter(r => r.id !== id); saveData(); renderRoutine(); };
window.editR = id => {
  const i = rudraData.routine.find(r => r.id === id); if (!i) return;
  const t = prompt('Time:', i.time), k = prompt('Task:', i.task);
  if (t !== null) i.time = t.trim();
  if (k !== null) i.task = k.trim();
  saveData(); renderRoutine();
};

// ─── GOALS ───────────────────────────────────────────────────
window.addGoal = function() {
  const name = document.getElementById('goal-name')?.value.trim();
  const dur  = document.getElementById('goal-duration')?.value.trim();
  if (!name || !dur) return;
  rudraData.goals.push({ id: Date.now(), name, duration: dur, progress: 0 });
  saveData(); renderGoals(); renderProgress();
  document.getElementById('goal-name').value     = '';
  document.getElementById('goal-duration').value = '';
};

function renderGoals() {
  const el = document.getElementById('goals-list'); if (!el) return;
  el.innerHTML = '';
  rudraData.goals.forEach(g => {
    el.innerHTML += `<div class="entry-item">
      <span class="et">${g.name}</span>
      <span class="em">${g.duration}</span>
      <button class="eb" onclick="editG(${g.id})">✏️</button>
      <button class="ed" onclick="delG(${g.id})">🗑</button>
    </div>`;
  });
}
window.delG  = id => { rudraData.goals = rudraData.goals.filter(g => g.id !== id); saveData(); renderGoals(); renderProgress(); };
window.editG = id => {
  const i = rudraData.goals.find(g => g.id === id); if (!i) return;
  const n = prompt('Goal:', i.name), d = prompt('Duration:', i.duration);
  if (n !== null) i.name = n.trim();
  if (d !== null) i.duration = d.trim();
  saveData(); renderGoals(); renderProgress();
};

// ─── SCHEDULE ────────────────────────────────────────────────
function setSched(day) {
  const s = document.getElementById('schedule-day'); if (s) s.value = day;
  generateSchedule();
}

window.generateSchedule = function() {
  const day = document.getElementById('schedule-day')?.value || 'Monday';
  document.getElementById('schedule-output').innerHTML =
    `<h4 style="color:#ff6b00;margin-bottom:5px;font-size:11px;letter-spacing:2px">${day.toUpperCase()}</h4>` +
    makeTable(buildDay(day));
};

window.generateWeekly = function() {
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  document.getElementById('schedule-output').innerHTML = days.map(d =>
    `<h4 style="color:#ff6b00;margin:10px 0 4px;font-size:11px;letter-spacing:2px">${d.toUpperCase()}</h4>` + makeTable(buildDay(d))
  ).join('');
};

function buildDay(day) {
  const isWE = ['Saturday','Sunday'].includes(day);
  const slots = rudraData.routine.map(r => ({ time: r.time, task: r.task }));
  if (rudraData.goals.length) {
    const windows = isWE
      ? [['9:00 AM','10:30 AM'],['11:00 AM','12:30 PM'],['3:00 PM','4:30 PM'],['5:00 PM','6:30 PM']]
      : [['6:00 AM','7:00 AM'],['4:00 PM','5:30 PM'],['8:00 PM','9:30 PM']];
    rudraData.goals.forEach((g,i) => {
      const w = windows[i % windows.length];
      slots.push({ time: `${w[0]}–${w[1]}`, task: `📚 ${g.name}` });
    });
  }
  if (!rudraData.routine.length) {
    slots.push({time:'6:00 AM',task:'Wake up'},{time:'7:00 AM',task:'Exercise'},{time:'8:00 AM',task:'Breakfast'});
    if (!isWE) slots.push({time:'9:00 AM–5:00 PM',task:'College / Work'});
    slots.push({time:'9:00 PM',task:'Wind down'},{time:'10:30 PM',task:'Sleep'});
  }
  return slots.sort((a,b) => timeVal(a.time) - timeVal(b.time));
}
function timeVal(t) {
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i); if (!m) return 9999;
  let h = parseInt(m[1]);
  if (m[3].toUpperCase()==='PM' && h!==12) h+=12;
  if (m[3].toUpperCase()==='AM' && h===12) h=0;
  return h*60+parseInt(m[2]);
}
function makeTable(slots) {
  return `<table class="st"><thead><tr><th>TIME</th><th>TASK</th></tr></thead><tbody>` +
    slots.map(s=>`<tr><td contenteditable="true">${s.time}</td><td contenteditable="true">${s.task}</td></tr>`).join('') +
    `</tbody></table>`;
}

// ─── PROGRESS ────────────────────────────────────────────────
function renderProgress() {
  const el = document.getElementById('progress-list'); if (!el) return;
  el.innerHTML = '';
  if (!rudraData.goals.length) {
    el.innerHTML = '<p style="color:#336688;font-size:10px;padding:4px">Add goals in the Agheera tab first.</p>';
    return;
  }
  rudraData.goals.forEach(g => {
    const p = g.progress || 0;
    el.innerHTML += `<div class="pi">
      <div class="ph"><span class="pt">${g.name} <small style="color:#336688">(${g.duration})</small></span><span class="pp" id="ph-${g.id}">${p}%</span></div>
      <div class="pb-bg"><div class="pb-fill" id="pb-${g.id}" style="width:${p}%"></div></div>
      <div class="pc"><input type="range" min="0" max="100" value="${p}" oninput="updProg(${g.id},this.value)">
      <span style="font-size:10px;color:#336688" id="pp-${g.id}">${p}%</span></div>
    </div>`;
  });
}
window.updProg = function(id, val) {
  const g = rudraData.goals.find(g => g.id === id); if (!g) return;
  g.progress = +val; saveData();
  const fill = document.getElementById('pb-'+g.id);
  const pct1 = document.getElementById('pp-'+g.id);
  const pct2 = document.getElementById('ph-'+g.id);
  if(fill) fill.style.width=val+'%';
  if(pct1) pct1.textContent=val+'%';
  if(pct2) pct2.textContent=val+'%';
};

function renderAll() { renderRoutine(); renderGoals(); renderProgress(); }

// ─── UTILS ───────────────────────────────────────────────────
function set(id, val) { const e=document.getElementById(id); if(e) e.textContent=val; }
function rnd(a,b) { return Math.floor(a+Math.random()*(b-a)); }
function pad2(n) { return String(n).padStart(2,'0'); }
function cap(s) { return s?s[0].toUpperCase()+s.slice(1).toLowerCase():s; }
