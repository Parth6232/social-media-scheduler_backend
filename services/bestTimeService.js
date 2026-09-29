const mongoose = require("mongoose");
const Post = require("../models/Post");

// Sab time India (IST) ke hisaab se calculate honge
const TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Itne se kam posts (stats ke saath) ho to general times dikhayenge
const MIN_POSTS_FOR_DATA = 5;
const TOP_SLOTS = 3;

// Score = views + likes * 10
const LIKE_WEIGHT = 10;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Fallback times. dayOfWeek: 0 = Sunday ... 6 = Saturday
const GENERAL_SLOTS = {
    instagram: [
        { dayOfWeek: 2, hour: 19 },
        { dayOfWeek: 5, hour: 20 },
        { dayOfWeek: 0, hour: 11 },
    ],
    facebook: [
        { dayOfWeek: 3, hour: 12 },
        { dayOfWeek: 4, hour: 19 },
        { dayOfWeek: 6, hour: 10 },
    ],
    youtube: [
        { dayOfWeek: 4, hour: 18 },
        { dayOfWeek: 5, hour: 17 },
        { dayOfWeek: 6, hour: 11 },
    ],
    default: [
        { dayOfWeek: 2, hour: 19 },
        { dayOfWeek: 4, hour: 19 },
        { dayOfWeek: 6, hour: 11 },
    ],
};

function formatHour(hour) {
    const suffix = hour >= 12 ? "PM" : "AM";
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${h12} ${suffix}`;
}

// Diye gaye (din, ghanta) ka agla upcoming time nikalta hai (kam se kam 30 min aage)
function getNextOccurrence(dayOfWeek, hour, now = new Date()) {
    const minTime = now.getTime() + 30 * 60 * 1000;
    const istNow = new Date(now.getTime() + IST_OFFSET_MS);

    for (let i = 0; i <= 7; i++) {
        const candidate = new Date(
            Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + i, hour, 0, 0)
        );
        if (candidate.getUTCDay() !== dayOfWeek) continue;
        const realTime = candidate.getTime() - IST_OFFSET_MS;
        if (realTime >= minTime) return new Date(realTime);
    }
    return null;
}

function buildSlot(dayOfWeek, hour, extra = {}) {
    const nextAt = getNextOccurrence(dayOfWeek, hour);
    return {
        dayOfWeek,
        dayName: DAY_NAMES[dayOfWeek],
        hour,
        label: `${DAY_NAMES[dayOfWeek]}, ${formatHour(hour)}`,
        nextAt: nextAt ? nextAt.toISOString() : null,
        ...extra,
    };
}

function getGeneralSlots(platform) {
    const list = GENERAL_SLOTS[platform] || GENERAL_SLOTS.default;
    return list.map((s) => buildSlot(s.dayOfWeek, s.hour));
}

async function getBestTimes(userId, platform) {
    const pipeline = [
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        { $unwind: "$targets" },
        {
            $match: {
                "targets.status": "published",
                $or: [{ "targets.views": { $ne: null } }, { "targets.likes": { $ne: null } }],
                ...(platform ? { "targets.platform": platform } : {}),
            },
        },
        {
            $project: {
                views: { $ifNull: ["$targets.views", 0] },
                likes: { $ifNull: ["$targets.likes", 0] },
                // Mongo mein 1 = Sunday hota hai, humein 0 chahiye, isliye -1
                dayOfWeek: { $subtract: [{ $dayOfWeek: { date: "$scheduledAt", timezone: TIMEZONE } }, 1] },
                hour: { $hour: { date: "$scheduledAt", timezone: TIMEZONE } },
            },
        },
        {
            $group: {
                _id: { dayOfWeek: "$dayOfWeek", hour: "$hour" },
                posts: { $sum: 1 },
                avgViews: { $avg: "$views" },
                avgLikes: { $avg: "$likes" },
                avgScore: { $avg: { $add: ["$views", { $multiply: ["$likes", LIKE_WEIGHT] }] } },
            },
        },
        { $sort: { avgScore: -1, posts: -1 } },
    ];

    const groups = await Post.aggregate(pipeline);
    const totalPosts = groups.reduce((sum, g) => sum + g.posts, 0);

    const hasUsefulData = totalPosts >= MIN_POSTS_FOR_DATA && groups.some((g) => g.avgScore > 0);
    if (!hasUsefulData) {
        return {
            source: "general",
            timezone: TIMEZONE,
            basedOnPosts: totalPosts,
            message: "Abhi tumhare paas kam posts ka data hai, isliye general best times dikha rahe hain.",
            slots: getGeneralSlots(platform),
        };
    }

    const slots = groups.slice(0, TOP_SLOTS).map((g) =>
        buildSlot(g._id.dayOfWeek, g._id.hour, {
            posts: g.posts,
            avgViews: Math.round(g.avgViews),
            avgLikes: Math.round(g.avgLikes),
        })
    );

    return {
        source: "your_data",
        timezone: TIMEZONE,
        basedOnPosts: totalPosts,
        message: "Ye slots tumhare apne posts ki performance se nikale gaye hain.",
        slots,
    };
}

module.exports = { getBestTimes, getNextOccurrence };