const mongoose = require("mongoose");
const { POST_RULES } = require("../config/postRules"); // NAYA: enum ab yahin se derive hota hai

const postSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    content: {
      type: String, // caption/text
      required: true,
    },
    mediaUrl: {
      type: String, // image/video ka link (Cloudinary URL)
    },
    // NAYA: postType ka enum ab POST_RULES ke keys se aata hai (feed/text/
    // photo/reel/video/facebookVideo/story) -- pehle sirf ["feed","reel","story"]
    // hardcoded tha jo naye postTypes (text/photo/video/facebookVideo) ke
    // liye save karte hi "Validation failed" de raha tha. Ab dono files
    // hamesha sync rahenge kyunki ek hi source (POST_RULES) se aa rahe hain.
    postType: {
      type: String,
      enum: Object.keys(POST_RULES),
      default: "feed",
    },
    scheduledAt: {
      type: Date,
      required: true,
    },
    status: {
      // NAYA: "partial" add kiya -- jab kuch targets publish ho gaye ho aur
      // kuch fail, tab post "completed" nahi dikhna chahiye (neeche
      // publishPostNow() mein use hota hai)
      type: String,
      enum: ["pending", "processing", "completed", "partial", "failed"],
      default: "pending",
    },
    privacy: {
      type: String,
      enum: ["public", "unlisted", "private"],
      default: "private", // safe default
    },
    targets: [
      {
        platform: {
          type: String,
          enum: ["youtube", "facebook", "instagram", "linkedin", "twitter", "whatsapp"],
          required: true,
        },
        // NAYA: agar user ke facebook/instagram ke multiple pages connected
        // hain, toh yahan us specific page/account ki platformAccountId
        // store hoti hai, taaki publish karte waqt sahi page pe post jaye.
        pageId: { type: String },
        status: {
          type: String,
          enum: ["pending", "published", "failed"],
          default: "pending",
        },
        error: { type: String }, // agar fail ho toh reason yahan store hoga
        publishedUrl: { type: String }, // successful post ka link
        // NAYA: platform ka raw/native post ID (YouTube video id, FB post/
        // video id, IG media id) -- URL se parse karna fragile hai (har
        // postType ka URL format alag hai), isliye publish ke time hi seedha
        // store karte hain. Isi ID se stats (views/likes) fetch honge.
        platformPostId: { type: String },
        views: { type: Number, default: null },
        likes: { type: Number, default: null },
        statsUpdatedAt: { type: Date, default: null },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Post", postSchema);