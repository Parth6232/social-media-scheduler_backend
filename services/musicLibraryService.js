const axios = require("axios");

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-PROVIDER MUSIC LIBRARY
// Providers:
//   1. Jamendo   — large CC catalog, API key required (free, 35k req/month)
//   2. Openverse — free, NO key, aggregates Jamendo + ccMixter + Freesound + more
//
// REMOVED (2026): Pixabay "music" API endpoint does not exist publicly
// (Pixabay only exposes Images/Videos APIs; Music is website-only, not
// queryable via API key) and the old freemusicarchive.org/api/get/tracks.json
// endpoint is the pre-2018 legacy FMA API, dead since FMA's ownership change.
// Both were returning 0 results / errors for every query — that's the bug
// that was causing "no songs at all" in search.
//
// Indian/Hindi content ke liye:
//   - Jamendo: query me "indian", "sitar", "tabla", "bhangra", "bollywood style" likho
//   - Openverse: same keywords kaam karte hain, results Jamendo se hi aate hain zyada
//   - IMPORTANT: koi bhi free/CC library me asli, copyrighted Bollywood/film
//     songs NAHI milenge — wo sab licensed hain. CC catalogs me sirf
//     independent/instrumental "Indian-style" tracks milte hain. Agar app me
//     real Bollywood tracks chahiye to ek licensed music API (e.g. a
//     commercial sync-licensing provider) leni padegi — free tier me possible nahi.
//
// Sab providers ek normalized shape return karte hain:
//   { externalId, title, artist, duration, previewUrl, genre, image, provider, license }
// Frontend ko kuch nahi todna padega.
// ─────────────────────────────────────────────────────────────────────────────

const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID;

const JAMENDO_BASE = "https://api.jamendo.com/v3.0/tracks/";
// Openverse: free, NO API key, aggregates Jamendo + ccMixter + Freesound + WFMU etc.
// in ek single endpoint me. (Pixabay "music" API aur legacy FMA API dono
// dead/non-existent hain — 2026 me inhe hata diya gaya, neeche note dekho.)
const OPENVERSE_BASE = "https://api.openverse.org/v1/audio/";

// ─── Error logging (poori detail, generic message nahi) ──────────────────────
function logProviderError(label, err) {
    const status = err?.response?.status;
    const body = err?.response?.data;
    console.error(
        `[musicLibrary] ${label} failed` + (status ? ` (HTTP ${status})` : "") + `:`,
        body ? JSON.stringify(body).slice(0, 500) : err?.message || err
    );
}

