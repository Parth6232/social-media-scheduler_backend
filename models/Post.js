const mongoose = require("mongoose");

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
    // NAYA: post kis "type" ka hai -- isi se decide hota hai ki konse
    // platforms allowed hain aur konsa publish-flow (reel/story/normal) use hoga.
    // "feed" = purana normal behaviour (photo/video/text post).
    postType: {
      type: String,
      enum: ["feed", "reel", "story"],
      default: "feed",
    },
    scheduledAt: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
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
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Post", postSchema);