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

function getCookiesArgs() {
    if (process.env.YOUTUBE_COOKIES) {
        const tmpPath = path.join(cfg.ROOT, "cookies.txt");
        try {
            fs.mkdirSync(cfg.ROOT, { recursive: true });
            fs.writeFileSync(tmpPath, process.env.YOUTUBE_COOKIES, "utf8");
            return ["--cookies", tmpPath];
        } catch (_) {}
    }
    const rootCookies = path.resolve(__dirname, "../../cookies.txt");
    if (fs.existsSync(rootCookies)) {
        return ["--cookies", rootCookies];
    }
    return [];
}

async function prepareSource(videoId, onProgress = () => {}) {
    const dir = path.join(cfg.CACHE_DIR, videoId);
    fs.mkdirSync(dir, { recursive: true });

    let videoPath = findSource(dir);
    if (!videoPath) {
        const cookiesArgs = getCookiesArgs();
        const runYtdlp = (playerClients) =>
            run(
                cfg.YTDLP,
                [
                    "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
                    "--merge-output-format", "mp4",
                    "--no-playlist", "--no-warnings", "--newline",
                    "--no-check-certificates",
                    "--js-runtimes", "node",
                    "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "--extractor-args", `youtube:player_client=${playerClients}`,
                    ...cookiesArgs,
                    "-P", dir,
                    "-o", "source.%(ext)s",
                    `https://www.youtube.com/watch?v=${videoId}`,
                ],
                {
                    onLine: (line) => {
                        const m = line.match(/\[download\]\s+([\d.]+)%/);
                        if (m) onProgress(Math.min(1, Number(m[1]) / 100));
                    },
                }
            );

        // Fallback chain: web_embedded (most reliable, no sign-in needed)
        // -> web (needs cookies on datacenter IPs)
        // -> mweb,android (last resort)
        const strategies = [
            "web_embedded",          // best for unauthenticated / server IPs
            "web_embedded,android",  // adds android as fallback format
            "mweb,android",          // last resort
        ];

        let lastErr;
        for (const clients of strategies) {
            try {
                await runYtdlp(clients);
                videoPath = findSource(dir);
                if (videoPath) break;  // success
            } catch (err) {
                lastErr = err;
                // Continue to next strategy
            }
        }

        if (!videoPath) {
            const msg = lastErr?.message || "Unknown error";
            throw new Error(`Video download nahi ho payi. Try karo: (1) cookies.txt add karo, ya (2) video directly upload karo. Detail: ${msg}`);
        }
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
