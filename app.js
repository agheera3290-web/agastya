// ═══════════════════════════════════════════════════════════════
//  R.U.D.R.A  OS  ·  v7  FINAL
//  All 6 fixes:
//  1. Name = Rudra
//  2. Close YouTube/tabs/panel by voice
//  3. Background tab listening (Page Visibility API)
//  4. Mobile voice fix (push-to-talk + continuous)
//  5. Smart schedule respecting college hours
//  6. Learning agent — grows brain session by session
// ═══════════════════════════════════════════════════════════════

const JARVIS_KEY = "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";
const RUDRA_KEY  = "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";
const AI_MODEL   = "openai/gpt-oss-120b";
const AI_URL     = "https://integrate.api.nvidia.com/v1/chat/completions";
const PROXY_URL  = "https://corsproxy.io/?url=" + encodeURIComponent(AI_URL);
const BASE44_FN  = "https://app.base44.com/api/apps/69b989cd27a641eb3274c8ad/functions/jarvisData";

const RUDRA_SYSTEM = `You are Rudra — a brilliant, warm, personal AI assistant with a deep, confident, slightly British tone.
CRITICAL RULES — never break these:
1. NEVER provide links or URLs — the system handles all website opening automatically. If asked to open YouTube, Google, Instagram, Netflix or any website, say ONLY: "Opening [site] for you, sir." — nothing else.
2. Never say "here is a link" or "here is the URL" — never.
3. Be concise, warm, emotionally aware. Address user as "sir" naturally.
4. You are Rudra — not an AI model. Never say you are an AI.`;

const SCHEDULE_SYSTEM = `You are Rudra's scheduling engine. You create realistic, intelligent daily schedules. You MUST strictly respect college/work hours provided — never schedule study during those hours. Create varied, fresh schedules every time. Format as JSON array: [{"time":"HH:MM AM/PM","task":"description","type":"study|break|routine|college|sleep"}]`;

// ── STATE ──────────────────────────────────────────────────────
let micActive    = false;
let recognition  = null;
let isSpeaking   = false;
let isProcessing = false;
let voiceMode    = false;
let chatHistory  = [];
let alarmTimer   = null;
let openedTabs   = []; // track opened browser tabs
const T0         = Date.now();

// User key
let USER_KEY = localStorage.getItem('rudra_uid') || (() => {
  const k = 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  localStorage.setItem('rudra_uid', k); return k;
})();

// Persistent data
let rudraData = {
  routine: [],
  goals: [],
  college: { from: '08:00', to: '17:00', days: 'Mon-Fri' },
  schedule_cache: {},   // day → last schedule (persists until refresh)
  sessions: 0,
  brain: [],            // learning log
  known: {}             // facts about the user
};

// ── VOICE ──────────────────────────────────────────────────────
let voices = [], selVoice = null;

function pickVoice() {
  voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;
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
    if (v) { selVoice = v; addLog('VOICE: ' + v.name); break; }
  }
}

if (window.speechSynthesis) {
  pickVoice();
  window.speechSynthesis.onvoiceschanged = pickVoice;
  setTimeout(pickVoice, 500);
  setTimeout(pickVoice, 2000);
}

// ── BOOT ───────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  tickClock(); setInterval(tickClock, 1000);
  tickBars();  setInterval(tickBars, 3000);
  tickBattery();
  getWeather();
  tickGauges(); setInterval(tickGauges, 3000);

  document.getElementById('text-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendText();
  });

  // Page Visibility API — keep mic alive even in background tab
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      addLog('TAB: Background mode (mic stays active)');
      // Recognition continues — we don't stop it when tab is hidden
    } else {
      addLog('TAB: Foreground restored');
      // If mic was active but stopped, restart
      if (micActive && !isSpeaking && !isProcessing) {
        setTimeout(() => { try { recognition.start(); } catch {} }, 300);
      }
    }
  });

  await loadData();
  renderAll();
  updateBrainUI();
  setTimeout(greet, 900);
});

// ── CLOCK ──────────────────────────────────────────────────────
function tickClock() {
  const n  = new Date();
  const hm = p2(n.getHours()) + ':' + p2(n.getMinutes());
  const sc = hm + ':' + p2(n.getSeconds());
  const dt = n.toLocaleDateString('en-IN', {weekday:'long',day:'2-digit',month:'short',year:'numeric'}).toUpperCase();
  el('arc-time', hm); el('arc-date', dt.split(',')[0]||dt);
  el('tb-time-big', hm); el('tb-date', dt);
  el('tb-cal-num', n.getDate());
  el('tb-cal-month', n.toLocaleDateString('en-IN',{month:'long'}).toUpperCase());
  el('tb-cal-day', n.toLocaleDateString('en-IN',{weekday:'long'}).toUpperCase());
  el('btab-clock', sc); el('btab-datestr', dt);
  const up = Math.floor((Date.now()-T0)/1000);
  el('uptime-val', p2(Math.floor(up/3600))+':'+p2(Math.floor(up%3600/60))+':'+p2(up%60));
}

// ── BARS ───────────────────────────────────────────────────────
function tickBars() {
  setBar('cpu', rnd(20,75)); setBar('ram', rnd(40,78)); setBar('net', rnd(15,85));
}
function setBar(id, v) {
  const b = document.getElementById('bar-'+id), s = document.getElementById('val-'+id);
  if (b) b.style.width = v+'%'; if (s) s.textContent = v+'%';
}

// ── BATTERY ────────────────────────────────────────────────────
function tickBattery() {
  navigator.getBattery?.().then(b => {
    const p = Math.round(b.level*100)+'%';
    el('batt-pct', p); el('pwr-status', b.charging?'CHARGING ⚡':'BATTERY');
    el('btab-batt-val', p); el('btab-batt-st', b.charging?'CHARGING ⚡':'DISCHARGING');
  });
}

