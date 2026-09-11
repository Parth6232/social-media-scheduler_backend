const axios = require("axios");
const { google } = require("googleapis");
const ConnectedAccount = require("../models/ConnectedAccount");

const GRAPH_URL = "https://graph.facebook.com/v21.0";

// ─────────────────────────────────────────────────────────────────────────
// Har platform ke liye ek chhota fetcher. Ye functions kabhi bhi "throw"
// nahi karte -- agar kisi wajah se (missing permission, expired token, etc.)
// data nahi mil paaya, { views: null, likes: null } return karte hain taaki
// ek target ka fail hona baaki targets ke stats refresh ko na roke.
// ─────────────────────────────────────────────────────────────────────────

async function fetchYouTubeStats(target, account) {
    try {
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials({ refresh_token: account.refreshToken });
        const { credentials } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(credentials);

        // token refresh ho gaya, DB mein bhi update kar do (jaisa publish flow mein hota hai)
        account.accessToken = credentials.access_token;
        account.tokenExpiresAt = new Date(credentials.expiry_date);
        await account.save();

        const youtube = google.youtube({ version: "v3", auth: oauth2Client });
        const res = await youtube.videos.list({ part: "statistics", id: target.platformPostId });
        const stats = res.data.items?.[0]?.statistics;
        if (!stats) return { views: null, likes: null };

        return {
            views: stats.viewCount != null ? Number(stats.viewCount) : null,
            likes: stats.likeCount != null ? Number(stats.likeCount) : null,
        };
    } catch (error) {
        console.error(`YouTube stats fetch failed for ${target.platformPostId}:`, error.message);
        return { views: null, likes: null };
    }
}

async function fetchFacebookStats(target, account) {
    const result = { views: null, likes: null };

    // Likes: basic field, koi extra permission nahi chahiye
    try {
        const likesRes = await axios.get(`${GRAPH_URL}/${target.platformPostId}`, {
            params: { fields: "likes.summary(true)", access_token: account.accessToken },
        });
        result.likes = likesRes.data.likes?.summary?.total_count ?? null;
    } catch (error) {
        console.error(`Facebook likes fetch failed for ${target.platformPostId}:`, error.response?.data?.error?.message || error.message);
    }

    // Views: video/reel insights ke liye "pages_read_engagement" permission
    // chahiye. Admin/Tester account se turant kaam karega (Dashboard config
    // update + reconnect ke baad), general public ke liye App Review lagega.
    try {
        const insightsRes = await axios.get(`${GRAPH_URL}/${target.platformPostId}/video_insights`, {
            params: { metric: "total_video_views", access_token: account.accessToken },
        });
        const viewsValue = insightsRes.data.data?.[0]?.values?.[0]?.value;
        if (viewsValue != null) result.views = viewsValue;
    } catch {
        // permission na hone par yahan silently fail hoga -- expected hai abhi
    }

    return result;
}

async function fetchInstagramStats(target, account) {
    const result = { views: null, likes: null };

    // Likes: har media type (image/video/reel) par valid field hai
    try {
        const likesRes = await axios.get(`${GRAPH_URL}/${target.platformPostId}`, {
            params: { fields: "like_count", access_token: account.accessToken },
        });
        result.likes = likesRes.data.like_count ?? null;
    } catch (error) {
        console.error(`Instagram likes fetch failed for ${target.platformPostId}:`, error.response?.data?.error?.message || error.message);
    }

    // Views ("plays"): SIRF video/Reel media par valid hai -- image post par
    // ye field hi exist nahi karta, aur agar isse "likes" ke saath ek hi
    // request mein maanga jaaye toh poori request hi fail ho jaati hai
    // (isliye likes bhi null aa raha tha). Ab dono calls independent hain.
    try {
        const playsRes = await axios.get(`${GRAPH_URL}/${target.platformPostId}`, {
            params: { fields: "plays", access_token: account.accessToken },
        });
        result.views = playsRes.data.plays ?? null;
    } catch (error) {
        // Image posts ke liye ye hamesha fail hoga -- expected hai, silently ignore
    }

    return result;
}

// NAYA: ek single target (post ke andar ek platform-entry) ke stats refresh
// karke seedha us target object par likh deta hai (caller ko post.save()
// karna hoga). Sirf "published" targets ke liye chalega -- pending/failed
// ke paas platformPostId hota hi nahi.
async function refreshTargetStats(target, userId) {
    if (target.status !== "published" || !target.platformPostId) return;

    const filter = { userId, platform: target.platform };
    if (target.pageId) filter.platformAccountId = target.pageId;
    const account = await ConnectedAccount.findOne(filter);
    if (!account) return; // account disconnect ho chuka ho sakta hai

    let stats = { views: null, likes: null };
    if (target.platform === "youtube") stats = await fetchYouTubeStats(target, account);
    else if (target.platform === "facebook") stats = await fetchFacebookStats(target, account);
    else if (target.platform === "instagram") stats = await fetchInstagramStats(target, account);
    else return; // linkedin/twitter/whatsapp abhi supported nahi

    target.views = stats.views;
    target.likes = stats.likes;
    target.statsUpdatedAt = new Date();
}

// NAYA: ek pure Post document ke saare "published" targets refresh karo.
// Manual "Refresh stats" button aur daily cron job, dono isi ek function
// ko reuse karenge taaki logic ek hi jagah rahe.
async function refreshStatsForPost(post) {
    for (const target of post.targets) {
        await refreshTargetStats(target, post.userId);
    }
    await post.save();
    return post;
}

module.exports = { refreshStatsForPost, refreshTargetStats };