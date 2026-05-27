
# Real-Time English Speaking Feedback App
 
## Motivation
 
When I enabled the AI analytics feature in my English learning app, I discovered that in a 25-minute class I was speaking for 21 minutes while the teacher spoke for only 4. That's 84% of the time being me.
 
For someone whose main goal is practicing speaking, the teacher's role in that interaction is structurally replaceable by AI — as long as the AI has enough naturalness to keep the conversation flowing.
 
My current routine is two daily 15-minute sessions with ChatGPT Voice Mode, and it works well. That's precisely why the goal here isn't to build yet another conversational agent. The real value to add is **real-time feedback while I speak**.
 
---
 
## Product
 
A web application — and potentially a Google Meet plugin — with four core features:
 
- **Live transcription** — your words appear on screen as you say them, in real time
- **Inline corrections** — grammar mistakes are underlined in red with a correction tooltip, a few seconds after they happen
- **Ghost text** — after 3 seconds of silence, a grayed-out suggestion appears showing how to continue the sentence
- **Filler word tracker** — words like "uh", "like", or "you know" are highlighted in amber, with a per-session counter for each one