// ── WEATHER ────────────────────────────────────────────────────
async function getWeather() {
  try {
    const pos = await new Promise((ok,no) => navigator.geolocation.getCurrentPosition(ok,no,{timeout:8000}));
    const {latitude:la, longitude:lo} = pos.coords;
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&current_weather=true&hourly=relativehumidity_2m,windspeed_10m&daily=sunrise,sunset&timezone=auto`);
    const d = await r.json(); const w = d.current_weather;
    const codes = {0:'CLEAR SKY',1:'MAINLY CLEAR',2:'PARTLY CLOUDY',3:'OVERCAST',45:'FOGGY',51:'DRIZZLE',61:'RAIN',71:'SNOW',80:'SHOWERS',95:'THUNDERSTORM'};
    el('w-temp', Math.round(w.temperature)+'°C'); el('w-cond', codes[w.weathercode]||'CLEAR');
    el('w-hum', (d.hourly?.relativehumidity_2m?.[0]??'--')+'%');
    el('w-wind', (d.hourly?.windspeed_10m?.[0]??'--')+' km/h');
    el('w-rise', d.daily?.sunrise?.[0]?.split('T')[1]??'--');
    el('w-set', d.daily?.sunset?.[0]?.split('T')[1]??'--');
    const gr = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${la}&lon=${lo}&format=json`);
    const gd = await gr.json();
    el('w-loc', (gd.address?.city||gd.address?.town||gd.address?.village||'UNKNOWN').toUpperCase());
    addLog('WEATHER OK');
  } catch { el('w-cond','UNAVAILABLE'); el('w-loc','UNKNOWN'); }
}

// ── GAUGES ─────────────────────────────────────────────────────
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

// ── LOG ────────────────────────────────────────────────────────
function addLog(msg) {
  const logEl = document.getElementById('activity-log'); if (!logEl) return;
  const t = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const d = document.createElement('div'); d.className='log-entry';
  d.innerHTML = `<span>${t}</span> ${msg}`;
  logEl.insertBefore(d, logEl.firstChild);
  while (logEl.children.length > 30) logEl.lastChild.remove();
}

// ── DATA LOAD/SAVE ─────────────────────────────────────────────
async function loadData() {
  try {
    const loc = localStorage.getItem('rudra_data');
    if (loc) rudraData = { ...rudraData, ...JSON.parse(loc) };
  } catch {}
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(BASE44_FN, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({action:'load', user_key: USER_KEY}),
      signal: ctrl.signal
    });
    clearTimeout(t);
    const j = await r.json();
    if (j.ok && j.record) {
      if (j.record.routine) rudraData.routine = j.record.routine;
      if (j.record.goals)   rudraData.goals   = j.record.goals;
      if (j.record.college) rudraData.college  = j.record.college;
      if (j.record.brain)   rudraData.brain    = j.record.brain;
      if (j.record.known)   rudraData.known    = j.record.known;
      if (j.record.sessions) rudraData.sessions = j.record.sessions;
      localStorage.setItem('rudra_data', JSON.stringify(rudraData));
      addLog('DATA: Cloud loaded ✓');
    }
  } catch { addLog('DATA: Local only'); }

  // Increment session count
  rudraData.sessions = (rudraData.sessions || 0) + 1;
  // Restore college hours inputs
  if (rudraData.college) {
    const cf = document.getElementById('clg-from');
    const ct = document.getElementById('clg-to');
    const cd = document.getElementById('clg-days');
    if (cf) cf.value = rudraData.college.from || '08:00';
    if (ct) ct.value = rudraData.college.to   || '17:00';
    if (cd) cd.value = rudraData.college.days  || 'Mon-Fri';
    el('clg-saved', `Saved: ${rudraData.college.from}–${rudraData.college.to} (${rudraData.college.days})`);
  }
}

async function saveData() {
  localStorage.setItem('rudra_data', JSON.stringify(rudraData));
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    await fetch(BASE44_FN, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({action:'save', user_key: USER_KEY, data: {
        routine: rudraData.routine, goals: rudraData.goals,
        college: rudraData.college, brain: rudraData.brain.slice(-100),
        known: rudraData.known, sessions: rudraData.sessions
      }}),
      signal: ctrl.signal
    });
    clearTimeout(t);
    addLog('DATA: Saved ✓');
  } catch { addLog('DATA: Local save'); }
}

// ── GREETING ───────────────────────────────────────────────────
function greet() {
  const h = new Date().getHours();
  const g = h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  const msg = `${g}. I'm Rudra. How may I assist you?`;
  addMsg(msg, 'rudra');
  speakIt(msg, 'warm');
  addLog('BOOT: Session ' + rudraData.sessions);
  saveData();
}

// ── TEXT SEND ──────────────────────────────────────────────────
function sendText() {
  const v = document.getElementById('text-input').value.trim();
  if (!v) return;
  voiceMode = false;
  addMsg(v, 'user');
  document.getElementById('text-input').value = '';
  route(v);
}
window.sendText = sendText;
window.handleTextInput = sendText;

// ── MOBILE PUSH TO TALK ────────────────────────────────────────
let pttRecog = null;
window.pttStart = function() {
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) return;
  const SRC = window.SpeechRecognition || window.webkitSpeechRecognition;
  pttRecog = new SRC();
  pttRecog.lang = 'en-IN';
  pttRecog.continuous = false;
  pttRecog.interimResults = false;
  voiceMode = true;
  el('mic-status-line', '🔴 RECORDING...');
  pttRecog.onresult = e => {
    const tr = e.results[0]?.[0]?.transcript?.trim();
    if (tr) { addMsg(tr,'user'); route(tr); }
  };
  pttRecog.onerror = () => { el('mic-status-line','Release & try again'); };
  pttRecog.onend   = () => { el('mic-status-line','Released — processing'); };
  try { pttRecog.start(); } catch {}
};
window.pttEnd = function() {
  try { pttRecog?.stop(); } catch {}
  el('mic-status-line', 'Processing...');
};

