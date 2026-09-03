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
    accessToken: { type: String, required: true },
    refreshToken: { type: String },
    tokenExpiresAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ConnectedAccount", connectedAccountSchema);    