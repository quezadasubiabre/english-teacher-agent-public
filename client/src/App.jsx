import { useState, useRef, useCallback, useEffect } from "react";

const SERVER_URL = "http://localhost:7860";

const ICE_TIMEOUT_MS = 2000;
const STUN = [{ urls: "stun:stun.l.google.com:19302" }];

const TOPICS = [
  "Job interview practice",
  "Daily conversation",
  "Business meeting",
  "Travel & directions",
  "Academic discussion",
  "Small talk",
];

const BAR_HEIGHTS = [10,16,26,20,34,22,14,28,18,24,32,16,26,12,30,20,16,24,28,14,22,34,18,26];

// Ordered longest-first so multi-word fillers match before single words
const FILLER_WORDS = [
  "you know what i mean", "you know", "kind of", "sort of", "i mean",
  "um", "uh", "like", "basically", "literally", "actually", "right", "so", "well", "anyway",
];

// Returns [{word, index, length}] sorted by index, no overlaps
function detectFillers(text) {
  const lower = text.toLowerCase();
  const hits = [];
  const taken = new Set();
  for (const fw of FILLER_WORDS) {
    let start = 0;
    while (start < lower.length) {
      const idx = lower.indexOf(fw, start);
      if (idx === -1) break;
      // word-boundary check
      const before = idx === 0 || /\W/.test(lower[idx - 1]);
      const after = idx + fw.length >= lower.length || /\W/.test(lower[idx + fw.length]);
      if (before && after) {
        // check no overlap with already-taken positions
        const overlap = [...Array(fw.length).keys()].some((i) => taken.has(idx + i));
        if (!overlap) {
          hits.push({ word: fw, index: idx, length: fw.length });
          for (let i = 0; i < fw.length; i++) taken.add(idx + i);
        }
      }
      start = idx + 1;
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function waitForIceGatheringComplete(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const timeout = setTimeout(() => resolve(), ICE_TIMEOUT_MS);
    pc.addEventListener("icegatheringstatechange", function handler() {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeout);
        pc.removeEventListener("icegatheringstatechange", handler);
        resolve();
      }
    });
  });
}

// ── Bar waveform (animated bars) ──────────────────────────────────────────────
function BarWaveform({ active, color, count = 22 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2.5, height: 32 }}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          style={{
            width: 3,
            borderRadius: 2,
            background: color,
            height: BAR_HEIGHTS[i % BAR_HEIGHTS.length],
            transform: active ? undefined : "scaleY(0.2)",
            animation: active ? `barWave 0.8s ease-in-out ${(i * 0.045).toFixed(3)}s infinite` : "none",
            transition: "transform 0.3s",
          }}
        />
      ))}
    </div>
  );
}

// Splits a plain text string into [{type:"text"}|{type:"filler"}] parts
function applyFillerHighlights(text) {
  const hits = detectFillers(text);
  if (hits.length === 0) return [{ type: "text", value: text }];
  const parts = [];
  let cursor = 0;
  for (const { index, length } of hits) {
    if (index > cursor) parts.push({ type: "text", value: text.slice(cursor, index) });
    parts.push({ type: "filler", value: text.slice(index, index + length) });
    cursor = index + length;
  }
  if (cursor < text.length) parts.push({ type: "text", value: text.slice(cursor) });
  return parts;
}

// ── Sentence with inline grammar corrections + filler highlights ──────────────
function SentenceWithCorrections({ sentence }) {
  const { text, corrections } = sentence;
  const visibleCorrections = corrections.filter((c) => c.visible);

  // Step 1: split by grammar corrections
  let parts = [{ type: "text", value: text }];
  for (const corr of visibleCorrections) {
    const escaped = corr.wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rePlain = new RegExp(escaped, "i");
    const reBoundary = new RegExp(`\\b${escaped}\\b`, "i");
    const next = [];
    for (const part of parts) {
      if (part.type !== "text") { next.push(part); continue; }
      const match = rePlain.exec(part.value) ?? reBoundary.exec(part.value);
      if (!match) { next.push(part); continue; }
      const idx = match.index;
      const matchedText = match[0];
      if (idx > 0) next.push({ type: "text", value: part.value.slice(0, idx) });
      next.push({ type: "correction", wrong: matchedText, right: corr.right });
      const after = part.value.slice(idx + matchedText.length);
      if (after) next.push({ type: "text", value: after });
    }
    parts = next;
  }

  // Step 2: further split text parts for filler highlights
  const finalParts = [];
  for (const part of parts) {
    if (part.type !== "text") { finalParts.push(part); continue; }
    for (const sub of applyFillerHighlights(part.value)) finalParts.push(sub);
  }

  return (
    <>
      {finalParts.map((p, i) => {
        if (p.type === "filler") return (
          <mark key={i} style={{
            background: "#FEF3C7", color: "#92400E",
            borderRadius: 3, padding: "0 2px",
            fontWeight: 500, fontStyle: "italic",
          }}>{p.value}</mark>
        );
        if (p.type === "correction") return (
          <span key={i} style={{ whiteSpace: "nowrap" }}>
            <span style={{ textDecoration: "line-through", color: "#DC2626" }}>{p.wrong}</span>
            <span style={{ color: "#9ca3af", margin: "0 3px", fontSize: "0.8em" }}>→</span>
            <span style={{ color: "#16A34A", fontWeight: 500 }}>{p.right}</span>
          </span>
        );
        return <span key={i}>{p.value}</span>;
      })}
    </>
  );
}