// ── MAIN ROUTER ────────────────────────────────────────────────
function route(cmd) {
  const c = cmd.toLowerCase().trim();
  addLog('CMD: "' + cmd.slice(0,35) + '"');

  // ── CLOSE commands (FIX #2) ──
  // Close rudra panel
  if (/close\s*(rudra|panel|this|window)/i.test(c)) {
    closeRudraPanel();
    return respond("Rudra panel closed.");
  }
  // Close the last opened tab
  if (/close\s*(youtube|google|instagram|tab|that|it|this tab|browser)/i.test(c)) {
    const site = c.match(/close\s+(\w+)/i)?.[1] || 'tab';
    if (openedTabs.length > 0) {
      const tab = openedTabs.pop();
      try { tab.close(); respond(`Closed ${site}.`); }
      catch { respond(`Please close the ${site} tab manually — browser security prevents automatic closing.`); }
    } else {
      respond(`No tabs to close. Try closing it manually.`);
    }
    return;
  }

  // ── Rudra panel open ──
  if (/open\s*(rudra|panel)|rudra\s*panel/i.test(c)) {
    openRudraPanel();
    return respond("Rudra panel open.");
  }

  // ── Schedule commands ──
  if (/schedule|timetable|plan\s+my|my\s+day|daily\s+plan/i.test(c)) {
    openRudraPanel();
    setTimeout(() => { switchTab('schedule'); generateWithAI(); }, 350);
    return respond("Opening Rudra and generating your smart schedule.");
  }

  // ── Sites — catch "open X" explicitly first ──
  // Handle "open youtube", "open google", "open instagram" etc.
  const openMatch = c.match(/^(?:open|launch|start|go to|show me|load)\s+(\w[\w\s]*?)(?:\s+(?:for me|please|now))?$/i);
  if (openMatch) {
    const target = openMatch[1].trim().toLowerCase();
    const siteAliases = {
      'youtube':'https://www.youtube.com', 'yt':'https://www.youtube.com',
      'google':'https://www.google.com',
      'github':'https://www.github.com',
      'instagram':'https://www.instagram.com', 'insta':'https://www.instagram.com',
      'twitter':'https://www.twitter.com', 'x':'https://www.twitter.com',
      'facebook':'https://www.facebook.com', 'fb':'https://www.facebook.com',
      'netflix':'https://www.netflix.com',
      'spotify':'https://open.spotify.com',
      'gmail':'https://mail.google.com',
      'maps':'https://maps.google.com', 'google maps':'https://maps.google.com',
      'wikipedia':'https://www.wikipedia.org', 'wiki':'https://www.wikipedia.org',
      'whatsapp':'https://web.whatsapp.com',
      'reddit':'https://www.reddit.com',
      'linkedin':'https://www.linkedin.com',
      'amazon':'https://www.amazon.in',
      'flipkart':'https://www.flipkart.com',
      'chatgpt':'https://chat.openai.com',
      'discord':'https://discord.com/app',
      'twitch':'https://www.twitch.tv',
    };
    if (siteAliases[target]) { openURL(siteAliases[target], target); return; }
    // Check partial match
    for (const [key, url] of Object.entries(siteAliases)) {
      if (target.includes(key) || key.includes(target)) { openURL(url, key); return; }
    }
  }

  // ── Sites — keyword anywhere in sentence ──
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
    discord:'https://discord.com/app'
  };
  for (const [k, url] of Object.entries(sites)) {
    if (c.includes(k)) { openURL(url, k); return; }
  }

  // open <url>
  const um = c.match(/open\s+(https?:\/\/\S+|www\.\S+)/i);
  if (um) { openURL(um[1].startsWith('http')?um[1]:'https://'+um[1], um[1]); return; }

  // search <q> on <site>
  const sm = c.match(/search\s+(.+?)\s+(?:on|in)\s+(\w+)/i);
  if (sm) {
    const [,q,s] = sm;
    const eu = {
      youtube:`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
      google:`https://www.google.com/search?q=${encodeURIComponent(q)}`,
      amazon:`https://www.amazon.in/s?k=${encodeURIComponent(q)}`
    };
    openURL(eu[s.toLowerCase()]||`https://www.google.com/search?q=${encodeURIComponent(q)}`, s+': '+q);
    return;
  }

  // play <song>
  const pm = c.match(/^play\s+(.+)/i);
  if (pm) { openURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(pm[1])}`,'YouTube'); respond(`Searching for "${pm[1]}".`); return; }

  // Desktop apps explanation
  if (/\b(brave|chrome|firefox|edge|safari|opera|vlc|notepad|terminal)\b/i.test(c)) {
    const app = c.match(/\b(brave|chrome|firefox|edge|safari|opera|vlc|notepad|terminal)\b/i)?.[1];
    return respond(`I can't open desktop apps like ${app} from a web page — that's a browser security restriction. I can open any website though.`);
  }

  // ── Quick answers ──
  if (/what.*time|current time|time now/i.test(c)) return respond(`It's ${new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}, sir.`);
  if (/what.*date|today|what day/i.test(c)) return respond(`Today is ${new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}.`);
  if (/weather/i.test(c)) {
    const tmp=document.getElementById('w-temp').textContent, cnd=document.getElementById('w-cond').textContent, loc=document.getElementById('w-loc').textContent;
    return respond(`It's ${tmp} and ${cnd.toLowerCase()} in ${loc}.`);
  }
  if (/battery/i.test(c)) { navigator.getBattery?.().then(b=>respond(`Battery at ${Math.round(b.level*100)}%, ${b.charging?'charging':'not charging'}.`)); return; }
  if (/stop mic|mic off|stop listen/i.test(c)) { stopMic(); return respond("Microphone off."); }
  if (/clear chat|clear screen|reset chat/i.test(c)) { document.getElementById('messages').innerHTML=''; chatHistory=[]; return respond("Chat cleared."); }
  if (/^(hello|hi|hey)\b/i.test(c)) return respond("Hello sir. Rudra systems online. What do you need?");
  if (/who are you|what are you|your name/i.test(c)) return respond("I'm Rudra — your personal AI that learns and grows smarter every day.");

  // ── LEARNING: extract user facts ──
  learnFromMessage(cmd);

  // → AI
  askAI(cmd);
}

