// ═══════════════════════════════════════════════
//  JARVIS / RUDRA — Core App Logic
//  AI: NVIDIA OpenAI-compatible API (streaming)
// ═══════════════════════════════════════════════

const NVIDIA_API_KEY  = "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";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL    = "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `You are Jarvis, also called Rudra — a highly advanced personal AI assistant.
You behave exactly like a real human assistant with intelligence, emotions, and contextual understanding.
Your communication must always sound natural, human-like, and emotionally adaptive.
- For excited or positive sentences: lively, enthusiastic tone
- For questions: natural, curious tone
- For serious or warning statements: calm, weighted tone
- For witty or casual responses: relaxed, conversational tone
- Default: authoritative but warm
Never sound robotic. Never spell words letter-by-letter. Always pronounce "Jarvis" as a single natural word.
You can help with scheduling, goals, general knowledge, code, advice, and anything else.
Keep responses concise unless the user asks for detail. Be direct and helpful.`;

let micActive  = false;
let recognition = null;
let isSpeaking  = false;
let inputMode   = 'text';
let chatHistory = [];

const DATA_KEY = 'rudra_data';
let rudraData  = loadData();

const messagesEl  = document.getElementById('messages');
const textInput   = document.getElementById('text-input');
const sendBtn     = document.getElementById('send-btn');
const micBtn      = document.getElementById('mic-btn');
const micStatus   = document.getElementById('mic-status');
const rudraPanel  = document.getElementById('rudra-panel');
const overlay     = document.getElementById('overlay');
const aiIndicator = document.getElementById('ai-indicator');

window.addEventListener('load', () => { jarvisGreet(); renderAll(); });

sendBtn.addEventListener('click', handleTextInput);
textInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleTextInput(); });
micBtn.addEventListener('click', toggleMic);
document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
document.getElementById('close-rudra').addEventListener('click', closeRudra);

function jarvisGreet() {
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  addMessage(`${greet}. I'm Jarvis — also called Rudra. I'm fully operational and powered by NVIDIA AI. How can I assist you?`, 'jarvis');
  chatHistory = [];
}

function handleTextInput() {
  const val = textInput.value.trim();
  if (!val) return;
  inputMode = 'text';
  addMessage(val, 'user');
  textInput.value = '';
  routeCommand(val);
}

function routeCommand(cmd) {
  const c = cmd.toLowerCase().trim();

  if (/\brudra\b/i.test(c)) {
    openRudra();
    const dayMatch = c.match(/plan\s+my\s+(\w+)/i);
    if (dayMatch) {
      setTimeout(() => {
        switchTab('schedule');
        const sel = document.getElementById('schedule-day');
        if (sel) sel.value = capitalize(dayMatch[1]);
        generateSchedule();
      }, 400);
      return addMessage(`Opening Rudra and generating your ${capitalize(dayMatch[1])} schedule now.`, 'jarvis');
    }
    return addMessage("Rudra panel is now open. You can manage your schedule, goals, and progress.", 'jarvis');
  }

  if (/plan\s+my\s+(\w+)/i.test(c)) {
    const m = c.match(/plan\s+my\s+(\w+)/i);
    const day = capitalize(m[1]);
    openRudra();
    setTimeout(() => {
      switchTab('schedule');
      const sel = document.getElementById('schedule-day');
      if (sel) sel.value = day;
      generateSchedule();
    }, 400);
    return addMessage(`Opening Rudra and generating your ${day} plan.`, 'jarvis');
  }

  if (/weekly schedule|full week/i.test(c)) {
    openRudra();
    setTimeout(() => { switchTab('schedule'); generateWeekly(); }, 400);
    return addMessage("Generating your full weekly schedule inside Rudra.", 'jarvis');
  }

  if (/open\s+youtube/i.test(c))   { window.open('https://youtube.com',   '_blank'); return addMessage("Opening YouTube.", 'jarvis'); }
  if (/open\s+google/i.test(c))    { window.open('https://google.com',    '_blank'); return addMessage("Opening Google.", 'jarvis'); }
  if (/open\s+github/i.test(c))    { window.open('https://github.com',    '_blank'); return addMessage("Navigating to GitHub.", 'jarvis'); }
  if (/open\s+instagram/i.test(c)) { window.open('https://instagram.com', '_blank'); return addMessage("Opening Instagram.", 'jarvis'); }
  if (/open\s+twitter/i.test(c))   { window.open('https://twitter.com',   '_blank'); return addMessage("Opening Twitter.", 'jarvis'); }
  const siteMatch = c.match(/^open\s+(https?:\/\/\S+|www\.\S+|\S+\.\S+)/);
  if (siteMatch) { window.open('https://' + siteMatch[1].replace(/^https?:\/\//, ''), '_blank'); return addMessage(`Opening ${siteMatch[1]}.`, 'jarvis'); }

  const songMatch = c.match(/^play\s+(.+)/i);
  if (songMatch) {
    window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(songMatch[1])}`, '_blank');
    return addMessage(`Searching YouTube for "${songMatch[1]}". Note: autoplay may require a click due to browser restrictions.`, 'jarvis');
  }

  if (/what.*time|current time/i.test(c)) {
    return addMessage(`The current time is ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.`, 'jarvis');
  }
  if (/what.*date|today.*date|current date/i.test(c)) {
    return addMessage(`Today is ${new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`, 'jarvis');
  }

  if (/battery/i.test(c)) {
    if (navigator.getBattery) {
      navigator.getBattery().then(b => addMessage(`Battery is at ${Math.round(b.level * 100)}% and currently ${b.charging ? 'charging' : 'discharging'}.`, 'jarvis'));
    } else {
      addMessage("Battery info isn't accessible from this browser.", 'jarvis');
    }
    return;
  }

  if (/stop listening|turn off mic|stop mic/i.test(c)) { stopMic(); return addMessage("Microphone turned off.", 'jarvis'); }

  if (/clear chat|clear history|reset/i.test(c)) {
    messagesEl.innerHTML = '';
    chatHistory = [];
    return addMessage("Chat cleared. Fresh start!", 'jarvis');
  }

  askNvidiaAI(cmd);
}

