const { pool } = require("../config/db");

// ========================================
// GET TODAY'S DOCTOR OPD
// ========================================

const getToday = async (req, res, next) => {
  try {
    const doctorId = req.user.doctorId;

    if (!doctorId) {
      return res.status(401).json({
        success: false,
        message: "Doctor identity not found",
      });
    }

    const [rows] = await pool.query(
      `
      SELECT
        dra.id AS assignment_id,

        COALESCE(os.id, NULL) AS opd_session_id,

        dra.assignment_date AS opd_date,

        COALESCE(os.status, 'NOT_STARTED') AS status,

        os.token_start_time,
        os.consultation_start_time,
        os.token_close_time,
        os.current_token_number,

        d.id AS doctor_id,
        d.doctor_code,
        d.name AS doctor_name,
        d.specialization AS specializations,

        r.id AS room_id,
        r.room_number,
        r.room_name

      FROM doctor_room_assignments dra

      INNER JOIN doctors d
        ON d.id = dra.doctor_id

      INNER JOIN rooms r
        ON r.id = dra.room_id

      LEFT JOIN opd_sessions os
        ON os.doctor_id = dra.doctor_id
        AND os.room_id = dra.room_id
        AND os.opd_date = dra.assignment_date

      WHERE dra.doctor_id = ?
        AND dra.assignment_date = CURDATE()
        AND dra.is_active = TRUE

      ORDER BY
        os.id DESC,
        dra.id DESC

      LIMIT 1
      `,
      [doctorId],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No room assignment found for today",
      });
    }

    return res.status(200).json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    next(error);
  }
};

const getPatients = async (req, res, next) => {
  try {
    const doctorId = req.user.doctorId;

    if (!doctorId) {
      return res.status(401).json({
        success: false,
        message: "Doctor identity not found",
      });
    }

    const { status } = req.query;

    let query = `
      SELECT
        t.id AS token_id,
        t.token_number,
        t.token_date,
        t.status,

        t.called_at,
        t.consultation_started_at,
        t.completed_at,

        os.id AS opd_session_id,

        r.id AS room_id,
        r.room_number,
        r.room_name,

        p.id AS patient_record_id,
        p.patient_id,
        p.name AS patient_name,
        p.age,
        p.gender

      FROM tokens t

      INNER JOIN opd_sessions os
        ON os.id = t.opd_session_id

      INNER JOIN rooms r
        ON r.id = os.room_id

      INNER JOIN patients p
        ON p.id = t.patient_id

      WHERE os.doctor_id = ?
        AND os.opd_date = CURDATE()
    `;

    const params = [doctorId];

    if (status) {
      query += ` AND t.status = ? `;
      params.push(status);
    }

    query += `
      ORDER BY t.token_number ASC
    `;

    const [rows] = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
};

// ========================================
// CALL NEXT PATIENT
// ========================================

const callNext = async (req, res, next) => {
  const connection = await pool.getConnection();

  try {
    const doctorId = req.user.doctorId;

    if (!doctorId) {
      return res.status(401).json({
        success: false,
        message: "Doctor identity not found",
      });
    }

    await connection.beginTransaction();

    // ------------------------------------
    // Find active OPD session
    // ------------------------------------

    const [sessions] = await connection.query(
      `
      SELECT
        id,
        room_id,
        doctor_id,
        status
      FROM opd_sessions
      WHERE doctor_id = ?
        AND opd_date = CURDATE()
        AND status = 'RUNNING'
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE
      `,
      [doctorId],
    );

    if (sessions.length === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "No running OPD found for today",
      });
    }

    const session = sessions[0];

    // ------------------------------------
    // Check if doctor already has patient
    // ------------------------------------

    const [currentPatients] = await connection.query(
      `
      SELECT id
      FROM tokens
      WHERE opd_session_id = ?
        AND status = 'IN_CONSULTATION'
      LIMIT 1
      `,
      [session.id],
    );

    if (currentPatients.length > 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Complete the current consultation first",
      });
    }

    // ------------------------------------
    // Find next eligible patient
    // ------------------------------------

    const [tokens] = await connection.query(
      `
      SELECT
        t.id,
        t.token_number,

        p.patient_id,
        p.name,
        p.age,
        p.gender

      FROM tokens t

      INNER JOIN patients p
        ON p.id = t.patient_id

      WHERE t.opd_session_id = ?

        AND t.status = 'WAITING'

      ORDER BY
        t.token_number ASC

      LIMIT 1

      FOR UPDATE
      `,
      [session.id],
    );

    if (tokens.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "No waiting patients",
      });
    }

    const token = tokens[0];

    // ------------------------------------
    // Mark token in consultation
    // ------------------------------------

    await connection.query(
      `
      UPDATE tokens
      SET
        status = 'IN_CONSULTATION',
        called_at = NOW(),
        consultation_started_at = NOW()
      WHERE id = ?
      `,
      [token.id],
    );

    // ------------------------------------
    // Update current token
    // ------------------------------------

    await connection.query(
      `
      UPDATE opd_sessions
      SET current_token_number = ?
      WHERE id = ?
      `,
      [token.token_number, session.id],
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Next patient called",
      data: {
        tokenId: token.id,
        tokenNumber: token.token_number,
        patientId: token.patient_id,
        patientName: token.name,
        age: token.age,
        gender: token.gender,
        status: "IN_CONSULTATION",
      },
    });
  } catch (error) {
    await connection.rollback();

    next(error);
  } finally {
    connection.release();
  }
};

