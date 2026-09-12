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

        account.accessToken = credentials.access_token;
        account.tokenExpiresAt = new Date(credentials.expiry_date);
        await account.save();

        const youtube = google.youtube({ version: "v3", auth: oauth2Client });
        const res = await youtube.videos.list({ part: "statistics", id: target.platformPostId });
        const stats = res.data.items?.[0]?.statistics;
        if (!stats) return { views: null, likes: null, platformStatus: "removed" };

        return {
            views: stats.viewCount != null ? Number(stats.viewCount) : null,
            likes: stats.likeCount != null ? Number(stats.likeCount) : null,
            platformStatus: "live", // NAYA -- isse pehle missing tha
        };
    } catch (error) {
        console.error(`YouTube stats fetch failed for ${target.platformPostId}:`, error.message);
        return { views: null, likes: null, platformStatus: "unknown" };
    }
}

async function fetchFacebookStats(target, account) {
    const result = { views: null, likes: null, platformStatus: "unknown" }; // NAYA

    try {
        const likesRes = await axios.get(`${GRAPH_URL}/${target.platformPostId}`, {
            params: { fields: "likes.summary(true)", access_token: account.accessToken },
        });
        result.likes = likesRes.data.likes?.summary?.total_count ?? null;
        result.platformStatus = "live"; // NAYA
    } catch (error) {
        const fbErrorCode = error.response?.data?.error?.code; // NAYA
        const fbErrorSubcode = error.response?.data?.error?.error_subcode; // NAYA
        console.error(`Facebook likes fetch failed for ${target.platformPostId}:`, error.response?.data?.error?.message || error.message);
        // code 100 + subcode 33 = "Unsupported get request... object does not exist" -- yaani delete ho chuka hai
        if (fbErrorCode === 100 || fbErrorSubcode === 33) {
            result.platformStatus = "removed"; // NAYA
        }
    }

    // (video_insights wala block bilkul same rehne do, usse platformStatus touch mat karo)
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
    const result = { views: null, likes: null, platformStatus: "unknown" }; // NAYA

    try {
        const likesRes = await axios.get(`${GRAPH_URL}/${target.platformPostId}`, {
            params: { fields: "like_count", access_token: account.accessToken },
        });
        result.likes = likesRes.data.like_count ?? null;
        result.platformStatus = "live"; // NAYA
    } catch (error) {
        const igErrorCode = error.response?.data?.error?.code; // NAYA
        console.error(`Instagram likes fetch failed for ${target.platformPostId}:`, error.response?.data?.error?.message || error.message);
        // code 100 = "Unsupported get request" / code 24 = "media not found" -- delete ho chuki
        if (igErrorCode === 100 || igErrorCode === 24) {
            result.platformStatus = "removed"; // NAYA
        }
    }

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
    target.platformStatus = stats.platformStatus || "unknown"; // NAYA
    target.platformStatusCheckedAt = new Date(); // NAYA
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