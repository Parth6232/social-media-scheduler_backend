// yt-dlp se video download + ffmpeg se audio nikalna. Result cache me rehta hai
// (shorts_work/cache/<videoId>), isliye "dobara generate" karne par dobara download nahi hota.
const fs = require("fs");
const path = require("path");
const cfg = require("../../config/shortsConfig");
const { run, capture } = require("./runCommand");

async function probe(file) {
    const out = await capture(cfg.FFPROBE, [
        "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
    ]);
    const j = JSON.parse(out);
    const v = (j.streams || []).find((s) => s.codec_type === "video");
    const a = (j.streams || []).find((s) => s.codec_type === "audio");
    if (!v) throw new Error("Download hui file me video stream nahi mili");
    return {
        width: v.width,
        height: v.height,
        duration: Number((j.format && j.format.duration) || v.duration || 0),
        hasAudio: !!a,
    };
}

function findSource(dir) {
    const f = fs.readdirSync(dir).find((n) => /^source\.(?!.*part)/.test(n) && !n.endsWith(".ytdl"));
    return f ? path.join(dir, f) : null;
}

async function prepareSource(videoId, onProgress = () => {}) {
    const dir = path.join(cfg.CACHE_DIR, videoId);
    fs.mkdirSync(dir, { recursive: true });

    let videoPath = findSource(dir);
    if (!videoPath) {
        await run(
            cfg.YTDLP,
            [
                "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
                "--merge-output-format", "mp4",
                "--no-playlist", "--no-warnings", "--newline",
                "-P", dir,
                "-o", "source.%(ext)s",
                `https://www.youtube.com/watch?v=${videoId}`, // videoId regex se validated hai
            ],
            {
                onLine: (line) => {
                    const m = line.match(/\[download\]\s+([\d.]+)%/);
                    if (m) onProgress(Math.min(1, Number(m[1]) / 100));
                },
            }
        );
        videoPath = findSource(dir);
        if (!videoPath) throw new Error("Video download nahi ho payi (yt-dlp ne file nahi banayi)");
    }

    const audioPath = path.join(dir, "audio.wav");
    if (!fs.existsSync(audioPath)) {
        await run(cfg.FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", audioPath]);
    }

    const meta = await probe(videoPath);
    const now = new Date();
    fs.utimesSync(dir, now, now); // cache cleanup ko "recently used" dikhe
    return { dir, videoPath, audioPath, meta };
}

module.exports = { prepareSource, probe };
