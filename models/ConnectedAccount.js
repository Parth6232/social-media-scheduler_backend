const mongoose = require("mongoose");

const connectedAccountSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    platform: {
      type: String,
      enum: ["youtube", "facebook", "instagram", "linkedin", "twitter", "whatsapp"],
      required: true,
    },
    platformAccountId: { type: String },
    displayName: { type: String },
    // NAYA: connected account ki profile/page/channel picture ka URL --
    // Accounts page par name ke aage dikhane ke liye
    profilePictureUrl: { type: String },
    accessToken: { type: String, required: true },
    refreshToken: { type: String },
    tokenExpiresAt: { type: Date },
  },
  { timestamps: true }
);

// NAYA: pehle sirf { userId, platform } ka ek record ban sakta tha, isliye
// dusra Facebook page connect karte hi pehla wala overwrite ho jata tha.
// Ab uniqueness { userId, platform, platformAccountId } par hai, isliye
// ek user ke multiple Facebook pages (ya multiple Instagram business
// accounts) alag-alag documents ke roop mein save ho sakte hain.
connectedAccountSchema.index(
  { userId: 1, platform: 1, platformAccountId: 1 },
  { unique: true }
);

module.exports = mongoose.model("ConnectedAccount", connectedAccountSchema);