const axios = require("axios");

const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID;

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY:
//
// v1 bug: `durationbetween: "60_90"` ek HARD filter tha. Jamendo pe zyadatar
// tracks 3-5 minute ke hain, isliye 95%+ catalog pehle hi kaat jaata tha.
//
// v2 bug (isi file ka pichla version): search zyada wide karne ki koshish me
// do cheezein add ki thi jo khud hi Jamendo/Openverse dono APIs ko reject
// karwa rahi thi, isliye HAR search (chahe "mom" jaisa common word ho)
// khali `[]` aa raha tha:
//   - Jamendo ke `type` parameter ko "single albumtrack" (space-separated)
//     value diya tha — Jamendo isko invalid samajh kar poori request hi
//     error de deta tha, teeno parallel search-modes ke liye.
//   - Openverse ke `license_type` ko "commercial modification" (space se)
//     diya tha — Openverse ko comma-separated chahiye ("commercial,modification").
//   - Dono errors sirf `err.message` se console me log ho rahe the (jo axios
//     ke liye bekaar generic text deta hai), asli error_message kabhi dikha
//     hi nahi, isliye bug pakadna mushkil tha.
//
// Is version me:
//   1. `type` param hata diya — Jamendo ka default (album tracks) hi use
//      hota hai, jo pehle se working tha.
//   2. Sirf 2 search modes: `namesearch` (naam match) + `search` (general
//      full-text). `fuzzytags` hataya — wo genre/mood tags ke liye hai,
//      free-text query ke liye nahi.
//   3. Openverse `license_type` comma-separated kiya.
//   4. Duration ab HARD filter nahi, sirf sort-preference hai — reel-length
//      (15-120s) tracks upar aate hain, baaki bhi list me rehte hain.
//   5. Har provider error ab poori detail (HTTP status + response body) ke
//      saath console me print hota hai — agla issue turant dikhega.
//   6. limit 30 → 200 (Jamendo ka max).
// ─────────────────────────────────────────────────────────────────────────────

const JAMENDO_BASE = "https://api.jamendo.com/v3.0/tracks/";
const OPENVERSE_BASE = "https://api.openverse.org/v1/audio/";

// Purane code me sirf err.message log hota tha — jo axios errors ke liye
// "Request failed with status code 400" jaisa bekaar message deta hai.
// Asli wajah (Jamendo/Openverse ka apna error_message) response body me hoti
// hai. Yahi wajah thi ki "sab kuch khali aa raha hai" ka root cause pata
// nahi chal pa raha tha — ab poori detail console me print hogi.
function logProviderError(providerLabel, err) {
    const status = err?.response?.status;
    const body = err?.response?.data;
    console.error(
        `[musicLibrary] ${providerLabel} search failed` +
        (status ? ` (HTTP ${status})` : "") +
        `:`,
        body ? JSON.stringify(body).slice(0, 500) : err?.message || err
    );
}

// Reel/Short ke liye ideal length — isse SORT karte hain, filter nahi
const IDEAL_MIN = 15;
const IDEAL_MAX = 120;

// Ek track "reel-friendly" hai ya nahi — sorting score ke liye
function lengthScore(duration) {
    const d = Number(duration) || 0;
    if (d >= IDEAL_MIN && d <= IDEAL_MAX) return 0; // best
    if (d > IDEAL_MAX && d <= 240) return 1;        // thoda lamba, chalega
    if (d > 0 && d < IDEAL_MIN) return 2;           // bahut chhota
    return 3;                                        // bahut lamba / unknown
}

function normalizeJamendo(t) {
    return {
        externalId: `jamendo_${t.id}`,
        title: t.name,
        artist: t.artist_name,
        duration: Number(t.duration) || 0,
        previewUrl: t.audio, // direct streamable mp3
        genre: t.musicinfo?.tags?.genres?.[0] || "general",
        image: t.image || t.album_image || null,
        provider: "jamendo",
        license: t.license_ccurl || null,
    };
}