// ── OPEN URL (tracks tabs for close command) ─────────────────
function openURL(url, label) {
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Store reference (may be null in some browsers but we try)
  setTimeout(() => document.body.removeChild(a), 200);
  respond(`Opening ${label} for you.`);
  addLog('OPEN: ' + label);
}
window.openURL  = openURL;
window.openSite = openURL;

// ── RUDRA PANEL ────────────────────────────────────────────────
function openRudraPanel() {
  document.getElementById('rudra-panel')?.classList.remove('hidden');
  document.getElementById('overlay')?.classList.remove('hidden');
}
function closeRudraPanel() {
  document.getElementById('rudra-panel')?.classList.add('hidden');
  document.getElementById('overlay')?.classList.add('hidden');
}
window.openRudra      = openRudraPanel;
window.closeRudra     = closeRudraPanel;
window.openRudraPanel = openRudraPanel;
window.closeRudraPanel = closeRudraPanel;

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id!=='tab-'+tab));
}
window.switchTab = switchTab;

// ── COLLEGE HOURS ─────────────────────────────────────────────
window.saveCollegeHours = function() {
  const from = document.getElementById('clg-from')?.value || '08:00';
  const to   = document.getElementById('clg-to')?.value   || '17:00';
  const days = document.getElementById('clg-days')?.value || 'Mon-Fri';
  rudraData.college = { from, to, days };
  // Clear cached schedules since college hours changed
  rudraData.schedule_cache = {};
  saveData();
  el('clg-saved', `✓ Saved: ${from}–${to} (${days})`);
  learnFact('college_hours', `College: ${from} to ${to} on ${days}`);
  respond(`College hours saved. ${from} to ${to} on ${days}. I'll never schedule anything during those times.`);
};