// ── Filler tracker card ───────────────────────────────────────────────────────
function FillerTrackerCard({ fillerCounts }) {
  const entries = Object.entries(fillerCounts);
  if (entries.length === 0) return null;
  const total = entries.reduce((s, [, v]) => s + v.count, 0);

  return (
    <div style={{
      background: "#fff", border: "0.5px solid #e5e7eb",
      borderRadius: 16, padding: "14px 18px",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 12,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 500, color: "#6b7280",
          letterSpacing: "0.08em", textTransform: "uppercase",
        }}>Filler words</span>
        <span style={{
          fontSize: 11, fontWeight: 600, color: "#92400E",
          background: "#FEF3C7", border: "0.5px solid #F59E0B",
          borderRadius: 99, padding: "2px 8px",
        }}>{total} total</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {entries.map(([word, { count, bumpKey }]) => (
          <FillerChip key={word + bumpKey} word={word} count={count} isNew={count === 1} />
        ))}
      </div>
    </div>
  );
}

function FillerChip({ word, count, isNew }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        background: "#FFFBEB", border: "0.5px solid #F59E0B",
        borderRadius: 99, padding: "4px 10px",
        fontSize: 13, fontWeight: 500, color: "#92400E",
        position: "relative",
        animation: isNew
          ? "chipPop 0.3s ease-out forwards"
          : "chipBump 0.35s ease-out forwards",
      }}
    >
      {word}
      <span style={{
        background: "#F59E0B", color: "#fff",
        borderRadius: "50%", fontSize: 10, fontWeight: 700,
        minWidth: 16, height: 16,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "0 3px",
      }}>{count}</span>
    </span>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function VoiceTutor() {
  const [status, setStatus] = useState("idle"); // idle | connecting | connected | error
  const [micActive, setMicActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [botSpeaking, setBotSpeaking] = useState(false);
  const [topicIdx, setTopicIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  // Each sentence: { id, text, corrections: [{ wrong, right, visible }] }
  const [sentences, setSentences] = useState([]);
  const [interim, setInterim] = useState("");
  const sentenceIdRef = useRef(0);
  const pendingFragmentRef = useRef(null); // holds short fragment waiting for next sentence
  // fillerCounts: { word → { count, bumpKey } }
  const [fillerCounts, setFillerCounts] = useState({});

  const [userSpeaking, setUserSpeaking] = useState(false);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const audioElRef = useRef(null);
  const audioCtxRef = useRef(null);
  const iceCandidatesQueueRef = useRef([]);
  const pcIdRef = useRef(null);
  const elapsedTimerRef = useRef(null);
  const dataChannelRef = useRef(null);
  const micAnalyserRef = useRef(null);
  const vadRafRef = useRef(null);
  const botRafRef = useRef(null);

  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  // ── Timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isConnected) {
      elapsedTimerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      clearInterval(elapsedTimerRef.current);
      setElapsed(0);
    }
    return () => clearInterval(elapsedTimerRef.current);
  }, [isConnected]);

  const formatTime = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  // ── Connect ────────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    try {
      setStatus("connecting");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      setMicActive(true);

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      // Mic volume analyser for VAD-based waveform animation
      const micSource = audioCtx.createMediaStreamSource(stream);
      const micAnalyser = audioCtx.createAnalyser();
      micAnalyser.fftSize = 256;
      micSource.connect(micAnalyser);
      micAnalyserRef.current = micAnalyser;
      const vadData = new Uint8Array(micAnalyser.frequencyBinCount);
      const THRESHOLD = 8;
      function vadLoop() {
        vadRafRef.current = requestAnimationFrame(vadLoop);
        micAnalyser.getByteFrequencyData(vadData);
        const avg = vadData.reduce((s, v) => s + v, 0) / vadData.length;
        setUserSpeaking(avg > THRESHOLD);
      }
      vadLoop();

      const pc = new RTCPeerConnection({ iceServers: STUN });
      pcRef.current = pc;

      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      // RTVI DataChannel — required for Pipecat to send transcriptions and fire on_client_ready
      const dc = pc.createDataChannel("pipecat-rtvi");
      dataChannelRef.current = dc;

      dc.onopen = () => {
        dc.send(JSON.stringify({ label: "rtvi-ai", type: "client-ready" }));
      };

      dc.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "user-transcription" && msg.data?.text) {
            console.log("[t]", msg.data.final, JSON.stringify(msg.data.text));
            if (msg.data.final) {
              // If there's a pending short fragment, merge it with this sentence
              const raw = msg.data.text;
              const pending = pendingFragmentRef.current;
              const text = pending ? `${pending.text} ${raw}` : raw;
              const wordCount = text.trim().split(/\s+/).length;

              // If still too short, hold it and wait for the next fragment
              if (wordCount < 4) {
                pendingFragmentRef.current = { text };
                if (!pending) {
                  // Show it in UI immediately even though we'll correct it later
                  const id = ++sentenceIdRef.current;
                  pendingFragmentRef.current.id = id;
                  setSentences((prev) => [...prev, { id, text, corrections: [] }]);
                }
                setInterim("");
                return;
              }

              pendingFragmentRef.current = null;
              const id = pending?.id ?? ++sentenceIdRef.current;

              if (pending?.id) {
                // Update the existing sentence with merged text
                setSentences((prev) =>
                  prev.map((s) => s.id === id ? { ...s, text } : s)
                );
              } else {
                setSentences((prev) => [...prev, { id, text, corrections: [] }]);
              }
              setInterim("");

              // Filler word detection — update counts immediately
              const fillers = detectFillers(text);
              if (fillers.length > 0) {
                setFillerCounts((prev) => {
                  const next = { ...prev };
                  for (const { word } of fillers) {
                    const existing = next[word];
                    next[word] = existing
                      ? { count: existing.count + 1, bumpKey: existing.bumpKey + 1 }
                      : { count: 1, bumpKey: 0 };
                  }
                  return next;
                });
              }

              // Deferred grammar correction
              setTimeout(async () => {
                try {
                  const res = await fetch(`${SERVER_URL}/api/correct`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sentence: text }),
                  });
                  const { corrections } = await res.json();
                  console.log("[correct]", text, corrections);
                  if (!corrections || corrections.length === 0) return;

                  // Reveal corrections one by one with 500ms gap
                  corrections.forEach((corr, i) => {
                    setTimeout(() => {
                      setSentences((prev) =>
                        prev.map((s) =>
                          s.id === id
                            ? { ...s, corrections: [...s.corrections, { ...corr, visible: true }] }
                            : s
                        )
                      );
                    }, i * 500);
                  });
                } catch (err) {
                  console.error("[correct] fetch failed", err);
                }
              }, 2000);
            } else {
              setInterim(msg.data.text);
            }
          }
          if (msg.type === "bot-tts-started" || msg.type === "bot-started-speaking") setBotSpeaking(true);
          if (msg.type === "bot-tts-stopped" || msg.type === "bot-stopped-speaking") setBotSpeaking(false);
        } catch {
          // non-JSON message
        }
      };

      pc.ontrack = (e) => {
        if (!audioElRef.current) audioElRef.current = new Audio();
        audioElRef.current.srcObject = e.streams[0];
        audioElRef.current.play().catch(console.error);

        const botSource = audioCtx.createMediaStreamSource(e.streams[0]);
        const botAnalyser = audioCtx.createAnalyser();
        botAnalyser.fftSize = 256;
        botSource.connect(botAnalyser);
        const botData = new Uint8Array(botAnalyser.frequencyBinCount);
        function botVadLoop() {
          botRafRef.current = requestAnimationFrame(botVadLoop);
          botAnalyser.getByteFrequencyData(botData);
          const avg = botData.reduce((s, v) => s + v, 0) / botData.length;
          setBotSpeaking(avg > 8);
        }
        botVadLoop();
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
          setStatus("connected");
        }
        if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
          setStatus("error");
        }
      };

      pc.onicecandidate = async (e) => {
        if (!e.candidate) return;
        const currentPcId = pcIdRef.current;
        if (currentPcId) {
          try {
            await fetch(`${SERVER_URL}/api/offer`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                pc_id: currentPcId,
                candidates: [{
                  candidate: e.candidate.candidate,
                  sdp_mid: e.candidate.sdpMid,
                  sdp_mline_index: e.candidate.sdpMLineIndex,
                }],
              }),
            });
          } catch {
            iceCandidatesQueueRef.current.push(e.candidate);
          }
        } else {
          iceCandidatesQueueRef.current.push(e.candidate);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);

      const res = await fetch(`${SERVER_URL}/api/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp: pc.localDescription.sdp, type: pc.localDescription.type }),
      });

      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const answer = await res.json();

      pcIdRef.current = answer.pc_id;

      if (iceCandidatesQueueRef.current.length > 0) {
        await fetch(`${SERVER_URL}/api/offer`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pc_id: answer.pc_id,
            candidates: iceCandidatesQueueRef.current.map((c) => ({
              candidate: c.candidate,
              sdp_mid: c.sdpMid,
              sdp_mline_index: c.sdpMLineIndex,
            })),
          }),
        });
        iceCandidatesQueueRef.current = [];
      }

      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      setStatus("error");
      console.error(err);
    }
  }, []);

  // ── Disconnect ─────────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    cancelAnimationFrame(vadRafRef.current);
    cancelAnimationFrame(botRafRef.current);
    vadRafRef.current = null;
    botRafRef.current = null;
    micAnalyserRef.current = null;
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    iceCandidatesQueueRef.current = [];
    pcIdRef.current = null;
    pendingFragmentRef.current = null;
    setStatus("idle");
    setMicActive(false);
    setUserSpeaking(false);
    setMuted(false);
    setBotSpeaking(false);
    setSentences([]);
    setInterim("");
    setFillerCounts({});
  }, []);

  const toggleMic = useCallback(() => {
    if (!isConnected) return;
    const next = !muted;
    setMuted(next);
    localStreamRef.current?.getTracks().forEach((t) => { t.enabled = !next; });
  }, [isConnected, muted]);

  const teacherStatus = isConnected
    ? botSpeaking
      ? "Speaking..."
      : muted
      ? "Muted"
      : "Listening to you..."
    : isConnecting
    ? "Connecting to Pipecat..."
    : "Not connected";

  return (
    <>
      <style>{`
        @keyframes barWave { 0%,100%{transform:scaleY(0.2)} 50%{transform:scaleY(1)} }
        @keyframes ringPulse { 0%,100%{opacity:0.4} 50%{opacity:1} }
        @keyframes blinkDot { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes blinkCur { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes connectingPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes chipPop { 0%{transform:scale(0.6);opacity:0} 70%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }
        @keyframes chipBump { 0%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }
        .call-btn:hover { transform: scale(1.06) !important; }
        .call-btn:active { transform: scale(0.95) !important; }
        .mic-btn:hover { background: #f3f4f6 !important; }
        .mic-btn.muted:hover { background: #fde8e8 !important; }
        .topic-pill:hover { background: #f3f4f6 !important; }
      `}</style>

      <div style={{
        minHeight: "100vh",
        background: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
        padding: 24,
      }}>
        <div style={{ width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Top bar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <button
              className="topic-pill"
              onClick={() => setTopicIdx((i) => (i + 1) % TOPICS.length)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "#f9fafb", border: "0.5px solid #e5e7eb",
                borderRadius: 99, padding: "6px 14px",
                fontSize: 13, fontWeight: 500, color: "#111827",
                cursor: "pointer", transition: "background 0.15s",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#378ADD" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              {TOPICS[topicIdx]}
            </button>
            <div style={{
              background: "#f9fafb", border: "0.5px solid #e5e7eb",
              borderRadius: 99, padding: "6px 14px",
              fontSize: 13, fontWeight: 500, color: "#111827",
            }}>
              B2 · Intermediate
            </div>
          </div>

          {/* Teacher row */}
          <div style={{
            display: "flex", alignItems: "center", gap: 14,
            background: "#fff", border: "0.5px solid #e5e7eb",
            borderRadius: 16, padding: "14px 18px",
          }}>
            {/* Avatar */}
            <div style={{ position: "relative", flexShrink: 0 }}>
              <div style={{
                width: 42, height: 42, borderRadius: "50%",
                background: "#E6F1FB", display: "flex",
                alignItems: "center", justifyContent: "center",
                fontWeight: 500, fontSize: 14, color: "#0C447C",
              }}>
                ES
              </div>
              {botSpeaking && (
                <div style={{
                  position: "absolute", inset: -3, borderRadius: "50%",
                  border: "2px solid #378ADD",
                  animation: "ringPulse 1.2s ease-in-out infinite",
                }} />
              )}
            </div>

            {/* Info */}
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 500, color: "#111827", margin: "0 0 2px" }}>
                Emma Sullivan
              </p>
              <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>
                {teacherStatus}
              </p>
            </div>

            {/* Teacher waveform */}
            <BarWaveform active={botSpeaking} color="#378ADD" count={22} />
          </div>

          {/* Transcript card */}
          <div style={{
            background: "#fff", border: "0.5px solid #e5e7eb",
            borderRadius: 16, padding: "1.5rem", minHeight: 120,
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 11, fontWeight: 500, color: "#6b7280",
              letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16,
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%", background: "#E24B4A",
                animation: isConnected ? "blinkDot 1.4s ease-in-out infinite" : "none",
                opacity: isConnected ? undefined : 0.3,
              }} />
              live transcription · you
            </div>
            <div style={{
              fontSize: 19, fontWeight: 400, lineHeight: 1.65,
              color: "#111827", letterSpacing: "-0.01em", minHeight: 60,
            }}>
              {sentences.length > 0 || interim ? (
                <>
                  {sentences.map((s, si) => (
                    <span key={s.id}>
                      {si > 0 ? " " : ""}
                      <SentenceWithCorrections sentence={s} />
                    </span>
                  ))}
                  {sentences.length > 0 && interim ? " " : ""}
                  {interim && <span style={{ color: "#9ca3af" }}>{interim}</span>}
                </>
              ) : (
                <span style={{ color: "#d1d5db" }}>
                  {isConnected ? "Start speaking..." : "Connect to begin your lesson"}
                </span>
              )}
              {isConnected && (
                <span style={{
                  display: "inline-block", width: 2, height: "1.1em",
                  background: "#111827", marginLeft: 2, verticalAlign: "text-bottom",
                  animation: "blinkCur 1.1s step-end infinite",
                }} />
              )}
            </div>
          </div>

          {/* Filler tracker */}
          <FillerTrackerCard fillerCounts={fillerCounts} />

          {/* User audio row */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            opacity: micActive ? 1 : 0, transition: "opacity 0.3s", minHeight: 36,
          }}>
            <button
              className={`mic-btn${muted ? " muted" : ""}`}
              onClick={toggleMic}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              style={{
                width: 32, height: 32, borderRadius: "50%",
                border: muted ? "0.5px solid #F09595" : "0.5px solid #e5e7eb",
                background: muted ? "#FCEBEB" : "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", outline: "none", transition: "background 0.2s",
                flexShrink: 0,
              }}
            >
              {muted ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#A32D2D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}
            </button>
            <BarWaveform active={userSpeaking && !muted} color="#1D9E75" count={22} />
          </div>

          {/* Call button */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <button
              className="call-btn"
              onClick={isConnected || isConnecting ? disconnect : connect}
              disabled={isConnecting}
              aria-label={isConnected ? "Hang up" : "Connect"}
              style={{
                width: 64, height: 64, borderRadius: "50%", border: "none",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: isConnecting ? "not-allowed" : "pointer",
                outline: "none", transition: "transform 0.15s, background 0.2s",
                background: isConnected ? "#A32D2D" : isConnecting ? "#BA7517" : "#3B6D11",
                animation: isConnecting ? "connectingPulse 1.2s ease-in-out infinite" : "none",
              }}
            >
              {isConnecting ? (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FAEEDA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ animation: "spin 1s linear infinite" }}>
                  <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
                  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
                  <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
                  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
                </svg>
              ) : isConnected ? (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FCEBEB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 4.43 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.34 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.32 9.9"/>
                  <line x1="23" y1="1" x2="1" y2="23"/>
                </svg>
              ) : (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#EAF3DE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91A16 16 0 0 0 15 17l.91-.91a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 18.18z"/>
                </svg>
              )}
            </button>
            <span style={{ fontSize: 12, color: "#9ca3af", letterSpacing: "0.04em" }}>
              {isConnected ? "Hang up" : isConnecting ? "Connecting..." : "Connect"}
            </span>
            <span style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", color: "#9ca3af", minHeight: 18 }}>
              {isConnected ? formatTime(elapsed) : ""}
            </span>
          </div>

        </div>
      </div>
    </>
  );
}
