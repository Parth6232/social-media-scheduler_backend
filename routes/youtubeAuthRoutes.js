const express = require("express");
const router = express.Router();
const { redirectToGoogle, googleCallback } = require("../controllers/youtubeAuthController");

router.get("/connect", redirectToGoogle);
router.get("/callback", googleCallback);

module.exports = router;