// ========================================
// HOLD PATIENT
// ========================================

const holdPatient = async (req, res, next) => {
  try {
    const doctorId = req.user.doctorId;
    const { tokenId } = req.params;

    const [result] = await pool.query(
      `
      UPDATE tokens t

      INNER JOIN opd_sessions os
        ON os.id = t.opd_session_id

      SET t.status = 'HOLD'

      WHERE t.id = ?
        AND os.doctor_id = ?
        AND os.opd_date = CURDATE()
        AND t.status = 'IN_CONSULTATION'
      `,
      [tokenId, doctorId],
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: "Patient cannot be placed on hold",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Patient placed on hold",
      data: {
        tokenId,
        status: "HOLD",
      },
    });
  } catch (error) {
    next(error);
  }
};

// ========================================
// SKIP PATIENT
// ========================================

const skipPatient = async (req, res, next) => {
  try {
    const doctorId = req.user.doctorId;
    const { tokenId } = req.params;

    const [result] = await pool.query(
      `
      UPDATE tokens t

      INNER JOIN opd_sessions os
        ON os.id = t.opd_session_id

      SET t.status = 'SKIPPED'

      WHERE t.id = ?
        AND os.doctor_id = ?
        AND os.opd_date = CURDATE()
        AND t.status IN ('WAITING', 'IN_CONSULTATION')
      `,
      [tokenId, doctorId],
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: "Patient cannot be skipped",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Patient marked as skipped",
      data: {
        tokenId,
        status: "SKIPPED",
      },
    });
  } catch (error) {
    next(error);
  }
};

// ========================================
// RECALL PATIENT
// ========================================

const recallPatient = async (req, res, next) => {
  try {
    const doctorId = req.user.doctorId;
    const { tokenId } = req.params;

    const [result] = await pool.query(
      `
      UPDATE tokens t

      INNER JOIN opd_sessions os
        ON os.id = t.opd_session_id

      SET t.status = 'WAITING'

      WHERE t.id = ?
        AND os.doctor_id = ?
        AND os.opd_date = CURDATE()
        AND t.status IN ('HOLD', 'SKIPPED')
      `,
      [tokenId, doctorId],
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: "Patient cannot be recalled",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Patient recalled successfully",
      data: {
        tokenId,
        status: "WAITING",
      },
    });
  } catch (error) {
    next(error);
  }
};

// ========================================
// GET CURRENT PATIENT
// ========================================

const getCurrentPatient = async (req, res, next) => {
  try {
    const doctorId = req.user.doctorId;

    const [rows] = await pool.query(
      `
      SELECT

        t.id AS token_id,
        t.token_number,
        t.status,

        p.patient_id,
        p.name,
        p.age,
        p.gender,

        r.room_number,

        os.current_token_number

      FROM tokens t

      INNER JOIN opd_sessions os
        ON os.id = t.opd_session_id

      INNER JOIN patients p
        ON p.id = t.patient_id

      INNER JOIN rooms r
        ON r.id = os.room_id

      WHERE os.doctor_id = ?
        AND os.opd_date = CURDATE()
        AND t.status = 'IN_CONSULTATION'

      LIMIT 1
      `,
      [doctorId],
    );

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        code: "NO_CURRENT_PATIENT",
        message: "No patient is currently in consultation",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    next(error);
  }
};

// ========================================
// CREATE PRESCRIPTION
// ========================================

