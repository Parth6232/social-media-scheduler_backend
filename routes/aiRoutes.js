const express = require("express");
const router = express.Router();
const { generateCaption, generateImage, generatePlatformContent, parseCommand } = require("../controllers/aiController");
const authMiddleware = require("../middleware/authMiddleware");

router.post("/generate-caption", authMiddleware, generateCaption);
router.post("/generate-image", authMiddleware, generateImage);
router.post("/generate-platform-content", authMiddleware, generatePlatformContent);
router.post("/parse-command", authMiddleware, parseCommand);

module.exports = router;