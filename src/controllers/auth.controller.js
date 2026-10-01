const bcrypt = require("bcryptjs");

// const db = require("../../config/db");
const { pool } = require("../config/db");
const generatePatientId = require("../utils/generatePatientId");
const generateToken = require("../utils/generateToken");

// ========================================
// REGISTER
// ========================================

const register = async (req, res, next) => {
  const connection = await pool.getConnection();

  try {
    const { name, age, gender, mobile, address, abhaNumber, password } =
      req.body;

    // ========================================
    // BASIC VALIDATION
    // ========================================

    if (!name || !age || !gender || !mobile || !abhaNumber || !password) {
      return res.status(400).json({
        success: false,
        message:
          "Name, age, gender, mobile, ABHA number and password are required",
      });
    }

    // ========================================
    // PASSWORD VALIDATION
    // ========================================

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must contain at least 6 characters",
      });
    }

    // ========================================
    // MOBILE NORMALIZATION
    // ========================================

    const cleanMobile = String(mobile).replace(/\D/g, "");

    if (!/^\d{10}$/.test(cleanMobile)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid 10-digit mobile number",
      });
    }

    // ========================================
    // ABHA FORMAT VALIDATION
    // Testing purpose only
    // NO ABDM / GOVERNMENT VERIFICATION
    // ========================================

    const cleanAbhaNumber = String(abhaNumber).replace(/\D/g, "");

    if (!/^\d{14}$/.test(cleanAbhaNumber)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid 14-digit ABHA number",
      });
    }

    // ========================================
    // CHECK EXISTING MOBILE
    // ========================================

    const [existingUsers] = await connection.query(
      `
      SELECT id
      FROM users
      WHERE mobile = ?
      LIMIT 1
      `,
      [cleanMobile],
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Mobile number is already registered",
      });
    }

    // ========================================
    // CHECK EXISTING ABHA
    // ========================================

    const [existingAbha] = await connection.query(
      `
      SELECT id
      FROM user_abha
      WHERE abha_number = ?
      LIMIT 1
      `,
      [cleanAbhaNumber],
    );

    if (existingAbha.length > 0) {
      return res.status(409).json({
        success: false,
        message: "This ABHA number is already registered",
      });
    }

    // ========================================
    // START TRANSACTION
    // ========================================

    await connection.beginTransaction();

    // ========================================
    // GENERATE PATIENT ID
    // ========================================

    const patientId = await generatePatientId();

    // ========================================
    // HASH PASSWORD
    // ========================================

    const passwordHash = await bcrypt.hash(password, 12);

    // ========================================
    // CREATE USER
    // ========================================

    const [userResult] = await connection.query(
      `
      INSERT INTO users
      (
        role,
        mobile,
        password_hash,
        is_active
      )
      VALUES (?, ?, ?, TRUE)
      `,
      ["PATIENT", cleanMobile, passwordHash],
    );

    const userId = userResult.insertId;

    // ========================================
    // CREATE PATIENT
    // ========================================

    await connection.query(
      `
      INSERT INTO patients
      (
        user_id,
        patient_id,
        name,
        age,
        gender,
        mobile,
        address,
        is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)
      `,
      [userId, patientId, name, age, gender, cleanMobile, address || null],
    );

    // ========================================
    // SAVE ABHA NUMBER
    // Testing purpose only
    // This does NOT mean government verified
    // ========================================

    await connection.query(
      `
      INSERT INTO user_abha
      (
        user_id,
        abha_number,
        verification_status
      )
      VALUES (?, ?, 'PENDING')
      `,
      [userId, cleanAbhaNumber],
    );

    // ========================================
    // COMMIT
    // ========================================

    await connection.commit();

    // ========================================
    // GENERATE JWT
    // ========================================

    const token = generateToken({
      userId,
      role: "PATIENT",
    });

    // ========================================
    // RESPONSE
    // ========================================

    return res.status(201).json({
      success: true,
      message: "Patient registration successful",
      data: {
        patientId,
        name,
        role: "PATIENT",
        abhaNumber: cleanAbhaNumber,
        token,
      },
    });
  } catch (error) {
    // ========================================
    // ROLLBACK
    // ========================================

    await connection.rollback();

    next(error);
  } finally {
    connection.release();
  }
};
// ========================================
// LOGIN
// ========================================