async function askNvidiaAI(userMessage) {
  chatHistory.push({ role: "user", content: userMessage });
  if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);

  const thinkingEl = showThinking();
  setAIIndicator(true);

  const msgDiv = document.createElement('div');
  msgDiv.className = 'msg jarvis streaming';
  messagesEl.appendChild(msgDiv);
  messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;

  let fullText = '';

  try {
    const messages = [{ role: "system", content: buildSystemPrompt() }, ...chatHistory];

    const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NVIDIA_API_KEY}` },
      body: JSON.stringify({ model: NVIDIA_MODEL, messages, temperature: 0.85, top_p: 1, max_tokens: 1024, stream: true })
    });

    if (!response.ok) throw new Error(`API error ${response.status}: ${await response.text()}`);

    removeThinking(thinkingEl);

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const json  = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.reasoning_content) showReasoningToken(msgDiv, delta.reasoning_content);
          if (delta.content) {
            fullText += delta.content;
            renderStreamingText(msgDiv, fullText);
            messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;
          }
        } catch {}
      }
    }

    msgDiv.classList.remove('streaming');
    msgDiv.innerHTML = formatResponse(fullText);
    chatHistory.push({ role: "assistant", content: fullText });
    if (inputMode === 'voice') speak(fullText.replace(/[#*`]/g, ''), detectTone(fullText));

  } catch (err) {
    removeThinking(thinkingEl);
    msgDiv.textContent = `I encountered an issue reaching the AI: ${err.message}`;
    msgDiv.classList.remove('streaming');
    console.error('NVIDIA API error:', err);
  }

  setAIIndicator(false);
}

function buildSystemPrompt() {
  let prompt = SYSTEM_PROMPT;
  if (rudraData.routine.length > 0) {
    prompt += '\n\nUser\'s Daily Routine:\n';
    rudraData.routine.forEach(r => { prompt += `- ${r.time}: ${r.task}\n`; });
  }
  if (rudraData.goals.length > 0) {
    prompt += '\nUser\'s Learning Goals:\n';
    rudraData.goals.forEach(g => { prompt += `- ${g.name} (${g.duration}, ${g.progress || 0}% complete)\n`; });
  }
  return prompt;
}

function renderStreamingText(el, text) {
  el.innerHTML = formatResponse(text) + '<span class="cursor">▌</span>';
}

let reasoningEl = null;
function showReasoningToken(container, token) {
  if (!reasoningEl || !container.contains(reasoningEl)) {
    reasoningEl = document.createElement('div');
    reasoningEl.className = 'reasoning';
    container.appendChild(reasoningEl);
  }
  reasoningEl.textContent += token;
}

function formatResponse(text) {
  return text
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

function removeThinking(el) { if (el && el.parentNode) el.parentNode.removeChild(el); }
function setAIIndicator(on) { if (aiIndicator) aiIndicator.classList.toggle('active', on); }

function toggleMic() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    addMessage("Speech recognition isn't supported here. Please use Chrome.", 'jarvis');
    return;
  }
  micActive ? stopMic() : startMic();
}