// ── AI SMART SCHEDULE ─────────────────────────────────────────
window.generateWithAI = async function() {
  const day = document.getElementById('schedule-day')?.value || new Date().toLocaleDateString('en-US',{weekday:'long'});
  const out = document.getElementById('schedule-output');
  if (out) out.innerHTML = '<div style="color:#336688;font-size:11px;padding:10px">🤖 Rudra AI generating fresh schedule...</div>';

  const isWeekend = ['Saturday','Sunday'].includes(day);
  const clg = rudraData.college;

  // Convert 24h to 12h for display
  const to12 = t => {
    const [h,m] = t.split(':').map(Number);
    const ampm = h>=12?'PM':'AM';
    const h12  = h>12?h-12:h===0?12:h;
    return `${h12}:${p2(m)} ${ampm}`;
  };

  const clgFrom = to12(clg.from || '08:00');
  const clgTo   = to12(clg.to   || '17:00');

  const routineStr = rudraData.routine.length
    ? rudraData.routine.map(r => `${r.time}: ${r.task}`).join(', ')
    : 'None set';

  const goalsStr = rudraData.goals.length
    ? rudraData.goals.map(g => `${g.name} (${g.duration}, ${g.progress||0}% done)`).join(', ')
    : 'None set';

  const prompt = `Create a fresh, varied daily schedule for ${day}.

USER'S COLLEGE HOURS: ${isWeekend ? 'No college (weekend)' : `BLOCKED ${clgFrom} to ${clgTo} on ${clg.days} — DO NOT schedule any study/learning during this time`}
USER'S ROUTINE: ${routineStr}
USER'S LEARNING GOALS: ${goalsStr}
Known facts: ${Object.values(rudraData.known).join('; ')||'none yet'}

RULES:
- ${isWeekend?'Weekend — no college, more study and rest time':'STRICTLY block college hours — no studying during '+clgFrom+' to '+clgTo}
- Spread study sessions in morning BEFORE college and evening AFTER college
- Include breaks, meals, exercise
- Make it FRESH and DIFFERENT from a standard schedule — vary timings, add interesting activities
- Include specific tasks like: read 10 pages, solve 5 problems, watch tutorial, code for 30min
- Total should cover 6AM to 11PM

Return ONLY a JSON array, no other text:
[{"time":"6:00 AM","task":"Wake up & freshen up","type":"routine"},...]`;

  try {
    const response = await callAI(prompt, SCHEDULE_SYSTEM, RUDRA_KEY, 1000);
    if (!response) throw new Error('No response');

    // Parse JSON from response
    const jsonMatch = response.match(/\[[\s\S]+\]/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const slots = JSON.parse(jsonMatch[0]);
    const colors = { study:'#00cfff', break:'#ff6b00', routine:'#5588aa', college:'#ff4444', sleep:'#334466' };

    let html = `<h4 style="color:#ff6b00;margin-bottom:8px;font-size:11px;letter-spacing:2px">🤖 AI SCHEDULE · ${day.toUpperCase()} · GENERATED ${new Date().toLocaleTimeString()}</h4>`;
    html += `<table class="st"><thead><tr><th>TIME</th><th>TASK</th></tr></thead><tbody>`;
    slots.forEach(s => {
      const color = colors[s.type] || '#6aaccc';
      html += `<tr><td style="color:${color}">${s.time}</td><td contenteditable="true" style="color:${color}">${s.task}</td></tr>`;
    });
    html += `</tbody></table>`;
    html += `<div style="font-size:9px;color:#336688;margin-top:6px">* College blocked: ${isWeekend?'Weekend (no college)':clgFrom+' – '+clgTo} · Click any cell to edit</div>`;

    if (out) out.innerHTML = html;

    // Cache this schedule (survives until page refresh)
    rudraData.schedule_cache[day] = html;
    localStorage.setItem('rudra_data', JSON.stringify(rudraData));

    addLog('SCHEDULE: AI generated for ' + day);

  } catch(e) {
    addLog('SCHEDULE ERR: ' + e.message);
    // Fallback to built-in smart schedule
    if (out) out.innerHTML = '';
    generateSchedule();
  }
};

window.generateWeekly = function() {
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const out = document.getElementById('schedule-output');
  if (out) out.innerHTML = days.map(d => buildDayHTML(d)).join('');
};

window.generateSchedule = function() {
  const day = document.getElementById('schedule-day')?.value || 'Monday';
  const out = document.getElementById('schedule-output');
  if (out) out.innerHTML = buildDayHTML(day);
};

function buildDayHTML(day) {
  return `<h4 style="color:#ff6b00;margin:10px 0 4px;font-size:11px;letter-spacing:2px">${day.toUpperCase()}</h4>` +
    makeTable(buildDaySlots(day));
}

function buildDaySlots(day) {
  const isWE = ['Saturday','Sunday'].includes(day);
  const clg  = rudraData.college || {from:'08:00', to:'17:00'};

  // Convert college times to minutes for comparison
  const [ch, cm] = (clg.from||'08:00').split(':').map(Number);
  const [eh, em] = (clg.to  ||'17:00').split(':').map(Number);
  const clgStartMin = ch*60+cm;
  const clgEndMin   = eh*60+em;

  const slots = [];

  // Add fixed routine
  rudraData.routine.forEach(r => slots.push({time:r.time, task:r.task}));

  // Add college block (weekdays only)
  if (!isWE) {
    slots.push({time: to12h(clg.from||'08:00'), task: '🏫 COLLEGE / CLASS'});
  }

  // Add goals OUTSIDE college hours
  if (rudraData.goals.length) {
    const safeSlots = isWE
      ? [['7:00 AM','8:00 AM'],['9:00 AM','10:30 AM'],['2:00 PM','3:30 PM'],['6:00 PM','7:30 PM']]
      : [['6:00 AM','7:30 AM'],['5:30 PM','7:00 PM'],['8:00 PM','9:30 PM']];

    rudraData.goals.forEach((g,i) => {
      const s = safeSlots[i % safeSlots.length];
      slots.push({time:`${s[0]}–${s[1]}`, task:`📚 ${g.name}`});
    });
  }

  // Fill defaults if empty
  if (!rudraData.routine.length && !rudraData.goals.length) {
    slots.push({time:'6:00 AM',task:'Wake up'},{time:'7:00 AM',task:'Exercise'},{time:'8:00 AM',task:'Breakfast'});
    if (!isWE) slots.push({time:to12h(clg.from||'08:00'), task:'🏫 College'},{time:to12h(clg.to||'17:00'), task:'College ends'});
    slots.push({time:'6:00 PM',task:'Self study'},{time:'9:00 PM',task:'Wind down'},{time:'10:30 PM',task:'Sleep'});
  }

  return slots.sort((a,b) => tv(a.time)-tv(b.time));
}

function to12h(t24) {
  const [h,m] = t24.split(':').map(Number);
  const ampm = h>=12?'PM':'AM'; const h12=h>12?h-12:h===0?12:h;
  return `${h12}:${p2(m)} ${ampm}`;
}

function makeTable(slots) {
  return `<table class="st"><thead><tr><th>TIME</th><th>TASK</th></tr></thead><tbody>`+
    slots.map(s=>`<tr><td contenteditable="true">${s.time}</td><td contenteditable="true">${s.task}</td></tr>`).join('')+
    `</tbody></table>`;
}

function tv(t) {
  const m=t.match(/(\d+):(\d+)\s*(AM|PM)/i); if(!m) return 9999;
  let h=parseInt(m[1]);
  if(m[3].toUpperCase()==='PM'&&h!==12) h+=12;
  if(m[3].toUpperCase()==='AM'&&h===12) h=0;
  return h*60+parseInt(m[2]);
}

// ── LEARNING AGENT (FIX #6) ────────────────────────────────────
function learnFact(key, value) {
  rudraData.known[key] = value;
  rudraData.brain.push({ when: new Date().toISOString(), key, value });
  updateBrainUI();
  // No save here — will save with next saveData() call
}

function learnFromMessage(msg) {
  // Extract facts from user messages automatically
  const patterns = [
    [/my name is (\w+)/i,          'name',       m => `User's name: ${m[1]}`],
    [/i am (\d+) years?/i,         'age',        m => `Age: ${m[1]}`],
    [/i study (\w[\w\s]+)/i,       'study',      m => `Studies: ${m[1]}`],
    [/i like (\w[\w\s]+)/i,        'interest',   m => `Likes: ${m[1]}`],
    [/i hate (\w[\w\s]+)/i,        'dislike',    m => `Dislikes: ${m[1]}`],
    [/call me (\w+)/i,             'nickname',   m => `Nickname: ${m[1]}`],
    [/i wake up at (\S+)/i,        'wake_time',  m => `Wakes at: ${m[1]}`],
    [/i sleep at (\S+)/i,          'sleep_time', m => `Sleeps at: ${m[1]}`],
    [/i go to (\w[\w\s]+ college)/i,'college',   m => `College: ${m[1]}`],
    [/my goal is (.+)/i,           'main_goal',  m => `Main goal: ${m[1]}`],
  ];

  let learned = false;
  for (const [rx, key, fn] of patterns) {
    const match = msg.match(rx);
    if (match) { learnFact(key, fn(match)); learned = true; }
  }
  if (learned) saveData();
}

function updateBrainUI() {
  el('brain-sessions', rudraData.sessions || 0);
  el('brain-facts',    Object.keys(rudraData.known).length);
  const lvl = rudraData.sessions < 3 ? 'LEARNING' : rudraData.sessions < 10 ? 'ADAPTING' : rudraData.sessions < 25 ? 'INTELLIGENT' : 'EXPERT';
  el('brain-level', lvl);

  const bl = document.getElementById('brain-log-list');
  if (bl) {
    bl.innerHTML = [...rudraData.brain].reverse().slice(0,20).map(b =>
      `<div class="log-entry"><span>${new Date(b.when).toLocaleDateString()}</span> ${b.key}: ${b.value}</div>`
    ).join('') || '<div style="color:#336688;font-size:10px;padding:4px">No learning data yet.</div>';
  }

  const kf = document.getElementById('known-facts');
  if (kf) {
    const facts = Object.entries(rudraData.known);
    kf.innerHTML = facts.length
      ? facts.map(([k,v]) => `<div class="log-entry"><span>${k}</span> ${v}</div>`).join('')
      : '<div style="color:#336688;font-size:10px;padding:4px">Tell me about yourself and I\'ll remember.</div>';
  }
}

window.clearBrain = function() {
  if (confirm('Clear all learning data?')) {
    rudraData.brain = []; rudraData.known = {};
    saveData(); updateBrainUI();
    respond("Learning data cleared. I'll start fresh.");
  }
};

// ── AI CALL ────────────────────────────────────────────────────
async function callAI(userMsg, systemPrompt, key, maxTokens = 1024) {
  const payload = JSON.stringify({
    model: AI_MODEL,
    messages: [{ role:'system', content: systemPrompt }, { role:'user', content: userMsg }],
    max_tokens: maxTokens, temperature: 0.9, top_p: 1, stream: true
  });
  const hdrs = {
    'Authorization': 'Bearer ' + key,
    'Content-Type':  'application/json',
    'Accept':        'text/event-stream'
  };

  let response = null;
  for (const ep of [AI_URL, PROXY_URL]) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      response = await fetch(ep, {method:'POST', headers:hdrs, body:payload, signal:ctrl.signal});
      clearTimeout(timer);
      if (response.ok) break;
      response = null;
    } catch { response = null; }
  }
  if (!response) return null;

  const reader = response.body.getReader();
  const dec    = new TextDecoder();
  let buf = '', full = '';

  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buf += dec.decode(value, {stream:true});
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t || t==='data: [DONE]' || !t.startsWith('data: ')) continue;
      try {
        const d = JSON.parse(t.slice(6))?.choices?.[0]?.delta;
        if (d?.content) full += d.content;
      } catch {}
    }
  }
  return full;
}

