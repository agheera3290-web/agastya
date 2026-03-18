// ═══════════════════════════════════════════════════════
//  JARVIS / RUDRA  ·  Iron Man HUD  ·  Kimi K2.5 AI
//  v4 — Fixed: AI after voice, YouTube voice, data save
// ═══════════════════════════════════════════════════════

// ── AI CONFIG ────────────────────────────────────────
const KIMI_KEY   = "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";
const KIMI_MODEL = "moonshotai/kimi-k2.5";
const KIMI_URL   = "https://integrate.api.nvidia.com/v1/chat/completions";

// Data save backend
const DATA_API   = "https://app.base44.com/api/apps/69b989cd27a641eb3274c8ad/functions/jarvisData";

const SYSTEM_PROMPT = `You are Jarvis, also called Rudra — the most advanced personal AI assistant ever created.
You speak like a highly intelligent, emotionally aware, warm human being — never robotic.
You have a naturally confident, slightly British tone. You use natural pauses, warmth, wit, and clarity.
Adapt your tone: excited for good news, calm for problems, warm for greetings, direct for facts.
Never sound like a machine. Be concise but complete. Address user as "sir" occasionally but naturally.`;

// ── STATE ─────────────────────────────────────────────
let micActive    = false;
let recognition  = null;
let isSpeaking   = false;
let isProcessing = false;   // ← KEY FIX: blocks duplicate voice commands
let voiceMode    = false;   // ← text=false, voice=true — controls speak/write behavior
let chatHistory  = [];
let alarmTimer   = null;
const t0         = Date.now();

// User identity — stored in localStorage per browser
let USER_KEY = localStorage.getItem('jarvis_user_key');
if (!USER_KEY) {
  USER_KEY = 'user_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now();
  localStorage.setItem('jarvis_user_key', USER_KEY);
}

const DATA_KEY = 'rudra_local_v3';
let rudraData  = { routine: [], goals: [] };

// ── VOICE SETUP ───────────────────────────────────────
let voices = [], voice = null;
function initVoices() {
  voices = window.speechSynthesis.getVoices();
  const picks = [
    v => v.name === 'Google UK English Male',
    v => v.name.includes('Daniel') && v.lang === 'en-GB',
    v => v.name.includes('James'),
    v => v.name.includes('Arthur'),
    v => v.lang === 'en-GB',
    v => /david|mark|microsoft/i.test(v.name) && v.lang.startsWith('en'),
    v => v.lang.startsWith('en')
  ];
  for (const test of picks) {
    const found = voices.find(test);
    if (found) { voice = found; break; }
  }
}
if (window.speechSynthesis) {
  initVoices();
  window.speechSynthesis.onvoiceschanged = initVoices;
}

// ── DOM ───────────────────────────────────────────────
const messagesEl = document.getElementById('messages');
const textInput  = document.getElementById('text-input');
const micBtn     = document.getElementById('mic-btn');
const micLabel   = document.getElementById('mic-label');
const micSt      = document.getElementById('mic-status-line');
const aiStatusEl = document.getElementById('ai-status-badge');

// ── INIT ──────────────────────────────────────────────
window.addEventListener('load', async () => {
  updateClock();
  setInterval(updateClock, 1000);
  setInterval(updateBars, 2500);
  updateBars();
  updateBattery();
  setInterval(updateBattery, 30000);
  fetchWeather();
  drawGauges();
  setInterval(drawGauges, 3000);

  // Load data from Base44 first, fallback to localStorage
  await loadUserData();
  renderAll();
  setTimeout(jarvisGreet, 700);
});

textInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') handleTextInput();
});

// ── CLOCK ─────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const hm   = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const full  = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const d     = now.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();

  document.getElementById('arc-time').textContent    = hm;
  document.getElementById('arc-date').textContent    = d.split(',')[0] || d;
  document.getElementById('tb-time-big').textContent = hm;
  document.getElementById('tb-date').textContent     = d;
  document.getElementById('tb-cal-num').textContent  = now.getDate();
  document.getElementById('tb-cal-month').textContent = now.toLocaleDateString('en-IN', { month: 'long' }).toUpperCase();
  document.getElementById('tb-cal-day').textContent  = now.toLocaleDateString('en-IN', { weekday: 'long' }).toUpperCase();
  document.getElementById('btab-clock').textContent  = full;
  document.getElementById('btab-datestr').textContent = d;

  const up = Math.floor((Date.now() - t0) / 1000);
  document.getElementById('uptime-val').textContent =
    `${String(Math.floor(up/3600)).padStart(2,'0')}:${String(Math.floor((up%3600)/60)).padStart(2,'0')}:${String(up%60).padStart(2,'0')}`;
}

