// Fast "best moments" picker — Whisper/Python ki zaroorat NAHI.
//   1) ffmpeg se chhota mono audio (mp3, ~24kbps) banata hai
//   2) Gemini ko seedha AUDIO sunwa kar 30-40 sec ke best moments maangta hai
//   3) Gemini fail ho (quota/network) to fallback: audio ki awaaz/energy se best hisse chunta hai
// Result: { moments: [{start, end, title, reason, score}], warning }
const fs = require("fs");
const path = require("path");
const cfg = require("../../config/shortsConfig");
const { run } = require("./runCommand");
const { generateWithAutoModel } = require("../../controllers/aiController");
const { overlapRatio, pickMoments } = require("./momentPicker");
const { hasGroq, groqTranscribe, groqChat, clean } = require("./groq");

const MIN_SEC = Number(process.env.SHORTS_FAST_MIN_SEC || 30);
const MAX_SEC = Number(process.env.SHORTS_FAST_MAX_SEC || 40);
const MAX_INLINE_BYTES = 14 * 1024 * 1024; // Gemini inline limit (~20MB request) se safe

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

const ANGLES = [
    "funny or entertaining moments",
    "surprising or shocking reveals",
    "useful tips or actionable advice",
    "emotional or inspiring moments",
    "strong opinions or high-energy moments",
    "storytelling peaks with a clear payoff",
];

// ---------- 1) chhota audio ----------
async function makeSmallAudio(dir, videoPath, wavPath) {
    const out = path.join(dir, "audio_small.mp3");
    if (fs.existsSync(out) && fs.statSync(out).size <= MAX_INLINE_BYTES) return out;
    for (const br of ["24k", "12k"]) {
        await run(cfg.FFMPEG, [
            "-y", "-hide_banner", "-loglevel", "error",
            "-i", wavPath && fs.existsSync(wavPath) ? wavPath : videoPath, // wav se banana tez hai (video dobara read nahi hoti)
            "-vn", "-ac", "1", "-ar", "16000", "-b:a", br, out,
        ]);
        if (fs.statSync(out).size <= MAX_INLINE_BYTES) return out;
    }
    return null; // bahut lamba — Gemini inline nahi le sakta
}

// ---------- 2) Gemini audio ----------
function parseJsonArray(text) {
    const a = text.indexOf("[");
    const b = text.lastIndexOf("]");
    if (a === -1 || b === -1) throw new Error("AI ne JSON nahi diya");
    return JSON.parse(text.slice(a, b + 1));
}

async function geminiMoments(mp3Path, { videoTitle, duration, minSec, maxSec, history }) {
    const data = fs.readFileSync(mp3Path).toString("base64");
    const angle = ANGLES[Math.floor(Math.random() * ANGLES.length)];
    const avoid = history.length
        ? `\nDo NOT choose moments near these already-used ranges (seconds): ${history
            .map((h) => `${Math.floor(h.start)}-${Math.floor(h.end)}`)
            .join(", ")}.`
        : "";

    const prompt = `You are an expert short-form video editor (YouTube Shorts / Reels).
This is the audio of a video titled "${videoTitle}". Total length: ${Math.floor(duration)} seconds.
Listen carefully and find 8 DIFFERENT strong moments to turn into vertical shorts.
This round, lean toward: ${angle}.
Rules:
- Each moment is ${minSec}-${maxSec} seconds long.
- Start exactly on a strong hook, end on a complete thought (never mid-sentence).
- Moments must not overlap.${avoid}
- "start" and "end" are REAL timestamps in seconds from the beginning of the audio (numbers only).
- "score" is 1-10 (viral potential).

Reply with ONLY a JSON array, no markdown:
[{"start": 125, "end": 160, "title": "catchy title, max 60 chars", "reason": "one line why", "score": 8}]`;

    const raw = await generateWithAutoModel([
        { inlineData: { mimeType: "audio/mp3", data } },
        { text: prompt },
    ]);
    return parseJsonArray(raw.replace(/```json|```/g, ""));
}

function normalizeCandidates(list, { duration, minSec, maxSec }) {
    const out = [];
    for (const c of list) {
        let s = Number(c.start);
        let e = Number(c.end);
        if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
        s = clamp(s, 0, Math.max(0, duration - minSec));
        const len = clamp(e - s, minSec, maxSec);
        e = Math.min(duration, s + len);
        if (e - s < Math.min(minSec, duration)) continue;
        out.push({
            start: s,
            end: e,
            title: String(c.title || "Best moment").slice(0, 90),
            reason: String(c.reason || ""),
            score: Number(c.score) || 5,
        });
    }
    return out;
}

// ---------- 3) fallback: awaaz/energy se ----------
// 16kHz mono wav (downloader isi ko audio.wav banata hai) ko 1-second ke RMS me todta hai
function secondEnergy(wavPath) {
    const fd = fs.openSync(wavPath, "r");
    try {
        const head = Buffer.alloc(512);
        fs.readSync(fd, head, 0, 512, 0);
        const pos = head.indexOf("data");
        const dataStart = pos >= 0 ? pos + 8 : 44;
        const BYTES = 16000 * 2;
        const buf = Buffer.alloc(BYTES);
        const rms = [];
        let offset = dataStart;
        for (; ;) {
            const n = fs.readSync(fd, buf, 0, BYTES, offset);
            if (n < 2) break;
            offset += n;
            const samples = n >> 1;
            let sum = 0;
            for (let i = 0; i < samples; i++) {
                const v = buf.readInt16LE(i * 2) / 32768;
                sum += v * v;
            }
            rms.push(Math.sqrt(sum / samples));
        }
        return rms;
    } finally {
        fs.closeSync(fd);
    }
}

