// Gemini se "best moments" ke candidates mangta hai, phir hum khud:
//   - transcript ke sentence boundary par snap karte hain (beech vaakya me cut nahi)
//   - pehle ke generations se overlap wale (duplicate) hata dete hain
//   - bacho me se RANDOM (score ke weight ke saath) 3 chunte hain => har baar alag timestamps
const { generateWithAutoModel } = require("../../controllers/aiController");
const cfg = require("../../config/shortsConfig");

const ANGLES = [
    "funny or entertaining moments",
    "surprising or shocking reveals",
    "useful tips, how-to or actionable advice",
    "emotional or inspiring moments",
    "strong opinions or controversial takes",
    "storytelling peaks with a clear payoff",
];

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function overlapRatio(a, b) {
    const ov = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
    return ov / Math.min(a.end - a.start, b.end - b.start);
}

function snapToSentences(segments, cand, minSec, maxSec, videoDuration) {
    if (!segments.length) return null;
    let si = 0;
    segments.forEach((s, i) => {
        if (Math.abs(s.start - cand.start) < Math.abs(segments[si].start - cand.start)) si = i;
    });
    const start = segments[si].start;
    const eligible = segments.filter((s) => s.end - start >= minSec * 0.8 && s.end - start <= maxSec);
    if (!eligible.length) return null;
    let best = eligible[0];
    eligible.forEach((s) => {
        if (Math.abs(s.end - cand.end) < Math.abs(best.end - cand.end)) best = s;
    });
    return {
        ...cand,
        start: Math.max(0, start - 0.2),
        end: Math.min(videoDuration || best.end + 0.3, best.end + 0.3),
    };
}

function parseJsonArray(text) {
    const a = text.indexOf("[");
    const b = text.lastIndexOf("]");
    if (a === -1 || b === -1) throw new Error("AI ne JSON nahi diya");
    return JSON.parse(text.slice(a, b + 1));
}

function weightedPick(pool, count) {
    const picked = [];
    let rest = [...pool];
    while (picked.length < count && rest.length) {
        const weights = rest.map((c) => Math.pow(Math.max(1, Number(c.score) || 5), 2));
        let r = Math.random() * weights.reduce((x, y) => x + y, 0);
        let idx = 0;
        for (; idx < weights.length; idx++) {
            r -= weights[idx];
            if (r <= 0) break;
        }
        idx = Math.min(idx, rest.length - 1);
        const chosen = rest[idx];
        picked.push(chosen);
        rest = rest.filter((c) => overlapRatio(c, chosen) <= 0.2); // chune hue se overlap wale hata do
    }
    return picked;
}

async function pickMoments({ transcript, videoDuration, videoTitle, count = cfg.CLIP_COUNT, minSec, maxSec, history = [] }) {
    const segments = transcript.segments.filter((s) => s.text);
    if (!segments.length) throw new Error("Video me bolne wala content (speech) nahi mila");

    let text = segments.map((s) => `[${Math.floor(s.start)}] ${s.text}`).join("\n");
    if (text.length > 90000) text = text.slice(0, 90000);

    const angle = ANGLES[Math.floor(Math.random() * ANGLES.length)];
    const avoid = history.length
        ? `\nDo NOT choose moments near these already-used ranges (seconds): ${history
              .map((h) => `${Math.floor(h.start)}-${Math.floor(h.end)}`)
              .join(", ")}.`
        : "";

    const prompt = `You are an expert short-form video editor (YouTube Shorts / Reels).
Video title: "${videoTitle}"
Each transcript line is: [start_second] text

Find 10 DIFFERENT strong candidate moments to turn into vertical shorts.
This round, lean toward: ${angle}.
Rules:
- Each moment ${minSec}-${maxSec} seconds long.
- Start on a strong hook, end on a complete thought.
- Moments must not overlap each other.${avoid}
- "start" and "end" are seconds taken from the transcript.
- "score" is 1-10 (viral potential).

Reply with ONLY a JSON array, no markdown:
[{"start": 125, "end": 168, "title": "catchy title, max 60 chars", "reason": "one line why", "score": 8}]

TRANSCRIPT:
${text}`;

    const raw = await generateWithAutoModel(prompt);
    let candidates;
    try {
        candidates = parseJsonArray(raw.replace(/```json|```/g, ""));
    } catch {
        throw new Error("AI ka jawab samajh nahi aaya, dobara generate karo");
    }

    const snapped = [];
    for (const c of candidates) {
        const s = Number(c.start), e = Number(c.end);
        if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
        const sn = snapToSentences(segments, { start: s, end: e, title: c.title, reason: c.reason, score: c.score }, minSec, maxSec, videoDuration);
        if (!sn) continue;
        sn.title = String(sn.title || "Best moment").slice(0, 90);
        sn.reason = String(sn.reason || "");
        snapped.push(sn);
    }

    // Duplicate detection: pehle ke generations se overlap > 30% => hata do
    const fresh = snapped.filter((c) => !history.some((h) => overlapRatio(c, h) > 0.3));
    const picked = weightedPick(fresh, count).sort((a, b) => a.start - b.start);

    let warning = null;
    if (!picked.length) {
        throw new Error("Is video ke saare best moments pehle hi use ho chuke hain. Doosri video try karo.");
    }
    if (picked.length < count) warning = `Sirf ${picked.length} naye moments mile (baaki pehle use ho chuke the).`;

    return { moments: picked, warning };
}

module.exports = { pickMoments, overlapRatio, snapToSentences, fmt };