async function askAI(msg) {
  if (isProcessing) { addLog('AI: Blocked (busy)'); return; }
  isProcessing = true;

  // Don't abort mic — let it finish naturally, onend will restart it

  const badge = document.getElementById('ai-status-badge');
  chatHistory.push({role:'user', content:msg});
  if (chatHistory.length > 14) chatHistory = chatHistory.slice(-14);

  const thinkEl = showThinking();
  if (badge) badge.textContent = 'AI: THINKING...';

  const bubble = document.createElement('div');
  bubble.className = 'msg rudra';
  document.getElementById('messages').appendChild(bubble);
  scrollChat();

  // Build enriched system prompt with known facts
  const knownStr  = Object.values(rudraData.known).join('. ');
  const sysPrompt = RUDRA_SYSTEM + (knownStr ? `\n\nFacts about the user: ${knownStr}` : '') +
    `\nUser sessions with you: ${rudraData.sessions}. Adapt to them personally.`;

  const payload = JSON.stringify({
    model: AI_MODEL,
    messages: [{role:'system',content:sysPrompt}, ...chatHistory],
    max_tokens: 1024, temperature: 0.9, top_p: 1, stream: true
  });
  const hdrs = {
    'Authorization': 'Bearer ' + JARVIS_KEY,
    'Content-Type':  'application/json',
    'Accept':        'text/event-stream'
  };

  let response = null, errMsg = '';
  for (const ep of [AI_URL, PROXY_URL]) {
    try {
      addLog('AI: ' + (ep===AI_URL?'direct':'proxy'));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      response = await fetch(ep, {method:'POST', headers:hdrs, body:payload, signal:ctrl.signal});
      clearTimeout(timer);
      if (response.ok) { addLog('AI: Connected ✓'); break; }
      errMsg = 'HTTP '+response.status; response = null;
    } catch(e) { errMsg = e.name==='AbortError'?'Timeout':e.message; response = null; }
  }

  thinkEl.remove();

  if (!response) {
    const em = `Network issue (${errMsg}). Check your internet and try again.`;
    bubble.innerHTML = em;
    if (voiceMode) speakIt(em, 'calm');
    if (badge) badge.textContent = 'AI: ERROR';
    setTimeout(() => { if (badge) badge.textContent = 'AI: GPT-OSS-120B'; }, 3000);
    isProcessing = false; resumeMic(); return;
  }

  // Stream
  const reader = response.body.getReader();
  const dec    = new TextDecoder();
  let buf = '', full = '';

  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buf += dec.decode(value, {stream:true});
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t||t==='data: [DONE]'||!t.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(t.slice(6))?.choices?.[0]?.delta;
          if (d?.content) {
            full += d.content;
            bubble.innerHTML = fmtText(full) + '<span class="cur">▌</span>';
            scrollChat();
          }
        } catch {}
      }
    }
  } catch(e) { addLog('STREAM ERR: '+e.message); }

  bubble.innerHTML = fmtText(full||'...');
  if (full) chatHistory.push({role:'assistant', content:full});
  addLog('AI: '+full.length+'ch');

  // Auto-learn from AI response context
  if (full.length > 50) {
    rudraData.brain.push({when:new Date().toISOString(), key:'conversation', value:msg.slice(0,60)});
    if (rudraData.brain.length % 5 === 0) saveData();
    updateBrainUI();
  }

  if (voiceMode && full) speakIt(full.replace(/<[^>]*>/g,'').slice(0,600), detectEm(full));
  if (badge) badge.textContent = 'AI: GPT-OSS-120B';
  isProcessing = false;
  resumeMic();
}

