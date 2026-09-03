const express = require("express");
const router = express.Router();
const { createPost, getMyPosts } = require("../controllers/postController");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware"); // NAYA

router.post("/", authMiddleware, upload.single("video"), createPost); // upload.single() add kiya
router.get("/", authMiddleware, getMyPosts);

module.exports = router;