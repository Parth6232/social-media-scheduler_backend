// Pura pipeline: download -> transcribe -> best moments -> (facecam) -> render 3 clips.
// Heavy kaam hai (local CPU), isliye ek time par sirf ek job chalta hai (queue).
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { pipeline } = require("stream/promises");
const cfg = require("../../config/shortsConfig");
const ShortJob = require("../../models/ShortJob");
const MusicTrack = require("../../models/MusicTrack");
const { prepareSource } = require("./downloader");
const { getTranscript } = require("./transcriber");
const { pickMoments } = require("./momentPicker");
const { detectFace } = require("./facecam");
const { renderClip } = require("./renderer");

const jobDirOf = (id) => path.join(cfg.JOBS_DIR, String(id));

const queue = [];
let running = false;

function enqueue(jobId) {
    queue.push(String(jobId));
    pump();
}

async function pump() {
    if (running) return;
    running = true;
    while (queue.length) {
        const id = queue.shift();
        try {
            await runJob(id);
        } catch (e) {
            console.error("[Shorts] Job fail:", e.message);
            await ShortJob.updateOne({ _id: id }, { $set: { status: "failed", stage: "Fail ho gaya", error: e.message } });
        }
    }
    running = false;
}

function reporter(jobId) {
    let last = -10;
    return async (status, progress, stage) => {
        const p = Math.round(progress);
        if (status === "keep" || Math.abs(p - last) < 2) return;
        last = p;
        await ShortJob.updateOne({ _id: jobId }, { $set: { status, progress: p, stage } });
    };
}

async function downloadMusic(trackId, userId, dir) {
    const track = await MusicTrack.findById(trackId);
    if (!track || (track.userId && String(track.userId) !== String(userId))) {
        throw new Error("Music track nahi mila");
    }
    const file = path.join(dir, "music.mp3");
    const res = await axios.get(track.url, { responseType: "stream" });
    await pipeline(res.data, fs.createWriteStream(file));
    return file;
}

async function runJob(jobId) {
    const job = await ShortJob.findById(jobId);
    if (!job) return;
    const opts = job.options || {};
    const jobDir = jobDirOf(jobId);
    const outDir = path.join(jobDir, "out");
    fs.mkdirSync(outDir, { recursive: true });
    const report = reporter(jobId);
    await ShortJob.updateOne({ _id: jobId }, { $set: { error: null, clips: [] } });

    // 1) Download
    await report("downloading", 3, "Video download ho rahi hai");
    const src = await prepareSource(job.videoId, (p) => report("downloading", 3 + p * 30, "Video download ho rahi hai"));

    // 2) Transcript (Whisper)
    await report("transcribing", 34, "Transcript ban raha hai (Whisper)");
    const transcript = await getTranscript(src.dir, src.audioPath, (p) => report("transcribing", 34 + p * 20, "Transcript ban raha hai (Whisper)"));

    // 3) Best moments (Gemini) — pehle ke generations ko avoid karta hai
    await report("analyzing", 56, "AI best moments dhoondh raha hai");
    const prev = await ShortJob.find({ userId: job.userId, videoId: job.videoId, status: "done", _id: { $ne: job._id } }).select("clips");
    const history = prev.flatMap((j) => j.clips.map((c) => ({ start: c.start, end: c.end })));
    const { moments, warning } = await pickMoments({
        transcript,
        videoDuration: src.meta.duration,
        videoTitle: job.videoTitle,
        minSec: opts.minSec,
        maxSec: opts.maxSec,
        history,
    });
    if (warning) await ShortJob.updateOne({ _id: jobId }, { $set: { warning } });

    // Audio files
    let musicFile = null;
    if (opts.musicTrackId) musicFile = await downloadMusic(opts.musicTrackId, job.userId, jobDir);
    const voiceFile = opts.voiceoverFile ? path.join(jobDir, opts.voiceoverFile) : null;

    // 4) Render har clip
    const isDirectUpload = job.sourceUrl === "uploaded_file" || job.channelTitle === "Uploaded Video";
    const credit = isDirectUpload ? "" : `Credit: ${job.channelTitle}`;
    for (let i = 0; i < moments.length; i++) {
        const m = moments[i];
        const base = 62 + (i / moments.length) * 36;
        await report("rendering", base, `Clip ${i + 1}/${moments.length} ban rahi hai`);

        let face = null;
        if (opts.facecamCrop) face = await detectFace(src.videoPath, m.start, m.end, outDir, i + 1);

        const r = await renderClip({
            sourceVideo: src.videoPath,
            meta: src.meta,
            clip: m,
            outDir,
            index: i + 1,
            options: opts,
            credit,
            transcript,
            musicFile,
            voiceFile: voiceFile && fs.existsSync(voiceFile) ? voiceFile : null,
            face,
        });

        await ShortJob.updateOne(
            { _id: jobId },
            {
                $push: {
                    clips: {
                        index: i + 1,
                        start: Math.round(m.start * 10) / 10,
                        end: Math.round(m.end * 10) / 10,
                        duration: Math.round((m.end - m.start) * 10) / 10,
                        title: m.title,
                        reason: m.reason,
                        layout: r.layout,
                        file: r.file,
                        thumb: r.thumb,
                        sizeBytes: r.sizeBytes,
                    },
                },
            }
        );
    }

    if (musicFile) fs.rmSync(musicFile, { force: true });
    await ShortJob.updateOne({ _id: jobId }, { $set: { status: "done", progress: 100, stage: "Ho gaya!" } });
}

// Server restart hone par adhoora job hamesha ke liye "processing" na dikhe
async function recoverStaleJobs() {
    await ShortJob.updateMany(
        { status: { $in: ["queued", "downloading", "transcribing", "analyzing", "rendering"] } },
        { $set: { status: "failed", stage: "Fail ho gaya", error: "Server restart hua, dobara generate karo" } }
    );
}

// Purani cache / purane job files delete (disk bharne se bachne ke liye)
function cleanupOld() {
    const sweep = (dir, maxAgeMs) => {
        if (!fs.existsSync(dir)) return;
        for (const name of fs.readdirSync(dir)) {
            const p = path.join(dir, name);
            try {
                if (Date.now() - fs.statSync(p).mtimeMs > maxAgeMs) fs.rmSync(p, { recursive: true, force: true });
            } catch { /* ignore */ }
        }
    };
    sweep(cfg.CACHE_DIR, cfg.CACHE_HOURS * 3600 * 1000);
    sweep(cfg.JOBS_DIR, cfg.KEEP_JOB_DAYS * 24 * 3600 * 1000);
}

function startShortsMaintenance() {
    fs.mkdirSync(cfg.CACHE_DIR, { recursive: true });
    fs.mkdirSync(cfg.JOBS_DIR, { recursive: true });
    recoverStaleJobs().catch((e) => console.error("[Shorts] recover fail:", e.message));
    cleanupOld();
    setInterval(cleanupOld, 60 * 60 * 1000).unref();
}

module.exports = { enqueue, jobDirOf, startShortsMaintenance };
