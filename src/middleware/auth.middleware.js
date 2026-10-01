const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "Authorization token is required",
      });
    }

    const parts = authHeader.split(" ");

    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return res.status(401).json({
        success: false,
        message: "Invalid authorization format",
      });
    }

    const token = parts[1];

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ---------------------------------------
    // Basic user information
    // ---------------------------------------

    req.user = {
      userId: decoded.userId,
      role: decoded.role,
    };

    // ---------------------------------------
    // DOCTOR
    // ---------------------------------------

    if (decoded.role === "DOCTOR") {
      const [doctors] = await pool.query(
        `
        SELECT
          id,
          doctor_code,
          name,
          is_active
        FROM doctors
        WHERE user_id = ?
        LIMIT 1
        `,
        [decoded.userId],
      );

      if (doctors.length === 0) {
        return res.status(403).json({
          success: false,
          message: "Doctor profile not found",
        });
      }

      const doctor = doctors[0];

      if (!doctor.is_active) {
        return res.status(403).json({
          success: false,
          message: "Doctor account is inactive",
        });
      }

      // IMPORTANT
      req.user.doctorId = doctor.id;
      req.user.doctorCode = doctor.doctor_code;
      req.user.doctorName = doctor.name;
    }

    next();
  } catch (error) {
    console.error("Authentication error:", error);

    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

module.exports = authenticate;
