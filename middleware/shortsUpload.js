const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cfg = require("../config/shortsConfig");

const tempDir = path.join(cfg.CACHE_DIR, "_temp");
fs.mkdirSync(tempDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, tempDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || (file.fieldname === "video" ? ".mp4" : ".mp3");
        cb(null, `${file.fieldname}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
});

const uploadShorts = multer({
    storage,
    limits: {
        fileSize: 500 * 1024 * 1024, // 500MB tak direct video upload allowed
    },
});

module.exports = uploadShorts;