// ── SYSTEM BARS ───────────────────────────────────────
function updateBars() {
  setBar('cpu', Math.floor(20 + Math.random() * 55));
  setBar('ram', Math.floor(35 + Math.random() * 40));
  setBar('net', Math.floor(15 + Math.random() * 70));
}
function setBar(id, v) {
  const b = document.getElementById(`bar-${id}`);
  const s = document.getElementById(`val-${id}`);
  if (b) b.style.width = v + '%';
  if (s) s.textContent = v + '%';
}

// ── BATTERY ───────────────────────────────────────────
function updateBattery() {
  if (!navigator.getBattery) return;
  navigator.getBattery().then(b => {
    const p  = Math.round(b.level * 100) + '%';
    const st = b.charging ? 'CHARGING ⚡' : 'DISCHARGE';
    document.getElementById('batt-pct').textContent   = p;
    document.getElementById('pwr-status').textContent = b.charging ? 'CHARGING ⚡' : 'BATTERY';
    const bv = document.getElementById('btab-batt-val');
    const bs = document.getElementById('btab-batt-st');
    if (bv) bv.textContent = p;
    if (bs) bs.textContent = st;
  });
}

// ── WEATHER ───────────────────────────────────────────
async function fetchWeather() {
  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000 }));
    const { latitude: lat, longitude: lon } = pos.coords;
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current_weather=true&hourly=relativehumidity_2m,windspeed_10m&daily=sunrise,sunset&timezone=auto`
    );
    const d = await r.json();
    const w = d.current_weather;
    const codes = { 0:'CLEAR SKY',1:'MAINLY CLEAR',2:'PARTLY CLOUDY',3:'OVERCAST',
      45:'FOGGY',48:'FOGGY',51:'DRIZZLE',61:'RAIN',71:'SNOW',80:'SHOWERS',95:'THUNDERSTORM' };
    document.getElementById('w-temp').textContent = Math.round(w.temperature) + '°C';
    document.getElementById('w-cond').textContent = codes[w.weathercode] || 'CLEAR';
    document.getElementById('w-hum').textContent  = (d.hourly?.relativehumidity_2m?.[0] ?? '--') + '%';
    document.getElementById('w-wind').textContent = (d.hourly?.windspeed_10m?.[0] ?? '--') + ' km/h';
    document.getElementById('w-rise').textContent = d.daily?.sunrise?.[0]?.split('T')[1] ?? '--';
    document.getElementById('w-set').textContent  = d.daily?.sunset?.[0]?.split('T')[1] ?? '--';
    const gr = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
    const gd = await gr.json();
    const city = gd.address?.city || gd.address?.town || gd.address?.village || 'UNKNOWN';
    document.getElementById('w-loc').textContent = city.toUpperCase();
    logActivity(`WEATHER: ${Math.round(w.temperature)}°C ${codes[w.weathercode] || 'CLEAR'}`);
  } catch {
    document.getElementById('w-cond').textContent = 'UNAVAILABLE';
    document.getElementById('w-loc').textContent  = 'LOCATION DENIED';
  }
}

// ── GAUGES ────────────────────────────────────────────
function drawGauges() {
  drawArc('gauge-cpu', Math.floor(20 + Math.random() * 60), '#00cfff');
  drawArc('gauge-ram', Math.floor(35 + Math.random() * 45), '#00aaff');
}
function drawArc(id, val, color) {
  const c = document.getElementById(id); if (!c) return;
  const ctx = c.getContext('2d'), W = c.width, H = c.height, cx = W/2, cy = H/2, r = W/2-8;
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath(); ctx.arc(cx,cy,r, 0.75*Math.PI, 2.25*Math.PI);
  ctx.strokeStyle='#0a2030'; ctx.lineWidth=8; ctx.lineCap='round'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,r, 0.75*Math.PI, 0.75*Math.PI+(val/100)*1.5*Math.PI);
  ctx.strokeStyle=color; ctx.lineWidth=8; ctx.lineCap='round'; ctx.stroke();
  ctx.fillStyle=color; ctx.font='bold 13px Orbitron,monospace';
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(val+'%', cx, cy);
}

// ── ACTIVITY LOG ──────────────────────────────────────
function logActivity(msg) {
  const el = document.getElementById('activity-log'); if (!el) return;
  const t = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
  const d = document.createElement('div'); d.className = 'log-entry';
  d.innerHTML = `<span>${t}</span> ${msg}`;
  el.insertBefore(d, el.firstChild);
  if (el.children.length > 25) el.lastChild.remove();
}

// ── DATA: BASE44 SAVE/LOAD ────────────────────────────
async function loadUserData() {
  // Try Base44 first
  try {
    const r = await fetch(DATA_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'load', user_key: USER_KEY })
    });
    const json = await r.json();
    if (json.ok && json.record) {
      rudraData = {
        routine: json.record.routine || [],
        goals:   json.record.goals   || []
      };
      // Also sync to localStorage
      localStorage.setItem(DATA_KEY, JSON.stringify(rudraData));
      logActivity('DATA: Loaded from cloud');
      return;
    }
  } catch {}

  // Fallback to localStorage
  try {
    const local = localStorage.getItem(DATA_KEY);
    if (local) {
      rudraData = JSON.parse(local);
      logActivity('DATA: Loaded from local');
    }
  } catch {}
}

async function saveUserData() {
  // Always save to localStorage immediately
  localStorage.setItem(DATA_KEY, JSON.stringify(rudraData));

  // Save to Base44 in background
  try {
    await fetch(DATA_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:   'save',
        user_key: USER_KEY,
        data:     { routine: rudraData.routine, goals: rudraData.goals }
      })
    });
    logActivity('DATA: Saved to cloud ✓');
  } catch {
    logActivity('DATA: Saved locally only');
  }
}

// ── GREETING ──────────────────────────────────────────
function jarvisGreet() {
  const hour  = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const msg   = `${greet}. I'm Jarvis. How may I assist you?`;
  addMessage(msg, 'jarvis');
  speakHuman(msg, 'warm');
  logActivity('BOOT: Jarvis online · USER: ' + USER_KEY.slice(0,8));
}

