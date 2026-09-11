// YE FILE EK HI JAGAH HAI JAHAN SE HUM DECIDE KARTE HAIN:
// - har postType (reel / feed / story) ke liye konse platforms allowed hain
// - konsa media type chahiye (image/video/both)
// - duration/size ki limits kya hain
//
// Frontend isi tarah ka ek copy use karega taaki UI mein bhi same
// warnings/restrictions dikhein (translations.js ke 3 languages mein).
// Backend yahan se validate karega taaki galat combination save hi na ho.

const POST_RULES = {
    // "feed" = purana free-choice behaviour: text-only, image, ya video --
    // jo bhi platform allow kare. Koi hard restriction nahi, isliye
    // requiresMedia false aur mediaType "both" rakha hai. Agar kisi
    // platform ko us content ke saath problem hogi (jaise Instagram
    // text-only reject karta hai), wo publish-time par per-platform
    // error dikhayega, jaisa abhi already ho raha hai.
    feed: {
        label: "Post",
        allowedPlatforms: ["youtube", "instagram", "facebook"],
        mediaType: "both",
        requiresMedia: false,
    },
    text: {
        label: "Text Post",
        allowedPlatforms: ["facebook"],
        mediaType: "none",
        requiresMedia: false,
    },
    reel: {
        label: "Reel",
        allowedPlatforms: ["youtube", "instagram", "facebook"],
        mediaType: "video", // sirf video chalega
        maxDurationSeconds: 90, // IG/FB Reels API cap. YouTube Shorts alag hai (~180s) lekin safe side 90 rakha
        requiresMedia: true,
    },
    photo: {
        label: "Photo Post",
        allowedPlatforms: ["instagram", "facebook"],
        mediaType: "image", // sirf image chalega
        requiresMedia: true,
    },
    video: {
        label: "Long Video",
        allowedPlatforms: ["youtube"],
        mediaType: "video",
        requiresMedia: true,
        // YouTube ke liye practically koi hard cap nahi (account verified hone par 12hr tak)
    },
    facebookVideo: {
        label: "Facebook Video",
        allowedPlatforms: ["facebook"],
        mediaType: "video",
        requiresMedia: true,
    },
    story: {
        label: "Story",
        allowedPlatforms: ["instagram", "facebook"],
        mediaType: "both", // image ya video dono chalega
        maxDurationSeconds: 60, // FB video story cap; IG bhi effectively isi range mein
        requiresMedia: true,
    },
};

// Helper: diya gaya postType + platform combination valid hai ya nahi
function isPlatformAllowed(postType, platform) {
    const rule = POST_RULES[postType];
    if (!rule) return false;
    return rule.allowedPlatforms.includes(platform);
}

// Helper: media (image/video) is postType ke liye sahi type ka hai ya nahi
function isMediaTypeValid(postType, isVideoFile) {
    const rule = POST_RULES[postType];
    if (!rule) return false;
    if (rule.mediaType === "none") return false;
    if (rule.mediaType === "both") return true;
    if (rule.mediaType === "video") return isVideoFile;
    if (rule.mediaType === "image") return !isVideoFile;
    return false;
}

module.exports = { POST_RULES, isPlatformAllowed, isMediaTypeValid };