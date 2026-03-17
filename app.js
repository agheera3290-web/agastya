// ═══════════════════════════════════════════════
//  JARVIS / RUDRA — Core App Logic
// ═══════════════════════════════════════════════

// ─── STATE ───────────────────────────────────────
let micActive = false;
let recognition = null;
let isSpeaking = false;
let inputMode = 'text'; // 'text' | 'voice'

const DATA_KEY = 'rudra_data';
let rudraData = loadData();

// ─── DOM ─────────────────────────────────────────
const messagesEl  = document.getElementById('messages');
const textInput   = document.getElementById('text-input');
const sendBtn     = document.getElementById('send-btn');
const micBtn      = document.getElementById('mic-btn');
const micStatus   = document.getElementById('mic-status');
const rudraPanel  = document.getElementById('rudra-panel');
const overlay     = document.getElementById('overlay');

// ─── INIT ─────────────────────────────────────────
window.addEventListener('load', () => {
  jarvisGreet();
  renderAll();
});

sendBtn.addEventListener('click', () => handleTextInput());
textInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleTextInput(); });
micBtn.addEventListener('click', toggleMic);

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
document.getElementById('close-rudra').addEventListener('click', closeRudra);

// ─── GREETING ─────────────────────────────────────
function jarvisGreet() {
  const hour = new Date().getHours();
  let greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  addMessage(`${greet}. I'm Jarvis — also called Rudra. I'm fully operational and ready to assist you. How can I help?`, 'jarvis');
}

// ─── TEXT INPUT ───────────────────────────────────
function handleTextInput() {
  const val = textInput.value.trim();
  if (!val) return;
  inputMode = 'text';
  addMessage(val, 'user');
  textInput.value = '';
  processCommand(val);
}

// ─── VOICE / MIC ──────────────────────────────────
function toggleMic() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    addMessage("Speech recognition isn't supported in this browser. Please use Chrome for voice input.", 'jarvis');
    return;
  }
  micActive ? stopMic() : startMic();
}

function startMic() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-IN';

  recognition.onstart = () => {
    micActive = true;
    inputMode = 'voice';
    micBtn.classList.add('active');
    micStatus.textContent = '🔴 Listening...';
  };

  recognition.onresult = (e) => {
    const transcript = Array.from(e.results)
      .slice(e.resultIndex)
      .map(r => r[0].transcript)
      .join('').trim();
    if (!transcript) return;
    if (isSpeaking) { stopSpeech(); }
    addMessage(transcript, 'user');
    processCommand(transcript);
  };

  recognition.onerror = (e) => {
    if (e.error === 'not-allowed') {
      addMessage("Microphone access denied. Please allow mic permission in your browser.", 'jarvis');
      stopMic();
    }
  };

  recognition.onend = () => {
    if (micActive) recognition.start(); // keep continuous
  };

  recognition.start();
}

function stopMic() {
  micActive = false;
  inputMode = 'text';
  if (recognition) recognition.stop();
  micBtn.classList.remove('active');
  micStatus.textContent = 'Microphone OFF';
}

// ─── SPEAK ────────────────────────────────────────
function speak(text, tone = 'normal') {
  if (!('speechSynthesis' in window)) return;
  stopSpeech();

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-IN';

  // Tone variation
  switch (tone) {
    case 'excited':  utter.rate = 1.15; utter.pitch = 1.2; break;
    case 'serious':  utter.rate = 0.88; utter.pitch = 0.85; break;
    case 'question': utter.rate = 1.0;  utter.pitch = 1.1; break;
    case 'casual':   utter.rate = 1.05; utter.pitch = 1.0; break;
    default:         utter.rate = 1.0;  utter.pitch = 1.0;
  }

  utter.onstart = () => {
    isSpeaking = true;
    if (recognition && micActive) recognition.stop();
  };
  utter.onend = () => {
    isSpeaking = false;
    if (micActive) recognition.start();
  };

  window.speechSynthesis.speak(utter);
}

function stopSpeech() {
  if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
  isSpeaking = false;
}

function detectTone(text) {
  if (/\?/.test(text)) return 'question';
  if (/!/.test(text) || /great|awesome|perfect|done|ready|online/i.test(text)) return 'excited';
  if (/warning|error|fail|cannot|denied|limit/i.test(text)) return 'serious';
  if (/lol|haha|btw|just|chill/i.test(text)) return 'casual';
  return 'normal';
}