function energyMoments(rms, duration, { minSec, maxSec }) {
    const L = Math.round((minSec + maxSec) / 2);
    const total = rms.length;
    if (total <= minSec) {
        return [{ start: 0, end: Math.min(duration || total, maxSec), title: "Best moment", reason: "Short video", score: 5 }];
    }
    const sorted = [...rms].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0.001;

    // prefix sums: awaaz ka average + "kitne second me awaaz thi" (silence wale hisse ko kam score)
    const P = new Float64Array(total + 1);
    const Q = new Float64Array(total + 1);
    for (let i = 0; i < total; i++) {
        P[i + 1] = P[i] + rms[i];
        Q[i + 1] = Q[i] + (rms[i] > median * 0.6 ? 1 : 0);
    }

    const edge = Math.floor(total * 0.03); // intro/outro skip
    const cands = [];
    for (let s = edge; s + L <= total - edge; s++) {
        const mean = (P[s + L] - P[s]) / L;
        const voiced = (Q[s + L] - Q[s]) / L;
        const jitter = 0.85 + Math.random() * 0.3; // har baar thoda alag result
        cands.push({
            start: s,
            end: Math.min(duration || total, s + L),
            title: "Best moment",
            reason: "High-energy hissa",
            score: mean * voiced * jitter * 100,
        });
    }
    return cands.sort((a, b) => b.score - a.score);
}

// ---------- chunav ----------
function choose(cands, count, history, picked = []) {
    const pool = [...cands]
        .map((c) => ({ ...c, _r: c.score * (0.9 + Math.random() * 0.2) }))
        .sort((a, b) => b._r - a._r);
    for (const c of pool) {
        if (picked.length >= count) break;
        if (picked.some((p) => overlapRatio(p, c) > 0.05)) continue;
        if (history.some((h) => overlapRatio(c, h) > 0.3)) continue;
        picked.push({ start: c.start, end: c.end, title: c.title, reason: c.reason, score: c.score });
    }
    return picked;
}

// Text AI: pehle Gemini, fail ho to Groq (Llama) — dono free
async function smartLLM(prompt) {
    const errs = [];
    if (process.env.GEMINI_API_KEY) {
        try { return await generateWithAutoModel(prompt); } catch (e) { errs.push("Gemini: " + clean(e.message)); }
    }
    if (hasGroq()) {
        try { return await groqChat(prompt.slice(0, 30000)); } catch (e) { errs.push("Groq: " + clean(e.message)); }
    }
    throw new Error(errs.join(" | ") || "Koi AI key set nahi hai (GEMINI_API_KEY / GROQ_API_KEY)");
}

// Transcript cache me save hota hai (regenerate par dobara API call nahi)
async function getTranscriptFast(dir, smallMp3) {
    const cached = path.join(dir, "transcript.json");
    if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, "utf8"));
    const t = await groqTranscribe(smallMp3);
    fs.writeFileSync(cached, JSON.stringify(t), "utf8");
    return t;
}

// Fallback chain:
//   A) Groq transcript  -> AI (Gemini/Groq) transcript padhkar best moments  (captions bhi milte hain)
//   B) Gemini audio sunkar best moments
//   C) Audio energy (loud/high-energy hisse)
async function pickMomentsFast({ dir, videoPath, audioPath, duration, videoTitle, history = [], count = cfg.CLIP_COUNT }) {
    const minSec = MIN_SEC;
    const maxSec = MAX_SEC;
    let picked = [];
    let transcript = null;
    const notes = []; // fail hone ki wajah (user ko warning me dikhegi)

    let small = null;
    try { small = await makeSmallAudio(dir, videoPath, audioPath); } catch (e) { notes.push("Audio: " + clean(e.message)); }
    if (!small) notes.push("Video bahut lambi hai AI ke liye");

    // A) transcript based
    if (small && hasGroq()) {
        try {
            transcript = await getTranscriptFast(dir, small);
            const r = await pickMoments({ transcript, videoDuration: duration, videoTitle, count, minSec, maxSec, history, llm: smartLLM });
            picked = r.moments;
        } catch (e) {
            console.warn("[Shorts] transcript pick fail:", e.message);
            notes.push(clean(e.message));
        }
    } else if (!hasGroq()) {
        notes.push("GROQ_API_KEY set nahi hai");
    }

    // B) Gemini audio
    if (picked.length < count && small && process.env.GEMINI_API_KEY) {
        try {
            const raw = await geminiMoments(small, { videoTitle, duration, minSec, maxSec, history });
            picked = choose(normalizeCandidates(raw, { duration, minSec, maxSec }), count, history, picked);
        } catch (e) {
            console.warn("[Shorts] Gemini audio pick fail:", e.message);
            notes.push("Gemini audio: " + clean(e.message));
        }
    }

    // C) energy
    let usedEnergy = false;
    if (picked.length < count && audioPath && fs.existsSync(audioPath)) {
        const cands = energyMoments(secondEnergy(audioPath), duration, { minSec, maxSec });
        picked = choose(cands, count, history, picked);
        usedEnergy = true;
    }

    if (!picked.length) throw new Error("Is video me se moments nahi mil paye. Doosri video try karo.");
    picked.sort((a, b) => a.start - b.start);
    picked.forEach((m, i) => { if (!m.title || m.title === "Best moment") m.title = `Short ${i + 1}`; });

    const warning = usedEnergy
        ? ("AI se best moments nahi mile, loud/energetic hisse chune gaye. Wajah: " + (notes.join(" | ") || "unknown")).slice(0, 400)
        : null;
    return { moments: picked, transcript, warning };
}

module.exports = { pickMomentsFast, secondEnergy, energyMoments };