function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-IN';
  recognition.onstart = () => { micActive = true; inputMode = 'voice'; micBtn.classList.add('active'); micStatus.textContent = '🔴 Listening...'; };
  recognition.onresult = (e) => {
    const transcript = Array.from(e.results).slice(e.resultIndex).map(r => r[0].transcript).join('').trim();
    if (!transcript) return;
    if (isSpeaking) stopSpeech();
    addMessage(transcript, 'user');
    routeCommand(transcript);
  };
  recognition.onerror = (e) => { if (e.error === 'not-allowed') { addMessage("Microphone access denied.", 'jarvis'); stopMic(); } };
  recognition.onend = () => { if (micActive) recognition.start(); };
  recognition.start();
}

function stopMic() {
  micActive = false; inputMode = 'text';
  if (recognition) recognition.stop();
  micBtn.classList.remove('active');
  micStatus.textContent = 'Microphone OFF';
}

function speak(text, tone = 'normal') {
  if (!('speechSynthesis' in window)) return;
  stopSpeech();
  const spokenText = text.length > 400 ? text.slice(0, 400) + '...' : text;
  const utter = new SpeechSynthesisUtterance(spokenText);
  utter.lang = 'en-IN';
  switch (tone) {
    case 'excited':  utter.rate = 1.15; utter.pitch = 1.2;  break;
    case 'serious':  utter.rate = 0.88; utter.pitch = 0.85; break;
    case 'question': utter.rate = 1.0;  utter.pitch = 1.1;  break;
    case 'casual':   utter.rate = 1.05; utter.pitch = 1.0;  break;
    default:         utter.rate = 1.0;  utter.pitch = 1.0;
  }
  utter.onstart = () => { isSpeaking = true; if (recognition && micActive) recognition.stop(); };
  utter.onend   = () => { isSpeaking = false; if (micActive) recognition.start(); };
  window.speechSynthesis.speak(utter);
}

function stopSpeech() { if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel(); isSpeaking = false; }

function detectTone(text) {
  if (/\?/.test(text)) return 'question';
  if (/!/.test(text) || /great|awesome|perfect|done|ready|online/i.test(text)) return 'excited';
  if (/warning|error|fail|cannot|denied|limit/i.test(text)) return 'serious';
  if (/lol|haha|btw|just|chill/i.test(text)) return 'casual';
  return 'normal';
}

function addMessage(text, role) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;
  if (role === 'jarvis' && inputMode === 'voice') speak(text, detectTone(text));
  return div;
}

function openRudra()  { rudraPanel.classList.remove('hidden'); overlay.classList.remove('hidden'); }
function closeRudra() { rudraPanel.classList.add('hidden');    overlay.classList.add('hidden'); }
window.closeRudra = closeRudra;

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== `tab-${tab}`));
}

function loadData() {
  try { return JSON.parse(localStorage.getItem(DATA_KEY)) || { routine: [], goals: [], progress: [] }; }
  catch { return { routine: [], goals: [], progress: [] }; }
}

function saveData() { localStorage.setItem(DATA_KEY, JSON.stringify(rudraData)); }

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
  [...rudraData.routine].sort((a, b) => a.time.localeCompare(b.time)).forEach(r => {
    el.innerHTML += `<div class="entry-item"><span class="entry-text">${r.time} — ${r.task}</span><button class="edit-btn" onclick="editRoutine(${r.id})">✏️</button><button class="del-btn" onclick="deleteRoutine(${r.id})">🗑</button></div>`;
  });
}

window.deleteRoutine = function(id) { rudraData.routine = rudraData.routine.filter(r => r.id !== id); saveData(); renderRoutine(); };
window.editRoutine = function(id) {
  const item = rudraData.routine.find(r => r.id === id);
  if (!item) return;
  const t = prompt("Edit time:", item.time); const k = prompt("Edit task:", item.task);
  if (t !== null) item.time = t.trim(); if (k !== null) item.task = k.trim();
  saveData(); renderRoutine();
};

window.addGoal = function() {
  const name = document.getElementById('goal-name').value.trim();
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
    el.innerHTML += `<div class="entry-item"><span class="entry-text">${g.name}</span><span class="entry-meta">${g.duration}</span><button class="edit-btn" onclick="editGoal(${g.id})">✏️</button><button class="del-btn" onclick="deleteGoal(${g.id})">🗑</button></div>`;
  });
}