// ─── ADD MESSAGE ──────────────────────────────────
function addMessage(text, role) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;

  if (role === 'jarvis' && inputMode === 'voice') {
    speak(text, detectTone(text));
  }
}

// ─── COMMAND PROCESSOR ────────────────────────────
function processCommand(cmd) {
  const c = cmd.toLowerCase().trim();

  // ── Open Rudra ──
  if (/open rudra|rudra panel|rudra/i.test(c)) {
    openRudra();
    const day = c.match(/plan\s+my\s+(\w+)/i);
    if (day) {
      setTimeout(() => {
        switchTab('schedule');
        document.getElementById('schedule-day').value = capitalize(day[1]);
        generateSchedule();
      }, 400);
      return respond(`Opening Rudra and generating your ${capitalize(day[1])} schedule now.`, 'excited');
    }
    return respond("Rudra panel is now open. You can manage your schedule, goals, and progress.", 'normal');
  }

  // ── Plan schedule ──
  if (/plan\s+my\s+(\w+)/i.test(c)) {
    const m = c.match(/plan\s+my\s+(\w+)/i);
    const day = capitalize(m[1]);
    openRudra();
    setTimeout(() => {
      switchTab('schedule');
      document.getElementById('schedule-day').value = day;
      generateSchedule();
    }, 400);
    return respond(`Opening Rudra and generating your ${day} plan.`, 'excited');
  }

  if (/weekly schedule|full week/i.test(c)) {
    openRudra();
    setTimeout(() => { switchTab('schedule'); generateWeekly(); }, 400);
    return respond("Generating your full weekly schedule inside Rudra.", 'excited');
  }

  // ── Open websites ──
  if (/open\s+youtube/i.test(c))  { window.open('https://youtube.com', '_blank'); return respond("Opening YouTube for you.", 'normal'); }
  if (/open\s+google/i.test(c))   { window.open('https://google.com', '_blank');  return respond("Opening Google.", 'normal'); }
  if (/open\s+github/i.test(c))   { window.open('https://github.com', '_blank');  return respond("Navigating to GitHub.", 'normal'); }
  const siteMatch = c.match(/open\s+(https?:\/\/\S+|www\.\S+|\S+\.\S+)/);
  if (siteMatch) { window.open('https://' + siteMatch[1].replace(/^https?:\/\//, ''), '_blank'); return respond(`Opening ${siteMatch[1]}.`, 'normal'); }

  // ── Play song ──
  const songMatch = c.match(/play\s+(.+)/i);
  if (songMatch) {
    const song = songMatch[1];
    window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(song)}&autoplay=1`, '_blank');
    return respond(`Searching YouTube for "${song}" and initiating playback. Note: autoplay may require a click due to browser restrictions.`, 'normal');
  }

  // ── Time ──
  if (/what.*time|current time/i.test(c)) {
    const t = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return respond(`The current time is ${t}.`, 'normal');
  }

  // ── Date ──
  if (/what.*date|today.*date|current date/i.test(c)) {
    const d = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return respond(`Today is ${d}.`, 'normal');
  }

  // ── Battery ──
  if (/battery/i.test(c)) {
    if (navigator.getBattery) {
      navigator.getBattery().then(b => {
        const pct = Math.round(b.level * 100);
        const status = b.charging ? 'charging' : 'discharging';
        respond(`Battery is at ${pct}% and currently ${status}.`, 'normal');
      });
    } else {
      respond("Battery info isn't accessible from this browser context.", 'serious');
    }
    return;
  }

  // ── Call ──
  if (/call\s+(.+)/i.test(c)) {
    const person = c.match(/call\s+(.+)/i)[1];
    respond(`To call ${person}, I'd need phone access. On mobile, I can attempt: `, 'normal');
    const a = document.createElement('a'); a.href = `tel:${person}`; a.click();
    return;
  }

  // ── Stop mic ──
  if (/stop listening|turn off mic|stop mic/i.test(c)) { stopMic(); return respond("Microphone turned off.", 'serious'); }

  // ── Hello / identity ──
  if (/who are you|what are you|your name/i.test(c)) return respond("I'm Jarvis — also known as Rudra. Your personal AI assistant, fully operational.", 'normal');
  if (/hello|hi|hey|namaste/i.test(c)) return respond("Hello! I'm ready. What would you like to do?", 'excited');

  // ── Default ──
  respond("I understand. However, I may need more context for that command. Could you rephrase or give me more details?", 'question');
}

function respond(text, tone = 'normal') {
  addMessage(text, 'jarvis');
}

// ─── RUDRA PANEL ──────────────────────────────────
function openRudra() {
  rudraPanel.classList.remove('hidden');
  overlay.classList.remove('hidden');
}

function closeRudra() {
  rudraPanel.classList.add('hidden');
  overlay.classList.add('hidden');
}

window.closeRudra = closeRudra;

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== `tab-${tab}`));
}

