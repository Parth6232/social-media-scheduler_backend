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
//
// BUG FIX: pehle `MusicTrack.find()` SAARE users ke tracks laata tha — koi
// filter hi nahi tha. Matlab agar koi user apna personal audio upload karta,
// to wo har doosre user ki "My Library" me bhi dikhta (privacy leak). Spec
// yehi tha ki sirf shared tracks (userId: null) + apne khud ke (userId match)
// dikhne chahiye.
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

// Manual upload endpoint (jaisa pehle tha) — admin-style, UI me expose nahi
// karna. userId set nahi karte, isliye ye track sabko "shared" dikhta hai.
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

// NAYA (missing tha, isi wajeh se deploy crash ho raha tha): user apne
// device se khud ka audio upload kare. routes/mediaRoutes.js pehle se hi
// isko import kar raha tha, lekin ye function kabhi banaya hi nahi gaya tha —
// isliye `uploadUserAudio` undefined tha aur Express boot hote hi crash ho
// jaata tha ("argument handler must be a function").
//
// addMusicTrack se fark: yahan userId set karte hain, taaki ye track sirf
// usi user ki "My Library" me dikhe, sabko nahi (dekho getMusicTracks upar).
exports.uploadUserAudio = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Audio file zaroori hai" });
        const result = await uploadBufferToCloudinary(req.file.buffer, "video", "socialblitz_music");
        const track = await MusicTrack.create({
            title: req.body.title || req.file.originalname.replace(/\.[^/.]+$/, ""),
            artist: req.body.artist || "You",
            category: req.body.category || "personal",
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

// Final video kitni lambi hogi — trim + speed dono ka asar milakar.
// Ye music layer ki `du_` (duration) set karne ke liye chahiye, taaki gaana
// exactly video ke saath khatam ho, na pehle na baad me.
function computeOutputDuration({ trimStart, trimEnd, speed }) {
    if (trimStart === undefined || trimEnd === undefined) return null;
    const clipLength = Number(trimEnd) - Number(trimStart);
    if (!Number.isFinite(clipLength) || clipLength <= 0) return null;

    // e_accelerate:100 => 2x tez => aadhi duration
    // e_accelerate:-50 => 0.5x => dugni duration
    const s = Number(speed) || 0;
    const rate = 1 + s / 100;
    if (rate <= 0) return clipLength;

    return clipLength / rate;
}

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
            // NAYA: gaane ka kaunsa hissa use karna hai (Instagram/Kinemaster style).
            // Reel max ~90s hoti hai lekin gaana 3-5 min ka hota hai, isliye user
            // ko gaane ka koi bhi portion chunne dena zaroori hai.
            musicStartOffset,   // seconds — gaane me se kahan se shuru karein
            musicVolume,        // 0-200, sirf music layer pe (base video se alag)
            replaceOriginalAudio, // true = video ka original audio hata do
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

        // Original audio poori tarah hata do (Instagram ka "replace audio").
        // Music overlay se PEHLE aana zaroori hai, warna music bhi mit jayega.
        if (isVideo && replaceOriginalAudio && musicPublicId) {
            transformation.push({ audio_codec: "none" });
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
        //
        // Cloudinary docs: audio layer pe so_/eo_/du_ qualifiers `fl_layer_apply`
        // wale component me jaate hain (e.g. `fl_layer_apply,so_45,du_30`), na ki
        // `l_video:` wale component me. Isliye overlay definition aur layer_apply
        // ko do alag components me todna padta hai — purane code me dono ek hi
        // object me the, jiski wajeh se offset lagana possible hi nahi tha.
        if (isVideo && musicPublicId) {
            // Layer 1: overlay definition (khulta bracket)
            const musicLayer = {
                overlay: { resource_type: "video", public_id: musicPublicId },
            };
            // Music ka apna volume, base video ke volume se independent
            if (musicVolume !== undefined && Number(musicVolume) !== 100) {
                musicLayer.effect = `volume:${musicVolume}`;
            }
            transformation.push(musicLayer);

            // Layer 2: layer_apply + timing qualifiers (band hota bracket)
            const applyMusic = { flags: "layer_apply" };

            // so_ = gaane me se kahan se sample lena hai
            if (musicStartOffset !== undefined && Number(musicStartOffset) > 0) {
                applyMusic.start_offset = Number(musicStartOffset);
            }

            // du_ = kitni der ka sample chahiye. Ise final video ki length ke
            // barabar rakhte hain taaki music theek video ke saath khatam ho.
            const outputDuration = computeOutputDuration({ trimStart, trimEnd, speed });
            if (outputDuration) {
                applyMusic.duration = Number(outputDuration.toFixed(2));
            }

            transformation.push(applyMusic);
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