// ── TEXT INPUT ────────────────────────────────────────
function handleTextInput() {
  const val = textInput.value.trim();
  if (!val) return;
  voiceMode = false;  // text mode — only write, don't speak
  addMessage(val, 'user');
  textInput.value = '';
  routeCommand(val);
}
window.handleTextInput = handleTextInput;

// ── COMMAND ROUTER ────────────────────────────────────
function routeCommand(cmd) {
  const c = cmd.toLowerCase().trim();
  logActivity(`CMD: ${cmd.slice(0, 32)}`);

  // ── Rudra panel ──
  if (/\brudra\b/i.test(c)) {
    openRudra();
    const dm = c.match(/plan\s+my\s+(\w+)/i);
    if (dm) {
      setTimeout(() => { switchTab('schedule'); setSched(capitalize(dm[1])); }, 400);
      return respond(`Opening Rudra and generating your ${capitalize(dm[1])} schedule.`);
    }
    return respond("Rudra panel is open. You can manage your schedule, goals, and progress.");
  }

  if (/plan\s+my\s+(\w+)/i.test(c)) {
    const dm = c.match(/plan\s+my\s+(\w+)/i);
    openRudra();
    setTimeout(() => { switchTab('schedule'); setSched(capitalize(dm[1])); }, 400);
    return respond(`Generating your ${capitalize(dm[1])} plan.`);
  }

  if (/weekly schedule|full week/i.test(c)) {
    openRudra();
    setTimeout(() => { switchTab('schedule'); generateWeekly(); }, 400);
    return respond("Full weekly schedule is ready.");
  }

  // ── Open websites — IMPORTANT: must call openSite immediately (not async) ──
  const siteMap = {
    youtube:   'https://www.youtube.com',
    google:    'https://www.google.com',
    github:    'https://www.github.com',
    instagram: 'https://www.instagram.com',
    twitter:   'https://www.twitter.com',
    facebook:  'https://www.facebook.com',
    netflix:   'https://www.netflix.com',
    spotify:   'https://www.spotify.com',
    gmail:     'https://mail.google.com',
    maps:      'https://maps.google.com',
    wikipedia: 'https://www.wikipedia.org',
    whatsapp:  'https://web.whatsapp.com'
  };

  for (const [k, url] of Object.entries(siteMap)) {
    if (c.includes(k)) {
      openSiteNow(url, k);
      return;
    }
  }

  const sm = c.match(/^open\s+(https?:\/\/\S+|www\.\S+|\S+\.\S+)/);
  if (sm) {
    openSiteNow(sm[1].startsWith('http') ? sm[1] : 'https://' + sm[1], sm[1]);
    return;
  }

  // ── Play song ──
  const pm = c.match(/^play\s+(.+)/i);
  if (pm) {
    openSiteNow(`https://www.youtube.com/results?search_query=${encodeURIComponent(pm[1])}`, 'YouTube');
    respond(`Searching YouTube for "${pm[1]}".`);
    return;
  }

  // ── Quick queries ──
  if (/what.*time|current time|time now/i.test(c)) {
    return respond(`It's ${new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}.`);
  }
  if (/date|today/i.test(c)) {
    return respond(`Today is ${new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}.`);
  }
  if (/weather/i.test(c)) {
    const t = document.getElementById('w-temp').textContent;
    const cd = document.getElementById('w-cond').textContent;
    const l  = document.getElementById('w-loc').textContent;
    return respond(`It's ${t} and ${cd.toLowerCase()} in ${l}.`);
  }
  if (/battery/i.test(c)) {
    if (navigator.getBattery) {
      navigator.getBattery().then(b =>
        respond(`Battery is at ${Math.round(b.level*100)}%, ${b.charging ? 'currently charging' : 'not charging'}.`)
      );
    } else respond("Battery info isn't accessible from this browser.");
    return;
  }
  if (/stop mic|stop listening|turn off mic/i.test(c)) {
    stopMic();
    return respond("Microphone off.");
  }
  if (/clear|reset chat/i.test(c)) {
    messagesEl.innerHTML = '';
    chatHistory = [];
    return respond("Chat cleared. Ready for new commands.");
  }

  // ── Everything else → Kimi AI ──
  askKimi(cmd);
}

