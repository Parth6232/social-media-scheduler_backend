// Whisper (OpenAI) ya local Whisper model se audio transcript banana.
// Agar OPENAI_API_KEY set hai to OpenAI Whisper API use hota hai;
// warna local `whisper` CLI (Python openai-whisper package) use hoti hai.
const fs   = require("fs");
const path = require("path");
const cfg  = require("../../config/shortsConfig");
const { run, capture } = require("./runCommand");

/**
 * Audio file se transcript nikalo.
 * @param {string} workDir   - directory jahan transcript cache hoga
 * @param {string} audioPath - WAV file path
 * @param {(progress: number) => void} onProgress
 * @returns {Promise<{ segments: Array<{ start, end, text }> }>}
 */
async function getTranscript(workDir, audioPath, onProgress = () => {}) {
    const cacheFile = path.join(workDir, "transcript.json");

    // Cache check
    if (fs.existsSync(cacheFile)) {
        try {
            return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
        } catch (_) {}
    }

    onProgress(0);

    let segments;

    if (process.env.OPENAI_API_KEY) {
        // OpenAI Whisper API (tez + accurate)
        segments = await transcribeWithOpenAI(audioPath, onProgress);
    } else {
        // Local Whisper CLI (openai-whisper Python package)
        segments = await transcribeWithLocalWhisper(workDir, audioPath, onProgress);
    }

    const result = { segments };
    fs.writeFileSync(cacheFile, JSON.stringify(result), "utf8");
    onProgress(1);
    return result;
}

async function transcribeWithOpenAI(audioPath, onProgress) {
    const FormData = (() => {
        try { return require("form-data"); } catch (_) { return null; }
    })();
    const axios = require("axios");

    if (!FormData) {
        throw new Error("form-data package nahi mila. npm install form-data karo.");
    }

    onProgress(0.1);
    const form = new FormData();
    form.append("file", fs.createReadStream(audioPath), path.basename(audioPath));
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");

    const res = await axios.post("https://api.openai.com/v1/audio/transcriptions", form, {
        headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            ...form.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 300_000,
    });

    onProgress(0.9);
    return (res.data.segments || []).map((s) => ({
        start: Number(s.start) || 0,
        end:   Number(s.end)   || 0,
        text:  String(s.text  || "").trim(),
    }));
}

async function transcribeWithLocalWhisper(workDir, audioPath, onProgress) {
    onProgress(0.05);

    const outDir   = workDir;
    const model    = cfg.WHISPER_MODEL || "base";
    const jsonFile = path.join(outDir, path.basename(audioPath, path.extname(audioPath)) + ".json");

    // whisper <audio> --model base --output_dir <dir> --output_format json --language auto
    await run(cfg.PYTHON, [
        "-m", "whisper",
        audioPath,
        "--model", model,
        "--output_dir", outDir,
        "--output_format", "json",
        "--language", "auto",
        "--fp16", "False",
    ], {
        onLine: (line) => {
            if (line.includes("-->")) onProgress(0.5); // mid-progress estimate
        },
    });

    onProgress(0.9);

    if (!fs.existsSync(jsonFile)) {
        throw new Error("Local Whisper output file nahi mili. Whisper installed hai? (pip install openai-whisper)");
    }

    const data = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
    return (data.segments || []).map((s) => ({
        start: Number(s.start) || 0,
        end:   Number(s.end)   || 0,
        text:  String(s.text  || "").trim(),
    }));
}

module.exports = { getTranscript };
