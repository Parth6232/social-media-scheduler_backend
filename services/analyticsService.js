const mongoose = require("mongoose");
const Post = require("../models/Post");
const { refreshStatsForPost } = require("./statsService");
const { getBestTimes } = require("./bestTimeService");

// Sab date/time India (IST) ke hisaab se
const TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Score = views + likes * 10 (bestTimeService jaisa hi)
const LIKE_WEIGHT = 10;
const MIN_POSTS_FOR_SLOT_INSIGHT = 5;

const RANGES = { "7d": 7, "30d": 30, "90d": 90, all: null };
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ─────────────────────────────────────────────────────────────────────────
// Chhote helpers
// ─────────────────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
const round1 = (n) => Math.round(n * 10) / 10;
const score = (views, likes) => (views || 0) + (likes || 0) * LIKE_WEIGHT;

function istParts(date) {
    const d = new Date(date.getTime() + IST_OFFSET_MS);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hour: d.getUTCHours(), min: d.getUTCMinutes(), dow: d.getUTCDay() };
}
const istDateKey = (date) => {
    const p = istParts(date);
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
};
const istMonthKey = (date) => {
    const p = istParts(date);
    return `${p.y}-${pad(p.m)}`;
};
// Us din ki IST raat 12:00 (asli UTC Date mein)
function istMidnightUtc(date) {
    const p = istParts(date);
    return new Date(Date.UTC(p.y, p.m - 1, p.d) - IST_OFFSET_MS);
}

// range ("7d"/"30d"/"90d"/"all") se time window nikalta hai
function getWindow(range, now = new Date()) {
    const days = RANGES[range];
    if (!days) return { days: null, from: null, prevFrom: null };
    const from = new Date(istMidnightUtc(now).getTime() - (days - 1) * DAY_MS);
    const prevFrom = new Date(from.getTime() - days * DAY_MS);
    return { days, from, prevFrom };
}

// ─────────────────────────────────────────────────────────────────────────
// Posts -> "rows". Ek row = ek post ka ek platform-target.
// ─────────────────────────────────────────────────────────────────────────
function flattenPosts(posts, platform) {
    const rows = [];
    for (const post of posts) {
        for (const t of post.targets || []) {
            if (platform && t.platform !== platform) continue;
            rows.push({
                postId: String(post._id),
                content: post.content || "",
                postType: post.postType || "feed",
                postStatus: post.status,
                scheduledAt: new Date(post.scheduledAt),
                platform: t.platform,
                status: t.status,
                views: t.views ?? null,
                likes: t.likes ?? null,
                error: t.error || null,
                publishedUrl: t.publishedUrl || null,
                platformStatus: t.platformStatus || "unknown",
                statsUpdatedAt: t.statsUpdatedAt || null,
            });
        }
    }
    return rows;
}

const hasStats = (r) => r.views !== null || r.likes !== null;

// Rows ka summary (KPI cards aur breakdown dono isi se bante hain)
function summarize(rows) {
    const postIds = new Set();
    const s = {
        posts: 0, targets: rows.length, published: 0, failed: 0, pending: 0,
        successRate: null, views: 0, likes: 0, targetsWithStats: 0, avgViews: 0, avgLikes: 0,
    };
    for (const r of rows) {
        postIds.add(r.postId);
        if (r.status === "published") s.published++;
        else if (r.status === "failed") s.failed++;
        else s.pending++;
        if (r.status === "published" && hasStats(r)) {
            s.views += r.views || 0;
            s.likes += r.likes || 0;
            s.targetsWithStats++;
        }
    }
    s.posts = postIds.size;
    const finished = s.published + s.failed;
    s.successRate = finished > 0 ? round1((s.published / finished) * 100) : null; // pending ko ginti mein nahi
    s.avgViews = s.targetsWithStats ? Math.round(s.views / s.targetsWithStats) : 0;
    s.avgLikes = s.targetsWithStats ? Math.round(s.likes / s.targetsWithStats) : 0;
    return s;
}

