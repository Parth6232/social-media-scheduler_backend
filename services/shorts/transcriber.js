// Whisper (faster-whisper, free + local) se captions/transcript. Cache me save hota hai.
const fs = require("fs");
const path = require("path");
const cfg = require("../../config/shortsConfig");
const { run } = require("./runCommand");

async function getTranscript(cacheDir, audioPath, onProgress = () => {}) {
    const cached = path.join(cacheDir, "transcript.json");
    if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, "utf8"));

    const script = path.join(__dirname, "python", "transcribe.py");
    await run(cfg.PYTHON, [script, audioPath, cached, cfg.WHISPER_MODEL], {
        onLine: (line) => {
            const m = line.match(/^PROGRESS\s+([\d.]+)/);
            if (m) onProgress(Math.min(1, Number(m[1])));
        },
    });
    if (!fs.existsSync(cached)) throw new Error("Whisper ne transcript nahi banaya");
    return JSON.parse(fs.readFileSync(cached, "utf8"));
}

module.exports = { getTranscript };