const createPrescription = async (req, res, next) => {
  const connection = await pool.getConnection();

  try {
    const doctorId = req.user.doctorId;

    const { tokenId, advice, medicines } = req.body;

    if (!tokenId) {
      return res.status(400).json({
        success: false,
        message: "tokenId is required",
      });
    }

    if (!Array.isArray(medicines) || medicines.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one medicine is required",
      });
    }

    await connection.beginTransaction();

    // ------------------------------------
    // Find current consultation
    // ------------------------------------

    const [tokens] = await connection.query(
      `
      SELECT

        t.id AS token_id,
        t.status,

        t.patient_id,

        os.id AS opd_session_id,
        os.room_id,
        os.doctor_id,

        p.patient_id AS patient_code,
        p.name AS patient_name

      FROM tokens t

      INNER JOIN opd_sessions os
        ON os.id = t.opd_session_id

      INNER JOIN patients p
        ON p.id = t.patient_id

      WHERE t.id = ?
        AND os.doctor_id = ?
        AND os.opd_date = CURDATE()

      FOR UPDATE
      `,
      [tokenId, doctorId],
    );

    if (tokens.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Patient consultation not found",
      });
    }

    const token = tokens[0];

    if (token.status !== "IN_CONSULTATION") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Patient is not currently in consultation",
      });
    }

    // ------------------------------------
    // Create prescription
    // ------------------------------------

    const [prescriptionResult] = await connection.query(
      `
      INSERT INTO prescriptions
      (
        token_id,
        patient_id,
        doctor_id,
        room_id,
        advice,
        status
      )
      VALUES (?, ?, ?, ?, ?, 'ACTIVE')
      `,
      [tokenId, token.patient_id, doctorId, token.room_id, advice || null],
    );

    const prescriptionId = prescriptionResult.insertId;

    // ------------------------------------
    // Insert medicines
    // ------------------------------------

    for (const medicine of medicines) {
      if (!medicine.medicineId || !medicine.dose || !medicine.quantity) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Medicine, dose and quantity are required",
        });
      }

      // Verify medicine exists
      const [medicineRows] = await connection.query(
        `
        SELECT id, name
        FROM medicines
        WHERE id = ?
          AND is_active = TRUE
        LIMIT 1
        `,
        [medicine.medicineId],
      );

      if (medicineRows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message: `Medicine ${medicine.medicineId} not found`,
        });
      }

      await connection.query(
        `
        INSERT INTO prescription_items
        (
          prescription_id,
          medicine_id,
          dose,
          frequency,
          duration,
          quantity
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          prescriptionId,
          medicine.medicineId,
          medicine.dose,
          medicine.frequency || null,
          medicine.duration || null,
          medicine.quantity,
        ],
      );
    }

    // ------------------------------------
    // Move token to medicine pending
    // ------------------------------------

    await connection.query(
      `
      UPDATE tokens
      SET status = 'MEDICINE_PENDING'
      WHERE id = ?
      `,
      [tokenId],
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Prescription created successfully",
      data: {
        prescriptionId,
        tokenId,
        patientId: token.patient_code,
        patientName: token.patient_name,
        status: "ACTIVE",
      },
    });
  } catch (error) {
    await connection.rollback();

    next(error);
  } finally {
    connection.release();
  }
};

// ========================================
// COMPLETE CONSULTATION
// ========================================

const completeConsultation = async (req, res, next) => {
  try {
    const doctorId = req.user.doctorId;
    const { tokenId } = req.body;

    if (!tokenId) {
      return res.status(400).json({
        success: false,
        message: "tokenId is required",
      });
    }

    const [result] = await pool.query(
      `
      UPDATE tokens t

      INNER JOIN opd_sessions os
        ON os.id = t.opd_session_id

      SET
        t.status = 'MEDICINE_PENDING',
        t.completed_at = NOW()

      WHERE t.id = ?
        AND os.doctor_id = ?
        AND os.opd_date = CURDATE()
        AND t.status = 'IN_CONSULTATION'
      `,
      [tokenId, doctorId],
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: "Consultation cannot be completed",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Consultation completed successfully",
      data: {
        tokenId,
        status: "MEDICINE_PENDING",
      },
    });
  } catch (error) {
    next(error);
  }
};

// ========================================
// GET MEDICINES FOR DOCTOR
// ========================================

const getMedicines = async (req, res, next) => {
  try {
    const { search = "" } = req.query;

    let query = `
      SELECT
        id,
        name,
        generic_name,
        unit,
        stock_quantity,
        is_active
      FROM medicines
      WHERE is_active = TRUE
    `;

    const params = [];

    if (search.trim()) {
      query += `
        AND (
          name LIKE ?
          OR generic_name LIKE ?
        )
      `;

      const value = `%${search.trim()}%`;

      params.push(value, value);
    }

    query += `
      ORDER BY name ASC
    `;

    const [rows] = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getToday,
  getPatients,
  callNext,
  getMedicines,
  holdPatient,
  skipPatient,
  recallPatient,
  getCurrentPatient,
  createPrescription,
  completeConsultation,
};
