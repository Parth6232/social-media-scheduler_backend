const express = require("express");
const router = express.Router();
const { getMyAccounts } = require("../controllers/accountController");
const authMiddleware = require("../middleware/authMiddleware");

router.get("/", authMiddleware, getMyAccounts);

module.exports = router;