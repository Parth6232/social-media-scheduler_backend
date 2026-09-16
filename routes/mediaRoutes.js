const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const {
    uploadMedia,
    getFilters,
    getMusicTracks,
    addMusicTrack,
    uploadUserAudio,
    searchFreeMusic,
    importFreeTrack,
    buildEditedUrl,
} = require("../controllers/mediaController");

router.post("/upload", authMiddleware, upload.single("media"), uploadMedia);
router.get("/filters", authMiddleware, getFilters);
router.get("/music", authMiddleware, getMusicTracks);
router.post("/music", authMiddleware, upload.single("audio"), addMusicTrack);
router.post("/upload-audio", authMiddleware, upload.single("audio"), uploadUserAudio);
router.get("/free-music/search", authMiddleware, searchFreeMusic);
router.post("/free-music/import", authMiddleware, importFreeTrack);
router.post("/edit", authMiddleware, buildEditedUrl);

module.exports = router;