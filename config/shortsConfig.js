// AI Shorts Generator ki saari settings ek jagah. Sab kuch .env se override ho sakta hai.
const path = require("path");
const fs = require("fs");
const isWin = process.platform === "win32";

const ROOT = path.resolve(process.env.SHORTS_WORK_DIR || path.join(__dirname, "..", "shorts_work"));
const LOCAL_BIN = path.join(__dirname, "..", "bin");

function resolveBin(envVar, defaultName) {
    if (process.env[envVar]) return process.env[envVar];

    // Check project bin directory (Render ya custom setup ke liye)
    const localTarget = path.join(LOCAL_BIN, isWin ? `${defaultName}.exe` : defaultName);
    if (fs.existsSync(localTarget)) return localTarget;

    if (isWin) {
        try {
            const { execSync } = require("child_process");
            const out = execSync(`where.exe ${defaultName}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
            const first = out.trim().split(/\r?\n/)[0];
            if (first) return first.trim();
        } catch (_) { }
    } else {
        try {
            const { execSync } = require("child_process");
            const out = execSync(`which ${defaultName}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
            const first = out.trim().split(/\r?\n/)[0];
            if (first) return first.trim();
        } catch (_) { }
    }
    return defaultName;
}

module.exports = {
    ROOT,
    CACHE_DIR: path.join(ROOT, "cache"), // download ki hui source video + transcript (regenerate fast ho)
    JOBS_DIR: path.join(ROOT, "jobs"),   // har job ka output (3 mp4 + thumbnails)

    // Tools (PATH me hone chahiye, ya .env me full path do, auto-resolved on Windows)
    FFMPEG: resolveBin("FFMPEG_BIN", "ffmpeg"),
    FFPROBE: resolveBin("FFPROBE_BIN", "ffprobe"),
    YTDLP: resolveBin("YTDLP_BIN", "yt-dlp"),
    PYTHON: resolveBin("PYTHON_BIN", isWin ? "python" : "python3"),

    WHISPER_MODEL: process.env.WHISPER_MODEL || "base", // tiny / base / small / medium

    CLIP_COUNT: 3,
    DEFAULT_MIN_SEC: 20,
    DEFAULT_MAX_SEC: 60,
    HARD_MAX_SEC: 90, // Reel limit (config/postRules.js se match)

    MAX_VIDEO_MINUTES: Number(process.env.SHORTS_MAX_VIDEO_MINUTES || 60),
    CACHE_HOURS: Number(process.env.SHORTS_CACHE_HOURS || 24),
    KEEP_JOB_DAYS: Number(process.env.SHORTS_KEEP_JOB_DAYS || 7),

    OUT_W: 720, OUT_H: 1280,
    OUT_H: 1920,
    CAPTION_FONT: process.env.SHORTS_FONT || "Arial", // Hindi captions ke liye "Nirmala UI" (Windows) try karo
};