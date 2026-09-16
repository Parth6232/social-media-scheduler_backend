const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const {
    uploadMedia,
    getFilters,
    getMusicTracks,
    addMusicTrack,
    buildEditedUrl,
} = require("../controllers/mediaController");

router.post("/upload", authMiddleware, upload.single("media"), uploadMedia);
router.get("/filters", authMiddleware, getFilters);
router.get("/music", authMiddleware, getMusicTracks);
router.post("/music", authMiddleware, upload.single("audio"), addMusicTrack);
router.post("/edit", authMiddleware, buildEditedUrl);

module.exports = router;