function changePct(current, previous) {
    if (!previous) return null; // pehle kuch tha hi nahi -> % banta nahi (frontend "new" dikha sakta hai)
    return Math.round(((current - previous) / previous) * 100);
}

// Group by key -> { key, ...summarize }
function groupSummary(rows, keyFn, keyName) {
    const map = new Map();
    for (const r of rows) {
        const k = keyFn(r);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(r);
    }
    return [...map.entries()]
        .map(([k, list]) => {
            const s = summarize(list);
            const removed = list.filter((r) => r.status === "published" && r.platformStatus === "removed").length;
            return { [keyName]: k, ...s, removed };
        })
        .sort((a, b) => b.targets - a.targets);
}

// Timeline (daily ya monthly buckets, khali din bhi zero ke saath taaki chart toote nahi)
function buildTimeline(rows, range, win, now) {
    const buckets = new Map();
    const blank = () => ({ targets: 0, published: 0, failed: 0, views: 0, likes: 0 });
    let granularity = "day";

    if (win.days) {
        for (let i = 0; i < win.days; i++) {
            const key = istDateKey(new Date(win.from.getTime() + i * DAY_MS));
            buckets.set(key, blank());
        }
    } else {
        granularity = "month";
        if (!rows.length) return { granularity, points: [] };
        const times = rows.map((r) => r.scheduledAt.getTime());
        const p1 = istParts(new Date(Math.min(...times)));
        const p2 = istParts(new Date(Math.max(...times, now.getTime())));
        let y = p1.y, m = p1.m;
        while (y < p2.y || (y === p2.y && m <= p2.m)) {
            buckets.set(`${y}-${pad(m)}`, blank());
            m++;
            if (m > 12) { m = 1; y++; }
        }
    }

    for (const r of rows) {
        const key = granularity === "day" ? istDateKey(r.scheduledAt) : istMonthKey(r.scheduledAt);
        const b = buckets.get(key);
        if (!b) continue;
        b.targets++;
        if (r.status === "published") {
            b.published++;
            if (hasStats(r)) { b.views += r.views || 0; b.likes += r.likes || 0; }
        } else if (r.status === "failed") b.failed++;
    }
    return { granularity, points: [...buckets.entries()].map(([date, v]) => ({ date, ...v })) };
}

// Heatmap: din x ghanta (sirf published + stats wale)
function buildHeatmap(rows) {
    const used = rows.filter((r) => r.status === "published" && hasStats(r));
    const cellMap = new Map();
    const hourMap = Array.from({ length: 24 }, () => ({ n: 0, v: 0, l: 0, s: 0 }));
    const dayMap = Array.from({ length: 7 }, () => ({ n: 0, v: 0, l: 0, s: 0 }));

    for (const r of used) {
        const p = istParts(r.scheduledAt);
        const v = r.views || 0, l = r.likes || 0, sc = score(v, l);
        const key = `${p.dow}-${p.hour}`;
        if (!cellMap.has(key)) cellMap.set(key, { dayOfWeek: p.dow, hour: p.hour, n: 0, v: 0, l: 0, s: 0 });
        for (const a of [cellMap.get(key), hourMap[p.hour], dayMap[p.dow]]) { a.n++; a.v += v; a.l += l; a.s += sc; }
    }

    const avg = (a) => ({
        posts: a.n,
        avgViews: a.n ? Math.round(a.v / a.n) : 0,
        avgLikes: a.n ? Math.round(a.l / a.n) : 0,
        avgScore: a.n ? Math.round(a.s / a.n) : 0,
    });

    const cells = [...cellMap.values()]
        .map((c) => ({ dayOfWeek: c.dayOfWeek, dayName: DAY_NAMES[c.dayOfWeek], hour: c.hour, ...avg(c) }))
        .sort((a, b) => b.avgScore - a.avgScore);

    return {
        totalPosts: used.length,
        maxScore: cells.length ? cells[0].avgScore : 0,
        cells, // sirf wahi (din, ghanta) jaha data hai; baaki frontend khali dikhayega
        byHour: hourMap.map((a, hour) => ({ hour, ...avg(a) })),
        byDay: dayMap.map((a, dayOfWeek) => ({ dayOfWeek, dayName: DAY_NAMES[dayOfWeek], ...avg(a) })),
    };
}

