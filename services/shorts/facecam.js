const fs = require("fs");
const path = require("path");
const cfg = require("../../config/shortsConfig");
const { run } = require("./runCommand");

// Clip ke time range me face dhoondta hai. Fail ho jaye to null (clip phir bhi center-crop se ban jayega).
async function detectFace(videoPath, start, end, tmpDir, index) {
    const out = path.join(tmpDir, `face_${index}.json`);
    try {
        await run(cfg.PYTHON, [
            path.join(__dirname, "python", "detect_facecam.py"),
            videoPath, String(start), String(end), out,
        ]);
        const r = JSON.parse(fs.readFileSync(out, "utf8"));
        return r.found ? r : null;
    } catch (e) {
        console.warn("[Shorts] Face detection skip hui:", e.message);
        return null;
    }
}

module.exports = { detectFace };
