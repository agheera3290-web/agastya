// ═══════════════════════════════════════════════════════
//  JARVIS / RUDRA  ·  Iron Man HUD  ·  Kimi K2.5 AI
// ═══════════════════════════════════════════════════════

// ── AI CONFIG ────────────────────────────────────────
const KIMI_KEY   = "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";
const KIMI_MODEL = "moonshotai/kimi-k2.5";
const KIMI_URL   = "https://integrate.api.nvidia.com/v1/chat/completions";
// CORS proxy fallback
const PROXY_URL  = "https://corsproxy.io/?url=" + encodeURIComponent(KIMI_URL);

const SYSTEM_PROMPT = `You are Jarvis, also called Rudra — the most advanced personal AI assistant ever created.
You speak like a highly intelligent, emotionally aware, warm human being — never robotic.
You have a naturally confident, slightly British tone. You use natural pauses, warmth, wit, and clarity.
You adapt your emotional tone: excited when something is great, thoughtful when something is complex, calm and direct when being helpful.
Never sound like a machine. Never use filler phrases. Be concise but complete.
Address the user as "sir" occasionally but naturally — not every sentence.`;

// ── STATE ─────────────────────────────────────────────
let micActive   = false;
let recognition = null;
let isSpeaking  = false;
let inputMode   = 'text';
let chatHistory = [];
let alarmTimer  = null;
const t0        = Date.now();
const DATA_KEY  = 'rudra_data_v2';
let rudraData   = loadData();

// ── VOICE ─────────────────────────────────────────────
let voices = [], voice = null;

function initVoices() {
  voices = window.speechSynthesis.getVoices();
  // Priority: Google UK English Male → Daniel (UK) → any en-GB → any en male
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
window.addEventListener('load', () => {
  updateClock();
  setInterval(updateClock, 1000);
  setInterval(updateBars, 2500);
  updateBars();
  updateBattery();
  setInterval(updateBattery, 30000);
  fetchWeather();
  drawGauges();
  setInterval(drawGauges, 3000);
  renderAll();
  setTimeout(jarvisGreet, 700);
});

textInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleTextInput(); });

// ── CLOCK ─────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const hm  = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const full = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const d    = now.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  const day  = now.getDate();
  const mon  = now.toLocaleDateString('en-IN', { month: 'long' }).toUpperCase();
  const wd   = now.toLocaleDateString('en-IN', { weekday: 'long' }).toUpperCase();

  document.getElementById('arc-time').textContent     = hm;
  document.getElementById('arc-date').textContent     = d.split(',')[0] || d;
  document.getElementById('tb-time-big').textContent  = hm;
  document.getElementById('tb-date').textContent      = d;
  document.getElementById('tb-cal-num').textContent   = day;
  document.getElementById('tb-cal-month').textContent = mon;
  document.getElementById('tb-cal-day').textContent   = wd;
  document.getElementById('btab-clock').textContent   = full;
  document.getElementById('btab-datestr').textContent = d;

  const up = Math.floor((Date.now() - t0) / 1000);
  const h = String(Math.floor(up / 3600)).padStart(2,'0');
  const m = String(Math.floor((up % 3600) / 60)).padStart(2,'0');
  const s = String(up % 60).padStart(2,'0');
  document.getElementById('uptime-val').textContent = `${h}:${m}:${s}`;
}

