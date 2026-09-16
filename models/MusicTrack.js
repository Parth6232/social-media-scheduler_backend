const mongoose = require("mongoose");

const musicTrackSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        artist: { type: String },
        category: { type: String, default: "general" },
        publicId: { type: String, required: true }, // Cloudinary public_id
        url: { type: String, required: true },
        duration: { type: Number },
        sourceUrl: { type: String },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
);

module.exports = mongoose.model("MusicTrack", musicTrackSchema);