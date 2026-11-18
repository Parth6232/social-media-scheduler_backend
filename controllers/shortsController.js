const fs = require("fs");
const path = require("path");
const cfg = require("../config/shortsConfig");
const cloudinary = require("../config/cloudinary");
const ShortJob = require("../models/ShortJob");
const { getVideoInfo } = require("../services/shorts/videoSource");
const { enqueue, jobDirOf } = require("../services/shorts/jobRunner");

const ACTIVE = ["queued", "downloading", "transcribing", "analyzing", "rendering"];

const toBool = (v, def) => (v === undefined || v === "" ? def : v === true || v === "true" || v === "1");
const toNum = (v, def, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

function handleError(res, error) {
    if (error.name === "CastError") return res.status(400).json({ message: "Galat ID" });
    res.status(error.status || 500).json({ message: error.message });
}

function fileUrl(req, jobId, name) {
    const base = process.env.BACKEND_URL || `${req.protocol}://${req.get("host")}`;
    return `${base}/api/shorts/files/${jobId}/${name}`;
}

// Frontend ke liye job ko saaf format me badalna (preview/download links ke saath)
function serializeJob(req, job) {
    const j = job.toObject ? job.toObject() : job;
    return {
        id: String(j._id),
        videoId: j.videoId,
        videoTitle: j.videoTitle,
        channelTitle: j.channelTitle,
        thumbnail: j.thumbnail,
        authorizedBy: j.authorizedBy,
        options: { ...j.options, voiceoverFile: undefined, hasVoiceover: !!(j.options && j.options.voiceoverFile) },
        status: j.status,
        progress: j.progress,
        stage: j.stage,
        error: j.error,
        warning: j.warning,
        createdAt: j.createdAt,
        clips: (j.clips || []).map((c) => ({
            index: c.index,
            start: c.start,
            end: c.end,
            duration: c.duration,
            title: c.title,
            reason: c.reason,
            layout: c.layout,
            sizeBytes: c.sizeBytes,
            previewUrl: fileUrl(req, j._id, c.file.replace(/^out\//, "")),
            thumbUrl: fileUrl(req, j._id, c.thumb.replace(/^out\//, "")),
            downloadPath: `/api/shorts/jobs/${j._id}/clips/${c.index}/download`,
        })),
    };
}

// POST /api/shorts/source-info   Body: { url }
// Title + channel automatically fetch + batata hai ki video use karne ki permission hai ya nahi
exports.sourceInfo = async (req, res) => {
    try {
        const info = await getVideoInfo(req.userId, req.body.url);
        res.json(info);
    } catch (e) {
        handleError(res, e);
    }
};

async function createJobFrom(req, { url, options, voiceoverFileName }) {
    const info = await getVideoInfo(req.userId, url);
    // Authorization check removed: kisi bhi YouTuber ki video se Shorts ban sakti hai
    if (info.durationSec > cfg.MAX_VIDEO_MINUTES * 60) {
        const e = new Error(`Video bahut lambi hai. Max ${cfg.MAX_VIDEO_MINUTES} minute allowed hai.`);
        e.status = 400;
        throw e;
    }
    const active = await ShortJob.findOne({ userId: req.userId, status: { $in: ACTIVE } });
    if (active) {
        const e = new Error("Aapka ek job pehle se chal raha hai. Use khatam hone do.");
        e.status = 409;
        throw e;
    }

    const job = await ShortJob.create({
        userId: req.userId,
        videoId: info.videoId,
        sourceUrl: `https://www.youtube.com/watch?v=${info.videoId}`,
        videoTitle: info.title,
        channelTitle: info.channelTitle,
        channelId: info.channelId,
        thumbnail: info.thumbnail,
        videoDurationSec: info.durationSec,
        authorizedBy: info.authorizedBy,
        options,
    });
    return job;
}

// POST /api/shorts/jobs   (multipart/form-data)
// Fields: url, facecamCrop, captions, originalAudio, musicTrackId, musicVolume,
//         voiceoverVolume, minSec, maxSec  + optional file: voiceover
exports.createJob = async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ message: "YouTube link zaroori hai" });

        const originalAudio = toBool(req.body.originalAudio, true);
        const hasMusic = !!req.body.musicTrackId;
        const minSec = toNum(req.body.minSec, cfg.DEFAULT_MIN_SEC, 10, cfg.HARD_MAX_SEC - 10);
        const maxSec = toNum(req.body.maxSec, cfg.DEFAULT_MAX_SEC, minSec + 5, cfg.HARD_MAX_SEC);

        const options = {
            facecamCrop: toBool(req.body.facecamCrop, false),
            captions: toBool(req.body.captions, true),
            originalAudio,
            musicTrackId: hasMusic ? String(req.body.musicTrackId) : null,
            musicVolume: toNum(req.body.musicVolume, originalAudio ? 25 : 70, 0, 100),
            voiceoverVolume: toNum(req.body.voiceoverVolume, 100, 0, 200),
            minSec,
            maxSec,
        };

        const job = await createJobFrom(req, { url, options });

        // Custom voiceover file save karo (agar di ho)
        if (req.file) {
            const dir = jobDirOf(job._id);
            fs.mkdirSync(dir, { recursive: true });
            const ext = (path.extname(req.file.originalname) || ".mp3").replace(/[^.\w]/g, "").slice(0, 6);
            const name = `voiceover${ext}`;
            fs.writeFileSync(path.join(dir, name), req.file.buffer);
            job.options = { ...job.options, voiceoverFile: name };
            job.markModified("options");
            await job.save();
        }

        enqueue(job._id);
        res.status(201).json(serializeJob(req, job));
    } catch (e) {
        handleError(res, e);
    }
};

// POST /api/shorts/jobs/:id/regenerate  — wahi settings, naye (alag) timestamps
exports.regenerate = async (req, res) => {
    try {
        const old = await ShortJob.findOne({ _id: req.params.id, userId: req.userId });
        if (!old) return res.status(404).json({ message: "Job nahi mila" });

        const job = await createJobFrom(req, { url: old.sourceUrl, options: old.options });

        // purana voiceover (agar tha) copy karo
        const vf = old.options && old.options.voiceoverFile;
        if (vf && fs.existsSync(path.join(jobDirOf(old._id), vf))) {
            const dir = jobDirOf(job._id);
            fs.mkdirSync(dir, { recursive: true });
            fs.copyFileSync(path.join(jobDirOf(old._id), vf), path.join(dir, vf));
        } else if (vf) {
            job.options = { ...job.options, voiceoverFile: null };
            job.markModified("options");
            await job.save();
        }

        enqueue(job._id);
        res.status(201).json(serializeJob(req, job));
    } catch (e) {
        handleError(res, e);
    }
};

// GET /api/shorts/jobs/:id   (frontend isse har 2-3 second me poll kare)
exports.getJob = async (req, res) => {
    try {
        const job = await ShortJob.findOne({ _id: req.params.id, userId: req.userId });
        if (!job) return res.status(404).json({ message: "Job nahi mila" });
        res.json(serializeJob(req, job));
    } catch (e) {
        handleError(res, e);
    }
};

// GET /api/shorts/jobs
exports.listJobs = async (req, res) => {
    try {
        const jobs = await ShortJob.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(20);
        res.json(jobs.map((j) => serializeJob(req, j)));
    } catch (e) {
        handleError(res, e);
    }
};

// DELETE /api/shorts/jobs/:id
exports.deleteJob = async (req, res) => {
    try {
        const job = await ShortJob.findOne({ _id: req.params.id, userId: req.userId });
        if (!job) return res.status(404).json({ message: "Job nahi mila" });
        if (ACTIVE.includes(job.status)) return res.status(409).json({ message: "Chalte hue job ko delete nahi kar sakte" });
        fs.rmSync(jobDirOf(job._id), { recursive: true, force: true });
        await job.deleteOne();
        res.json({ message: "Delete ho gaya" });
    } catch (e) {
        handleError(res, e);
    }
};

async function findClip(req) {
    const job = await ShortJob.findOne({ _id: req.params.id, userId: req.userId });
    if (!job) return {};
    const clip = job.clips.find((c) => c.index === Number(req.params.index));
    return { job, clip };
}

// GET /api/shorts/jobs/:id/clips/:index/download   (auth ke saath)
exports.downloadClip = async (req, res) => {
    try {
        const { job, clip } = await findClip(req);
        if (!clip) return res.status(404).json({ message: "Clip nahi mili" });
        const file = path.join(jobDirOf(job._id), "out", path.basename(clip.file));
        if (!fs.existsSync(file)) return res.status(410).json({ message: "Clip file delete ho chuki hai, dobara generate karo" });
        res.download(file, `postpilot_short_${clip.index}.mp4`);
    } catch (e) {
        handleError(res, e);
    }
};

// POST /api/shorts/jobs/:id/clips/:index/to-post
// PostPilot publishing integration: clip ko Cloudinary par daalta hai aur Create Post ke liye
// ready data deta hai (mediaUrl/mediaType/mediaDuration — createPost yahi fields leta hai).
// Body (optional): { includeCredit: false }  — credit line hatane ke liye
exports.clipToPost = async (req, res) => {
    try {
        const { job, clip } = await findClip(req);
        if (!clip) return res.status(404).json({ message: "Clip nahi mili" });

        let url = clip.cloudinaryUrl;
        if (!url) {
            const file = path.join(jobDirOf(job._id), "out", path.basename(clip.file));
            if (!fs.existsSync(file)) return res.status(410).json({ message: "Clip file delete ho chuki hai, dobara generate karo" });
            const up = await cloudinary.uploader.upload(file, { resource_type: "video", folder: "socialblitz_shorts" });
            url = up.secure_url;
            clip.cloudinaryUrl = url;
            clip.cloudinaryPublicId = up.public_id;
            await job.save();
        }

        // includeCredit: default true; false bhejo to credit line nahi aayegi
        const includeCredit = toBool(req.body && req.body.includeCredit, true);
        const creditLine = includeCredit
            ? `\n\nCredit: ${job.channelTitle} — https://youtu.be/${job.videoId}`
            : "";
        const suggestedCaption = `${clip.title}${creditLine}\n\n#shorts`;

        res.json({
            mediaUrl: url,
            mediaType: "video",
            mediaDuration: clip.duration,
            postType: "reel",
            suggestedCaption,
            includeCredit,
        });
    } catch (e) {
        handleError(res, e);
    }
};

// GET /api/shorts/files/:jobId/:file   (public, <video src> ke liye; jobId unguessable hai)
exports.serveFile = (req, res) => {
    const { jobId, file } = req.params;
    if (!/^[a-f0-9]{24}$/.test(jobId) || !/^clip_\d+\.(mp4|jpg)$/.test(file)) return res.sendStatus(404);
    const p = path.join(jobDirOf(jobId), "out", file);
    if (!fs.existsSync(p)) return res.sendStatus(404);
    res.sendFile(p);
};