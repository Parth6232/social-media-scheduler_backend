const cloudinary = require("../config/cloudinary");
const MusicTrack = require("../models/MusicTrack");
const { EDIT_FILTERS } = require("../config/editRules");
const { WATERMARK_PUBLIC_ID } = require("../config/watermark");
const { searchFreeTracks } = require("../services/musicLibraryService");

function uploadBufferToCloudinary(buffer, resourceType, folder) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { resource_type: resourceType, folder },
            (error, result) => (error ? reject(error) : resolve(result))
        );
        stream.end(buffer);
    });
}

// STEP 1: Raw media Cloudinary pe upload karo
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

exports.getFilters = (req, res) => {
    res.json(Object.keys(EDIT_FILTERS));
};

// Apne khud ke DB me saved tracks (manually uploaded + Jamendo se import hue)
exports.getMusicTracks = async (req, res) => {
    try {
        const tracks = await MusicTrack.find({
            $or: [{ userId: null }, { userId: req.userId }],
        }).sort({ createdAt: -1 });
        res.json(tracks);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Manual upload endpoint (jaisa pehle tha)
exports.addMusicTrack = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Audio file zaroori hai" });
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

// NAYA: User apne device se khud ka audio upload kare (jaisa Insta/Snapchat/
// Kinemaster me "add your own sound" hota hai). Ye sirf isi user ko dikhega.
exports.uploadUserAudio = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Audio file zaroori hai" });
        const result = await uploadBufferToCloudinary(req.file.buffer, "video", "socialblitz_user_audio");
        const track = await MusicTrack.create({
            title: req.body.title || req.file.originalname,
            artist: "You",
            category: "my_upload",
            publicId: result.public_id,
            url: result.secure_url,
            duration: result.duration,
            userId: req.userId,
        });
        res.status(201).json(track);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
// NAYA: Free music library (Jamendo) search — user ko results dikhao
exports.searchFreeMusic = async (req, res) => {
    try {
        const { q } = req.query;
        const tracks = await searchFreeTracks({ query: q });
        res.json(tracks);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// NAYA: User jab free library se ek track select kare, use apne Cloudinary
// account me ek baar import karo (taaki baad me overlay transformation me
// use ho sake — Cloudinary overlay sirf apne account ke assets pe chalta hai)
exports.importFreeTrack = async (req, res) => {
    try {
        const { previewUrl, title, artist, genre, duration } = req.body;
        if (!previewUrl) return res.status(400).json({ message: "previewUrl zaroori hai" });

        const existing = await MusicTrack.findOne({ sourceUrl: previewUrl });
        if (existing) return res.json(existing);

        const result = await cloudinary.uploader.upload(previewUrl, {
            resource_type: "video", // audio bhi Cloudinary me "video" resource type
            folder: "socialblitz_music",
        });

        const track = await MusicTrack.create({
            title,
            artist,
            category: genre || "general",
            publicId: result.public_id,
            url: result.secure_url,
            duration: result.duration || duration,
            sourceUrl: previewUrl,
        });

        res.status(201).json(track);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// STEP 2: Trim + speed + volume + aspect-ratio + rotate + filter + music +
// watermark — sab ek hi transformation chain me combine ho jaate hai
exports.buildEditedUrl = async (req, res) => {
    try {
        const {
            publicId,
            resourceType,
            trimStart,
            trimEnd,
            speed,        // -50 (slow) se 100 (fast), 0 = normal
            volume,        // 0 = mute, 100 = normal, 200 = double
            aspectRatio,   // "9:16", "1:1", "16:9", "4:5"
            rotate,        // degrees: 90, 180, 270, -90
            flip,          // "horizontal" | "vertical"
            filter,
            musicPublicId,
        } = req.body;

        if (!publicId || !resourceType) {
            return res.status(400).json({ message: "publicId aur resourceType zaroori hain" });
        }

        const transformation = [];
        const isVideo = resourceType === "video";

        // Trim
        if (isVideo && (trimStart !== undefined || trimEnd !== undefined)) {
            const trim = {};
            if (trimStart !== undefined) trim.start_offset = trimStart;
            if (trimEnd !== undefined) trim.end_offset = trimEnd;
            transformation.push(trim);
        }

        // Speed (slow-mo / fast-forward)
        if (isVideo && speed !== undefined && Number(speed) !== 0) {
            transformation.push({ effect: `accelerate:${speed}` });
        }

        // Volume / mute
        if (isVideo && volume !== undefined) {
            transformation.push({ effect: `volume:${volume}` });
        }

        // Aspect ratio crop (Reels ke liye 9:16 jaisa)
        if (aspectRatio) {
            transformation.push({ aspect_ratio: aspectRatio, crop: "fill", gravity: "auto" });
        }

        // Rotate
        if (rotate) {
            transformation.push({ angle: rotate });
        }

        // Flip
        if (flip === "horizontal") {
            transformation.push({ effect: "hflip" });
        } else if (flip === "vertical") {
            transformation.push({ effect: "vflip" });
        }

        // Filter
        if (filter && EDIT_FILTERS[filter]) {
            transformation.push({ raw_transformation: EDIT_FILTERS[filter] });
        }

        // Music overlay
        if (isVideo && musicPublicId) {
            transformation.push({
                overlay: { resource_type: "video", public_id: musicPublicId },
                flags: "layer_apply",
            });
        }

        // Watermark (hamesha last, hamesha on)
        if (WATERMARK_PUBLIC_ID) {
            transformation.push({
                overlay: { resource_type: "image", public_id: WATERMARK_PUBLIC_ID },
                width: 0.18,
                flags: "relative",
                opacity: 80,
                gravity: "south_east",
                x: 15,
                y: 15,
            });
            transformation.push({ flags: "layer_apply" });
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