// ── SYSTEM BARS ───────────────────────────────────────
function updateBars() {
  const cpu = Math.floor(20 + Math.random() * 55);
  const ram = Math.floor(35 + Math.random() * 40);
  const net = Math.floor(15 + Math.random() * 70);
  setBar('cpu', cpu); setBar('ram', ram); setBar('net', net);
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
    const p = Math.round(b.level * 100) + '%';
    const st = b.charging ? 'CHARGING ⚡' : 'DISCHARGE';
    document.getElementById('batt-pct').textContent = p;
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
      `&current_weather=true&hourly=relativehumidity_2m,windspeed_10m` +
      `&daily=sunrise,sunset&timezone=auto`
    );
    const d = await r.json();
    const w = d.current_weather;
    const codes = { 0:'CLEAR SKY',1:'MAINLY CLEAR',2:'PARTLY CLOUDY',3:'OVERCAST',
      45:'FOGGY',48:'FOGGY',51:'DRIZZLE',61:'RAIN',71:'SNOW',80:'SHOWERS',95:'THUNDERSTORM' };
    const desc = codes[w.weathercode] || 'CLEAR';
    const hum  = d.hourly?.relativehumidity_2m?.[0] ?? '--';
    const wind = d.hourly?.windspeed_10m?.[0] ?? '--';
    const rise = d.daily?.sunrise?.[0]?.split('T')[1] ?? '--';
    const set  = d.daily?.sunset?.[0]?.split('T')[1] ?? '--';

    document.getElementById('w-temp').textContent = Math.round(w.temperature) + '°C';
    document.getElementById('w-cond').textContent = desc;
    document.getElementById('w-hum').textContent  = hum + '%';
    document.getElementById('w-wind').textContent = wind + ' km/h';
    document.getElementById('w-rise').textContent = rise;
    document.getElementById('w-set').textContent  = set;

    const gr = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
    const gd = await gr.json();
    const city = gd.address?.city || gd.address?.town || gd.address?.village || 'UNKNOWN';
    document.getElementById('w-loc').textContent = city.toUpperCase();
    logActivity(`WEATHER: ${Math.round(w.temperature)}°C ${desc}`);
  } catch {
    document.getElementById('w-cond').textContent = 'LOCATION DENIED';
    document.getElementById('w-loc').textContent  = 'UNAVAILABLE';
  }
}

// ── GAUGES ────────────────────────────────────────────
function drawGauges() {
  drawArcGauge('gauge-cpu', Math.floor(20 + Math.random() * 60), '#00cfff', 'CPU');
  drawArcGauge('gauge-ram', Math.floor(35 + Math.random() * 45), '#00aaff', 'RAM');
}

function drawArcGauge(id, val, color, label) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2, r = W / 2 - 8;
  ctx.clearRect(0, 0, W, H);

  // Background arc
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0.75 * Math.PI, 2.25 * Math.PI);
  ctx.strokeStyle = '#0a2030';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Value arc
  const end = 0.75 * Math.PI + (val / 100) * 1.5 * Math.PI;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0.75 * Math.PI, end);
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Text
  ctx.fillStyle = color;
  ctx.font = `bold 14px Orbitron, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(val + '%', cx, cy);
}

// ── ACTIVITY LOG ──────────────────────────────────────
function logActivity(msg) {
  const el = document.getElementById('activity-log');
  if (!el) return;
  const t = new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const d = document.createElement('div');
  d.className = 'log-entry';
  d.innerHTML = `<span>${t}</span> ${msg}`;
  el.insertBefore(d, el.firstChild);
  if (el.children.length > 25) el.lastChild.remove();
}

// ── GREETING ──────────────────────────────────────────
function jarvisGreet() {
  const hour  = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const msg   = `${greet}. I'm Jarvis. How may I assist you?`;
  addMessage(msg, 'jarvis');
  speakHuman(msg, { emotion: 'warm' });
  logActivity('BOOT: Jarvis online');
}

// ── TEXT INPUT ────────────────────────────────────────
function handleTextInput() {
  const val = textInput.value.trim();
  if (!val) return;
  inputMode = 'text';
  addMessage(val, 'user');
  textInput.value = '';
  routeCommand(val);
}
window.handleTextInput = handleTextInput;

