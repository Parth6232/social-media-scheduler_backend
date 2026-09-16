const axios = require("axios");

const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID;

// ─────────────────────────────────────────────────────────────────────────────
// KYUN BADLA (purane code ka bug):
//
// Purane code me `durationbetween: "60_90"` ek HARD filter tha. Jamendo pe
// zyadatar tracks 3-5 minute ke hain, to ye filter 95%+ catalog pehle hi kaat
// deta tha. Uske upar search term match karna = Discover tab hamesha khali.
//
// Ab approach ye hai:
//   1. Duration ko filter ki jagah SORT/PREFERENCE banaya — reel-length
//      (~15-120s) tracks upar aate hain, baaki bhi list me rehte hain.
//   2. Jamendo ke 3 alag search modes try karte hain (namesearch / fuzzytags /
//      general search) aur results merge karte hain — ek hi mode se kaafi kam
//      results milte the.
//   3. `type: "single albumtrack"` — singles bhi include, purane code me sirf
//      album tracks aate the (Jamendo ka default).
//   4. limit ab 200 tak (Jamendo ka max) — pehle 30 tha.
//   5. Jamendo fail ho ya khali de to Openverse (WordPress ka CC media search,
//      koi API key nahi chahiye) se fallback — extra lakhs of CC tracks.
// ─────────────────────────────────────────────────────────────────────────────

const JAMENDO_BASE = "https://api.jamendo.com/v3.0/tracks/";
const OPENVERSE_BASE = "https://api.openverse.org/v1/audio/";

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
            include: "musicinfo licenses",
            audioformat: "mp32",
            // singles + album tracks dono — default sirf album tracks deta hai
            type: "single albumtrack",
            imagesize: 200,
            ...params,
        },
        timeout: 12000,
    });
    return (data?.results || []).map(normalizeJamendo);
}

// Jamendo ke multiple search modes — merge karke zyada results milte hain
async function searchJamendo(query, limit) {
    if (!JAMENDO_CLIENT_ID) return [];

    // Khali query = Discover tab pehli baar khulta hai. Popular tracks dikhao
    // taaki user ko khali screen na mile.
    if (!query || !query.trim()) {
        return jamendoRequest({ limit, order: "popularity_month" });
    }

    const q = query.trim();

    // Teeno modes parallel — koi ek fail ho to baaki se kaam chal jaye
    const [byName, byTags, byGeneral] = await Promise.allSettled([
        jamendoRequest({ limit, namesearch: q }),
        jamendoRequest({ limit, fuzzytags: q, order: "popularity_total" }),
        jamendoRequest({ limit, search: q }),
    ]);

    const merged = [];
    for (const r of [byName, byTags, byGeneral]) {
        if (r.status === "fulfilled") merged.push(...r.value);
    }
    return merged;
}

// Fallback provider — koi API key nahi chahiye
async function searchOpenverse(query, limit) {
    const { data } = await axios.get(OPENVERSE_BASE, {
        params: {
            q: query && query.trim() ? query.trim() : "music",
            page_size: Math.min(limit, 20), // Openverse max 20 per page
            license_type: "commercial modification",
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
        console.error("[musicLibrary] Jamendo search failed:", err.message);
    }

    // Jamendo se kuch nahi mila (ya down hai) — Openverse try karo
    if (tracks.length === 0) {
        try {
            tracks = await searchOpenverse(query, safeLimit);
        } catch (err) {
            console.error("[musicLibrary] Openverse fallback failed:", err.message);
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