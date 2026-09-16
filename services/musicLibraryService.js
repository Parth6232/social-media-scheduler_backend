const axios = require("axios");

const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID;

// Jamendo se royalty-free tracks search karta hai. Duration filter ab
// khud (client-side) laga rahe hai kyunki API ka duration-param kabhi
// kabhi strict search ke saath 0 results de deta hai -- ye zyada reliable hai.
async function searchFreeTracks({ query = "", limit = 30 } = {}) {
    const response = await axios.get("https://api.jamendo.com/v3.0/tracks/", {
        params: {
            client_id: JAMENDO_CLIENT_ID,
            format: "json",
            limit: 50, // zyada mangwao taaki duration-filter ke baad bhi kaafi bache
            include: "musicinfo",
            audioformat: "mp32",
            order: "popularity_total",
            search: query || undefined,
        },
    });

    const results = response.data?.results || [];

    const filtered = results
        .filter((t) => t.duration >= 50 && t.duration <= 95)
        .slice(0, limit)
        .map((t) => ({
            externalId: t.id,
            title: t.name,
            artist: t.artist_name,
            duration: t.duration,
            previewUrl: t.audio,
            genre: t.musicinfo?.tags?.genres?.[0] || "general",
        }));

    if (filtered.length === 0) {
        return results.slice(0, limit).map((t) => ({
            externalId: t.id,
            title: t.name,
            artist: t.artist_name,
            duration: t.duration,
            previewUrl: t.audio,
            genre: t.musicinfo?.tags?.genres?.[0] || "general",
        }));
    }

    return filtered;
}

module.exports = { searchFreeTracks };