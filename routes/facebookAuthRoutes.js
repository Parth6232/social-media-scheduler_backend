const express = require("express");
const router = express.Router();
const { redirectToFacebook, facebookCallback } = require("../controllers/facebookAuthController");

router.get("/connect", redirectToFacebook);
router.get("/callback", facebookCallback);

module.exports = router;