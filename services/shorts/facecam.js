// Facecam detection: video ke ek frame se chehra dhoondho aur crop region return karo.
// Face detection ke liye ffmpeg + OpenCV (Python) ya simple center-crop fallback use karta hai.
// Agar FACE_DETECT_ENABLED=false hai, ya OpenCV nahi hai, to center-crop ho jata hai.
const fs   = require("fs");
const path = require("path");
const cfg  = require("../../config/shortsConfig");
const { capture } = require("./runCommand");

/**
 * Video ke diye hue timestamp se ek frame extract karo aur face region detect karo.
 * @param {string} videoPath  - source video file
 * @param {number} startSec   - clip start time (file time, renderOffset already applied)
 * @param {number} endSec     - clip end time
 * @param {string} outDir     - scratch directory
 * @param {number} index      - clip index (for unique filenames)
 * @returns {Promise<{ x, y, w, h } | null>}  face crop region (null = no face / disabled)
 */
async function detectFace(videoPath, startSec, endSec, outDir, index) {
    if (process.env.FACE_DETECT_ENABLED === "false") return null;

    const midSec  = (startSec + endSec) / 2;
    const frame   = path.join(outDir, `face_frame_${index}.jpg`);

    // Extract single frame at midpoint using ffmpeg
    try {
        await capture(cfg.FFMPEG, [
            "-y",
            "-hide_banner",
            "-loglevel", "error",
            "-ss", String(midSec),
            "-i",  videoPath,
            "-frames:v", "1",
            "-q:v", "2",
            frame,
        ]);
    } catch (_) {
        return null; // frame extract fail — no crop
    }

    if (!fs.existsSync(frame)) return null;

    // Try Python + OpenCV face detection
    try {
        const result = await detectWithOpenCV(frame);
        fs.unlink(frame, () => {}); // cleanup
        return result;
    } catch (_) {
        fs.unlink(frame, () => {}); // cleanup
        return null; // OpenCV nahi hai — renderer center-crop karega
    }
}

async function detectWithOpenCV(framePath) {
    // Inline Python script — no extra file needed
    const script = `
import sys, json, cv2
img = cv2.imread(sys.argv[1])
if img is None:
    print(json.dumps(None))
    sys.exit(0)
h, w = img.shape[:2]
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
# Try multiple cascade classifiers
cascades = [
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml",
    cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml",
]
faces = []
for cascade_path in cascades:
    clf = cv2.CascadeClassifier(cascade_path)
    detected = clf.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(60,60))
    if len(detected):
        faces = detected
        break
if not len(faces):
    print(json.dumps(None))
else:
    # Largest face chuno
    fx, fy, fw, fh = max(faces, key=lambda r: r[2]*r[3])
    print(json.dumps({"x": int(fx), "y": int(fy), "w": int(fw), "h": int(fh), "imgW": w, "imgH": h}))
`.trim();

    const output = await capture(cfg.PYTHON, ["-c", script, framePath]);
    const parsed = JSON.parse(output.trim());
    return parsed; // null or { x, y, w, h, imgW, imgH }
}

module.exports = { detectFace };