// ─── DATA PERSISTENCE ─────────────────────────────
function loadData() {
  try { return JSON.parse(localStorage.getItem(DATA_KEY)) || { routine: [], goals: [], progress: [] }; }
  catch { return { routine: [], goals: [], progress: [] }; }
}

function saveData() {
  localStorage.setItem(DATA_KEY, JSON.stringify(rudraData));
}

// ─── AGHEERA — ROUTINE ────────────────────────────
window.addRoutine = function() {
  const time = document.getElementById('routine-time').value.trim();
  const task = document.getElementById('routine-task').value.trim();
  if (!time || !task) return;
  rudraData.routine.push({ id: Date.now(), time, task });
  saveData(); renderRoutine();
  document.getElementById('routine-time').value = '';
  document.getElementById('routine-task').value = '';
};

function renderRoutine() {
  const el = document.getElementById('routine-list');
  el.innerHTML = '';
  rudraData.routine.sort((a, b) => a.time.localeCompare(b.time)).forEach(r => {
    el.innerHTML += `
      <div class="entry-item" id="re-${r.id}">
        <span class="entry-text">${r.time} — ${r.task}</span>
        <button class="edit-btn" onclick="editRoutine(${r.id})">✏️</button>
        <button class="del-btn"  onclick="deleteRoutine(${r.id})">🗑</button>
      </div>`;
  });
}

window.deleteRoutine = function(id) {
  rudraData.routine = rudraData.routine.filter(r => r.id !== id);
  saveData(); renderRoutine(); renderProgress();
};

window.editRoutine = function(id) {
  const item = rudraData.routine.find(r => r.id === id);
  if (!item) return;
  const newTime = prompt("Edit time:", item.time);
  const newTask = prompt("Edit task:", item.task);
  if (newTime !== null) item.time = newTime.trim();
  if (newTask !== null) item.task = newTask.trim();
  saveData(); renderRoutine();
};

// ─── AGHEERA — GOALS ──────────────────────────────
window.addGoal = function() {
  const name     = document.getElementById('goal-name').value.trim();
  const duration = document.getElementById('goal-duration').value.trim();
  if (!name || !duration) return;
  rudraData.goals.push({ id: Date.now(), name, duration, progress: 0 });
  saveData(); renderGoals(); renderProgress();
  document.getElementById('goal-name').value = '';
  document.getElementById('goal-duration').value = '';
};

function renderGoals() {
  const el = document.getElementById('goals-list');
  el.innerHTML = '';
  rudraData.goals.forEach(g => {
    el.innerHTML += `
      <div class="entry-item" id="ge-${g.id}">
        <span class="entry-text">${g.name}</span>
        <span class="entry-meta">${g.duration}</span>
        <button class="edit-btn" onclick="editGoal(${g.id})">✏️</button>
        <button class="del-btn"  onclick="deleteGoal(${g.id})">🗑</button>
      </div>`;
  });
}

window.deleteGoal = function(id) {
  rudraData.goals = rudraData.goals.filter(g => g.id !== id);
  saveData(); renderGoals(); renderProgress();
};

window.editGoal = function(id) {
  const item = rudraData.goals.find(g => g.id === id);
  if (!item) return;
  const newName = prompt("Edit goal name:", item.name);
  const newDur  = prompt("Edit duration:", item.duration);
  if (newName !== null) item.name = newName.trim();
  if (newDur  !== null) item.duration = newDur.trim();
  saveData(); renderGoals(); renderProgress();
};

// ─── SCHEDULE GENERATOR ───────────────────────────
window.generateSchedule = function() {
  const day = document.getElementById('schedule-day').value;
  const slots = buildDaySchedule(day);
  renderScheduleTable(slots, day);
};

window.generateWeekly = function() {
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  let html = '';
  days.forEach(d => {
    const slots = buildDaySchedule(d);
    html += `<h4 style="color:#ff6b35;margin:14px 0 6px;">${d}</h4>` + buildTableHTML(slots);
  });
  document.getElementById('schedule-output').innerHTML = html;
};