const login = async (req, res, next) => {
  try {
    const { login, password } = req.body;

    if (!login || !password) {
      return res.status(400).json({
        success: false,
        message: "Login and password are required",
      });
    }

    // ========================================
    // STATIC MEDICAL SHOP LOGIN
    // ========================================

    if (
      login === process.env.PHARMACY_MOBILE &&
      password === process.env.PHARMACY_PASSWORD
    ) {
      const token = generateToken({
        userId: "PHARMACY",
        role: "PHARMACIST",
      });

      return res.status(200).json({
        success: true,
        message: "Medical shop login successful",
        data: {
          token,
          role: "PHARMACIST",
          profile: {
            name: "Medical Shop",
            mobile: process.env.PHARMACY_MOBILE,
            role: "PHARMACIST",
          },
        },
      });
    }

    const [users] = await pool.query(
      `
      SELECT
        id,
        role,
        mobile,
        email,
        password_hash,
        is_active
      FROM users
      WHERE
        mobile = ?
        OR email = ?
      LIMIT 1
      `,
      [login, login],
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid login credentials",
      });
    }

    const user = users[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "User account is inactive",
      });
    }

    const passwordMatched = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatched) {
      return res.status(401).json({
        success: false,
        message: "Invalid login credentials",
      });
    }

    await pool.query(
      `
      UPDATE users
      SET last_login_at = NOW()
      WHERE id = ?
      `,
      [user.id],
    );

    // ========================================
    // LOAD PROFILE
    // ========================================

    let profile = null;

    // ----------------------------------------
    // PATIENT
    // ----------------------------------------

    if (user.role === "PATIENT") {
      const [patients] = await pool.query(
        `
        SELECT
          id,
          patient_id,
          name,
          age,
          gender,
          mobile,
          address
        FROM patients
        WHERE user_id = ?
        LIMIT 1
        `,
        [user.id],
      );

      profile = patients[0] || null;
    }

    // ----------------------------------------
    // ADMIN
    // ----------------------------------------

    if (user.role === "ADMIN") {
      const [admins] = await pool.query(
        `
        SELECT
          id,
          name
        FROM admins
        WHERE user_id = ?
        LIMIT 1
        `,
        [user.id],
      );

      profile = admins[0] || null;
    }

    // ----------------------------------------
    // DOCTOR
    // ----------------------------------------

    if (user.role === "DOCTOR") {
      const [doctors] = await pool.query(
        `
        SELECT
          id,
          user_id,
          doctor_code,
          name,
          qualification,
          specialization,
          mobile,
          email,
          is_active
        FROM doctors
        WHERE user_id = ?
        LIMIT 1
        `,
        [user.id],
      );

      if (doctors.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Doctor profile not found",
        });
      }

      if (!doctors[0].is_active) {
        return res.status(403).json({
          success: false,
          message: "Doctor account is inactive",
        });
      }

      profile = doctors[0];
    }

    // ========================================
    // TOKEN
    // ========================================

    const tokenPayload = {
      userId: user.id,
      role: user.role,
    };

    // Doctor ke JWT mein doctor table ka actual ID
    // store hoga.
    if (user.role === "DOCTOR" && profile) {
      tokenPayload.doctorId = profile.id;
    }

    const token = generateToken(tokenPayload);

    // ========================================
    // RESPONSE
    // ========================================

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        token,
        role: user.role,
        profile,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ========================================
// ME
// ========================================

const me = async (req, res, next) => {
  try {
    const { userId, role } = req.user;

    if (role === "PATIENT") {
      const [rows] = await pool.query(
        `
        SELECT
          u.id AS user_id,
          u.role,
          p.id AS patient_record_id,
          p.patient_id,
          p.name,
          p.age,
          p.gender,
          p.mobile,
          p.address
        FROM users u
        INNER JOIN patients p
          ON p.user_id = u.id
        WHERE u.id = ?
        LIMIT 1
        `,
        [userId],
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Patient profile not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: rows[0],
      });
    }

    if (role === "ADMIN") {
      const [rows] = await pool.query(
        `
        SELECT
          u.id AS user_id,
          u.role,
          a.id AS admin_id,
          a.name
        FROM users u
        INNER JOIN admins a
          ON a.user_id = u.id
        WHERE u.id = ?
        LIMIT 1
        `,
        [userId],
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Admin profile not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: rows[0],
      });
    }

    if (role === "DOCTOR") {
      const [rows] = await pool.query(
        `
    SELECT
      u.id AS user_id,
      u.role,

      d.id AS doctor_record_id,
      d.doctor_code,
      d.name,
      d.qualification,
      d.specialization,
      d.mobile,
      d.email,
      d.is_active

    FROM users u

    INNER JOIN doctors d
      ON d.user_id = u.id

    WHERE u.id = ?
    LIMIT 1
    `,
        [userId],
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Doctor profile not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: rows[0],
      });
    }

    return res.status(400).json({
      success: false,
      message: "Unsupported user role",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  me,
};
