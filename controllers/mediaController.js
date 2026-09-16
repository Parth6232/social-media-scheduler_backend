const cloudinary = require("../config/cloudinary");
const MusicTrack = require("../models/MusicTrack");
const { EDIT_FILTERS } = require("../config/editRules");

function uploadBufferToCloudinary(buffer, resourceType, folder) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { resource_type: resourceType, folder },
            (error, result) => (error ? reject(error) : resolve(result))
        );
        stream.end(buffer);
    });
}

// STEP 1: Raw media Cloudinary pe upload karo (post create NAHI hoti abhi,
// sirf edit-screen ke liye file upload hoti hai)
exports.uploadMedia = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Media file zaroori hai" });
        const isVideo = req.file.mimetype.startsWith("video/");
        const result = await uploadBufferToCloudinary(
            req.file.buffer,
            isVideo ? "video" : "image",
            "socialblitz_raw"
        );
        res.status(201).json({
            publicId: result.public_id,
            resourceType: isVideo ? "video" : "image",
            url: result.secure_url,
            duration: result.duration || null,
            width: result.width,
            height: result.height,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Filter list frontend ko dene ke liye (carousel banane me kaam aayega)
exports.getFilters = (req, res) => {
    res.json(Object.keys(EDIT_FILTERS));
};

// Music library list
exports.getMusicTracks = async (req, res) => {
    try {
        const tracks = await MusicTrack.find().sort({ createdAt: -1 });
        res.json(tracks);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Manual endpoint — tum khud isse call karke apne music tracks add karoge
exports.addMusicTrack = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Audio file zaroori hai" });
        // NOTE: Cloudinary me audio bhi "video" resource_type ke andar hi aata hai
        const result = await uploadBufferToCloudinary(req.file.buffer, "video", "socialblitz_music");
        const track = await MusicTrack.create({
            title: req.body.title || req.file.originalname,
            artist: req.body.artist,
            category: req.body.category || "general",
            publicId: result.public_id,
            url: result.secure_url,
            duration: result.duration,
        });
        res.status(201).json(track);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// STEP 2: Trim + filter + music ko combine karke final edited URL banata hai.
// Koi heavy processing nahi — Cloudinary transformation URL se on-the-fly
// render karta hai jab pehli baar access hoti hai.
exports.buildEditedUrl = async (req, res) => {
    try {
        const { publicId, resourceType, trimStart, trimEnd, filter, musicPublicId } = req.body;
        if (!publicId || !resourceType) {
            return res.status(400).json({ message: "publicId aur resourceType zaroori hain" });
        }

        const transformation = [];

        if (resourceType === "video" && (trimStart !== undefined || trimEnd !== undefined)) {
            const trim = {};
            if (trimStart !== undefined) trim.start_offset = trimStart;
            if (trimEnd !== undefined) trim.end_offset = trimEnd;
            transformation.push(trim);
        }

        if (filter && EDIT_FILTERS[filter]) {
            transformation.push({ raw_transformation: EDIT_FILTERS[filter] });
        }

        if (resourceType === "video" && musicPublicId) {
            transformation.push({
                overlay: { resource_type: "video", public_id: musicPublicId },
                flags: "layer_apply",
            });
        }

        const finalUrl = cloudinary.url(publicId, {
            resource_type: resourceType,
            transformation,
            secure: true,
        });

        res.json({ url: finalUrl });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};