// ── COMMAND ROUTER ────────────────────────────────────
function routeCommand(cmd) {
  const c = cmd.toLowerCase().trim();
  logActivity(`CMD: ${cmd.slice(0, 32)}`);

  // Rudra
  if (/\brudra\b/i.test(c)) {
    openRudra();
    const dm = c.match(/plan\s+my\s+(\w+)/i);
    if (dm) {
      setTimeout(() => { switchTab('schedule'); setSched(capitalize(dm[1])); }, 400);
      return respond(`Opening Rudra and generating your ${capitalize(dm[1])} schedule.`);
    }
    return respond("Rudra panel is open. Manage your schedule, goals, and progress.");
  }

  if (/plan\s+my\s+(\w+)/i.test(c)) {
    const dm = c.match(/plan\s+my\s+(\w+)/i);
    openRudra(); setTimeout(() => { switchTab('schedule'); setSched(capitalize(dm[1])); }, 400);
    return respond(`Generating your ${capitalize(dm[1])} plan.`);
  }

  if (/weekly schedule|full week/i.test(c)) {
    openRudra(); setTimeout(() => { switchTab('schedule'); generateWeekly(); }, 400);
    return respond("Full weekly schedule is ready.");
  }

  // Sites
  const sites = {
    youtube: 'https://www.youtube.com', google: 'https://www.google.com',
    github: 'https://www.github.com', instagram: 'https://www.instagram.com',
    twitter: 'https://www.twitter.com', facebook: 'https://www.facebook.com',
    netflix: 'https://www.netflix.com', spotify: 'https://www.spotify.com',
    gmail: 'https://mail.google.com', maps: 'https://maps.google.com',
    wikipedia: 'https://www.wikipedia.org'
  };
  for (const [k, url] of Object.entries(sites)) {
    if (c.includes(k)) { openSite(url, k); return; }
  }
  const sm = c.match(/^open\s+(https?:\/\/\S+|www\.\S+|\S+\.\S+)/);
  if (sm) { openSite(sm[1].startsWith('http') ? sm[1] : 'https://' + sm[1], sm[1]); return; }

  // Play
  const pm = c.match(/^play\s+(.+)/i);
  if (pm) {
    openSite(`https://www.youtube.com/results?search_query=${encodeURIComponent(pm[1])}`, 'YouTube');
    return respond(`Searching YouTube for "${pm[1]}".`);
  }

  // Quick queries
  if (/what.*time|current time|time now/i.test(c)) {
    const t = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return respond(`It's ${t}.`);
  }
  if (/date|today/i.test(c)) {
    return respond(`Today is ${new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`);
  }
  if (/weather/i.test(c)) {
    const temp = document.getElementById('w-temp').textContent;
    const cond = document.getElementById('w-cond').textContent;
    const loc  = document.getElementById('w-loc').textContent;
    return respond(`It's ${temp} and ${cond.toLowerCase()} in ${loc}.`);
  }
  if (/battery/i.test(c)) {
    if (navigator.getBattery) {
      navigator.getBattery().then(b => respond(`Battery is at ${Math.round(b.level * 100)}%, ${b.charging ? 'currently charging' : 'not charging'}.`));
    } else respond("Battery info isn't accessible from this browser.");
    return;
  }
  if (/stop mic|stop listening|turn off mic/i.test(c)) { stopMic(); return respond("Microphone off."); }
  if (/clear|reset chat/i.test(c)) { messagesEl.innerHTML = ''; chatHistory = []; return respond("Chat cleared."); }

  // → AI
  askKimi(cmd);
}

// ── OPEN SITE ─────────────────────────────────────────
function openSite(url, label) {
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  respond(`Opening ${label} for you.`);
  logActivity(`OPEN: ${label}`);
}
window.openSite = openSite;