// ── OPEN SITE (synchronous — no async blocking) ───────
// Called directly, opens immediately before any await
function openSiteNow(url, label) {
  // Safest method: create link and click it
  const a = document.createElement('a');
  a.href   = url;
  a.target = '_blank';
  a.rel    = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  respond(`Opening ${label} for you, sir.`);
  logActivity(`OPEN: ${label}`);
}
window.openSite = openSiteNow;

// ── KIMI K2.5 AI ──────────────────────────────────────
async function askKimi(userMsg) {
  // ── KEY FIX: prevent duplicate calls ──
  if (isProcessing) {
    logActivity('AI: Blocked duplicate call');
    return;
  }
  isProcessing = true;

  // Pause mic while AI is working
  const wasMicActive = micActive;
  if (recognition && micActive) {
    try { recognition.stop(); } catch {}
  }

  chatHistory.push({ role: 'user', content: userMsg });
  if (chatHistory.length > 16) chatHistory = chatHistory.slice(-16);

  const thinkEl = showThinking();
  if (aiStatusEl) aiStatusEl.textContent = 'AI: THINKING...';

  const msgDiv = document.createElement('div');
  msgDiv.className = 'msg jarvis';
  messagesEl.appendChild(msgDiv);
  messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;

  let fullText = '';

  const payload = JSON.stringify({
    model: KIMI_MODEL,
    messages: [{ role: 'system', content: buildSysPrompt() }, ...chatHistory],
    max_tokens: 1024,
    temperature: 0.85,
    top_p: 1.0,
    stream: true,
    chat_template_kwargs: { thinking: true }
  });

  const headers = {
    'Authorization': `Bearer ${KIMI_KEY}`,
    'Content-Type':  'application/json',
    'Accept':        'text/event-stream'
  };

  try {
    // Try multiple CORS proxies
    const proxies = [
      KIMI_URL,  // direct (works in some browsers)
      `https://corsproxy.io/?url=${encodeURIComponent(KIMI_URL)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(KIMI_URL)}`
    ];

    let response = null;
    for (const url of proxies) {
      try {
        const r = await fetch(url, { method: 'POST', headers, body: payload });
        if (r.ok) { response = r; break; }
      } catch {}
    }

    if (!response) throw new Error('All endpoints failed');

    removeThinking(thinkEl);

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        const t = line.trim();
        if (!t || t === 'data: [DONE]' || !t.startsWith('data: ')) continue;
        try {
          const j     = JSON.parse(t.slice(6));
          const delta = j.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.reasoning_content) showReasoning(msgDiv, delta.reasoning_content);
          if (delta.content) {
            fullText += delta.content;
            streamText(msgDiv, fullText);
            messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;
          }
        } catch {}
      }
    }

    // Finalize message
    msgDiv.innerHTML = fmtText(fullText);
    chatHistory.push({ role: 'assistant', content: fullText });
    logActivity(`AI: ${fullText.length}ch reply`);

    // Only speak if voice mode is active
    if (voiceMode) {
      speakHuman(fullText.replace(/<[^>]*>/g, '').slice(0, 600), detectEmotion(fullText));
    }

  } catch (err) {
    removeThinking(thinkEl);
    const errMsg = "I couldn't reach my neural network. Please check your internet connection.";
    msgDiv.innerHTML = fmtText(errMsg);
    if (voiceMode) speakHuman(errMsg, 'calm');
    logActivity(`AI ERROR: ${err.message}`);
    console.error('Kimi error:', err);
  }

  if (aiStatusEl) aiStatusEl.textContent = 'AI: KIMI K2.5';
  isProcessing = false;

  // Resume mic after AI is done
  if (wasMicActive && micActive) {
    setTimeout(() => {
      if (micActive && !isSpeaking) {
        try { recognition.start(); } catch {}
      }
    }, 500);
  }
}

