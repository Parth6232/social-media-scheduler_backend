const express = require("express");
const router = express.Router();
const { generateCaption, generateImage } = require("../controllers/aiController");
const authMiddleware = require("../middleware/authMiddleware");

router.post("/generate-caption", authMiddleware, generateCaption);
router.post("/generate-image", authMiddleware, generateImage);

module.exports = router;