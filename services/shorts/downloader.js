// yt-dlp se video download + ffmpeg se audio nikalna. Result cache me rehta hai
// (shorts_work/cache/<videoId>), isliye "dobara generate" karne par dobara download nahi hota.
const fs = require("fs");
const path = require("path");
const cfg = require("../../config/shortsConfig");
const { run, capture } = require("./runCommand");

const hms = (sec) => {
    sec = Math.round(sec);
    return `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
};

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

// Optional: residential/rotating proxy (YouTube datacenter IP block ka sabse pakka ilaaj). Render env: YTDLP_PROXY=http://user:pass@host:port
function getProxyArgs() {
    return process.env.YTDLP_PROXY ? ["--proxy", process.env.YTDLP_PROXY] : [];
}

function getCookiesArgs() {
    if (process.env.YOUTUBE_COOKIES) {
        const tmpPath = path.join(cfg.ROOT, "cookies.txt");
        try {
            fs.mkdirSync(cfg.ROOT, { recursive: true });
            fs.writeFileSync(tmpPath, process.env.YOUTUBE_COOKIES, "utf8");
            return ["--cookies", tmpPath];
        } catch (_) { }
    }
    const rootCookies = path.resolve(__dirname, "../../cookies.txt");
    if (fs.existsSync(rootCookies)) {
        return ["--cookies", rootCookies];
    }
    return [];
}

// range = { start, end } (seconds, original video ke hisaab se) ya null.
// Return me:
//   workDir      : audio.wav / transcript / small mp3 yahan banta hai (range ke hisaab se alag)
//   workDuration : jitni lambai par AI kaam karega (range ho to range ki lambai)
//   renderOffset : picker ke time + renderOffset = source FILE ka time (ffmpeg seek ke liye)
//   absOffset    : picker ke time + absOffset    = ORIGINAL video ka time (user ko dikhane ke liye)
async function prepareSource(videoId, onProgress = () => { }, range = null) {
    const isUpload = String(videoId).startsWith("up_");
    const tag = range ? `r${range.start}_${range.end}` : null;
    // Link + range: sirf wahi hissa download hota hai => alag cache folder. Upload: poori file ek hi folder me.
    const dir = path.join(cfg.CACHE_DIR, !isUpload && tag ? `${videoId}_${tag}` : videoId);
    fs.mkdirSync(dir, { recursive: true });

    let videoPath = findSource(dir);
    if (!videoPath && isUpload) {
        throw new Error("Uploaded video server se hat chuki hai (cache expire / server restart). Kripya video dobara upload karo.");
    }
    if (!videoPath) {
        const cookiesArgs = getCookiesArgs();
        // Range ho to sirf utna hissa download (lambi video poori download nahi hoti => tez + disk bachti hai)
        const sectionArgs = range ? ["--download-sections", `*${hms(range.start)}-${hms(range.end)}`] : [];
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
                    ...getProxyArgs(),
                    ...sectionArgs,
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

        // Fallback chain (sabse kam block hone wale clients pehle). Cookies hon to web/mweb bhi chalte hain.
        const strategies = process.env.YOUTUBE_COOKIES || fs.existsSync(path.resolve(__dirname, "../../cookies.txt"))
            ? ["web,mweb", "tv", "web_embedded", "mweb,android"]
            : ["tv", "android_vr", "web_embedded", "mweb,android"];

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

    const meta = await probe(videoPath);

    // File poori video hai ya sirf wahi hissa? (upload hamesha poori; link+range me download-sections ne kaata hota hai)
    let renderOffset = 0;
    let absOffset = 0;
    let workDuration = meta.duration;
    let windowed = false; // audio ko file me se kaatna padega?
    if (range) {
        const len = range.end - range.start;
        absOffset = range.start;
        if (isUpload || meta.duration > len + 30) {
            // poori file hai (ya yt-dlp ne section nahi kaata) => file me range.start par seek karenge
            windowed = true;
            renderOffset = range.start;
            workDuration = Math.max(1, Math.min(range.end, meta.duration) - range.start);
        } else {
            workDuration = meta.duration; // file khud wo hissa hai
        }
    }

    const workDir = windowed ? path.join(dir, tag) : dir;
    fs.mkdirSync(workDir, { recursive: true });

    const audioPath = path.join(workDir, "audio.wav");
    if (!fs.existsSync(audioPath)) {
        const args = ["-y", "-hide_banner", "-loglevel", "error"];
        if (windowed) args.push("-ss", String(range.start), "-t", String(workDuration));
        args.push("-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", audioPath);
        await run(cfg.FFMPEG, args);
    }

    const now = new Date();
    fs.utimesSync(dir, now, now); // cache cleanup ko "recently used" dikhe
    return { dir, workDir, videoPath, audioPath, meta, workDuration, renderOffset, absOffset };
}

module.exports = { prepareSource, probe };