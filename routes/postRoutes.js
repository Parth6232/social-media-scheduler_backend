const express = require("express");
const router = express.Router();
const { createPost, getMyPosts, getPlatformSummary, refreshPostStats, deletePostTarget } = require("../controllers/postController");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware"); // NAYA

router.post("/", authMiddleware, upload.single("media"), createPost);
router.get("/", authMiddleware, getMyPosts);
// NAYA: platform-summary route -- "/" route se pehle nahi hona zaroori nahi
// hai kyunki koi "/:id" dynamic route hi nahi hai is file mein, lekin future
// mein agar "/:id" add karo toh "/summary" ko uske UPAR rakhna (warna "summary"
// ko id samajh liya jaayega).
router.get("/summary", authMiddleware, getPlatformSummary);
// NAYA: manual "Refresh stats" button ke liye (single post)
router.post("/:id/refresh-stats", authMiddleware, refreshPostStats);
router.delete("/:id/targets/:platform", authMiddleware, deletePostTarget);

module.exports = router;