const express = require("express");
const router = express.Router();
const { createPost, getMyPosts } = require("../controllers/postController");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware"); // NAYA

router.post("/", authMiddleware, upload.single("media"), createPost);
router.get("/", authMiddleware, getMyPosts);

module.exports = router;