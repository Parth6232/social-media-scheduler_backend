// YouTube video ki metadata fetch karne ka service.
// YouTube Data API key ki zaroorat nahi — yt-dlp se JSON dump karta hai.
// getVideoInfo(userId, url) => { videoId, title, channelTitle, channelId, thumbnail, durationSec, authorizedBy }
const path = require("path");
const fs   = require("fs");
const cfg  = require("../../config/shortsConfig");
const { capture } = require("./runCommand");

// Supported URL formats se videoId nikalo
function extractVideoId(url) {
    if (!url) return null;
    const str = String(url).trim();

    // Plain 11-char ID
    if (/^[A-Za-z0-9_-]{11}$/.test(str)) return str;

    try {
        const u = new URL(str);
        // youtu.be/<id>
        if (u.hostname === "youtu.be") return u.pathname.slice(1).split(/[?&#]/)[0] || null;
        // youtube.com/shorts/<id>  |  /embed/<id>  |  /v/<id>
        const pathMatch = u.pathname.match(/\/(?:shorts|embed|v)\/([A-Za-z0-9_-]{11})/);
        if (pathMatch) return pathMatch[1];
        // youtube.com/watch?v=<id>
        return u.searchParams.get("v") || null;
    } catch (_) {
        // Not a valid URL — try regex
        const m = str.match(/(?:v=|\/(?:shorts|embed|v)\/)([A-Za-z0-9_-]{11})/);
        return m ? m[1] : null;
    }
}

// ISO 8601 duration (PT1H2M3S) ko seconds me badlo
function parseDuration(iso) {
    if (!iso) return 0;
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
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
    if (fs.existsSync(rootCookies)) return ["--cookies", rootCookies];
    return [];
}

function getProxyArgs() {
    return process.env.YTDLP_PROXY ? ["--proxy", process.env.YTDLP_PROXY] : [];
}

/**
 * YouTube video ki info fetch karo (yt-dlp --dump-json).
 * @param {string} userId  - logged-in user (future auth checks ke liye)
 * @param {string} url     - YouTube URL ya video ID
 * @returns {Promise<{ videoId, title, channelTitle, channelId, thumbnail, durationSec, authorizedBy }>}
 */
async function getVideoInfo(userId, url) {
    const videoId = extractVideoId(url);
    if (!videoId) {
        const e = new Error("Galat YouTube link diya hai. youtube.com/watch?v=... ya youtu.be/... chahiye.");
        e.status = 400;
        throw e;
    }

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // yt-dlp se JSON metadata lo (download bilkul nahi hoga)
    const args = [
        "--dump-json",
        "--no-playlist",
        "--no-warnings",
        "--skip-download",
        "--no-check-certificates",
        "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "--extractor-args", "youtube:player_client=tv",
        ...getCookiesArgs(),
        ...getProxyArgs(),
        watchUrl,
    ];

    let raw;
    try {
        raw = await capture(cfg.YTDLP, args);
    } catch (err) {
        const e = new Error(`Video ki info fetch nahi ho payi. YouTube link check karo ya baad me try karo. (${err.message})`);
        e.status = 502;
        throw e;
    }

    let info;
    try {
        // yt-dlp kabhi kabhi multiple JSON lines deta hai (playlist); pehla lo
        const firstLine = raw.trim().split(/\r?\n/)[0];
        info = JSON.parse(firstLine);
    } catch (_) {
        const e = new Error("Video metadata parse nahi ho payi.");
        e.status = 502;
        throw e;
    }

    // Duration check
    const durationSec = Number(info.duration) || parseDuration(info.duration_string);
    const maxSec = cfg.MAX_VIDEO_MINUTES * 60;
    if (durationSec > maxSec) {
        const e = new Error(
            `Video ${Math.round(durationSec / 60)} minute ki hai (limit ${cfg.MAX_VIDEO_MINUTES} min). ` +
            `Itni lambi video se seedha shorts nahi ban sakte — please ${cfg.MAX_RANGE_MINUTES} min tak ka timestamp range chuno.`
        );
        e.status = 422;
        e.shortsCode = "VIDEO_TOO_LONG";
        e.data = { durationSec, maxMinutes: cfg.MAX_VIDEO_MINUTES, maxRangeMinutes: cfg.MAX_RANGE_MINUTES };
        throw e;
    }

    // Best thumbnail nikalo
    const thumbnails = Array.isArray(info.thumbnails) ? info.thumbnails : [];
    const thumb =
        thumbnails.find((t) => t.id === "maxresdefault")?.url ||
        thumbnails.find((t) => t.width && t.width >= 1280)?.url ||
        thumbnails.find((t) => t.width && t.width >= 640)?.url ||
        thumbnails.slice(-1)[0]?.url ||
        info.thumbnail ||
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    return {
        videoId,
        title: info.title || "Untitled",
        channelTitle: info.uploader || info.channel || info.uploader_id || "Unknown Channel",
        channelId: info.channel_id || info.uploader_id || "unknown",
        thumbnail: thumb,
        durationSec: Math.round(durationSec),
        // "any_video" — koi bhi video se shorts ban sakti hai (authorization check hata diya)
        authorizedBy: "any_video",
    };
}

module.exports = { getVideoInfo, extractVideoId };