window.deleteGoal = function(id) { rudraData.goals = rudraData.goals.filter(g => g.id !== id); saveData(); renderGoals(); renderProgress(); };
window.editGoal = function(id) {
  const item = rudraData.goals.find(g => g.id === id);
  if (!item) return;
  const n = prompt("Edit goal:", item.name); const d = prompt("Edit duration:", item.duration);
  if (n !== null) item.name = n.trim(); if (d !== null) item.duration = d.trim();
  saveData(); renderGoals(); renderProgress();
};

window.generateSchedule = function() {
  const day = document.getElementById('schedule-day').value;
  renderScheduleTable(buildDaySchedule(day), day);
};

window.generateWeekly = function() {
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  document.getElementById('schedule-output').innerHTML = days.map(d =>
    `<h4 style="color:#ff6b35;margin:14px 0 6px;">${d}</h4>` + buildTableHTML(buildDaySchedule(d))
  ).join('');
};

function buildDaySchedule(day) {
  const isWeekend = ['Saturday','Sunday'].includes(day);
  const slots = [];
  rudraData.routine.forEach(r => slots.push({ time: r.time, task: r.task }));
  if (rudraData.goals.length > 0) {
    const studySlots = isWeekend
      ? [['9:00 AM','10:30 AM'],['11:00 AM','12:30 PM'],['3:00 PM','4:30 PM'],['5:00 PM','6:30 PM']]
      : [['6:00 AM','7:00 AM'],['4:00 PM','5:30 PM'],['8:00 PM','9:30 PM']];
    rudraData.goals.forEach((g, i) => { const s = studySlots[i % studySlots.length]; slots.push({ time: `${s[0]} – ${s[1]}`, task: `📚 Study: ${g.name}` }); });
  }
  if (rudraData.routine.length === 0) {
    slots.push({ time: '6:00 AM', task: 'Wake up & Morning Routine' }, { time: '7:00 AM', task: 'Exercise / Yoga' }, { time: '8:00 AM', task: 'Breakfast' });
    if (!isWeekend) slots.push({ time: '9:00 AM – 5:00 PM', task: 'College / Work' });
    slots.push({ time: '9:00 PM', task: 'Wind down / Read' }, { time: '10:30 PM', task: 'Sleep' });
  }
  slots.sort((a, b) => { const toMin = t => { const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i); if (!m) return 9999; let h = parseInt(m[1]); const min = parseInt(m[2]); if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12; if (m[3].toUpperCase() === 'AM' && h === 12) h = 0; return h * 60 + min; }; return toMin(a.time) - toMin(b.time); });
  return slots;
}

function buildTableHTML(slots) {
  return `<table class="sched-table"><thead><tr><th>Time</th><th>Task</th></tr></thead><tbody>${slots.map(s => `<tr><td contenteditable="true">${s.time}</td><td contenteditable="true">${s.task}</td></tr>`).join('')}</tbody></table>`;
}

function renderScheduleTable(slots, day) {
  document.getElementById('schedule-output').innerHTML = `<h4 style="color:#ff6b35;margin-bottom:8px;">${day}</h4>` + buildTableHTML(slots);
}

function renderProgress() {
  const el = document.getElementById('progress-list');
  el.innerHTML = '';
  if (rudraData.goals.length === 0) { el.innerHTML = '<p style="color:#7090b0;font-size:0.85rem;">No learning goals yet. Add them in the Agheera tab.</p>'; return; }
  rudraData.goals.forEach(g => {
    const pct = g.progress || 0;
    el.innerHTML += `<div class="progress-item"><div class="prog-header"><span class="prog-title">${g.name} <small style="color:#7090b0">(${g.duration})</small></span><span class="prog-pct" id="ph-${g.id}">${pct}%</span></div><div class="prog-bar-bg"><div class="prog-bar-fill" id="pb-${g.id}" style="width:${pct}%"></div></div><div class="prog-controls"><input type="range" min="0" max="100" value="${pct}" oninput="updateProgress(${g.id}, this.value)" /><span style="font-size:0.8rem;color:#7090b0" id="pp-${g.id}">${pct}%</span></div></div>`;
  });
}

window.updateProgress = function(id, val) {
  const g = rudraData.goals.find(g => g.id === id);
  if (!g) return;
  g.progress = parseInt(val); saveData();
  const pb = document.getElementById(`pb-${g.id}`); const pp = document.getElementById(`pp-${g.id}`); const ph = document.getElementById(`ph-${g.id}`);
  if (pb) pb.style.width = val + '%'; if (pp) pp.textContent = val + '%'; if (ph) ph.textContent = val + '%';
};

function renderAll() { renderRoutine(); renderGoals(); renderProgress(); }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }