const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sendOtpEmail, sendNewDeviceOtpEmail, sendNewDeviceAddedEmail } = require("../utils/sendEmail");

// Helper: email hamesha ek jaisa format me store/search ho (lowercase + trim)
// Ye "Invalid credentials" wale bugs se bachata hai jo case/extra-space ki wajah se hote hain
const normalizeEmail = (email) => (email || "").trim().toLowerCase();

// SIGNUP
exports.signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Sabhi fields zaroori hain" });
    }

    const cleanEmail = normalizeEmail(email);
    const cleanName = name.trim();

    // check karo user pehle se hai kya
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // password ko hash karo (plain text kabhi store mat karo)
    // NOTE: password ko trim NAHI karte — password me leading/trailing space
    // intentional ho sakta hai, sirf email/name jaise identifier fields trim hote hain
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name: cleanName,
      email: cleanEmail,
      password: hashedPassword,
    });

    console.log("✅ SIGNUP SUCCESS →", { email: user.email, userId: user._id.toString() });

    res.status(201).json({ message: "User created", userId: user._id });
  } catch (error) {
    console.log("❌ SIGNUP ERROR →", error.message);
    res.status(500).json({ message: error.message });
  }
};

// LOGIN
exports.login = async (req, res) => {
  try {
    const { email, password, deviceId } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email aur password zaroori hain" });
    }

    const cleanEmail = normalizeEmail(email);

    console.log("LOGIN ATTEMPT →", { email: cleanEmail, passwordLength: password.length, deviceId });

    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      console.log("❌ USER NOT FOUND for email:", cleanEmail);
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    console.log("🔑 PASSWORD MATCH RESULT:", isMatch, "for email:", cleanEmail);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Facebook/App-review tester account — isko device OTP check se bypass karo
    const reviewerEmail = process.env.APP_REVIEW_TEST_EMAIL;
    const isReviewerAccount =
      reviewerEmail && user.email === normalizeEmail(reviewerEmail);

    if (isReviewerAccount) {
      console.log("ℹ️ Reviewer account login — OTP bypass");

      const token = jwt.sign(
        { userId: user._id },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      return res.json({
        message: "Login successful",
        token,
        user: {
          userId: user._id,
          name: user.name,
          email: user.email,
        },
      });
    }

    if (!deviceId) {
      return res.status(400).json({ message: "Device identifier missing" });
    }

    // check karo ki ye device pehle se trusted hai ya nahi
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

      console.log("📧 New device OTP sent to:", user.email);

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

    console.log("✅ LOGIN SUCCESS (trusted device) →", user.email);

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
    console.log("❌ LOGIN ERROR →", error.message);
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

    const cleanEmail = normalizeEmail(email);

    const user = await User.findOne({ email: cleanEmail });
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

    console.log("✅ DEVICE OTP VERIFIED, login complete →", user.email);

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
    console.log("❌ VERIFY OTP ERROR →", error.message);
    res.status(500).json({ message: error.message });
  }
};

// FORGOT PASSWORD — email pe OTP bhejo
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email zaroori hai" });
    }

    const cleanEmail = normalizeEmail(email);

    const user = await User.findOne({ email: cleanEmail });

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

    console.log("📧 Password reset OTP sent to:", user.email);

    res.json({
      message: "Is email pe OTP bhej diya gaya hai",
    });
  } catch (error) {
    console.log("❌ FORGOT PASSWORD ERROR →", error.message);
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

    const cleanEmail = normalizeEmail(email);

    const user = await User.findOne({ email: cleanEmail });
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

    console.log("✅ PASSWORD RESET SUCCESS →", user.email);

    res.json({ message: "Password successfully reset ho gaya" });
  } catch (error) {
    console.log("❌ RESET PASSWORD ERROR →", error.message);
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

    console.log("✅ PASSWORD CHANGE SUCCESS →", user.email);

    res.json({ message: "Password successfully change ho gaya" });
  } catch (error) {
    console.log("❌ CHANGE PASSWORD ERROR →", error.message);
    res.status(500).json({ message: error.message });
  }
};