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
      type: String, // image/video ka link (abhi ke liye simple URL, baad mein file upload add karenge)
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