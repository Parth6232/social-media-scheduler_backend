const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sendOtpEmail, sendNewDeviceOtpEmail, sendNewDeviceAddedEmail } = require("../utils/sendEmail");

// SIGNUP
exports.signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // check karo user pehle se hai kya
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // password ko hash karo (plain text kabhi store mat karo)
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
    });

    res.status(201).json({ message: "User created", userId: user._id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// LOGIN
exports.login = async (req, res) => {
  try {
    const { email, password, deviceId } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (!deviceId) {
      return res.status(400).json({ message: "Device identifier missing" });
    }

    // NAYA: check karo ki ye device pehle se trusted hai ya nahi
    const isTrustedDevice = (user.trustedDevices || []).some(
      (d) => d.deviceId === deviceId
    );

    if (!isTrustedDevice) {
      // Naya/anjaan device — OTP generate karke email pe bhejo, login abhi complete nahi karo
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const hashedOtp = await bcrypt.hash(otp, 10);

      user.deviceOtp = hashedOtp;
      user.deviceOtpExpiry = Date.now() + 10 * 60 * 1000; // 10 minute valid
      user.pendingDeviceId = deviceId;
      await user.save();

      const userAgent = req.headers["user-agent"] || "";
      await sendNewDeviceOtpEmail(user.email, otp, userAgent);

      return res.status(200).json({
        message: "Naya device detect hua. Aapke email par OTP bheja gaya hai.",
        otpRequired: true,
        email: user.email,
      });
    }

    // Trusted device — normal login
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        userId: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// VERIFY DEVICE OTP — naye device se login complete karne ke liye
exports.verifyDeviceOtp = async (req, res) => {
  try {
    const { email, otp, deviceId } = req.body;

    if (!email || !otp || !deviceId) {
      return res.status(400).json({ message: "Sabhi fields zaroori hain" });
    }

    const user = await User.findOne({ email });
    if (!user || !user.deviceOtp || !user.deviceOtpExpiry) {
      return res.status(400).json({ message: "Invalid ya expired OTP" });
    }

    if (Date.now() > user.deviceOtpExpiry) {
      user.deviceOtp = null;
      user.deviceOtpExpiry = null;
      user.pendingDeviceId = null;
      await user.save();
      return res.status(400).json({ message: "OTP expire ho chuka hai, dobara login try karein" });
    }

    if (user.pendingDeviceId !== deviceId) {
      return res.status(400).json({ message: "Device mismatch, dobara login try karein" });
    }

    const isOtpValid = await bcrypt.compare(otp, user.deviceOtp);
    if (!isOtpValid) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    // OTP sahi hai — is device ko trusted list me add karo
    user.trustedDevices = user.trustedDevices || [];
    user.trustedDevices.push({
      deviceId,
      userAgent: req.headers["user-agent"] || "",
      addedAt: new Date(),
    });

    user.deviceOtp = null;
    user.deviceOtpExpiry = null;
    user.pendingDeviceId = null;
    await user.save();

    // Confirmation alert bhejo ki naya device add ho gaya
    await sendNewDeviceAddedEmail(user.email, req.headers["user-agent"] || "");

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        userId: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
// FORGOT PASSWORD — email pe OTP bhejo
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        message: "Is email se humare paas koi account nahi hai",
      });
    }

    // 6 digit OTP generate karo
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // OTP ko hash karke store karo (plain text kabhi store mat karo)
    const hashedOtp = await bcrypt.hash(otp, 10);

    user.resetOtp = hashedOtp;
    user.resetOtpExpiry = Date.now() + 10 * 60 * 1000; // 10 minute valid
    await user.save();

    await sendOtpEmail(user.email, otp);

    res.json({
      message: "Is email pe OTP bhej diya gaya hai",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// RESET PASSWORD — OTP verify karke naya password set karo
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: "Sabhi fields zaroori hain" });
    }

    const user = await User.findOne({ email });
    if (!user || !user.resetOtp || !user.resetOtpExpiry) {
      return res.status(400).json({ message: "Invalid ya expired OTP" });
    }

    if (Date.now() > user.resetOtpExpiry) {
      user.resetOtp = null;
      user.resetOtpExpiry = null;
      await user.save();
      return res.status(400).json({ message: "OTP expire ho chuka hai, dobara request karein" });
    }

    const isOtpValid = await bcrypt.compare(otp, user.resetOtp);
    if (!isOtpValid) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetOtp = null;
    user.resetOtpExpiry = null;
    await user.save();

    res.json({ message: "Password successfully reset ho gaya" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// CHANGE PASSWORD — logged-in user, purana password daal ke naya set kare
exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: "Sabhi fields zaroori hain" });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: "User nahi mila" });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Purana password galat hai" });
    }

    if (oldPassword === newPassword) {
      return res.status(400).json({ message: "Naya password purane se alag hona chahiye" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ message: "Password successfully change ho gaya" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};