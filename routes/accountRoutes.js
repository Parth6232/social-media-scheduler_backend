const express = require("express");
const router = express.Router();
const { getMyAccounts, disconnectAccount } = require("../controllers/accountController");
const authMiddleware = require("../middleware/authMiddleware");

router.get("/", authMiddleware, getMyAccounts);

// NAYA: /:platform/:accountId route add kiya taaki ek specific Facebook/
// Instagram page ko disconnect kiya ja sake (jab multiple pages connected hon).
// Purana /:platform route (bina accountId) bhi kaam karta rahega (YouTube waise hi).
router.delete("/:platform", authMiddleware, disconnectAccount);
router.delete("/:platform/:accountId", authMiddleware, disconnectAccount);

module.exports = router;