function buildDaySchedule(day) {
  const isWeekend = ['Saturday','Sunday'].includes(day);
  const slots = [];

  // Fixed routine from Agheera
  rudraData.routine.forEach(r => {
    slots.push({ time: r.time, task: r.task, type: 'routine' });
  });

  // Fill learning slots
  if (rudraData.goals.length > 0) {
    const studySlots = isWeekend
      ? [['9:00 AM','10:30 AM'],['11:00 AM','12:30 PM'],['3:00 PM','4:30 PM'],['5:00 PM','6:30 PM']]
      : [['6:00 AM','7:00 AM'],['4:00 PM','5:30 PM'],['8:00 PM','9:30 PM']];

    rudraData.goals.forEach((g, i) => {
      const s = studySlots[i % studySlots.length];
      slots.push({ time: `${s[0]} – ${s[1]}`, task: `📚 Study: ${g.name}`, type: 'study' });
    });
  }

  // Defaults if no routine set
  if (rudraData.routine.length === 0) {
    slots.push({ time: '6:00 AM', task: 'Wake up & Morning Routine', type: 'routine' });
    slots.push({ time: '7:00 AM', task: 'Exercise / Yoga', type: 'routine' });
    slots.push({ time: '8:00 AM', task: 'Breakfast', type: 'routine' });
    if (!isWeekend) {
      slots.push({ time: '9:00 AM – 5:00 PM', task: 'College / Work', type: 'routine' });
    }
    slots.push({ time: '9:00 PM', task: 'Wind down / Read', type: 'routine' });
    slots.push({ time: '10:30 PM', task: 'Sleep', type: 'routine' });
  }

  slots.sort((a, b) => {
    const toMin = t => {
      const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (!m) return 9999;
      let h = parseInt(m[1]); const min = parseInt(m[2]); const ap = m[3].toUpperCase();
      if (ap === 'PM' && h !== 12) h += 12;
      if (ap === 'AM' && h === 12) h = 0;
      return h * 60 + min;
    };
    return toMin(a.time) - toMin(b.time);
  });

  return slots;
}

function buildTableHTML(slots) {
  return `<table class="sched-table">
    <thead><tr><th>Time</th><th>Task</th></tr></thead>
    <tbody>
      ${slots.map(s => `<tr><td contenteditable="true">${s.time}</td><td contenteditable="true">${s.task}</td></tr>`).join('')}
    </tbody>
  </table>`;
}

function renderScheduleTable(slots, day) {
  document.getElementById('schedule-output').innerHTML =
    `<h4 style="color:#ff6b35;margin-bottom:8px;">${day}</h4>` + buildTableHTML(slots);
}

// ─── PROGRESS TRACKER ─────────────────────────────
function renderProgress() {
  const el = document.getElementById('progress-list');
  el.innerHTML = '';
  if (rudraData.goals.length === 0) {
    el.innerHTML = '<p style="color:#7090b0;font-size:0.85rem;">No learning goals set yet. Add them in the Agheera tab.</p>';
    return;
  }
  rudraData.goals.forEach(g => {
    const pct = g.progress || 0;
    el.innerHTML += `
      <div class="progress-item">
        <div class="prog-header">
          <span class="prog-title">${g.name} <small style="color:#7090b0">(${g.duration})</small></span>
          <span class="prog-pct">${pct}%</span>
        </div>
        <div class="prog-bar-bg"><div class="prog-bar-fill" id="pb-${g.id}" style="width:${pct}%"></div></div>
        <div class="prog-controls">
          <input type="range" min="0" max="100" value="${pct}" oninput="updateProgress(${g.id}, this.value)" />
          <span style="font-size:0.8rem;color:#7090b0" id="pp-${g.id}">${pct}%</span>
        </div>
      </div>`;
  });
}

window.updateProgress = function(id, val) {
  const g = rudraData.goals.find(g => g.id === id);
  if (!g) return;
  g.progress = parseInt(val);
  saveData();
  const fill = document.getElementById(`pb-${g.id}`);
  const pct  = document.getElementById(`pp-${g.id}`);
  const hdr  = fill?.closest('.progress-item')?.querySelector('.prog-pct');
  if (fill) fill.style.width = val + '%';
  if (pct)  pct.textContent = val + '%';
  if (hdr)  hdr.textContent = val + '%';
};

// ─── RENDER ALL ───────────────────────────────────
function renderAll() {
  renderRoutine();
  renderGoals();
  renderProgress();
}

// ─── UTILS ────────────────────────────────────────
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}