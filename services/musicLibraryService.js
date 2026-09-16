const axios = require("axios");

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-PROVIDER MUSIC LIBRARY
// Providers (priority order):
//   1. Jamendo      — large CC catalog, API key required (free)
//   2. Pixabay      — royalty-free, no attribution needed, API key required (free)
//   3. Free Music Archive (FMA) — CC-licensed, no API key needed
//
// Indian/Hindi content ke liye:
//   - Jamendo: query me "indian", "sitar", "tabla", "bhangra", "bollywood style" likho
//   - Pixabay: "indian", "desi", "bhangra", "fusion" tags pe decent results
//   - FMA:     genre=world filter se Indian artists milte hain
//
// Sab providers ek normalized shape return karte hain:
//   { externalId, title, artist, duration, previewUrl, genre, image, provider, license }
// Frontend ko kuch nahi todna padega.
// ─────────────────────────────────────────────────────────────────────────────

const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID;
const PIXABAY_API_KEY = process.env.PIXABAY_API_KEY;   // free at pixabay.com/api/docs/

const JAMENDO_BASE = "https://api.jamendo.com/v3.0/tracks/";
const PIXABAY_BASE = "https://pixabay.com/api/videos/music/"; // music endpoint
const FMA_BASE = "https://freemusicarchive.org/api/get/tracks.json";

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
// PROVIDER 2: PIXABAY MUSIC
// Free API key: https://pixabay.com/api/docs/  (no attribution required)
// Indian query examples: "indian", "bhangra", "sitar", "tabla", "desi fusion"
// ─────────────────────────────────────────────────────────────────────────────
function normalizePixabay(t) {
    // Pixabay music item shape: { id, title, duration, tags, previewURL, url, user }
    return {
        externalId: `pixabay_${t.id}`,
        title: t.title || "Untitled",
        artist: t.user || "Pixabay Artist",
        duration: Number(t.duration) || 0,
        previewUrl: t.previewURL || t.url,
        genre: (t.tags || "").split(",")[0]?.trim() || "general",
        image: null,   // Pixabay music API me thumbnail nahi hota
        provider: "pixabay",
        license: "Pixabay License (royalty-free, no attribution needed)",
    };
}

async function searchPixabay(query, limit) {
    if (!PIXABAY_API_KEY) {
        console.warn("[musicLibrary] PIXABAY_API_KEY .env me nahi — Pixabay skip");
        return [];
    }

    const params = {
        key: PIXABAY_API_KEY,
        per_page: Math.min(limit, 200),
    };
    if (query?.trim()) params.q = query.trim();

    const { data } = await axios.get(PIXABAY_BASE, { params, timeout: 12000 });
    return (data?.hits || []).map(normalizePixabay);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER 3: FREE MUSIC ARCHIVE (FMA)
// No API key needed. Indian content: genre_id search ya "world" genre.
// Note: FMA API thoda slow hai, isliye ye last fallback hai.
// ─────────────────────────────────────────────────────────────────────────────
function normalizeFMA(t) {
    return {
        externalId: `fma_${t.track_id}`,
        title: t.track_title || "Untitled",
        artist: t.artist_name || "Unknown",
        duration: parseFMADuration(t.track_duration),
        previewUrl: t.track_file,   // direct mp3 URL
        genre: t.track_genres?.[0]?.genre_title || "general",
        image: t.track_image_file || null,
        provider: "fma",
        license: t.license_title || "Creative Commons",
    };
}

// FMA duration format: "MM:SS" ya "H:MM:SS" — seconds me convert
function parseFMADuration(str) {
    if (!str) return 0;
    const parts = String(str).split(":").map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return Number(str) || 0;
}

async function searchFMA(query, limit) {
    // FMA me Indian ke liye "world" genre_id = 9 (approximate)
    // Agar query Indian-related hai to genre filter lagao
    const indianKeywords = ["indian", "hindi", "bollywood", "sitar", "tabla",
        "bhangra", "desi", "punjabi", "sufi", "carnatic"];
    const isIndian = indianKeywords.some(k => query?.toLowerCase().includes(k));

    const params = {
        api_key: "60BLHNQCAOUFPIBZ",   // FMA public demo key (read-only, free)
        limit: Math.min(limit, 50),   // FMA max 50 per call
        sort: "track_date_recorded",
    };

    if (query?.trim()) params.search = query.trim();
    if (isIndian) params.genre_id = 9; // World genre

    const { data } = await axios.get(FMA_BASE, { params, timeout: 15000 });
    return (data?.dataset || [])
        .filter(t => t.track_file) // sirf wo tracks jinke paas direct URL hai
        .map(normalizeFMA);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────
async function searchFreeTracks({ query = "", limit = 200 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 200);

    // Teeno providers parallel me chalao — jo bhi fail ho uska error log ho,
    // baaki ke results combine ho jaayein
    const [jamendoResult, pixabayResult, fmaResult] = await Promise.allSettled([
        searchJamendo(query, safeLimit).catch(err => { logProviderError("Jamendo", err); return []; }),
        searchPixabay(query, safeLimit).catch(err => { logProviderError("Pixabay", err); return []; }),
        searchFMA(query, Math.ceil(safeLimit / 2)).catch(err => { logProviderError("FMA", err); return []; }),
    ]);

    const allTracks = [
        ...(jamendoResult.status === "fulfilled" ? jamendoResult.value : []),
        ...(pixabayResult.status === "fulfilled" ? pixabayResult.value : []),
        ...(fmaResult.status === "fulfilled" ? fmaResult.value : []),
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
    console.log(`[musicLibrary] query="${query}" → Jamendo:${jamendoResult.value?.length ?? 0} Pixabay:${pixabayResult.value?.length ?? 0} FMA:${fmaResult.value?.length ?? 0} → total:${final.length}`);

    return final;
}

module.exports = { searchFreeTracks };