function buildTopPosts(rows, limit = 5) {
    return rows
        .filter((r) => r.status === "published" && hasStats(r))
        .map((r) => ({ ...r, score: score(r.views, r.likes) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((r) => ({
            postId: r.postId,
            platform: r.platform,
            postType: r.postType,
            content: r.content.slice(0, 100),
            publishedUrl: r.publishedUrl,
            scheduledAt: r.scheduledAt,
            views: r.views || 0,
            likes: r.likes || 0,
            score: r.score,
        }));
}

// Failure reasons: milte-julte errors ek saath (lambe numbers/ids ko '#' bana ke)
function buildFailures(rows) {
    const failed = rows.filter((r) => r.status === "failed");
    const byPlatformMap = new Map();
    const reasonMap = new Map();
    for (const r of failed) {
        byPlatformMap.set(r.platform, (byPlatformMap.get(r.platform) || 0) + 1);
        const reason = (r.error || "Unknown error").replace(/\d{6,}/g, "#").trim().slice(0, 120);
        if (!reasonMap.has(reason)) reasonMap.set(reason, { reason, count: 0, platforms: new Set() });
        const e = reasonMap.get(reason);
        e.count++;
        e.platforms.add(r.platform);
    }
    return {
        total: failed.length,
        byPlatform: [...byPlatformMap.entries()].map(([platform, count]) => ({ platform, count })).sort((a, b) => b.count - a.count),
        reasons: [...reasonMap.values()]
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
            .map((e) => ({ reason: e.reason, count: e.count, platforms: [...e.platforms] })),
    };
}

// Auto insights -- text nahi, i18n-friendly { key, type, params } (frontend translate karega)
function buildInsights(rows, totals, platforms, postTypes, heatmap, failures, health) {
    const out = [];
    if (!rows.length) return [{ key: "no_data", type: "info", params: {} }];

    const withStats = (list) => list.filter((x) => x.targetsWithStats > 0);

    const p = withStats(platforms);
    if (p.length >= 2) {
        const best = [...p].sort((a, b) => score(b.avgViews, b.avgLikes) - score(a.avgViews, a.avgLikes))[0];
        out.push({ key: "best_platform", type: "success", params: { platform: best.platform, avgViews: best.avgViews, avgLikes: best.avgLikes } });
    }
    const t = withStats(postTypes);
    if (t.length >= 2) {
        const best = [...t].sort((a, b) => score(b.avgViews, b.avgLikes) - score(a.avgViews, a.avgLikes))[0];
        out.push({ key: "best_post_type", type: "success", params: { postType: best.postType, avgViews: best.avgViews, avgLikes: best.avgLikes } });
    }
    if (heatmap.totalPosts >= MIN_POSTS_FOR_SLOT_INSIGHT && heatmap.cells.length) {
        const c = heatmap.cells[0];
        out.push({ key: "best_slot", type: "success", params: { dayName: c.dayName, hour: c.hour, avgViews: c.avgViews, avgLikes: c.avgLikes } });
    }
    if (totals.published + totals.failed >= 5 && totals.successRate !== null && totals.successRate < 80) {
        out.push({ key: "low_success_rate", type: "warning", params: { successRate: totals.successRate, failed: totals.failed } });
    }
    if (failures.reasons.length) {
        out.push({ key: "top_failure_reason", type: "warning", params: { reason: failures.reasons[0].reason, count: failures.reasons[0].count } });
    }
    if (totals.published > 0 && totals.targetsWithStats === 0) {
        out.push({ key: "no_stats_yet", type: "info", params: {} });
    }
    if (health.removed > 0) {
        out.push({ key: "removed_posts", type: "warning", params: { count: health.removed } });
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────
// PURE function: posts (plain objects) -> poora analytics object.
// DB ki zaroorat nahi, isliye alag se test ho sakta hai.
// ─────────────────────────────────────────────────────────────────────────
function buildAnalytics(posts, { range = "30d", platform = null, now = new Date() } = {}) {
    const win = getWindow(range, now);
    const allRows = flattenPosts(posts, platform).filter((r) => r.scheduledAt <= now);

    const rows = win.from ? allRows.filter((r) => r.scheduledAt >= win.from) : allRows;
    const prevRows = win.from ? allRows.filter((r) => r.scheduledAt >= win.prevFrom && r.scheduledAt < win.from) : [];

    const totals = summarize(rows);

    const comparison = win.from
        ? (() => {
            const prev = summarize(prevRows);
            const pair = (k) => ({ current: totals[k], previous: prev[k], changePct: changePct(totals[k], prev[k]) });
            return { posts: pair("posts"), published: pair("published"), failed: pair("failed"), views: pair("views"), likes: pair("likes") };
        })()
        : null;

    // Post ka overall status (pending/processing/completed/partial/failed) -- unique posts par
    const postStatusMap = new Map();
    for (const r of rows) postStatusMap.set(r.postId, r.postStatus);
    const postStatus = { pending: 0, processing: 0, completed: 0, partial: 0, failed: 0 };
    for (const st of postStatusMap.values()) if (st in postStatus) postStatus[st]++;

    const platforms = groupSummary(rows, (r) => r.platform, "platform");
    const postTypes = groupSummary(rows, (r) => r.postType, "postType");
    const heatmap = buildHeatmap(rows);
    const failures = buildFailures(rows);

    const publishedRows = rows.filter((r) => r.status === "published");
    const health = {
        live: publishedRows.filter((r) => r.platformStatus === "live").length,
        removed: publishedRows.filter((r) => r.platformStatus === "removed").length,
        unknown: publishedRows.filter((r) => r.platformStatus === "unknown").length,
    };

    const statsTimes = rows.map((r) => r.statsUpdatedAt).filter(Boolean).map((d) => new Date(d).getTime());

    return {
        meta: {
            range,
            platform: platform || "all",
            timezone: TIMEZONE,
            from: win.from ? win.from.toISOString() : null,
            to: now.toISOString(),
            generatedAt: new Date().toISOString(),
            statsLastUpdatedAt: statsTimes.length ? new Date(Math.max(...statsTimes)).toISOString() : null,
            note: "Views/likes platform ke total (abhi tak ke) hain; timeline mein wo post ki scheduled date par count hote hain.",
        },
        totals,
        comparison,
        postStatus,
        timeline: buildTimeline(rows, range, win, now),
        platforms,
        postTypes,
        heatmap,
        topPosts: buildTopPosts(rows),
        failures,
        health,
        insights: buildInsights(rows, totals, platforms, postTypes, heatmap, failures, health),
    };
}

// ─────────────────────────────────────────────────────────────────────────
// DB wale functions
// ─────────────────────────────────────────────────────────────────────────
async function fetchPosts(userId, range, now) {
    const win = getWindow(range, now);
    const query = { userId: new mongoose.Types.ObjectId(userId), scheduledAt: { $lte: now } };
    if (win.prevFrom) query.scheduledAt.$gte = win.prevFrom; // pichhla period bhi (comparison ke liye)
    return Post.find(query).select("content postType scheduledAt status targets").lean();
}

async function getAnalytics(userId, { range = "30d", platform = null } = {}) {
    const now = new Date();
    const uid = new mongoose.Types.ObjectId(userId);

    const upcomingQuery = { userId: uid, status: "pending", scheduledAt: { $gt: now } };
    if (platform) upcomingQuery["targets.platform"] = platform;

    const [posts, upcomingCount, upcomingPosts, bestTime] = await Promise.all([
        fetchPosts(userId, range, now),
        Post.countDocuments(upcomingQuery),
        Post.find(upcomingQuery).sort({ scheduledAt: 1 }).limit(5).select("content postType scheduledAt targets").lean(),
        getBestTimes(userId, platform || undefined).catch(() => null), // fail ho to baaki analytics na ruke
    ]);

    const analytics = buildAnalytics(posts, { range, platform, now });

    analytics.upcoming = {
        count: upcomingCount,
        next: upcomingPosts.map((p) => ({
            postId: String(p._id),
            content: (p.content || "").slice(0, 100),
            postType: p.postType,
            scheduledAt: p.scheduledAt,
            platforms: (p.targets || []).map((t) => t.platform),
        })),
    };
    analytics.bestTime = bestTime; // all-time data par based (CreatePost ke chips jaisa)
    return analytics;
}

// Recent published posts ke stats abhi refresh karo ("Refresh stats" button)
const REFRESH_LIMIT = 20;
const REFRESH_CHUNK = 5;
async function refreshRecentStats(userId) {
    const posts = await Post.find({
        userId: new mongoose.Types.ObjectId(userId),
        "targets.status": "published",
    })
        .sort({ scheduledAt: -1 })
        .limit(REFRESH_LIMIT);

    let refreshed = 0;
    let failed = 0;
    for (let i = 0; i < posts.length; i += REFRESH_CHUNK) {
        const chunk = posts.slice(i, i + REFRESH_CHUNK);
        const results = await Promise.allSettled(chunk.map((p) => refreshStatsForPost(p)));
        results.forEach((r) => (r.status === "fulfilled" ? refreshed++ : failed++));
    }
    return { attempted: posts.length, refreshed, failed };
}

// ─────────────────────────────────────────────────────────────────────────
// CSV export
// ─────────────────────────────────────────────────────────────────────────
// Excel formula injection se bachne ke liye (=, +, -, @ se shuru ho to aage ' laga do)
function csvCell(value) {
    let s = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
}

function buildCsv(posts, { range = "30d", platform = null, now = new Date() } = {}) {
    const win = getWindow(range, now);
    let rows = flattenPosts(posts, platform).filter((r) => r.scheduledAt <= now);
    if (win.from) rows = rows.filter((r) => r.scheduledAt >= win.from);
    rows.sort((a, b) => b.scheduledAt - a.scheduledAt);

    const header = ["Date (IST)", "Time (IST)", "Platform", "Post type", "Status", "Views", "Likes", "Content", "Link", "Error"];
    const lines = [header.map(csvCell).join(",")];
    for (const r of rows) {
        const p = istParts(r.scheduledAt);
        lines.push(
            [
                `${p.y}-${pad(p.m)}-${pad(p.d)}`,
                `${pad(p.hour)}:${pad(p.min)}`,
                r.platform,
                r.postType,
                r.status,
                r.views,
                r.likes,
                r.content.replace(/\s+/g, " ").slice(0, 200),
                r.publishedUrl,
                r.error,
            ].map(csvCell).join(",")
        );
    }
    return "\uFEFF" + lines.join("\n"); // BOM: Excel mein Hindi text sahi dikhe
}

async function getExportCsv(userId, { range = "30d", platform = null } = {}) {
    const now = new Date();
    const posts = await fetchPosts(userId, range, now);
    return buildCsv(posts, { range, platform, now });
}

module.exports = {
    RANGES,
    getAnalytics,
    refreshRecentStats,
    getExportCsv,
    // tests ke liye
    buildAnalytics,
    buildCsv,
};