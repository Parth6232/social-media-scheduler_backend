const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // hashed password store hoga
    resetOtp: { type: String, default: null },
    resetOtpExpiry: { type: Date, default: null },
    trustedDevices: [
      {
        deviceId: { type: String, required: true },
        userAgent: { type: String, default: "" },
        addedAt: { type: Date, default: Date.now },
      },
    ],
    deviceOtp: { type: String, default: null },
    deviceOtpExpiry: { type: Date, default: null },
    pendingDeviceId: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);