function buildSysPrompt() {
  let p = SYSTEM_PROMPT;
  if (rudraData.routine.length > 0) {
    p += '\n\nUser daily routine:\n';
    rudraData.routine.forEach(r => { p += `- ${r.time}: ${r.task}\n`; });
  }
  if (rudraData.goals.length > 0) {
    p += '\nUser learning goals:\n';
    rudraData.goals.forEach(g => { p += `- ${g.name} (${g.duration}, ${g.progress||0}% complete)\n`; });
  }
  return p;
}

function streamText(el, text) {
  el.innerHTML = fmtText(text) + '<span class="cursor">▌</span>';
}

let reasoningEl = null;
function showReasoning(container, token) {
  if (!reasoningEl || !container.contains(reasoningEl)) {
    reasoningEl = document.createElement('div');
    reasoningEl.className = 'reasoning';
    container.appendChild(reasoningEl);
  }
  reasoningEl.textContent += token;
}

function fmtText(t) {
  return t
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/`(.+?)`/g,'<code>$1</code>')
    .replace(/\n/g,'<br>');
}

function showThinking() {
  const el = document.createElement('div');
  el.className = 'msg jarvis thinking';
  el.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  messagesEl.appendChild(el);
  messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;
  return el;
}
function removeThinking(el) { if (el?.parentNode) el.parentNode.removeChild(el); }

// ── RESPOND ───────────────────────────────────────────
// Write always. Speak only if voiceMode is ON.
function respond(text, emotion = 'neutral') {
  addMessage(text, 'jarvis');
  if (voiceMode) speakHuman(text, emotion);
  logActivity(`JARVIS: ${text.slice(0, 28)}`);
}

function addMessage(text, role) {
  const d = document.createElement('div');
  d.className = `msg ${role}`;
  d.textContent = text;
  messagesEl.appendChild(d);
  messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;
  return d;
}