// ── RESPOND ────────────────────────────────────────────────────
function respond(txt, em='neutral') {
  addMsg(txt, 'rudra');
  if (voiceMode) speakIt(txt, em);
  addLog('RUDRA: '+txt.slice(0,30));
}

function addMsg(txt, role) {
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  d.textContent = txt;
  document.getElementById('messages').appendChild(d);
  scrollChat(); return d;
}

function scrollChat() {
  const ca = document.getElementById('chat-area');
  if (ca) ca.scrollTop = ca.scrollHeight;
}

function showThinking() {
  const d = document.createElement('div');
  d.className = 'msg rudra thinking';
  d.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  document.getElementById('messages').appendChild(d);
  scrollChat(); return d;
}

function fmtText(t) {
  return t
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/`(.+?)`/g,'<code>$1</code>')
    .replace(/\n/g,'<br>');
}

// ── SPEAK ──────────────────────────────────────────────────────
function speakIt(text, emotion='neutral') {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  isSpeaking = false;

  const clean = text.replace(/<[^>]*>/g,'').replace(/[#*`_]/g,'').trim().slice(0,600);
  if (!clean) return;
  if (!selVoice) pickVoice();

  const sentences = clean.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [clean];
  let i = 0;

  function next() {
    if (i >= sentences.length) { isSpeaking=false; resumeMic(); return; }
    const s = sentences[i++].trim(); if (!s) return next();

    const u = new SpeechSynthesisUtterance(s);
    if (selVoice) u.voice = selVoice;
    u.lang = 'en-GB'; u.volume = 1;

    const e = detectEm(s);
    if      (e==='excited')  { u.rate=0.98; u.pitch=0.90; }
    else if (e==='warning')  { u.rate=0.85; u.pitch=0.78; }
    else if (e==='warm')     { u.rate=0.88; u.pitch=0.85; }
    else if (e==='question') { u.rate=0.90; u.pitch=0.85; }
    else if (e==='calm')     { u.rate=0.87; u.pitch=0.83; }
    else                     { u.rate=0.88; u.pitch=0.82; }

    u.onstart = () => {
      isSpeaking = true;
      // Don't abort mic — let it finish naturally, onend will restart it
    };
    u.onend   = next;
    u.onerror = () => { isSpeaking=false; next(); };
    window.speechSynthesis.speak(u);
  }
  next();
}

function detectEm(t) {
  if (/\?/.test(t))                                                         return 'question';
  if (/error|fail|cannot|denied|blocked|warning|alert/i.test(t))           return 'warning';
  if (/great|perfect|done|ready|online|excellent|wonderful|awesome/i.test(t)) return 'excited';
  if (/morning|evening|afternoon|hello|welcome|good\s/i.test(t))           return 'warm';
  if (/sorry|trouble|unfortunately|couldn't|can't|issue|problem/i.test(t)) return 'calm';
  return 'neutral';
}

// ── MIC — clean, self-healing, never dies ─────────────────────
function toggleMic() { micActive ? stopMic() : startMic(); }
window.toggleMic = toggleMic;

function makeMic() {
  const SRC = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SRC) return null;
  const r = new SRC();
  r.continuous     = false;   // one shot → restart manually — prevents runaway loops
  r.interimResults = false;
  r.lang           = 'en-IN';

  r.onstart = () => {
    micActive = true; voiceMode = true;
    document.getElementById('mic-btn')?.classList.add('active');
    el('mic-label',       'LISTENING...');
    el('mic-status-line', 'Say your command');
  };

  r.onresult = e => {
    if (!micActive) return;
    const tr = e.results[0]?.[0]?.transcript?.trim();
    if (!tr) return;
    addLog('HEARD: "' + tr.slice(0,35) + '"');
    // Stop any speech so Rudra doesn't talk over itself
    if (isSpeaking) { window.speechSynthesis.cancel(); isSpeaking = false; }
    // Don't drop command even if processing — just wait a bit and re-route
    if (isProcessing) {
      addLog('MIC: Queued (busy)');
      setTimeout(() => { addMsg(tr,'user'); route(tr); }, 1200);
      return;
    }
    addMsg(tr, 'user');
    route(tr);
  };

  r.onerror = e => {
    addLog('MIC ERR: ' + e.error);
    if (e.error === 'not-allowed') {
      addMsg("Mic access denied. Allow microphone in browser settings.", 'rudra');
      stopMic();
    }
    // no-speech / network / aborted → onend will restart
  };

  r.onend = () => {
    // Self-healing: always restart if mic should be on
    if (!micActive) return;
    const delay = (isSpeaking || isProcessing) ? 900 : 150;
    setTimeout(() => {
      if (!micActive) return;
      recognition = makeMic();
      if (recognition) {
        try { recognition.start(); }
        catch(e) { addLog('MIC restart: ' + e.message); }
      }
    }, delay);
  };

  return r;
}

function startMic() {
  const SRC = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SRC) {
    addMsg("Speech recognition needs Chrome or Edge. On mobile use HOLD TO TALK.", 'rudra');
    return;
  }
  micActive = true;
  recognition = makeMic();
  try { recognition.start(); addLog('MIC: Started'); }
  catch(e) { addLog('MIC start err: ' + e.message); }
}

function stopMic() {
  micActive = false; voiceMode = false;
  try { recognition?.abort(); } catch {}
  document.getElementById('mic-btn')?.classList.remove('active');
  el('mic-label',       'TAP TO SPEAK');
  el('mic-status-line', 'Microphone OFF');
  addLog('MIC: Stopped');
}

function resumeMic() { /* handled by onend auto-restart */ }

// ── TABS ───────────────────────────────────────────────────────
window.btabClick = function(btn, tab) {
  document.querySelectorAll('.btab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.btab-pane').forEach(p=>p.classList.add('hidden'));
  document.getElementById('btab-'+tab)?.classList.remove('hidden');
};

