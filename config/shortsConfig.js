// AI Shorts Generator ki saari settings ek jagah. Sab kuch .env se override ho sakta hai.
const path = require("path");
const isWin = process.platform === "win32";

const ROOT = path.resolve(process.env.SHORTS_WORK_DIR || path.join(__dirname, "..", "shorts_work"));

module.exports = {
    ROOT,
    CACHE_DIR: path.join(ROOT, "cache"), // download ki hui source video + transcript (regenerate fast ho)
    JOBS_DIR: path.join(ROOT, "jobs"),   // har job ka output (3 mp4 + thumbnails)

    // Tools (PATH me hone chahiye, ya .env me full path do)
    FFMPEG: process.env.FFMPEG_BIN || "ffmpeg",
    FFPROBE: process.env.FFPROBE_BIN || "ffprobe",
    YTDLP: process.env.YTDLP_BIN || "yt-dlp",
    PYTHON: process.env.PYTHON_BIN || (isWin ? "python" : "python3"),

    WHISPER_MODEL: process.env.WHISPER_MODEL || "base", // tiny / base / small / medium

    CLIP_COUNT: 3,
    DEFAULT_MIN_SEC: 20,
    DEFAULT_MAX_SEC: 60,
    HARD_MAX_SEC: 90, // Reel limit (config/postRules.js se match)

    MAX_VIDEO_MINUTES: Number(process.env.SHORTS_MAX_VIDEO_MINUTES || 60),
    CACHE_HOURS: Number(process.env.SHORTS_CACHE_HOURS || 24),
    KEEP_JOB_DAYS: Number(process.env.SHORTS_KEEP_JOB_DAYS || 7),

    OUT_W: 1080,
    OUT_H: 1920,
    CAPTION_FONT: process.env.SHORTS_FONT || "Arial", // Hindi captions ke liye "Nirmala UI" (Windows) try karo
};