// ─── Reel-friendly length scoring (sort ke liye, filter nahi) ────────────────
function lengthScore(duration) {
    const d = Number(duration) || 0;
    if (d >= 15 && d <= 120) return 0;   // ideal reel length
    if (d > 120 && d <= 240) return 1;   // thoda lamba, chalega
    if (d > 0 && d < 15) return 2;   // bahut chhota
    return 3;                              // bahut lamba / unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER 1: JAMENDO
// ─────────────────────────────────────────────────────────────────────────────
function normalizeJamendo(t) {
    return {
        externalId: `jamendo_${t.id}`,
        title: t.name,
        artist: t.artist_name,
        duration: Number(t.duration) || 0,
        previewUrl: t.audio,
        genre: t.musicinfo?.tags?.genres?.[0] || "general",
        image: t.image || t.album_image || null,
        provider: "jamendo",
        license: t.license_ccurl || null,
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

async function searchJamendo(query, limit) {
    if (!JAMENDO_CLIENT_ID) {
        console.warn("[musicLibrary] JAMENDO_CLIENT_ID .env me nahi — Jamendo skip");
        return [];
    }

    // Empty query = Discover tab — popular tracks dikhao
    if (!query?.trim()) {
        return jamendoRequest({ limit, order: "popularity_month" });
    }

    const q = query.trim();

    // Indian-specific boost: agar query me Indian keywords hain to fuzzytags bhi lagao
    const indianKeywords = ["indian", "hindi", "bollywood", "sitar", "tabla",
        "bhangra", "desi", "fusion", "punjabi", "rajasthani",
        "carnatic", "classical indian", "sufi"];
    const isIndianQuery = indianKeywords.some(k => q.toLowerCase().includes(k));

    const requests = [
        jamendoRequest({ limit, namesearch: q }),
        jamendoRequest({ limit, search: q }),
    ];

    // Indian query pe extra: tags se bhi search karo
    if (isIndianQuery) {
        requests.push(
            jamendoRequest({ limit, fuzzytags: q }),
            jamendoRequest({ limit: Math.ceil(limit / 2), tags: "world,indian,ethnic" })
        );
    }

    const results = await Promise.allSettled(requests);
    const merged = [];

    results.forEach((r, i) => {
        if (r.status === "fulfilled") merged.push(...r.value);
        else logProviderError(`Jamendo (mode-${i})`, r.reason);
    });

    return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER 2: OPENVERSE AUDIO
// Free, NO API key needed (anonymous access, rate-limited but generous).
// Aggregates Jamendo + ccMixter + Freesound + WFMU + more in one search.
// Docs: https://api.openverse.org/v1/audio/  (category=music filters out
// raw sound-effects). NOTE: results can overlap with our direct Jamendo
// calls above — that's fine, the dedupe step below (by externalId) handles it.
// ─────────────────────────────────────────────────────────────────────────────
function normalizeOpenverse(t) {
    const rawTag = Array.isArray(t.tags) && t.tags.length ? t.tags[0] : null;
    const genre = typeof rawTag === "string" ? rawTag : rawTag?.name;

    return {
        externalId: `openverse_${t.id}`,
        title: t.title || "Untitled",
        artist: t.creator || "Unknown Artist",
        // Openverse returns duration in milliseconds
        duration: t.duration ? Math.round(Number(t.duration) / 1000) : 0,
        previewUrl: t.url, // direct playable audio file URL
        genre: genre || "general",
        image: t.thumbnail || null,
        provider: "openverse",
        license: t.license ? `CC ${String(t.license).toUpperCase()}` : "Creative Commons",
    };
}

async function searchOpenverse(query, limit) {
    const params = {
        page_size: Math.min(limit, 100), // Openverse max per page = 100
        category: "music", // exclude raw sound-effects/podcasts
    };
    if (query?.trim()) params.q = query.trim();

    const { data } = await axios.get(OPENVERSE_BASE, { params, timeout: 12000 });
    return (data?.results || [])
        .filter(t => t.url) // sirf wo tracks jinke paas playable file URL hai
        .map(normalizeOpenverse);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────
async function searchFreeTracks({ query = "", limit = 200 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 200);

    // Dono providers parallel me chalao — jo bhi fail ho uska error log ho,
    // baaki ke results combine ho jaayein
    const [jamendoResult, openverseResult] = await Promise.allSettled([
        searchJamendo(query, safeLimit).catch(err => { logProviderError("Jamendo", err); return []; }),
        searchOpenverse(query, safeLimit).catch(err => { logProviderError("Openverse", err); return []; }),
    ]);

    const allTracks = [
        ...(jamendoResult.status === "fulfilled" ? jamendoResult.value : []),
        ...(openverseResult.status === "fulfilled" ? openverseResult.value : []),
    ];

    // Dedupe by externalId
    const seen = new Set();
    const unique = allTracks.filter(t => {
        if (!t.previewUrl || seen.has(t.externalId)) return false;
        seen.add(t.externalId);
        return true;
    });

    // Reel-friendly length wale pehle
    unique.sort((a, b) => lengthScore(a.duration) - lengthScore(b.duration));

    const final = unique.slice(0, safeLimit);
    console.log(`[musicLibrary] query="${query}" → Jamendo:${jamendoResult.value?.length ?? 0} Openverse:${openverseResult.value?.length ?? 0} → total:${final.length}`);

    return final;
}

module.exports = { searchFreeTracks };