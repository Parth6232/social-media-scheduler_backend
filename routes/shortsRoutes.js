const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const c = require("../controllers/shortsController");

// public (video tag ke liye) — file naam/ID strictly validated hai
router.get("/files/:jobId/:file", c.serveFile);

router.post("/source-info", authMiddleware, c.sourceInfo);
router.post("/jobs", authMiddleware, upload.single("voiceover"), c.createJob);
router.get("/jobs", authMiddleware, c.listJobs);
router.get("/jobs/:id", authMiddleware, c.getJob);
router.post("/jobs/:id/regenerate", authMiddleware, c.regenerate);
router.delete("/jobs/:id", authMiddleware, c.deleteJob);
router.get("/jobs/:id/clips/:index/download", authMiddleware, c.downloadClip);
router.post("/jobs/:id/clips/:index/to-post", authMiddleware, c.clipToPost);

module.exports = router;