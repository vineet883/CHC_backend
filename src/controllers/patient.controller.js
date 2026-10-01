const { pool } = require("../config/db");

// ======================================================
// HELPERS
// ======================================================

const getAuthenticatedPatient = async (userId, connection = pool) => {
  const [rows] = await connection.query(
    `
    SELECT
      id,
      patient_id,
      name,
      age,
      gender,
      mobile
    FROM patients
    WHERE user_id = ?
      AND is_active = TRUE
    LIMIT 1
    `,
    [userId],
  );

  return rows[0] || null;
};

// ======================================================
// PATIENT DASHBOARD
// GET /api/patient/dashboard
// ======================================================

const getDashboard = async (req, res, next) => {
  try {
    const userId = req.user.userId || req.user.id;

    const patient = await getAuthenticatedPatient(userId);

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient not found",
      });
    }

    // ----------------------------------------------
    // TODAY'S LATEST TOKEN
    // ----------------------------------------------

    const [todayTokens] = await pool.query(
      `
      SELECT
        t.id AS token_id,
        t.token_number,
        t.status,
        t.token_date,

        os.id AS opd_session_id,
        os.status AS opd_status,
        os.current_token_number,

        r.id AS room_id,
        r.room_number,
        r.room_name,

        d.id AS doctor_id,
        d.name AS doctor_name,

        s.id AS specialization_id,
        s.name AS specialization_name

      FROM tokens t

      INNER JOIN opd_sessions os
        ON os.id = t.opd_session_id

      INNER JOIN rooms r
        ON r.id = os.room_id

      INNER JOIN doctors d
        ON d.id = os.doctor_id

      LEFT JOIN room_specializations rs
        ON rs.room_id = r.id
        AND rs.is_active = TRUE

      LEFT JOIN specializations s
        ON s.id = rs.specialization_id

      WHERE t.patient_id = ?
        AND t.token_date = CURDATE()

      ORDER BY t.id DESC
      LIMIT 1
      `,
      [patient.id],
    );

    // ----------------------------------------------
    // LATEST PRESCRIPTION
    // ----------------------------------------------

    const [prescriptions] = await pool.query(
      `
      SELECT
        p.id AS prescription_id,

        t.id AS token_id,
        t.token_number,

        d.id AS doctor_id,
        d.name AS doctor_name,

        r.room_number,

        p.advice,
        p.status AS prescription_status,
        p.prescribed_at,

        COUNT(pi.id) AS medicine_count,

        SUM(
          CASE
            WHEN COALESCE(md.status, 'PENDING') = 'GIVEN'
            THEN 1
            ELSE 0
          END
        ) AS given_medicine_count,

        SUM(
          CASE
            WHEN COALESCE(md.status, 'PENDING') = 'UNAVAILABLE'
            THEN 1
            ELSE 0
          END
        ) AS unavailable_medicine_count,

        SUM(
          CASE
            WHEN COALESCE(md.status, 'PENDING') = 'PENDING'
            THEN 1
            ELSE 0
          END
        ) AS pending_medicine_count

      FROM prescriptions p

      INNER JOIN tokens t
        ON t.id = p.token_id

      INNER JOIN doctors d
        ON d.id = p.doctor_id

      INNER JOIN rooms r
        ON r.id = p.room_id

      LEFT JOIN prescription_items pi
        ON pi.prescription_id = p.id

      LEFT JOIN medicine_dispensing md
        ON md.prescription_item_id = pi.id

      WHERE p.patient_id = ?

      GROUP BY
        p.id,
        t.id,
        t.token_number,
        d.id,
        d.name,
        r.room_number,
        p.advice,
        p.status,
        p.prescribed_at

      ORDER BY p.prescribed_at DESC
      LIMIT 1
      `,
      [patient.id],
    );

    return res.status(200).json({
      success: true,

      data: {
        patient: {
          id: patient.id,
          patientId: patient.patient_id,
          name: patient.name,
          age: patient.age,
          gender: patient.gender,
          mobile: patient.mobile,
        },

        todayToken: todayTokens[0] || null,

        latestPrescription: prescriptions[0] || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET PATIENT PROFILE
// GET /api/patient/profile
// ======================================================

const getPatientProfile = async (req, res, next) => {
  try {
    const userId = req.user.userId || req.user.id;

    const [rows] = await pool.query(
      `
      SELECT
        id,
        patient_id,
        name,
        mobile,
        age,
        gender,
        created_at,
        updated_at

      FROM patients

      WHERE user_id = ?
        AND is_active = TRUE

      LIMIT 1
      `,
      [userId],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Patient not found",
      });
    }

    const patient = rows[0];

    return res.status(200).json({
      success: true,

      data: {
        id: patient.id,
        patientId: patient.patient_id,
        name: patient.name,
        mobile: patient.mobile,
        age: patient.age,
        gender: patient.gender,
        createdAt: patient.created_at,
        updatedAt: patient.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// UPDATE PATIENT PROFILE
// PUT /api/patient/profile
// ======================================================

const updatePatientProfile = async (req, res, next) => {
  try {
    const userId = req.user.userId || req.user.id;

    const { name, mobile, age } = req.body;

    // ----------------------------------------------
    // VALIDATION
    // ----------------------------------------------

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        success: false,
        message: "Name is required",
      });
    }

    if (!mobile || !String(mobile).trim()) {
      return res.status(400).json({
        success: false,
        message: "Mobile number is required",
      });
    }

    if (age === undefined || age === null || age === "") {
      return res.status(400).json({
        success: false,
        message: "Age is required",
      });
    }

    const numericAge = Number(age);

    if (!Number.isInteger(numericAge) || numericAge < 1 || numericAge > 120) {
      return res.status(400).json({
        success: false,
        message: "Age must be between 1 and 120",
      });
    }

    const cleanMobile = String(mobile).trim();

    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 10 digit mobile number",
      });
    }

    // ----------------------------------------------
    // FIND PATIENT
    // ----------------------------------------------

    const patient = await getAuthenticatedPatient(userId);

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient not found",
      });
    }

    // ----------------------------------------------
    // UPDATE
    // ----------------------------------------------

    await pool.query(
      `
      UPDATE patients

      SET
        name = ?,
        mobile = ?,
        age = ?,
        updated_at = CURRENT_TIMESTAMP

      WHERE id = ?
      `,
      [String(name).trim(), cleanMobile, numericAge, patient.id],
    );

    // ----------------------------------------------
    // RETURN UPDATED PROFILE
    // ----------------------------------------------

    const [rows] = await pool.query(
      `
      SELECT
        id,
        patient_id,
        name,
        mobile,
        age,
        gender,
        created_at,
        updated_at

      FROM patients

      WHERE id = ?

      LIMIT 1
      `,
      [patient.id],
    );

    const updatedPatient = rows[0];

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",

      data: {
        id: updatedPatient.id,
        patientId: updatedPatient.patient_id,
        name: updatedPatient.name,
        mobile: updatedPatient.mobile,
        age: updatedPatient.age,
        gender: updatedPatient.gender,
        createdAt: updatedPatient.created_at,
        updatedAt: updatedPatient.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// SEARCH DISEASE / SPECIALIZATION
// GET /api/patient/search?search=...
// ======================================================

const searchDiseaseSpecialization = async (req, res, next) => {
  try {
    const { search } = req.query;

    if (!search || typeof search !== "string" || search.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Search query must contain at least 2 characters",
      });
    }

    const searchValue = `%${search.trim()}%`;

    // ----------------------------------------------
    // DISEASES
    // ----------------------------------------------

    const [diseases] = await pool.query(
      `
      SELECT
        d.id,
        d.name,
        d.description,
        'DISEASE' AS type

      FROM diseases d

      WHERE d.is_active = TRUE
        AND d.name LIKE ?

      ORDER BY d.name ASC

      LIMIT 20
      `,
      [searchValue],
    );

    // ----------------------------------------------
    // SPECIALIZATIONS
    // ----------------------------------------------

    const [specializations] = await pool.query(
      `
      SELECT
        s.id,
        s.name,
        s.description,
        'SPECIALIZATION' AS type

      FROM specializations s

      WHERE s.is_active = TRUE
        AND s.name LIKE ?

      ORDER BY s.name ASC

      LIMIT 20
      `,
      [searchValue],
    );

    return res.status(200).json({
      success: true,

      data: [...specializations, ...diseases],
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET AVAILABLE OPD OPTIONS
// GET /api/patient/opd-options
// ======================================================

const getOpdOptions = async (req, res, next) => {
  try {
    const { diseaseId, specializationId } = req.query;

    if (!diseaseId && !specializationId) {
      return res.status(400).json({
        success: false,
        message: "diseaseId or specializationId is required",
      });
    }

    let specializationIds = [];

    // ----------------------------------------------
    // DISEASE → SPECIALIZATIONS
    // ----------------------------------------------

    if (diseaseId) {
      const [rows] = await pool.query(
        `
        SELECT DISTINCT
          specialization_id

        FROM specialization_diseases

        WHERE disease_id = ?
        `,
        [diseaseId],
      );

      specializationIds = rows
        .map((row) => row.specialization_id)
        .filter(Boolean);

      if (specializationIds.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No specialization found for this disease",
        });
      }
    }

    // ----------------------------------------------
    // SPECIALIZATION DIRECTLY SELECTED
    // ----------------------------------------------

    if (specializationId) {
      specializationIds = [specializationId];
    }

    const placeholders = specializationIds.map(() => "?").join(",");

    // ----------------------------------------------
    // TODAY'S AVAILABLE OPD
    // ----------------------------------------------

    const [rows] = await pool.query(
      `
      SELECT DISTINCT

        os.id AS opd_session_id,
        os.opd_date,
        os.status,

        r.id AS room_id,
        r.room_number,
        r.room_name,

        d.id AS doctor_id,
        d.doctor_code,
        d.name AS doctor_name,

        s.id AS specialization_id,
        s.name AS specialization_name,

        (
          SELECT COUNT(*)
          FROM tokens wt

          WHERE wt.opd_session_id = os.id
            AND wt.token_date = CURDATE()
            AND wt.status IN (
              'WAITING',
              'CALLED',
              'IN_PROGRESS',
              'IN_CONSULTATION'
            )
        ) AS waiting_count

      FROM opd_sessions os

      INNER JOIN rooms r
        ON r.id = os.room_id

      INNER JOIN doctors d
        ON d.id = os.doctor_id

      INNER JOIN room_specializations rs
        ON rs.room_id = r.id
        AND rs.is_active = TRUE

      INNER JOIN specializations s
        ON s.id = rs.specialization_id

      WHERE os.opd_date = CURDATE()

        AND s.id IN (${placeholders})

        AND os.status IN (
          'NOT_STARTED',
          'RUNNING'
        )

        AND r.is_active = TRUE
        AND d.is_active = TRUE

      ORDER BY
        r.room_number ASC
      `,
      specializationIds,
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// BOOK OPD / GENERATE TOKEN
// POST /api/patient/tokens
// ======================================================

const bookToken = async (req, res, next) => {
  const connection = await pool.getConnection();

  try {
    const { opdSessionId } = req.body;

    const userId = req.user.userId || req.user.id;

    // ==================================================
    // VALIDATE INPUT
    // ==================================================

    if (!opdSessionId) {
      return res.status(400).json({
        success: false,
        message: "opdSessionId is required",
      });
    }

    // ==================================================
    // GET AUTHENTICATED PATIENT
    // ==================================================

    const patient = await getAuthenticatedPatient(userId, connection);

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient not found",
      });
    }

    await connection.beginTransaction();

    // ==================================================
    // CHECK TODAY'S EXISTING TOKEN
    //
    // IMPORTANT:
    // ONE PATIENT = ONE TOKEN PER DAY
    //
    // Status does NOT matter here.
    // Even COMPLETED token blocks another token
    // for the same day.
    // ==================================================

    const [existingTokens] = await connection.query(
      `
      SELECT
        t.id,
        t.token_number,
        t.status,
        t.token_date,

        os.id AS opd_session_id,

        r.room_number,
        r.room_name,

        d.name AS doctor_name,

        s.name AS specialization_name

      FROM tokens t

      INNER JOIN opd_sessions os
        ON os.id = t.opd_session_id

      INNER JOIN rooms r
        ON r.id = os.room_id

      INNER JOIN doctors d
        ON d.id = os.doctor_id

      LEFT JOIN room_specializations rs
        ON rs.room_id = r.id
        AND rs.is_active = TRUE

      LEFT JOIN specializations s
        ON s.id = rs.specialization_id

      WHERE t.patient_id = ?
        AND t.token_date = CURDATE()

      ORDER BY t.id DESC

      LIMIT 1

      FOR UPDATE
      `,
      [patient.id],
    );

    // ==================================================
    // ALREADY HAS TOKEN TODAY
    // ==================================================

    if (existingTokens.length > 0) {
      const existingToken = existingTokens[0];

      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: "You already have an OPD token for today.",

        data: {
          tokenId: existingToken.id,

          tokenNumber: existingToken.token_number,

          status: existingToken.status,

          tokenDate: existingToken.token_date,

          opdSessionId: existingToken.opd_session_id,

          roomNumber: existingToken.room_number,

          roomName: existingToken.room_name,

          doctorName: existingToken.doctor_name,

          specializationName: existingToken.specialization_name,
        },
      });
    }

    // ==================================================
    // LOCK OPD SESSION
    // ==================================================

    const [sessions] = await connection.query(
      `
      SELECT
        os.id,
        os.room_id,
        os.doctor_id,
        os.opd_date,
        os.status,
        os.current_token_number,

        r.room_number,
        r.room_name,

        d.name AS doctor_name

      FROM opd_sessions os

      INNER JOIN rooms r
        ON r.id = os.room_id

      INNER JOIN doctors d
        ON d.id = os.doctor_id

      WHERE os.id = ?

      FOR UPDATE
      `,
      [opdSessionId],
    );

    // ==================================================
    // OPD NOT FOUND
    // ==================================================

    if (sessions.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "OPD session not found",
      });
    }

    const session = sessions[0];

    // ==================================================
    // VERIFY OPD DATE
    // ==================================================

    const [dateCheck] = await connection.query(
      `
      SELECT
        CASE
          WHEN opd_date = CURDATE()
          THEN 1
          ELSE 0
        END AS is_today

      FROM opd_sessions

      WHERE id = ?
      `,
      [opdSessionId],
    );

    if (dateCheck.length === 0 || Number(dateCheck[0].is_today) !== 1) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "This OPD is not available today",
      });
    }

    // ==================================================
    // VERIFY OPD STATUS
    // ==================================================

    if (session.status !== "NOT_STARTED" && session.status !== "RUNNING") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "OPD is not available",
      });
    }

    // ==================================================
    // GENERATE NEXT TOKEN NUMBER
    // ==================================================

    const [lastTokens] = await connection.query(
      `
      SELECT
        token_number

      FROM tokens

      WHERE opd_session_id = ?
        AND token_date = CURDATE()

      ORDER BY token_number DESC

      LIMIT 1
      `,
      [opdSessionId],
    );

    const nextTokenNumber =
      lastTokens.length > 0 ? Number(lastTokens[0].token_number) + 1 : 1;

    // ==================================================
    // CREATE TOKEN
    // ==================================================

    const [tokenResult] = await connection.query(
      `
      INSERT INTO tokens
      (
        opd_session_id,
        patient_id,
        token_number,
        token_date,
        status
      )

      VALUES
      (?, ?, ?, CURDATE(), 'WAITING')
      `,
      [opdSessionId, patient.id, nextTokenNumber],
    );

    // ==================================================
    // UPDATE OPD COUNTER
    // ==================================================

    await connection.query(
      `
      UPDATE opd_sessions

      SET current_token_number = ?

      WHERE id = ?
      `,
      [nextTokenNumber, opdSessionId],
    );

    // ==================================================
    // COMMIT
    // ==================================================

    await connection.commit();

    // ==================================================
    // SUCCESS RESPONSE
    // ==================================================

    return res.status(201).json({
      success: true,

      message: "OPD booked successfully",

      data: {
        tokenId: tokenResult.insertId,

        tokenNumber: nextTokenNumber,

        patientId: patient.patient_id,

        patientName: patient.name,

        opdSessionId: session.id,

        roomNumber: session.room_number,

        roomName: session.room_name,

        doctorName: session.doctor_name,

        status: "WAITING",

        tokenDate: new Date().toISOString().slice(0, 10),
      },
    });
  } catch (error) {
    // ==================================================
    // ROLLBACK
    // ==================================================

    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error("Transaction rollback error:", rollbackError);
    }

    console.error("Book token error:", error);

    // ==================================================
    // DUPLICATE TOKEN
    // ==================================================

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,

        message: "You already have an OPD token for today.",
      });
    }

    next(error);
  } finally {
    connection.release();
  }
};