// ── KIMI K2.5 AI ──────────────────────────────────────
async function askKimi(userMsg) {
  chatHistory.push({ role: 'user', content: userMsg });
  if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);

  const thinkEl = showThinking();
  if (aiStatusEl) { aiStatusEl.textContent = 'AI: THINKING...'; }

  const msgDiv = document.createElement('div');
  msgDiv.className = 'msg jarvis';
  messagesEl.appendChild(msgDiv);
  messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;

  let fullText = '';

  const payload = JSON.stringify({
    model: KIMI_MODEL,
    messages: [{ role: 'system', content: buildSysPrompt() }, ...chatHistory],
    max_tokens: 2048,
    temperature: 1.0,
    top_p: 1.0,
    stream: true,
    chat_template_kwargs: { thinking: true }
  });

  const headers = {
    'Authorization': `Bearer ${KIMI_KEY}`,
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream'
  };

  try {
    let response;

    // Try direct first
    try {
      response = await fetch(KIMI_URL, { method: 'POST', headers, body: payload });
      if (!response.ok) throw new Error(`${response.status}`);
    } catch (e1) {
      // Fallback to CORS proxy
      try {
        response = await fetch(PROXY_URL, { method: 'POST', headers, body: payload });
        if (!response.ok) throw new Error(`proxy ${response.status}`);
      } catch (e2) {
        throw new Error('Both direct and proxy failed. Check network / API key.');
      }
    }

    removeThinking(thinkEl);

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let hasContent = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        const t = line.trim();
        if (!t || t === 'data: [DONE]') continue;
        if (!t.startsWith('data: ')) continue;
        try {
          const j = JSON.parse(t.slice(6));
          const delta = j.choices?.[0]?.delta;
          if (!delta) continue;

          // Kimi thinking tokens
          if (delta.reasoning_content) {
            showReasoning(msgDiv, delta.reasoning_content);
          }

          if (delta.content) {
            fullText += delta.content;
            hasContent = true;
            streamText(msgDiv, fullText);
            messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;
          }
        } catch {}
      }
    }

    // Finalize
    msgDiv.innerHTML = fmtText(fullText);
    chatHistory.push({ role: 'assistant', content: fullText });
    logActivity(`AI: ${fullText.length}ch reply`);

    // Speak with emotion
    const emotion = detectEmotion(fullText);
    speakHuman(fullText.replace(/<[^>]*>/g, '').slice(0, 600), { emotion });

  } catch (err) {
    removeThinking(thinkEl);
    const errMsg = "I'm having a bit of trouble reaching my neural network right now. Please check your connection and try again.";
    msgDiv.innerHTML = fmtText(errMsg);
    speakHuman(errMsg, { emotion: 'calm' });
    logActivity(`AI ERROR: ${err.message}`);
    console.error('Kimi error:', err);
  }

  if (aiStatusEl) aiStatusEl.textContent = 'AI: KIMI K2.5';
}