// ── HUMAN VOICE ───────────────────────────────────────
function speakHuman(text, emotion = 'neutral') {
  if (!window.speechSynthesis) return;
  stopSpeech();

  const clean = text.replace(/<[^>]*>/g, '').replace(/[#*`]/g, '').slice(0, 500);
  if (!clean.trim()) return;

  // Split into sentences for natural delivery
  const sentences = clean.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [clean];
  let idx = 0;

  function next() {
    if (idx >= sentences.length) {
      isSpeaking = false;
      // Resume mic after speaking finishes
      if (micActive && !isProcessing) {
        setTimeout(() => {
          try { recognition.start(); } catch {}
        }, 300);
      }
      return;
    }
    const s = sentences[idx++].trim();
    if (!s) { next(); return; }

    const utter = new SpeechSynthesisUtterance(s);
    if (voice) utter.voice = voice;
    utter.lang   = 'en-GB';
    utter.volume = 1;

    // Per-sentence emotion
    const e = detectEmotion(s);
    if      (e === 'excited') { utter.rate = 1.02; utter.pitch = 0.95; }
    else if (e === 'warning') { utter.rate = 0.86; utter.pitch = 0.80; }
    else if (e === 'warm')    { utter.rate = 0.90; utter.pitch = 0.90; }
    else if (e === 'question'){ utter.rate = 0.93; utter.pitch = 0.92; }
    else if (e === 'calm')    { utter.rate = 0.88; utter.pitch = 0.85; }
    else                      { utter.rate = 0.92; utter.pitch = 0.87; }

    utter.onstart = () => {
      isSpeaking = true;
      // Stop mic while speaking — prevents feedback
      if (recognition && micActive) {
        try { recognition.stop(); } catch {}
      }
    };
    utter.onend   = () => { next(); };
    utter.onerror = () => { isSpeaking = false; next(); };

    window.speechSynthesis.speak(utter);
  }

  next();
}

function detectEmotion(text) {
  if (/\?/.test(text)) return 'question';
  if (/warning|error|fail|cannot|denied|alert|critical/i.test(text)) return 'warning';
  if (/great|perfect|done|ready|online|excellent|awesome|absolutely|wonderful/i.test(text)) return 'excited';
  if (/morning|evening|afternoon|hello|welcome|assist/i.test(text)) return 'warm';
  if (/sorry|trouble|unfortunately|issue|problem|couldn't/i.test(text)) return 'calm';
  return 'neutral';
}

function stopSpeech() {
  if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel();
  isSpeaking = false;
}

// ── MIC TOGGLE ────────────────────────────────────────
function toggleMic() {
  micActive ? stopMic() : startMic();
}
window.toggleMic = toggleMic;

function startMic() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    addMessage("Speech recognition requires Chrome browser.", 'jarvis');
    return;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous    = false;  // ← KEY FIX: single result, then restart manually
  recognition.interimResults = false;
  recognition.lang           = 'en-IN';
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    micActive  = true;
    voiceMode  = true;
    micBtn.classList.add('active');
    micLabel.textContent = 'LISTENING...';
    micSt.textContent    = 'Click to stop';
    logActivity('MIC: Active');
  };

  recognition.onresult = e => {
    if (!micActive) return;

    const transcript = e.results[0]?.[0]?.transcript?.trim();
    if (!transcript) return;

    logActivity(`HEARD: ${transcript.slice(0,30)}`);

    // If Jarvis is speaking, stop it first
    if (isSpeaking) stopSpeech();

    // If AI is already processing, skip this result
    if (isProcessing) {
      logActivity('MIC: Skipped (AI busy)');
      return;
    }

    addMessage(transcript, 'user');
    routeCommand(transcript);
  };

  recognition.onerror = e => {
    if (e.error === 'not-allowed') {
      addMessage("Microphone access denied. Please allow mic permission.", 'jarvis');
      stopMic();
    } else if (e.error === 'no-speech') {
      // Normal — just restart
    }
    logActivity(`MIC ERR: ${e.error}`);
  };

  recognition.onend = () => {
    // Auto-restart ONLY if mic is still supposed to be active AND not speaking AND not processing
    if (micActive && !isSpeaking && !isProcessing) {
      setTimeout(() => {
        if (micActive) {
          try { recognition.start(); }
          catch { logActivity('MIC: restart failed'); }
        }
      }, 400);
    }
  };

  recognition.start();
}

function stopMic() {
  micActive  = false;
  voiceMode  = false;
  if (recognition) { try { recognition.stop(); } catch {} }
  micBtn.classList.remove('active');
  micLabel.textContent = 'TAP TO SPEAK';
  micSt.textContent    = 'Microphone OFF';
  logActivity('MIC: Stopped');
}

// ── BOTTOM TABS ───────────────────────────────────────
window.btabClick = function(btn, tab) {
  document.querySelectorAll('.btab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.btab-pane').forEach(p => p.classList.add('hidden'));
  document.getElementById(`btab-${tab}`)?.classList.remove('hidden');
};

// ── ALARM ─────────────────────────────────────────────
window.setAlarm = function() {
  const t = document.getElementById('alarm-time').value;
  if (!t) return;
  if (alarmTimer) clearInterval(alarmTimer);
  document.getElementById('alarm-st').textContent = `SET: ${t}`;
  logActivity(`ALARM: ${t}`);
  alarmTimer = setInterval(() => {
    const n = new Date();
    const cur = String(n.getHours()).padStart(2,'0') + ':' + String(n.getMinutes()).padStart(2,'0');
    if (cur === t) {
      clearInterval(alarmTimer);
      document.getElementById('alarm-st').textContent = '⚡ TRIGGERED!';
      const msg = "Sir, your alarm is going off. Time to get moving.";
      addMessage(msg, 'jarvis');
      speakHuman(msg, 'excited');
      logActivity('ALARM: TRIGGERED');
    }
  }, 10000);
};

// ── JOKE ──────────────────────────────────────────────
window.fetchJoke = async function() {
  try {
    const r = await fetch('https://v2.jokeapi.dev/joke/Programming,Misc?type=single&blacklistFlags=nsfw,racist');
    const d = await r.json();
    const j = d.joke || `${d.setup} — ${d.delivery}`;
    document.getElementById('joke-text').textContent = j;
    respond(j, 'excited');
  } catch {
    document.getElementById('joke-text').textContent = 'Could not fetch joke.';
  }
};

// ── QUICK BUTTONS ─────────────────────────────────────
window.qCmd = function(cmd) {
  const map = {
    time:    () => respond(`It's ${new Date().toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'})}.`),
    weather: () => routeCommand('weather'),
    yt:      () => openSiteNow('https://www.youtube.com', 'YouTube'),
    joke:    () => fetchJoke()
  };
  if (map[cmd]) map[cmd]();
};

// ── RUDRA PANEL ───────────────────────────────────────
function openRudra() {
  document.getElementById('rudra-panel').classList.remove('hidden');
  document.getElementById('overlay').classList.remove('hidden');
}
function closeRudra() {
  document.getElementById('rudra-panel').classList.add('hidden');
  document.getElementById('overlay').classList.add('hidden');
}
window.openRudra  = openRudra;
window.closeRudra = closeRudra;

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== `tab-${tab}`));
}
window.switchTab = switchTab;

