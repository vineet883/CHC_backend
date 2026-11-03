const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");
const { encrypt, abhaPost } = require("../utils/abdm");

const clean = (value) => String(value || "").replace(/\D/g, "");

const withHyphens = (digits) =>
  `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}-${digits.slice(10, 14)}`;

// Existing ABHA number + ABHA-linked mobile OTP
const SCOPE = ["abha-login", "mobile-verify"];

const abdmError = (data, fallback) =>
  data?.message ||
  data?.error?.message ||
  data?.description ||
  data?.errorMessage ||
  fallback;

const pendingTxn = new Map();

setInterval(() => {
  for (const [key, value] of pendingTxn) {
    if (value.exp < Date.now()) pendingTxn.delete(key);
  }
}, 60 * 1000).unref();

// POST /abha/request-otp
const requestOtp = async (req, res, next) => {
  try {
    const abha = clean(req.body?.abhaNumber);

    if (!/^\d{14}$/.test(abha)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid 14-digit ABHA number",
      });
    }

    const [duplicates] = await pool.query(
      "SELECT id FROM user_abha WHERE abha_number = ? LIMIT 1",
      [abha],
    );

    if (duplicates.length) {
      return res.status(409).json({
        success: false,
        message: "This ABHA number is already registered",
      });
    }

    const { ok, status, data } = await abhaPost(
      "/v3/profile/login/request/otp",
      {
        scope: SCOPE,
        loginHint: "abha-number",
        loginId: await encrypt(withHyphens(abha)),
        otpSystem: "abdm",
      },
    );

    if (!ok || !data?.txnId) {
      const code = data?.error?.code || data?.code;

      console.error("ABDM OTP request failed:", {
        status,
        code,
        message: abdmError(data, "unknown"),
      });

      return res.status(400).json({
        success: false,
        message: abdmError(data, "Could not send OTP. Please try again."),
        code: code || null,
      });
    }

    pendingTxn.set(data.txnId, {
      abha,
      exp: Date.now() + 5 * 60 * 1000,
    });

    return res.json({
      success: true,
      data: { txnId: data.txnId },
    });
  } catch (error) {
    next(error);
  }
};

// POST /abha/verify-otp
const verifyOtp = async (req, res, next) => {
  try {
    const txnId = String(req.body?.txnId || "").trim();
    const otp = String(req.body?.otp || "").trim();
    const abha = clean(req.body?.abhaNumber);

    if (!txnId || !/^\d{14}$/.test(abha) || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid ABHA number and 6-digit OTP",
      });
    }

    const pending = pendingTxn.get(txnId);

    if (!pending || pending.exp < Date.now() || pending.abha !== abha) {
      return res.status(400).json({
        success: false,
        message: "OTP session expired. Please request a new OTP.",
      });
    }

    // FIX: scope is required in verify body as well
    const { ok, status, data } = await abhaPost(
      "/v3/profile/login/verify",
      {
        scope: SCOPE,
        authData: {
          authMethods: ["otp"],
          otp: {
            txnId,
            otpValue: await encrypt(otp),
          },
        },
      },
      {
        "T-TOKEN": txnId,
      },
    );

    // Fail closed: do not issue proof JWT unless authResult is success
    if (!ok || data?.authResult !== "success") {
      const code = data?.error?.code || data?.code;

      console.error("ABDM OTP verification failed:", {
        status,
        code,
        message: abdmError(data, "unknown"),
      });

      return res.status(400).json({
        success: false,
        message: abdmError(data, "OTP verification failed"),
        code: code || null,
      });
    }

    // Consume the transaction after successful verification.
    pendingTxn.delete(txnId);

    const proofSecret = process.env.ABHA_PROOF_SECRET;

    if (!proofSecret) {
      throw new Error("ABHA_PROOF_SECRET is not configured");
    }

    const token = jwt.sign(
      {
        abha,
        purpose: "abha-verify",
      },
      proofSecret,
      {
        expiresIn: "10m",
      },
    );

    return res.json({
      success: true,
      data: { token },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { requestOtp, verifyOtp };