function buildSysPrompt() {
  let p = SYSTEM_PROMPT;
  if (rudraData.routine.length > 0) {
    p += '\n\nUser daily routine:\n';
    rudraData.routine.forEach(r => { p += `- ${r.time}: ${r.task}\n`; });
  }
  if (rudraData.goals.length > 0) {
    p += '\nUser learning goals:\n';
    rudraData.goals.forEach(g => { p += `- ${g.name} (${g.duration}, ${g.progress || 0}% complete)\n`; });
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
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
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
function respond(text, emotion = 'neutral') {
  addMessage(text, 'jarvis');
  speakHuman(text, { emotion });
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
// Emotions: warm | excited | serious | calm | question | neutral
function speakHuman(text, { emotion = 'neutral', maxLen = 550 } = {}) {
  if (!window.speechSynthesis) return;
  stopSpeech();

  const clean = text.replace(/<[^>]*>/g, '').replace(/[#*`]/g, '').slice(0, maxLen);
  if (!clean.trim()) return;

  // Split into sentences for more natural delivery
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
  let idx = 0;

  function speakNext() {
    if (idx >= sentences.length) {
      isSpeaking = false;
      if (micActive) { try { recognition.start(); } catch {} }
      return;
    }

    const sentence = sentences[idx++].trim();
    if (!sentence) { speakNext(); return; }

    const utter = new SpeechSynthesisUtterance(sentence);
    if (voice) utter.voice = voice;
    utter.lang = 'en-GB';
    utter.volume = 1;

    // Detect per-sentence emotion
    const e = detectEmotion(sentence);

    switch (e) {
      case 'excited':
        utter.rate  = 1.05;
        utter.pitch = 1.0;
        break;
      case 'serious':
      case 'warning':
        utter.rate  = 0.88;
        utter.pitch = 0.82;
        break;
      case 'warm':
        utter.rate  = 0.92;
        utter.pitch = 0.9;
        break;
      case 'question':
        utter.rate  = 0.95;
        utter.pitch = 0.92;
        break;
      case 'calm':
        utter.rate  = 0.90;
        utter.pitch = 0.85;
        break;
      default:
        utter.rate  = 0.93;
        utter.pitch = 0.87;
    }

    utter.onstart = () => {
      isSpeaking = true;
      if (recognition && micActive) { try { recognition.stop(); } catch {} }
    };
    utter.onend  = () => { speakNext(); };
    utter.onerror = () => { isSpeaking = false; speakNext(); };

    window.speechSynthesis.speak(utter);
  }

  speakNext();
}

function detectEmotion(text) {
  if (/\?/.test(text)) return 'question';
  if (/warning|error|fail|cannot|denied|alert|critical/i.test(text)) return 'warning';
  if (/great|perfect|done|ready|online|excellent|awesome|absolutely/i.test(text)) return 'excited';
  if (/morning|evening|afternoon|hello|welcome/i.test(text)) return 'warm';
  if (/sorry|trouble|unfortunately|issue|problem/i.test(text)) return 'calm';
  return 'neutral';
}

function stopSpeech() {
  if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel();
  isSpeaking = false;
}

// ── MIC ───────────────────────────────────────────────
function toggleMic() {
  micActive ? stopMic() : startMic();
}
window.toggleMic = toggleMic;

function startMic() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    respond("Speech recognition isn't supported in this browser. Please use Chrome.");
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-IN';

  recognition.onstart = () => {
    micActive = true; inputMode = 'voice';
    micBtn.classList.add('active');
    micLabel.textContent = 'LISTENING...';
    micSt.textContent    = 'Click to stop';
    document.getElementById('voice-state') &&
      (document.getElementById('voice-state').textContent = 'ACTIVE');
    logActivity('MIC: Activated');
  };

  recognition.onresult = e => {
    const t = Array.from(e.results).slice(e.resultIndex).map(r => r[0].transcript).join('').trim();
    if (!t) return;
    if (isSpeaking) stopSpeech();
    addMessage(t, 'user');
    routeCommand(t);
  };

  recognition.onerror = e => {
    if (e.error === 'not-allowed') { respond("Microphone access denied."); stopMic(); }
  };

  recognition.onend = () => {
    if (micActive) { try { recognition.start(); } catch {} }
  };

  recognition.start();
}

function stopMic() {
  micActive = false; inputMode = 'text';
  if (recognition) { try { recognition.stop(); } catch {} }
  micBtn.classList.remove('active');
  micLabel.textContent = 'TAP TO SPEAK';
  micSt.textContent    = 'Microphone OFF';
  logActivity('MIC: Deactivated');
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
      respond("Your alarm is going off, sir. Time to get moving.");
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

// ── QUICK ─────────────────────────────────────────────
window.qCmd = function(cmd) {
  ({ time: () => respond(`It's ${new Date().toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'})}.`),
     weather: () => routeCommand('weather'),
     yt: () => openSite('https://www.youtube.com', 'YouTube'),
     joke: () => fetchJoke()
  })[cmd]?.();
};

// ── RUDRA ─────────────────────────────────────────────
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

// ── DATA ──────────────────────────────────────────────
function loadData() {
  try { return JSON.parse(localStorage.getItem(DATA_KEY)) || { routine:[], goals:[] }; }
  catch { return { routine:[], goals:[] }; }
}
function saveData() { localStorage.setItem(DATA_KEY, JSON.stringify(rudraData)); }

window.addRoutine = function() {
  const time = document.getElementById('routine-time').value.trim();
  const task = document.getElementById('routine-task').value.trim();
  if (!time||!task) return;
  rudraData.routine.push({ id: Date.now(), time, task });
  saveData(); renderRoutine();
  document.getElementById('routine-time').value = '';
  document.getElementById('routine-task').value = '';
};
function renderRoutine() {
  const el = document.getElementById('routine-list'); el.innerHTML = '';
  [...rudraData.routine].sort((a,b)=>a.time.localeCompare(b.time)).forEach(r => {
    el.innerHTML += `<div class="entry-item"><span class="et">${r.time} — ${r.task}</span>
      <button class="eb" onclick="editRoutine(${r.id})">✏️</button>
      <button class="ed" onclick="delRoutine(${r.id})">🗑</button></div>`;
  });
}
window.delRoutine  = function(id) { rudraData.routine = rudraData.routine.filter(r=>r.id!==id); saveData(); renderRoutine(); };
window.editRoutine = function(id) {
  const i = rudraData.routine.find(r=>r.id===id); if(!i) return;
  const t = prompt('Time:', i.time); const k = prompt('Task:', i.task);
  if(t!==null) i.time=t.trim(); if(k!==null) i.task=k.trim();
  saveData(); renderRoutine();
};

window.addGoal = function() {
  const name = document.getElementById('goal-name').value.trim();
  const dur  = document.getElementById('goal-duration').value.trim();
  if (!name||!dur) return;
  rudraData.goals.push({ id: Date.now(), name, duration: dur, progress: 0 });
  saveData(); renderGoals(); renderProgress();
  document.getElementById('goal-name').value = '';
  document.getElementById('goal-duration').value = '';
};
function renderGoals() {
  const el = document.getElementById('goals-list'); el.innerHTML = '';
  rudraData.goals.forEach(g => {
    el.innerHTML += `<div class="entry-item"><span class="et">${g.name}</span><span class="em">${g.duration}</span>
      <button class="eb" onclick="editGoal(${g.id})">✏️</button>
      <button class="ed" onclick="delGoal(${g.id})">🗑</button></div>`;
  });
}
window.delGoal  = function(id) { rudraData.goals = rudraData.goals.filter(g=>g.id!==id); saveData(); renderGoals(); renderProgress(); };
window.editGoal = function(id) {
  const i = rudraData.goals.find(g=>g.id===id); if(!i) return;
  const n = prompt('Goal:', i.name); const d = prompt('Duration:', i.duration);
  if(n!==null) i.name=n.trim(); if(d!==null) i.duration=d.trim();
  saveData(); renderGoals(); renderProgress();
};

// ── SCHEDULE ──────────────────────────────────────────
function setSched(day) {
  const sel = document.getElementById('schedule-day');
  if (sel) sel.value = day;
  generateSchedule();
}

window.generateSchedule = function() {
  const day = document.getElementById('schedule-day').value;
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
    slots.push({time:'6:00 AM',task:'Wake up'},{time:'7:00 AM',task:'Exercise'},{time:'8:00 AM',task:'Breakfast'});
    if (!isWE) slots.push({time:'9:00 AM–5:00 PM',task:'College / Work'});
    slots.push({time:'9:00 PM',task:'Wind down'},{time:'10:30 PM',task:'Sleep'});
  }
  slots.sort((a,b) => {
    const f = t => {
      const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i); if(!m) return 9999;
      let h = parseInt(m[1]);
      if(m[3].toUpperCase()==='PM'&&h!==12) h+=12;
      if(m[3].toUpperCase()==='AM'&&h===12) h=0;
      return h*60+parseInt(m[2]);
    };
    return f(a.time)-f(b.time);
  });
  return slots;
}

function buildTable(slots) {
  return `<table class="st"><thead><tr><th>TIME</th><th>TASK</th></tr></thead><tbody>` +
    slots.map(s=>`<tr><td contenteditable="true">${s.time}</td><td contenteditable="true">${s.task}</td></tr>`).join('') +
    `</tbody></table>`;
}

// ── PROGRESS ──────────────────────────────────────────
function renderProgress() {
  const el = document.getElementById('progress-list'); el.innerHTML = '';
  if (!rudraData.goals.length) { el.innerHTML = '<p style="color:#336688;font-size:10px;">No goals yet. Add in Agheera tab.</p>'; return; }
  rudraData.goals.forEach(g => {
    const pct = g.progress || 0;
    el.innerHTML += `<div class="pi">
      <div class="ph"><span class="pt">${g.name} <small style="color:#336688">(${g.duration})</small></span><span class="pp" id="ph-${g.id}">${pct}%</span></div>
      <div class="pb-bg"><div class="pb-fill" id="pb-${g.id}" style="width:${pct}%"></div></div>
      <div class="pc"><input type="range" min="0" max="100" value="${pct}" oninput="updateProg(${g.id},this.value)"/>
      <span style="font-size:10px;color:#336688" id="pp-${g.id}">${pct}%</span></div></div>`;
  });
}
window.updateProg = function(id, val) {
  const g = rudraData.goals.find(g=>g.id===id); if(!g) return;
  g.progress = parseInt(val); saveData();
  ['pb','pp','ph'].forEach(p => {
    const el = document.getElementById(`${p}-${g.id}`);
    if (!el) return;
    if (p==='pb') el.style.width=val+'%'; else el.textContent=val+'%';
  });
};

function renderAll() { renderRoutine(); renderGoals(); renderProgress(); }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }
