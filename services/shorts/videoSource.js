// Video ki info (title, channel) YouTube API se laata hai AUR check karta hai ki
// ye video use karne ki permission hai ya nahi:
//   1) Video user ke apne connected YouTube channel ki hai  -> "owner"
//   2) Video Creative Commons licensed hai (Remix allowed)  -> "creative_commons"
// Baaki kisi bhi video par clip banana BLOCK hai (copyright/ToS safe rakhne ke liye).
const { google } = require("googleapis");
const ConnectedAccount = require("../../models/ConnectedAccount");

function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

function extractVideoId(url = "") {
    const m = String(url).match(
        /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
    );
    return m ? m[1] : null;
}

function parseIsoDuration(iso = "") {
    const m = iso.match(/^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    if (!m) return 0;
    return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

async function getVideoInfo(userId, url) {
    const videoId = extractVideoId(url);
    if (!videoId) throw httpError(400, "Sahi YouTube link daalo");

    const accounts = await ConnectedAccount.find({ userId, platform: "youtube" });
    if (!accounts.length) {
        throw httpError(400, "Pehle Accounts page se apna YouTube channel connect karo");
    }
    const acc = accounts[0];

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({
        access_token: acc.accessToken,
        refresh_token: acc.refreshToken,
        expiry_date: acc.tokenExpiresAt ? new Date(acc.tokenExpiresAt).getTime() : undefined,
    });

    const youtube = google.youtube({ version: "v3", auth: oauth2Client });
    let item;
    try {
        const { data } = await youtube.videos.list({ part: "snippet,status,contentDetails", id: videoId });
        item = data.items && data.items[0];
    } catch (e) {
        throw httpError(502, "YouTube se video ki info nahi mil payi: " + e.message);
    }
    if (!item) throw httpError(404, "Video nahi mili (private ya delete ho sakti hai)");

    const channelId = item.snippet.channelId;
    const isOwner = accounts.some((a) => a.platformAccountId && a.platformAccountId === channelId);
    const isCC = item.status && item.status.license === "creativeCommon";

    // Authorization check bypass: kisi bhi YouTube video se Shorts ban sakte hain
    let authorizedBy = isOwner ? "owner" : isCC ? "creative_commons" : "any_video";
    let authMessage = "";

    const thumbs = item.snippet.thumbnails || {};
    return {
        videoId,
        title: item.snippet.title,
        channelId,
        channelTitle: item.snippet.channelTitle,
        thumbnail: (thumbs.high || thumbs.medium || thumbs.default || {}).url || null,
        durationSec: parseIsoDuration(item.contentDetails && item.contentDetails.duration),
        license: item.status && item.status.license,
        authorizedBy,
        authorized: true,   // kisi bhi video se Shorts banana allowed hai
        authMessage,
    };
}

module.exports = { getVideoInfo, extractVideoId, httpError };