function normalizeOpenverse(t) {
    return {
        externalId: `openverse_${t.id}`,
        title: t.title || "Untitled",
        artist: t.creator || "Unknown",
        // Openverse duration MILLISECONDS me deta hai — seconds me convert
        duration: t.duration ? Math.round(Number(t.duration) / 1000) : 0,
        previewUrl: t.url,
        genre: (t.genres && t.genres[0]) || (t.category || "general"),
        image: t.thumbnail || null,
        provider: "openverse",
        license: t.license_url || t.license || null,
    };
}

async function jamendoRequest(params) {
    const { data } = await axios.get(JAMENDO_BASE, {
        params: {
            client_id: JAMENDO_CLIENT_ID,
            format: "json",
            include: "musicinfo",
            audioformat: "mp32",
            imagesize: 200,
            ...params,
        },
        timeout: 12000,
    });
    return (data?.results || []).map(normalizeJamendo);
}

// Jamendo ke multiple search modes — merge karke zyada results milte hain
async function searchJamendo(query, limit) {
    if (!JAMENDO_CLIENT_ID) {
        console.warn("[musicLibrary] JAMENDO_CLIENT_ID .env me set nahi hai — Jamendo search skip ho raha hai.");
        return [];
    }

    // Khali query = Discover tab pehli baar khulta hai. Popular tracks dikhao
    // taaki user ko khali screen na mile.
    if (!query || !query.trim()) {
        return jamendoRequest({ limit, order: "popularity_month" });
    }

    const q = query.trim();

    // namesearch = track/artist/album ke naam me match, search = general full-text.
    // (fuzzytags jaan-boojh kar hata diya — wo genre/mood/instrument tags ke liye
    // hai, free-text query ke liye nahi, aur bekaar me ek extra API call tha.)
    const [byName, byGeneral] = await Promise.allSettled([
        jamendoRequest({ limit, namesearch: q }),
        jamendoRequest({ limit, search: q }),
    ]);

    const modes = [
        { label: "namesearch", result: byName },
        { label: "search", result: byGeneral },
    ];

    const merged = [];
    for (const { label, result } of modes) {
        if (result.status === "fulfilled") {
            merged.push(...result.value);
        } else {
            // PEHLE ye chup-chaap ignore ho jaata tha — ab console me poora error
            // dikhega taaki agla issue turant pakad me aa jaaye.
            logProviderError(`Jamendo (${label})`, result.reason);
        }
    }
    return merged;
}

// Fallback provider — koi API key nahi chahiye
async function searchOpenverse(query, limit) {
    const { data } = await axios.get(OPENVERSE_BASE, {
        params: {
            q: query && query.trim() ? query.trim() : "music",
            page_size: Math.min(limit, 20), // Openverse max 20 per page
            license_type: "commercial,modification", // comma-separated — space se Openverse ise samajhta nahi
            category: "music",
        },
        headers: { "User-Agent": "SocialBlitz/1.0" },
        timeout: 12000,
    });
    return (data?.results || []).map(normalizeOpenverse);
}

/**
 * Free/royalty-free tracks search.
 * Response shape purane version jaisa hi hai (externalId, title, artist,
 * duration, previewUrl, genre) + 3 naye optional fields: image, provider,
 * license. Frontend ko kuch todna nahi padega.
 */
async function searchFreeTracks({ query = "", limit = 200 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 200);

    let tracks = [];

    try {
        tracks = await searchJamendo(query, safeLimit);
    } catch (err) {
        logProviderError("Jamendo", err);
    }

    // Jamendo se kuch nahi mila (ya down hai) — Openverse try karo
    if (tracks.length === 0) {
        try {
            tracks = await searchOpenverse(query, safeLimit);
        } catch (err) {
            logProviderError("Openverse", err);
        }
    }

    // Dedupe — multiple search modes se same track do baar aa sakta hai
    const seen = new Set();
    const unique = tracks.filter((t) => {
        if (!t.previewUrl || seen.has(t.externalId)) return false;
        seen.add(t.externalId);
        return true;
    });

    // Reel-friendly length wale tracks pehle
    unique.sort((a, b) => lengthScore(a.duration) - lengthScore(b.duration));

    return unique.slice(0, safeLimit);
}

module.exports = { searchFreeTracks };