// ======================================================
// GET TODAY'S TOKEN
// GET /api/patient/my-token/today
// ======================================================

const getMyTodayToken = async (req, res, next) => {
  try {
    const userId = req.user.userId || req.user.id;

    const patient = await getAuthenticatedPatient(userId);

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient not found",
      });
    }

    const [rows] = await pool.query(
      `
        SELECT

          t.id AS token_id,
          t.token_number,
          t.token_date,
          t.status AS token_status,

          os.id AS opd_session_id,
          os.status AS opd_status,
          os.current_token_number,

          r.id AS room_id,
          r.room_number,
          r.room_name,

          d.id AS doctor_id,
          d.name AS doctor_name,

          s.id AS specialization_id,
          s.name AS specialization_name

        FROM tokens t

        INNER JOIN opd_sessions os
          ON os.id = t.opd_session_id

        INNER JOIN rooms r
          ON r.id = os.room_id

        INNER JOIN doctors d
          ON d.id = os.doctor_id

        LEFT JOIN room_specializations rs
          ON rs.room_id = r.id
          AND rs.is_active = TRUE

        LEFT JOIN specializations s
          ON s.id = rs.specialization_id

        WHERE t.patient_id = ?

          AND t.token_date = CURDATE()

        ORDER BY t.id DESC

        LIMIT 1
        `,
      [patient.id],
    );

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: null,
        message: "No token booked for today",
      });
    }

    const token = rows[0];

    return res.status(200).json({
      success: true,

      data: {
        tokenId: token.token_id,
        tokenNumber: token.token_number,

        patientName: patient.name,
        patientId: patient.patient_id,

        room: {
          id: token.room_id,
          number: token.room_number,
          name: token.room_name,
        },

        specialization: {
          id: token.specialization_id,
          name: token.specialization_name,
        },

        doctor: {
          id: token.doctor_id,
          name: token.doctor_name,
        },

        status: token.token_status,

        currentServingToken: token.current_token_number ?? null,

        opdStatus: token.opd_status,

        opdSessionId: token.opd_session_id,

        tokenDate: token.token_date,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET MY PRESCRIPTIONS
// GET /api/patient/prescriptions
// ======================================================

const getMyPrescriptions = async (req, res, next) => {
  try {
    const userId = req.user.userId || req.user.id;

    const patient = await getAuthenticatedPatient(userId);

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient not found",
      });
    }

    const [rows] = await pool.query(
      `
      SELECT
        p.id AS prescription_id,

        t.id AS token_id,
        t.token_number,

        d.id AS doctor_id,
        d.name AS doctor_name,

        r.room_number,

        p.advice,

        p.status AS prescription_status,

        p.prescribed_at,
        p.completed_at,

        COUNT(pi.id) AS medicine_count,

        COALESCE(
          SUM(
            CASE
              WHEN COALESCE(md.status, 'PENDING') = 'GIVEN'
              THEN 1
              ELSE 0
            END
          ),
          0
        ) AS given_medicine_count,

        COALESCE(
          SUM(
            CASE
              WHEN COALESCE(md.status, 'PENDING') = 'UNAVAILABLE'
              THEN 1
              ELSE 0
            END
          ),
          0
        ) AS unavailable_medicine_count,

        COALESCE(
          SUM(
            CASE
              WHEN COALESCE(md.status, 'PENDING') = 'PENDING'
              THEN 1
              ELSE 0
            END
          ),
          0
        ) AS pending_medicine_count

      FROM prescriptions p

      INNER JOIN tokens t
        ON t.id = p.token_id

      INNER JOIN doctors d
        ON d.id = p.doctor_id

      INNER JOIN rooms r
        ON r.id = p.room_id

      LEFT JOIN prescription_items pi
        ON pi.prescription_id = p.id

      LEFT JOIN medicine_dispensing md
        ON md.prescription_item_id = pi.id

      WHERE p.patient_id = ?

      GROUP BY
        p.id,
        t.id,
        t.token_number,
        d.id,
        d.name,
        r.room_number,
        p.advice,
        p.status,
        p.prescribed_at,
        p.completed_at

      ORDER BY
        p.prescribed_at DESC
      `,
      [patient.id],
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET MY PRESCRIPTION DETAILS
// GET /api/patient/prescriptions/:prescriptionId
// ======================================================

const getMyPrescriptionDetails = async (req, res, next) => {
  try {
    const userId = req.user.userId || req.user.id;

    const { prescriptionId } = req.params;

    if (!prescriptionId) {
      return res.status(400).json({
        success: false,
        message: "Prescription ID is required",
      });
    }

    const patient = await getAuthenticatedPatient(userId);

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient not found",
      });
    }

    // ==================================================
    // PRESCRIPTION
    // ==================================================

    const [prescriptions] = await pool.query(
      `
        SELECT
          p.id AS prescription_id,

          t.id AS token_id,
          t.token_number,
          t.token_date,

          pt.patient_id,
          pt.name AS patient_name,
          pt.age,
          pt.gender,

          d.id AS doctor_id,
          d.name AS doctor_name,

          r.id AS room_id,
          r.room_number,
          r.room_name,

          p.advice,
          p.status,
          p.prescribed_at,
          p.completed_at

        FROM prescriptions p

        INNER JOIN tokens t
          ON t.id = p.token_id

        INNER JOIN patients pt
          ON pt.id = p.patient_id

        INNER JOIN doctors d
          ON d.id = p.doctor_id

        INNER JOIN rooms r
          ON r.id = p.room_id

        WHERE p.id = ?
          AND p.patient_id = ?

        LIMIT 1
        `,
      [prescriptionId, patient.id],
    );

    if (prescriptions.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Prescription not found",
      });
    }

    const prescription = prescriptions[0];

    // ==================================================
    // MEDICINES
    // ==================================================

    const [medicines] = await pool.query(
      `
        SELECT

          pi.id AS prescription_item_id,

          m.id AS medicine_id,
          m.name AS medicine_name,
          m.unit,

          pi.dose,
          pi.frequency,
          pi.duration,
          pi.quantity,

          COALESCE(
            md.status,
            'PENDING'
          ) AS dispensing_status,

          COALESCE(
            md.given_quantity,
            0
          ) AS given_quantity,

          md.dispensed_at

        FROM prescription_items pi

        INNER JOIN medicines m
          ON m.id = pi.medicine_id

        LEFT JOIN medicine_dispensing md
          ON md.prescription_item_id = pi.id

        WHERE pi.prescription_id = ?

        ORDER BY pi.id ASC
        `,
      [prescriptionId],
    );

    // ==================================================
    // SUMMARY
    // ==================================================

    const totalMedicines = medicines.length;

    const givenMedicines = medicines.filter(
      (item) => item.dispensing_status === "GIVEN",
    ).length;

    const unavailableMedicines = medicines.filter(
      (item) => item.dispensing_status === "UNAVAILABLE",
    ).length;

    const pendingMedicines = medicines.filter(
      (item) => item.dispensing_status === "PENDING",
    ).length;

    return res.status(200).json({
      success: true,

      data: {
        prescription,

        summary: {
          totalMedicines,
          givenMedicines,
          unavailableMedicines,
          pendingMedicines,
        },

        medicines,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET PATIENT NOTIFICATIONS
// GET /api/patient/notifications
// ======================================================

const getNotifications = async (req, res, next) => {
  try {
    const userId = req.user.userId || req.user.id;

    const patient = await getAuthenticatedPatient(userId);

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient not found",
      });
    }

    const [rows] = await pool.query(
      `
        SELECT

          id,
          token_id,
          type,
          title,
          message,
          is_read,
          created_at

        FROM notifications

        WHERE patient_id = ?

        ORDER BY created_at DESC
        `,
      [patient.id],
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// MARK NOTIFICATION READ
// PUT /api/patient/notifications/:id/read
// ======================================================

const markNotificationRead = async (req, res, next) => {
  try {
    const userId = req.user.userId || req.user.id;

    const { id } = req.params;

    const [result] = await pool.query(
      `
        UPDATE notifications n

        INNER JOIN patients p
          ON p.id = n.patient_id

        SET
          n.is_read = TRUE

        WHERE n.id = ?

          AND p.user_id = ?
        `,
      [id, userId],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification marked as read",
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// EXPORTS
// ======================================================

module.exports = {
  getDashboard,

  getPatientProfile,
  updatePatientProfile,

  searchDiseaseSpecialization,
  getOpdOptions,

  bookToken,
  getMyTodayToken,

  getMyPrescriptions,
  getMyPrescriptionDetails,

  getNotifications,
  markNotificationRead,
};
