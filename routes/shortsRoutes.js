const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const shortsUpload = require("../middleware/shortsUpload");
const c = require("../controllers/shortsController");

// public (video tag ke liye) — file naam/ID strictly validated hai
router.get("/files/:jobId/:file", c.serveFile);

router.post("/source-info", authMiddleware, c.sourceInfo);
// 1) YouTube Link se short banana
router.post("/jobs", authMiddleware, upload.single("voiceover"), c.createJob);
// 2) Direct Downloaded Video Upload karke short banana (100% Free, No YouTube Block)
router.post(
    "/upload-job",
    authMiddleware,
    shortsUpload.fields([
        { name: "video", maxCount: 1 },
        { name: "voiceover", maxCount: 1 },
    ]),
    c.createJobFromUpload
);
router.get("/jobs", authMiddleware, c.listJobs);
router.get("/jobs/:id", authMiddleware, c.getJob);
router.post("/jobs/:id/regenerate", authMiddleware, c.regenerate);
router.delete("/jobs/:id", authMiddleware, c.deleteJob);
router.get("/jobs/:id/clips/:index/download", authMiddleware, c.downloadClip);
router.post("/jobs/:id/clips/:index/to-post", authMiddleware, c.clipToPost);

module.exports = router;