// ── ROUTINE ───────────────────────────────────────────
window.addRoutine = function() {
  const time = document.getElementById('routine-time').value.trim();
  const task = document.getElementById('routine-task').value.trim();
  if (!time || !task) return;
  rudraData.routine.push({ id: Date.now(), time, task });
  saveUserData(); renderRoutine();
  document.getElementById('routine-time').value = '';
  document.getElementById('routine-task').value = '';
};

function renderRoutine() {
  const el = document.getElementById('routine-list'); el.innerHTML = '';
  [...rudraData.routine].sort((a,b) => a.time.localeCompare(b.time)).forEach(r => {
    el.innerHTML += `<div class="entry-item">
      <span class="et">${r.time} — ${r.task}</span>
      <button class="eb" onclick="editRoutine(${r.id})">✏️</button>
      <button class="ed" onclick="delRoutine(${r.id})">🗑</button>
    </div>`;
  });
}

window.delRoutine  = function(id) {
  rudraData.routine = rudraData.routine.filter(r => r.id !== id);
  saveUserData(); renderRoutine();
};
window.editRoutine = function(id) {
  const i = rudraData.routine.find(r => r.id === id); if (!i) return;
  const t = prompt('Time:', i.time); const k = prompt('Task:', i.task);
  if (t !== null) i.time = t.trim();
  if (k !== null) i.task = k.trim();
  saveUserData(); renderRoutine();
};

// ── GOALS ─────────────────────────────────────────────
window.addGoal = function() {
  const name = document.getElementById('goal-name').value.trim();
  const dur  = document.getElementById('goal-duration').value.trim();
  if (!name || !dur) return;
  rudraData.goals.push({ id: Date.now(), name, duration: dur, progress: 0 });
  saveUserData(); renderGoals(); renderProgress();
  document.getElementById('goal-name').value     = '';
  document.getElementById('goal-duration').value = '';
};

function renderGoals() {
  const el = document.getElementById('goals-list'); el.innerHTML = '';
  rudraData.goals.forEach(g => {
    el.innerHTML += `<div class="entry-item">
      <span class="et">${g.name}</span>
      <span class="em">${g.duration}</span>
      <button class="eb" onclick="editGoal(${g.id})">✏️</button>
      <button class="ed" onclick="delGoal(${g.id})">🗑</button>
    </div>`;
  });
}

window.delGoal  = function(id) {
  rudraData.goals = rudraData.goals.filter(g => g.id !== id);
  saveUserData(); renderGoals(); renderProgress();
};
window.editGoal = function(id) {
  const i = rudraData.goals.find(g => g.id === id); if (!i) return;
  const n = prompt('Goal:', i.name); const d = prompt('Duration:', i.duration);
  if (n !== null) i.name = n.trim();
  if (d !== null) i.duration = d.trim();
  saveUserData(); renderGoals(); renderProgress();
};

