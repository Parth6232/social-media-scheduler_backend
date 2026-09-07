const express = require("express");
const router = express.Router();
const { getMyAccounts, disconnectAccount } = require("../controllers/accountController");
const authMiddleware = require("../middleware/authMiddleware");

router.get("/", authMiddleware, getMyAccounts);
router.delete("/:platform", authMiddleware, disconnectAccount);

module.exports = router;