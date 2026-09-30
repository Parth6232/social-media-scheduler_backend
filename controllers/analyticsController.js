const {
    RANGES,
    getAnalytics,
    refreshRecentStats,
    getExportCsv,
} = require("../services/analyticsService");

const ALLOWED_PLATFORMS = ["youtube", "facebook", "instagram"];

// ?range=7d|30d|90d|all (default 30d)  &  ?platform=youtube|facebook|instagram (optional)
function readFilters(req) {
    const range = req.query.range || "30d";
    const platform = req.query.platform || null;
    if (!Object.prototype.hasOwnProperty.call(RANGES, range)) return { error: "range galat hai (7d/30d/90d/all)" };
    if (platform && !ALLOWED_PLATFORMS.includes(platform)) {
        return { error: "platform galat hai (youtube/facebook/instagram)" };
    }
    return { range, platform };
}

// GET /api/analytics  -> poore Analytics page ka data ek hi call mein
exports.getAnalyticsOverview = async (req, res) => {
    try {
        const f = readFilters(req);
        if (f.error) return res.status(400).json({ message: f.error });
        const data = await getAnalytics(req.userId, { range: f.range, platform: f.platform });
        res.json(data);
    } catch (error) {
        console.error("Analytics failed:", error.message);
        res.status(500).json({ message: "Analytics load nahi ho paya. Please try again." });
    }
};

// POST /api/analytics/refresh -> recent posts ke views/likes abhi refresh karo
// Spam se bachne ke liye har user ke liye 2 minute ka cooldown (server memory mein).
const REFRESH_COOLDOWN_MS = 2 * 60 * 1000;
const lastRefreshAt = new Map(); // userId -> timestamp

exports.refreshAnalyticsStats = async (req, res) => {
    try {
        const last = lastRefreshAt.get(String(req.userId)) || 0;
        const wait = REFRESH_COOLDOWN_MS - (Date.now() - last);
        if (wait > 0) {
            return res.status(429).json({
                message: "Stats abhi hi refresh hue hain. Thodi der baad try karein.",
                retryAfterSec: Math.ceil(wait / 1000),
            });
        }
        lastRefreshAt.set(String(req.userId), Date.now());
        const result = await refreshRecentStats(req.userId);
        res.json({ message: "Stats refresh ho gaye", ...result });
    } catch (error) {
        console.error("Analytics refresh failed:", error.message);
        res.status(500).json({ message: "Stats refresh nahi ho paye. Please try again." });
    }
};

// GET /api/analytics/export -> CSV file download
exports.exportAnalyticsCsv = async (req, res) => {
    try {
        const f = readFilters(req);
        if (f.error) return res.status(400).json({ message: f.error });
        const csv = await getExportCsv(req.userId, { range: f.range, platform: f.platform });
        const day = new Date().toISOString().slice(0, 10);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="analytics-${f.range}-${day}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error("Analytics export failed:", error.message);
        res.status(500).json({ message: "Export nahi ho paya. Please try again." });
    }
};