// ── SCHEDULE ──────────────────────────────────────────
function setSched(day) {
  const sel = document.getElementById('schedule-day');
  if (sel) sel.value = day;
  generateSchedule();
}

window.generateSchedule = function() {
  const day   = document.getElementById('schedule-day').value;
  const slots = buildDay(day);
  document.getElementById('schedule-output').innerHTML =
    `<h4 style="color:#ff6b00;margin-bottom:6px;font-size:11px;letter-spacing:2px;">${day.toUpperCase()}</h4>` + buildTable(slots);
};

window.generateWeekly = function() {
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  document.getElementById('schedule-output').innerHTML = days.map(d =>
    `<h4 style="color:#ff6b00;margin:10px 0 4px;font-size:11px;letter-spacing:2px;">${d.toUpperCase()}</h4>` + buildTable(buildDay(d))
  ).join('');
};

function buildDay(day) {
  const isWE = ['Saturday','Sunday'].includes(day);
  const slots = [];
  rudraData.routine.forEach(r => slots.push({ time: r.time, task: r.task }));
  if (rudraData.goals.length > 0) {
    const ss = isWE
      ? [['9:00 AM','10:30 AM'],['11:00 AM','12:30 PM'],['3:00 PM','4:30 PM'],['5:00 PM','6:30 PM']]
      : [['6:00 AM','7:00 AM'],['4:00 PM','5:30 PM'],['8:00 PM','9:30 PM']];
    rudraData.goals.forEach((g,i) => {
      const s = ss[i % ss.length];
      slots.push({ time: `${s[0]}–${s[1]}`, task: `📚 ${g.name}` });
    });
  }
  if (rudraData.routine.length === 0) {
    slots.push(
      { time:'6:00 AM', task:'Wake up & Morning Routine' },
      { time:'7:00 AM', task:'Exercise / Yoga' },
      { time:'8:00 AM', task:'Breakfast' }
    );
    if (!isWE) slots.push({ time:'9:00 AM–5:00 PM', task:'College / Work' });
    slots.push(
      { time:'9:00 PM',  task:'Wind down / Read' },
      { time:'10:30 PM', task:'Sleep' }
    );
  }
  slots.sort((a, b) => {
    const f = t => {
      const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i); if (!m) return 9999;
      let h = parseInt(m[1]);
      if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
      if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
      return h * 60 + parseInt(m[2]);
    };
    return f(a.time) - f(b.time);
  });
  return slots;
}

function buildTable(slots) {
  return `<table class="st"><thead><tr><th>TIME</th><th>TASK</th></tr></thead><tbody>` +
    slots.map(s => `<tr><td contenteditable="true">${s.time}</td><td contenteditable="true">${s.task}</td></tr>`).join('') +
    `</tbody></table>`;
}

// ── PROGRESS ──────────────────────────────────────────
function renderProgress() {
  const el = document.getElementById('progress-list'); el.innerHTML = '';
  if (!rudraData.goals.length) {
    el.innerHTML = '<p style="color:#336688;font-size:10px;padding:4px">No goals yet. Add them in the Agheera tab.</p>';
    return;
  }
  rudraData.goals.forEach(g => {
    const pct = g.progress || 0;
    el.innerHTML += `<div class="pi">
      <div class="ph">
        <span class="pt">${g.name} <small style="color:#336688">(${g.duration})</small></span>
        <span class="pp" id="ph-${g.id}">${pct}%</span>
      </div>
      <div class="pb-bg"><div class="pb-fill" id="pb-${g.id}" style="width:${pct}%"></div></div>
      <div class="pc">
        <input type="range" min="0" max="100" value="${pct}" oninput="updateProg(${g.id},this.value)"/>
        <span style="font-size:10px;color:#336688" id="pp-${g.id}">${pct}%</span>
      </div>
    </div>`;
  });
}

window.updateProg = function(id, val) {
  const g = rudraData.goals.find(g => g.id === id); if (!g) return;
  g.progress = parseInt(val);
  saveUserData();
  const pb = document.getElementById(`pb-${g.id}`);
  const pp = document.getElementById(`pp-${g.id}`);
  const ph = document.getElementById(`ph-${g.id}`);
  if (pb) pb.style.width = val + '%';
  if (pp) pp.textContent = val + '%';
  if (ph) ph.textContent = val + '%';
};

function renderAll() { renderRoutine(); renderGoals(); renderProgress(); }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }
