// Usage (backend folder se):  node scripts/checkAI.js
// Batata hai Gemini / Groq / ffmpeg / yt-dlp me se kya chal raha hai aur kya nahi (exact error ke saath).
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const cfg = require("../config/shortsConfig");
const { generateWithAutoModel } = require("../controllers/aiController");
const { hasGroq, groqTranscribe, groqChat, clean } = require("../services/shorts/groq");

const ok = (m) => console.log("  ✅", m);
const bad = (m) => console.log("  ❌", m);

async function step(title, fn) {
    console.log("\n" + title);
    try { ok(await fn()); } catch (e) { bad(clean(e.message || e)); }
}

(async () => {
    console.log("Tools");
    for (const [name, bin, arg] of [["ffmpeg", cfg.FFMPEG, "-version"], ["yt-dlp", cfg.YTDLP, "--version"]]) {
        try {
            const out = execFileSync(bin, [arg], { encoding: "utf8" }).split("\n")[0];
            ok(`${name}: ${out}`);
        } catch { bad(`${name} nahi mila (${bin}) — PATH me daalo ya .env me ${name === "ffmpeg" ? "FFMPEG_BIN" : "YTDLP_BIN"} do`); }
    }

    // 3 sec ki test awaaz (mp3)
    const mp3 = path.join(os.tmpdir(), "shorts_check.mp3");
    try {
        execFileSync(cfg.FFMPEG, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-ac", "1", "-b:a", "24k", mp3]);
    } catch { /* ffmpeg nahi to audio tests skip honge */ }

    console.log("\nKeys");
    process.env.GEMINI_API_KEY ? ok("GEMINI_API_KEY set hai") : bad("GEMINI_API_KEY set nahi hai");
    hasGroq() ? ok("GROQ_API_KEY set hai") : bad("GROQ_API_KEY set nahi hai (https://console.groq.com/keys, free)");

    if (process.env.GEMINI_API_KEY) {
        await step("Gemini text", async () => "jawab: " + clean(await generateWithAutoModel("Reply with only the word OK")));
        if (fs.existsSync(mp3)) {
            await step("Gemini audio (yehi fast-mode me fail ho raha tha)", async () => {
                const data = fs.readFileSync(mp3).toString("base64");
                const r = await generateWithAutoModel([
                    { inlineData: { mimeType: "audio/mp3", data } },
                    { text: "Describe this audio in 5 words." },
                ]);
                return "jawab: " + clean(r);
            });
        }
    }

    if (hasGroq()) {
        await step("Groq chat (Llama)", async () => "jawab: " + clean(await groqChat("Reply with only the word OK")));
        if (fs.existsSync(mp3)) {
            await step("Groq transcribe (Whisper)", async () => {
                const t = await groqTranscribe(mp3).catch((e) => {
                    // sine wave me speech nahi hoti, 'no timestamps' error normal hai — matlab API chal rahi hai
                    if (/timestamps nahi/.test(e.message)) return { segments: [], note: "API chal rahi hai (test audio me speech nahi thi)" };
                    throw e;
                });
                return t.note || `${t.segments.length} segments mile`;
            });
        }
    }
    console.log("\nDone.");
})();