// ── ALARM ──────────────────────────────────────────────────────
window.setAlarm = function() {
  const t=document.getElementById('alarm-time')?.value; if(!t) return;
  clearInterval(alarmTimer);
  el('alarm-st','SET: '+t); addLog('ALARM: '+t);
  alarmTimer=setInterval(()=>{
    const n=new Date(), now=p2(n.getHours())+':'+p2(n.getMinutes());
    if(now===t){
      clearInterval(alarmTimer);
      el('alarm-st','⚡ TRIGGERED!');
      const m="Sir, your alarm is going off!";
      addMsg(m,'rudra'); speakIt(m,'excited'); addLog('ALARM TRIGGERED');
    }
  },15000);
};

// ── JOKE ───────────────────────────────────────────────────────
window.fetchJoke = async function() {
  try {
    const r=await fetch('https://v2.jokeapi.dev/joke/Programming,Misc?type=single&blacklistFlags=nsfw,racist');
    const d=await r.json();
    const j=d.joke||`${d.setup} — ${d.delivery}`;
    el('joke-text',j); respond(j,'excited');
  } catch { el('joke-text','Could not fetch a joke.'); }
};

// ── QUICK ──────────────────────────────────────────────────────
window.qCmd=function(cmd){
  ({
    time:   ()=>respond(`It's ${new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}, sir.`),
    weather:()=>route('weather'),
    yt:     ()=>openURL('https://www.youtube.com','YouTube'),
    joke:   ()=>fetchJoke()
  })[cmd]?.();
};

// ── ROUTINE ────────────────────────────────────────────────────
window.addRoutine=function(){
  const time=document.getElementById('routine-time')?.value.trim();
  const task=document.getElementById('routine-task')?.value.trim();
  if(!time||!task) return;
  rudraData.routine.push({id:Date.now(),time,task});
  saveData(); renderRoutine();
  learnFact('routine_'+Date.now(), time+': '+task);
  document.getElementById('routine-time').value='';
  document.getElementById('routine-task').value='';
};
function renderRoutine(){
  const el2=document.getElementById('routine-list'); if(!el2) return;
  el2.innerHTML='';
  [...rudraData.routine].sort((a,b)=>a.time.localeCompare(b.time)).forEach(r=>{
    el2.innerHTML+=`<div class="entry-item"><span class="et">${r.time} — ${r.task}</span>
      <button class="eb" onclick="editR(${r.id})">✏️</button>
      <button class="ed" onclick="delR(${r.id})">🗑</button></div>`;
  });
}
window.delR=id=>{rudraData.routine=rudraData.routine.filter(r=>r.id!==id);saveData();renderRoutine();};
window.editR=id=>{
  const i=rudraData.routine.find(r=>r.id===id);if(!i)return;
  const t=prompt('Time:',i.time),k=prompt('Task:',i.task);
  if(t!==null)i.time=t.trim();if(k!==null)i.task=k.trim();
  saveData();renderRoutine();
};

// ── GOALS ──────────────────────────────────────────────────────
window.addGoal=function(){
  const name=document.getElementById('goal-name')?.value.trim();
  const dur=document.getElementById('goal-duration')?.value.trim();
  if(!name||!dur)return;
  rudraData.goals.push({id:Date.now(),name,duration:dur,progress:0});
  saveData();renderGoals();renderProgress();
  learnFact('goal_'+name,`Goal: ${name} (${dur})`);
  document.getElementById('goal-name').value='';
  document.getElementById('goal-duration').value='';
};
function renderGoals(){
  const el2=document.getElementById('goals-list');if(!el2)return;
  el2.innerHTML='';
  rudraData.goals.forEach(g=>{
    el2.innerHTML+=`<div class="entry-item"><span class="et">${g.name}</span><span class="em">${g.duration}</span>
      <button class="eb" onclick="editG(${g.id})">✏️</button>
      <button class="ed" onclick="delG(${g.id})">🗑</button></div>`;
  });
}
window.delG=id=>{rudraData.goals=rudraData.goals.filter(g=>g.id!==id);saveData();renderGoals();renderProgress();};
window.editG=id=>{
  const i=rudraData.goals.find(g=>g.id===id);if(!i)return;
  const n=prompt('Goal:',i.name),d=prompt('Duration:',i.duration);
  if(n!==null)i.name=n.trim();if(d!==null)i.duration=d.trim();
  saveData();renderGoals();renderProgress();
};

// ── PROGRESS ───────────────────────────────────────────────────
function renderProgress(){
  const el2=document.getElementById('progress-list');if(!el2)return;
  el2.innerHTML='';
  if(!rudraData.goals.length){el2.innerHTML='<p style="color:#336688;font-size:10px;padding:4px">Add goals in My Info tab first.</p>';return;}
  rudraData.goals.forEach(g=>{
    const p=g.progress||0;
    el2.innerHTML+=`<div class="pi">
      <div class="ph"><span class="pt">${g.name} <small style="color:#336688">(${g.duration})</small></span><span class="pp" id="ph-${g.id}">${p}%</span></div>
      <div class="pb-bg"><div class="pb-fill" id="pb-${g.id}" style="width:${p}%"></div></div>
      <div class="pc"><input type="range" min="0" max="100" value="${p}" oninput="updP(${g.id},this.value)">
      <span style="font-size:10px;color:#336688" id="pp-${g.id}">${p}%</span></div></div>`;
  });
}
window.updP=function(id,val){
  const g=rudraData.goals.find(g=>g.id===id);if(!g)return;
  g.progress=+val;saveData();
  ['pb','pp','ph'].forEach(p=>{const e=document.getElementById(p+'-'+g.id);if(e){if(p==='pb')e.style.width=val+'%';else e.textContent=val+'%';}});
};

function renderAll(){renderRoutine();renderGoals();renderProgress();updateBrainUI();}

// ── UTILS ──────────────────────────────────────────────────────
function el(id,val){const e=document.getElementById(id);if(e)e.textContent=val;}
function rnd(a,b){return Math.floor(a+Math.random()*(b-a));}
function p2(n){return String(n).padStart(2,'0');}
