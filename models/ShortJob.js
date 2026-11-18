const mongoose = require("mongoose");

const clipSchema = new mongoose.Schema(
    {
        index: Number,
        start: Number,
        end: Number,
        duration: Number,
        title: String,
        reason: String,
        layout: String, // center | follow_face | facecam_split
        file: String,   // out/clip_1.mp4
        thumb: String,  // out/clip_1.jpg
        sizeBytes: Number,
        cloudinaryUrl: String, // publish ke liye ek baar upload hone ke baad yahan save
        cloudinaryPublicId: String,
    },
    { _id: false }
);

const shortJobSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        videoId: { type: String, required: true },
        sourceUrl: String,
        videoTitle: String,
        channelTitle: String,
        channelId: String,
        thumbnail: String,
        videoDurationSec: Number,
        authorizedBy: { type: String, enum: ["owner", "creative_commons", "any_video"], default: "any_video" },

        options: { type: mongoose.Schema.Types.Mixed, default: {} },

        status: {
            type: String,
            enum: ["queued", "downloading", "transcribing", "analyzing", "rendering", "done", "failed"],
            default: "queued",
        },
        progress: { type: Number, default: 0 },
        stage: { type: String, default: "Queue me hai" },
        error: String,
        warning: String,

        clips: [clipSchema],
    },
    { timestamps: true }
);

shortJobSchema.index({ userId: 1, videoId: 1 });

module.exports = mongoose.model("ShortJob", shortJobSchema);