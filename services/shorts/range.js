// Timestamp range (video ka sirf ek hissa) ke helpers.
// Rules:
//   - Video <= MAX_VIDEO_MINUTES (60)  => range optional (user chaahe to hissa chun sakta hai)
//   - Video  > MAX_VIDEO_MINUTES       => range ZAROORI
//   - Range ki lambai: kam se kam 2 min, zyada se zyada MAX_RANGE_MINUTES (30)
const cfg = require("../../config/shortsConfig");

const MIN_RANGE_SEC = 120;

// "90", "1:30", "01:30", "1:02:03" ya number => seconds (galat/khaali => null)
function parseTime(v) {
    if (v === undefined || v === null || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
    const s = String(v).trim();
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
    const parts = s.split(":");
    if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
    return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function rangeError(message, code, data) {
    const e = new Error(message);
    e.status = 422;
    e.shortsCode = code;
    e.data = data;
    return e;
}

// input: { rangeStart, rangeEnd } (seconds ya "mm:ss"). Return: null (poori video) ya { start, end } (seconds)
function resolveRange(input, durationSec, limits = {}) {
    const maxVideoSec = (limits.maxVideoMinutes ?? cfg.MAX_VIDEO_MINUTES) * 60;
    const maxRangeSec = (limits.maxRangeMinutes ?? cfg.MAX_RANGE_MINUTES) * 60;
    const duration = Number(durationSec) || 0;

    const s = parseTime(input && input.rangeStart);
    const e = parseTime(input && input.rangeEnd);
    const data = { durationSec: Math.round(duration), maxMinutes: maxVideoSec / 60, maxRangeMinutes: maxRangeSec / 60 };

    if (s === null && e === null) {
        if (duration > maxVideoSec) {
            throw rangeError(
                `Video ${fmtTime(duration)} ki hai (limit ${maxVideoSec / 60} min). Itni lambi video se seedha shorts nahi ban sakte — ` +
                    `please ${maxRangeSec / 60} min tak ka timestamp range chuno (jaise 10:00 se 30:00) aur dobara Generate karo.`,
                "VIDEO_TOO_LONG",
                data
            );
        }
        return null;
    }

    const start = s === null ? 0 : s;
    let end = e === null ? start + maxRangeSec : e;
    if (duration > 0) end = Math.min(end, duration);

    if (duration > 0 && start >= duration - 1) {
        throw rangeError(`Start time (${fmtTime(start)}) video ki lambai (${fmtTime(duration)}) se bahar hai.`, "RANGE_INVALID", data);
    }
    if (end <= start) {
        throw rangeError("End time start time se bada hona chahiye.", "RANGE_INVALID", data);
    }
    if (end - start < MIN_RANGE_SEC) {
        throw rangeError(`Range kam se kam 2 minute ka rakho (3 shorts ke liye jagah chahiye). Abhi ${fmtTime(end - start)} hai.`, "RANGE_TOO_SHORT", data);
    }
    if (end - start > maxRangeSec + 1) {
        throw rangeError(`Range max ${maxRangeSec / 60} minute ka ho sakta hai. Aapne ${fmtTime(end - start)} chuna hai.`, "RANGE_TOO_LONG", data);
    }
    return { start: Math.floor(start), end: Math.ceil(end) };
}

module.exports = { parseTime, fmtTime, resolveRange, MIN_RANGE_SEC };
