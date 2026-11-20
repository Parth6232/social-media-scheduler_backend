// Groq (free tier) — 2 kaam:
//   1) groqTranscribe: Whisper large-v3-turbo se transcript (word timestamps ke saath) => captions + best-moment ke liye
//   2) groqChat: Llama se text jawab (Gemini fail ho to backup)
// Server par CPU/RAM nahi lagta, 4 min ki video ~2-3 sec me transcribe ho jaati hai.
// Key: https://console.groq.com/keys  => Render/.env me GROQ_API_KEY
const fs = require("fs");
const path = require("path");

const BASE = "https://api.groq.com/openai/v1";
const hasGroq = () => Boolean(process.env.GROQ_API_KEY);

// error text se API key jaisi cheezein hata do
const clean = (m) =>
    String(m || "")
        .replace(/key=[^&\s]+/gi, "key=***")
        .replace(/gsk_[A-Za-z0-9]+/g, "gsk_***")
        .replace(/\s+/g, " ")
        .slice(0, 180);

async function groqTranscribe(filePath) {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(filePath)], { type: "audio/mpeg" }), path.basename(filePath));
    form.append("model", process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    form.append("temperature", "0");

    const res = await fetch(`${BASE}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: form,
        signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Groq transcribe ${res.status}: ${clean(await res.text())}`);
    const data = await res.json();

    const words = (data.words || [])
        .map((w) => ({ start: Number(w.start), end: Number(w.end), word: String(w.word || "").trim() }))
        .filter((w) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end));
    const segments = (data.segments || [])
        .map((s) => ({ start: Number(s.start), end: Number(s.end), text: String(s.text || "").trim(), words: [] }))
        .filter((s) => s.text && Number.isFinite(s.start) && Number.isFinite(s.end));

    // words ko unke segment me jodo (captions ke liye)
    let wi = 0;
    for (const seg of segments) {
        while (wi < words.length && words[wi].start < seg.end - 0.01) {
            if (words[wi].start >= seg.start - 0.05) seg.words.push(words[wi]);
            wi++;
        }
    }
    if (!segments.length && data.text) throw new Error("Groq ne timestamps nahi diye (shayad video me speech nahi hai)");
    return { language: data.language || null, segments };
}

async function groqChat(prompt) {
    const models = [...new Set([process.env.GROQ_LLM_MODEL, "llama-3.3-70b-versatile", "llama-3.1-8b-instant"].filter(Boolean))];
    let last;
    for (const model of models) {
        try {
            const res = await fetch(`${BASE}/chat/completions`, {
                method: "POST",
                headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: 2048 }),
                signal: AbortSignal.timeout(60000),
            });
            if (!res.ok) throw new Error(`Groq chat ${res.status}: ${clean(await res.text())}`);
            const data = await res.json();
            const text = data.choices?.[0]?.message?.content;
            if (!text) throw new Error("Groq ne khaali jawab diya");
            return text;
        } catch (e) {
            last = e; // model hat gaya ho to agla try karo
        }
    }
    throw last;
}

module.exports = { hasGroq, groqTranscribe, groqChat, clean };
