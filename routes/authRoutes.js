const express = require("express");
const router = express.Router();
const {
    signup,
    login,
    verifyDeviceOtp,
    forgotPassword,
    resetPassword,
    changePassword,
    getNotificationSettings,
    updateNotificationSettings,
} = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");

router.post("/signup", signup);
router.post("/login", login);
router.post("/verify-device-otp", verifyDeviceOtp);

router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/change-password", authMiddleware, changePassword);
router.get("/notification-settings", authMiddleware, getNotificationSettings);
router.put("/notification-settings", authMiddleware, updateNotificationSettings);

module.exports = router;