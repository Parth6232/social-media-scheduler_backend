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
// NAYA: Facebook/Instagram Graph API "ye object exist nahi karta" ke liye
// broad, reusable detection. Alag-alag post/media types (text status vs
// photo vs video vs story) alag error code/subcode de sakte hain, isliye
// sirf ek fixed code match karna fragile hai -- code + subcode + message
// text teeno ko check karte hain.
function isMetaObjectMissingError(error) {
    const fbError = error.response?.data?.error;
    if (!fbError) return false;
    const code = fbError.code;
    const subcode = fbError.error_subcode;
    const message = (fbError.message || "").toLowerCase();

    // Known "doesn't exist" signals Facebook/Instagram Graph API mein:
    if (code === 100) return true; // GraphMethodException -- humare apne page/account ke content ke liye almost hamesha "deleted" hi matlab hota hai
    if (subcode === 33) return true; // "object does not exist"
    if (code === 24) return true; // Instagram: media not found
    if (message.includes("does not exist")) return true;
    if (message.includes("cannot be loaded")) return true;
    if (message.includes("was deleted")) return true;
    if (message.includes("unsupported get request")) return true;

    return false; // baaki sab (rate limit, token expired, etc.) transient hai -- "removed" mat maano
}

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
    const result = { views: null, likes: null, platformStatus: "unknown" };

    // NAYA: pehle ek halka, dedicated existence-check -- sirf "id" field
    // maangte hain (likes/views field se bilkul alag), taaki kisi post-type
    // ke likes-field-quirk se "removed" ka signal confuse na ho.
    try {
        await axios.get(`${GRAPH_URL}/${target.platformPostId}`, {
            params: { fields: "id", access_token: account.accessToken },
        });
        result.platformStatus = "live";
    } catch (error) {
        if (isMetaObjectMissingError(error)) {
            result.platformStatus = "removed";
        }
        console.error(`Facebook existence check failed for ${target.platformPostId}:`, error.response?.data?.error?.message || error.message);
    }

    // Agar removed confirm ho gaya, likes/views fetch karne ka koi matlab nahi
    if (result.platformStatus === "removed") return result;

    try {
        const likesRes = await axios.get(`${GRAPH_URL}/${target.platformPostId}`, {
            params: { fields: "likes.summary(true)", access_token: account.accessToken },
        });
        result.likes = likesRes.data.likes?.summary?.total_count ?? null;
    } catch (error) {
        console.error(`Facebook likes fetch failed for ${target.platformPostId}:`, error.response?.data?.error?.message || error.message);
    }

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
    const result = { views: null, likes: null, platformStatus: "unknown" };

    try {
        await axios.get(`${GRAPH_URL}/${target.platformPostId}`, {
            params: { fields: "id", access_token: account.accessToken },
        });
        result.platformStatus = "live";
    } catch (error) {
        if (isMetaObjectMissingError(error)) {
            result.platformStatus = "removed";
        }
        console.error(`Instagram existence check failed for ${target.platformPostId}:`, error.response?.data?.error?.message || error.message);
    }

    if (result.platformStatus === "removed") return result;

    try {
        const likesRes = await axios.get(`${GRAPH_URL}/${target.platformPostId}`, {
            params: { fields: "like_count", access_token: account.accessToken },
        });
        result.likes = likesRes.data.like_count ?? null;
    } catch (error) {
        console.error(`Instagram likes fetch failed for ${target.platformPostId}:`, error.response?.data?.error?.message || error.message);
    }

    try {
        const playsRes = await axios.get(`${GRAPH_URL}/${target.platformPostId}`, {
            params: { fields: "plays", access_token: account.accessToken },
        });
        result.views = playsRes.data.plays ?? null;
    } catch {
        // image posts ke liye ye hamesha fail hoga -- expected
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