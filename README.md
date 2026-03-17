# Agastya — Jarvis / Rudra AI Assistant

> You are **Jarvis**, also called **Rudra** — a highly advanced personal AI assistant with intelligence, emotional voice modulation, contextual understanding, and full task execution capabilities.

## Features

### 🎙️ Voice & Text Interaction
- **Continuous listening** — once mic is activated, it stays on until manually turned off
- **Auto-pause** — Jarvis pauses listening while speaking; resumes after response
- **Interruption-friendly** — speak while Jarvis is talking to interrupt
- **Input-output mode matching** — voice input → voice output; text input → text output
- **Emotional tone modulation** — excited, serious, question, casual, authoritative

### ⚡ Command Execution
- `open youtube` / `open google` / `open <any site>` — opens directly
- `play <song name>` — searches YouTube and initiates playback
- `what time is it` / `today's date` — real-time info
- `battery` — retrieves device battery status
- `open Rudra` / `Rudra` — opens the Rudra management panel

### ⚡ Rudra Panel
A full AI-powered management system for schedules, goals, and planning.

#### Agheera Tab
- **Daily Routine** — add, edit, delete fixed daily activities (college, pooja, classes, etc.)
- **Learning Goals** — set goals with durations (e.g. "Web Development in 3 months")
- All entries are fully editable — no locked fields

#### Schedule Tab
- Generate intelligent daily or weekly schedules based on your Agheera data
- Outputs an editable table with time slots
- All cells are editable inline

#### Progress Tab
- Track progress of each learning goal with a slider (0–100%)
- Progress is saved and persists across sessions

### 💾 Data Persistence
All data (routine, goals, progress) is stored in `localStorage` — survives page refreshes.

## Usage

Open `index.html` in a browser (Chrome recommended for full speech support).

### Voice Commands (examples)
- "Open Rudra"
- "Plan my Monday"
- "Generate my weekly schedule"
- "Open Rudra and plan my Tuesday"
- "Play Kesariya"
- "Open YouTube"
- "What time is it"
- "Battery percentage"
- "Stop listening"

## Tech Stack
- Vanilla HTML + CSS + JavaScript
- Web Speech API (SpeechRecognition + SpeechSynthesis)
- localStorage for persistence
- Zero dependencies — runs fully offline

## Browser Support
- ✅ Chrome / Edge (full support)
- ⚠️ Firefox (limited speech support)
- ⚠️ Safari (limited speech support)
