const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");

// ========================================
// ADD DOCTOR
// ========================================

const addDoctor = async (req, res, next) => {
  const connection = await pool.getConnection();

  try {
    const {
      doctorCode,
      name,
      qualification,
      specialization,
      departmentId,
      workingDays,
      mobile,
      email,
      password,
    } = req.body;

    // ========================================
    // VALIDATION
    // ========================================

    if (!doctorCode || !name || !mobile || !password) {
      return res.status(400).json({
        success: false,
        message: "Doctor code, name, mobile and password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must contain at least 6 characters",
      });
    }

    // Specialization required
    if (!specialization || !specialization.trim()) {
      return res.status(400).json({
        success: false,
        message: "Doctor specialization is required",
      });
    }

    // ========================================
    // DEPARTMENT VALIDATION
    // ========================================

    if (!departmentId) {
      return res.status(400).json({
        success: false,
        message: "Department is required",
      });
    }

    // ========================================
    // WORKING DAYS VALIDATION
    // ========================================

    const allowedDays = [
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ];

    if (!Array.isArray(workingDays) || workingDays.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one working day is required",
      });
    }

    const normalizedWorkingDays = [
      ...new Set(
        workingDays
          .map((day) => String(day).trim().toUpperCase())
          .filter(Boolean),
      ),
    ];

    const invalidDays = normalizedWorkingDays.filter(
      (day) => !allowedDays.includes(day),
    );

    if (invalidDays.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid working day selected",
        invalidDays,
      });
    }

    const specializationName = specialization.trim();

    await connection.beginTransaction();

    // ========================================
    // CHECK DEPARTMENT
    // ========================================

    const [departmentRows] = await connection.query(
      `
        SELECT
          id,
          name,
          is_active
        FROM medical_certificate_departments
        WHERE id = ?
        LIMIT 1
      `,
      [departmentId],
    );

    if (departmentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Department not found",
      });
    }

    if (!departmentRows[0].is_active) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Selected department is inactive",
      });
    }

    const department = departmentRows[0];

    // ========================================
    // CHECK DOCTOR CODE
    // ========================================

    const [existingDoctor] = await connection.query(
      `
        SELECT id
        FROM doctors
        WHERE doctor_code = ?
        LIMIT 1
      `,
      [doctorCode],
    );

    if (existingDoctor.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "Doctor code already exists",
      });
    }

    // ========================================
    // CHECK MOBILE
    // ========================================

    const [existingMobile] = await connection.query(
      `
        SELECT id
        FROM users
        WHERE mobile = ?
        LIMIT 1
      `,
      [mobile],
    );

    if (existingMobile.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "Mobile number is already registered",
      });
    }

    // ========================================
    // CHECK EMAIL
    // ========================================

    if (email && email.trim()) {
      const [existingEmail] = await connection.query(
        `
          SELECT id
          FROM users
          WHERE email = ?
          LIMIT 1
        `,
        [email.trim()],
      );

      if (existingEmail.length > 0) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "Email is already registered",
        });
      }
    }

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
          email,
          password_hash,
          is_active
        )
        VALUES (?, ?, ?, ?, TRUE)
      `,
      ["DOCTOR", mobile, email?.trim() || null, passwordHash],
    );

    const userId = userResult.insertId;

    // ========================================
    // FIND / CREATE SPECIALIZATION
    // ========================================

    let specializationId;

    const [existingSpecialization] = await connection.query(
      `
        SELECT
          id,
          name,
          is_active
        FROM specializations
        WHERE LOWER(TRIM(name)) =
              LOWER(TRIM(?))
        LIMIT 1
      `,
      [specializationName],
    );

    if (existingSpecialization.length > 0) {
      specializationId = existingSpecialization[0].id;

      // Agar inactive hai to active kar do
      if (!existingSpecialization[0].is_active) {
        await connection.query(
          `
            UPDATE specializations
            SET is_active = TRUE
            WHERE id = ?
          `,
          [specializationId],
        );
      }
    } else {
      const [specializationResult] = await connection.query(
        `
          INSERT INTO specializations
          (
            name,
            description,
            is_active
          )
          VALUES (?, NULL, TRUE)
        `,
        [specializationName],
      );

      specializationId = specializationResult.insertId;
    }

    // ========================================
    // CREATE DOCTOR PROFILE
    // ========================================

    const [doctorResult] = await connection.query(
      `
        INSERT INTO doctors
        (
          user_id,
          doctor_code,
          name,
          qualification,
          specialization,
          mobile,
          email,
          is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)
      `,
      [
        userId,
        doctorCode,
        name,
        qualification?.trim() || null,
        specializationName,
        mobile,
        email?.trim() || null,
      ],
    );

    const doctorId = doctorResult.insertId;

    // ========================================
    // MAP DOCTOR TO DEPARTMENT
    // ========================================

    await connection.query(
      `
        INSERT INTO medical_certificate_doctor_departments
        (
          doctor_id,
          department_id,
          is_active
        )
        VALUES (?, ?, TRUE)
      `,
      [doctorId, departmentId],
    );

    // ========================================
    // SAVE WEEKLY WORKING DAYS
    // ========================================

    for (const day of normalizedWorkingDays) {
      await connection.query(
        `
          INSERT INTO doctor_weekly_schedule
          (
            doctor_id,
            day_of_week,
            is_active
          )
          VALUES (?, ?, TRUE)
        `,
        [doctorId, day],
      );
    }

    // ========================================
    // COMMIT
    // ========================================

    await connection.commit();

    // ========================================
    // RESPONSE
    // ========================================

    return res.status(201).json({
      success: true,
      message: "Doctor added successfully",

      data: {
        id: doctorId,
        userId,

        doctorCode,
        name,

        qualification: qualification?.trim() || null,

        specialization: specializationName,
        specializationId,

        departmentId: Number(departmentId),
        departmentName: department.name,

        workingDays: normalizedWorkingDays,

        mobile,

        email: email?.trim() || null,

        // Doctor ko login credentials dene ke liye
        login: mobile,
        password,
      },
    });
  } catch (error) {
    // ========================================
    // ROLLBACK
    // ========================================

    try {
      await connection.rollback();
    } catch {}

    console.error("Add doctor error:", error);

    // ========================================
    // DUPLICATE
    // ========================================

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message:
          "Doctor code, mobile, email, department mapping or schedule already exists",
      });
    }

    next(error);
  } finally {
    connection.release();
  }
};

// ========================================
// GET DOCTORS
// ========================================

const getDoctors = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT
        d.id,
        d.doctor_code,
        d.name,
        d.qualification,
        d.specialization,
        d.mobile,
        d.email,
        d.is_active,
        d.created_at,

        /* ==============================
           DEPARTMENT
           ============================== */

        mcd.id AS departmentId,
        mcd.name AS departmentName,

        /* ==============================
           WORKING DAYS
           ============================== */

        COALESCE(
          GROUP_CONCAT(
            DISTINCT dws.day_of_week
            ORDER BY FIELD(
              dws.day_of_week,
              'MONDAY',
              'TUESDAY',
              'WEDNESDAY',
              'THURSDAY',
              'FRIDAY',
              'SATURDAY',
              'SUNDAY'
            )
            SEPARATOR ','
          ),
          ''
        ) AS workingDays

      FROM doctors d

      /* ==============================
         DOCTOR → DEPARTMENT
         ============================== */

      LEFT JOIN medical_certificate_doctor_departments mcdd
        ON mcdd.doctor_id = d.id
        AND mcdd.is_active = TRUE

      LEFT JOIN medical_certificate_departments mcd
        ON mcd.id = mcdd.department_id
        AND mcd.is_active = TRUE

      /* ==============================
         DOCTOR → WEEKLY SCHEDULE
         ============================== */

      LEFT JOIN doctor_weekly_schedule dws
        ON dws.doctor_id = d.id
        AND dws.is_active = TRUE

      GROUP BY
        d.id,
        d.doctor_code,
        d.name,
        d.qualification,
        d.specialization,
        d.mobile,
        d.email,
        d.is_active,
        d.created_at,
        mcd.id,
        mcd.name

      ORDER BY d.name ASC
      `,
    );

    // ========================================
    // FORMAT WORKING DAYS
    // ========================================

    const formattedDoctors = rows.map((doctor) => ({
      ...doctor,

      code: doctor.doctor_code,

      status: doctor.is_active ? "ACTIVE" : "INACTIVE",

      departmentId: doctor.departmentId ? Number(doctor.departmentId) : null,

      workingDays: doctor.workingDays ? doctor.workingDays.split(",") : [],
    }));

    // ========================================
    // RESPONSE
    // ========================================

    return res.status(200).json({
      success: true,
      data: formattedDoctors,
    });
  } catch (error) {
    console.error("Get doctors error:", error);
    next(error);
  }
};

// ======================================================
// UPDATE DOCTOR
// ======================================================

const updateDoctor = async (req, res, next) => {
  const connection = await pool.getConnection();

  let transactionStarted = false;

  try {
    const { id } = req.params;

    const {
      name,
      qualification,
      specialization,
      departmentId,
      workingDays,
      mobile,
      email,
      status,
    } = req.body;

    // ==================================================
    // VALIDATE DOCTOR ID
    // ==================================================

    if (!id || Number.isNaN(Number(id))) {
      return res.status(400).json({
        success: false,
        message: "Invalid doctor ID",
      });
    }

    const doctorId = Number(id);

    // ==================================================
    // CHECK DOCTOR
    // ==================================================

    const [existingDoctors] = await connection.query(
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
      WHERE id = ?
      LIMIT 1
      `,
      [doctorId],
    );

    if (existingDoctors.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    const existingDoctor = existingDoctors[0];

    // ==================================================
    // VALIDATE STATUS
    // ==================================================

    if (status !== undefined && !["ACTIVE", "INACTIVE"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid doctor status",
      });
    }

    // ==================================================
    // VALIDATE DEPARTMENT
    // ==================================================

    if (departmentId !== undefined && !departmentId) {
      return res.status(400).json({
        success: false,
        message: "Department is required",
      });
    }

    // ==================================================
    // VALIDATE WORKING DAYS
    // ==================================================

    const allowedDays = [
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ];

    let normalizedWorkingDays;

    if (workingDays !== undefined) {
      if (!Array.isArray(workingDays) || workingDays.length === 0) {
        return res.status(400).json({
          success: false,
          message: "At least one working day is required",
        });
      }

      normalizedWorkingDays = [
        ...new Set(
          workingDays
            .map((day) => String(day).trim().toUpperCase())
            .filter(Boolean),
        ),
      ];

      const invalidDays = normalizedWorkingDays.filter(
        (day) => !allowedDays.includes(day),
      );

      if (invalidDays.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid working day selected",
          invalidDays,
        });
      }
    }

    // ==================================================
    // START TRANSACTION
    // ==================================================

    await connection.beginTransaction();
    transactionStarted = true;

    // ==================================================
    // CHECK DEPARTMENT
    // ==================================================

    if (departmentId !== undefined) {
      const [[department]] = await connection.query(
        `
        SELECT
          id,
          name,
          is_active
        FROM medical_certificate_departments
        WHERE id = ?
        LIMIT 1
        `,
        [departmentId],
      );

      if (!department) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(404).json({
          success: false,
          message: "Department not found",
        });
      }

      if (!department.is_active) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          success: false,
          message: "Selected department is inactive",
        });
      }
    }

    // ==================================================
    // CHECK MOBILE DUPLICATE
    // ==================================================

    if (mobile !== undefined) {
      const cleanMobile = String(mobile).replace(/\s/g, "");

      const [existingMobile] = await connection.query(
        `
        SELECT id
        FROM doctors
        WHERE mobile = ?
          AND id <> ?
        LIMIT 1
        `,
        [cleanMobile, doctorId],
      );

      if (existingMobile.length > 0) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(409).json({
          success: false,
          message: "Mobile number is already registered with another doctor",
        });
      }
    }

    // ==================================================
    // CHECK EMAIL DUPLICATE
    // ==================================================

    if (email !== undefined && String(email).trim()) {
      const cleanEmail = String(email).trim();

      const [existingEmail] = await connection.query(
        `
        SELECT id
        FROM doctors
        WHERE email = ?
          AND id <> ?
        LIMIT 1
        `,
        [cleanEmail, doctorId],
      );

      if (existingEmail.length > 0) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(409).json({
          success: false,
          message: "Email is already registered with another doctor",
        });
      }
    }

    // ==================================================
    // UPDATE DOCTOR BASIC DETAILS
    // ==================================================

    const fields = [];
    const values = [];

    if (name !== undefined) {
      fields.push("name = ?");
      values.push(String(name).trim());
    }

    if (qualification !== undefined) {
      fields.push("qualification = ?");
      values.push(String(qualification).trim() || null);
    }

    if (specialization !== undefined) {
      if (!String(specialization).trim()) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          success: false,
          message: "Doctor specialization is required",
        });
      }

      fields.push("specialization = ?");
      values.push(String(specialization).trim());
    }

    if (mobile !== undefined) {
      fields.push("mobile = ?");
      values.push(String(mobile).replace(/\s/g, ""));
    }

    if (email !== undefined) {
      fields.push("email = ?");
      values.push(String(email).trim() || null);
    }

    if (status !== undefined) {
      fields.push("is_active = ?");
      values.push(status === "ACTIVE" ? 1 : 0);
    }

    if (fields.length > 0) {
      values.push(doctorId);

      await connection.query(
        `
        UPDATE doctors
        SET
          ${fields.join(", ")},
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        values,
      );
    }

    // ==================================================
    // UPDATE USER MOBILE / EMAIL / STATUS
    // ==================================================

    const doctorUserId = existingDoctor.user_id;

    const userFields = [];
    const userValues = [];

    if (mobile !== undefined) {
      userFields.push("mobile = ?");
      userValues.push(String(mobile).replace(/\s/g, ""));
    }

    if (email !== undefined) {
      userFields.push("email = ?");
      userValues.push(String(email).trim() || null);
    }

    if (status !== undefined) {
      userFields.push("is_active = ?");
      userValues.push(status === "ACTIVE" ? 1 : 0);
    }

    if (userFields.length > 0) {
      userValues.push(doctorUserId);

      await connection.query(
        `
        UPDATE users
        SET ${userFields.join(", ")}
        WHERE id = ?
        `,
        userValues,
      );
    }

    // ==================================================
    // UPDATE DEPARTMENT
    // ==================================================

    if (departmentId !== undefined) {
      /*
       * Doctor ka sirf ek certificate department mapping hai.
       *
       * Isliye pehle purani mapping delete karenge
       * aur phir selected department insert karenge.
       *
       * Ye unique key:
       * uk_mc_doctor_department
       * ke saath duplicate issue avoid karega.
       */

      await connection.query(
        `
        DELETE FROM medical_certificate_doctor_departments
        WHERE doctor_id = ?
        `,
        [doctorId],
      );

      await connection.query(
        `
        INSERT INTO medical_certificate_doctor_departments
        (
          doctor_id,
          department_id,
          is_active
        )
        VALUES (?, ?, TRUE)
        `,
        [doctorId, Number(departmentId)],
      );
    }

    // ==================================================
    // UPDATE WEEKLY WORKING DAYS
    // ==================================================

    if (normalizedWorkingDays !== undefined) {
      /*
       * IMPORTANT:
       * Sirf tab working days update honge
       * jab frontend workingDays bhejega.
       */

      await connection.query(
        `
        DELETE FROM doctor_weekly_schedule
        WHERE doctor_id = ?
        `,
        [doctorId],
      );

      for (const day of normalizedWorkingDays) {
        await connection.query(
          `
          INSERT INTO doctor_weekly_schedule
          (
            doctor_id,
            day_of_week,
            is_active
          )
          VALUES (?, ?, TRUE)
          `,
          [doctorId, day],
        );
      }
    }

    // ==================================================
    // COMMIT
    // ==================================================

    await connection.commit();
    transactionStarted = false;

    // ==================================================
    // GET UPDATED DOCTOR
    // ==================================================

    const [updatedDoctors] = await pool.query(
      `
      SELECT
        d.id,
        d.doctor_code,
        d.name,
        d.qualification,
        d.specialization,
        d.mobile,
        d.email,
        d.is_active,

        mcd.id AS departmentId,
        mcd.name AS departmentName,

        COALESCE(
          GROUP_CONCAT(
            DISTINCT dws.day_of_week
            ORDER BY FIELD(
              dws.day_of_week,
              'MONDAY',
              'TUESDAY',
              'WEDNESDAY',
              'THURSDAY',
              'FRIDAY',
              'SATURDAY',
              'SUNDAY'
            )
            SEPARATOR ','
          ),
          ''
        ) AS workingDays

      FROM doctors d

      LEFT JOIN medical_certificate_doctor_departments mcdd
        ON mcdd.doctor_id = d.id
        AND mcdd.is_active = TRUE

      LEFT JOIN medical_certificate_departments mcd
        ON mcd.id = mcdd.department_id
        AND mcd.is_active = TRUE

      LEFT JOIN doctor_weekly_schedule dws
        ON dws.doctor_id = d.id
        AND dws.is_active = TRUE

      WHERE d.id = ?

      GROUP BY
        d.id,
        d.doctor_code,
        d.name,
        d.qualification,
        d.specialization,
        d.mobile,
        d.email,
        d.is_active,
        mcd.id,
        mcd.name
      `,
      [doctorId],
    );

    const updatedDoctor = updatedDoctors[0];

    // ==================================================
    // RESPONSE
    // ==================================================

    return res.status(200).json({
      success: true,

      message:
        status === "INACTIVE"
          ? "Doctor deactivated successfully"
          : status === "ACTIVE"
            ? "Doctor activated successfully"
            : "Doctor updated successfully",

      data: updatedDoctor
        ? {
            ...updatedDoctor,

            code: updatedDoctor.doctor_code,

            status: updatedDoctor.is_active ? "ACTIVE" : "INACTIVE",

            departmentId: updatedDoctor.departmentId
              ? Number(updatedDoctor.departmentId)
              : null,

            workingDays: updatedDoctor.workingDays
              ? updatedDoctor.workingDays.split(",")
              : [],
          }
        : null,
    });
  } catch (error) {
    // ==================================================
    // ROLLBACK
    // ==================================================

    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (_) {}
    }

    console.error("Update doctor error:", error);

    // ==================================================
    // DUPLICATE
    // ==================================================

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message:
          "Doctor mobile, email, department mapping or schedule already exists",
      });
    }

    return next(error);
  } finally {
    connection.release();
  }
};

// 4. DELETE DOCTOR
const deleteDoctor = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      `
      UPDATE doctors
      SET is_active = FALSE
      WHERE id = ?
        AND is_active = TRUE
      `,
      [id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found or already inactive",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Doctor deactivated successfully",
    });
  } catch (error) {
    next(error);
  }
};

// 5. ADD ROOM
const addRoom = async (req, res, next) => {
  try {
    const { roomNumber, roomName, floor } = req.body;

    if (!roomNumber) {
      return res.status(400).json({
        success: false,
        message: "Room number is required",
      });
    }

    const [result] = await pool.query(
      `
      INSERT INTO rooms
      (
        room_number,
        room_name,
        floor,
        is_active
      )
      VALUES (?, ?, ?, TRUE)
      `,
      [roomNumber, roomName || null, floor || null],
    );

    return res.status(201).json({
      success: true,
      message: "Room added successfully",
      data: {
        id: result.insertId,
        roomNumber,
      },
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "Room number already exists",
      });
    }

    next(error);
  }
};

// 6. GET ROOMS
const getRooms = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT
        r.id,
        r.room_number,
        r.room_name,
        r.floor,
        r.is_active,

        dra.id AS assignment_id,
        dra.doctor_id,

        d.name AS doctor_name,
        d.specialization AS specialization,

        dra.assignment_date,
        dra.start_time,
        dra.end_time,
        dra.is_active AS assignment_active,
        dra.is_recurring

      FROM rooms r

      LEFT JOIN doctor_room_assignments dra
        ON dra.room_id = r.id
        AND dra.is_active = 1
        AND (
          /* NORMAL ASSIGNMENT */
          (
            dra.is_recurring = 0
            AND dra.assignment_date = CURDATE()
          )

          OR

          /* RECURRING ASSIGNMENT */
          (
            dra.is_recurring = 1
            AND dra.assignment_date <= CURDATE()

            AND EXISTS (
              SELECT 1
              FROM doctor_weekly_schedule dws
              WHERE dws.doctor_id = dra.doctor_id
                AND dws.day_of_week =
                    UPPER(DAYNAME(CURDATE()))
                AND dws.is_active = TRUE
            )
          )
        )

      LEFT JOIN doctors d
        ON d.id = dra.doctor_id
        AND d.is_active = TRUE

      WHERE r.is_active = TRUE

      ORDER BY r.room_number ASC
      `,
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error(
      "Get rooms error:",
      error,
    );

    next(error);
  }
};

// 7. UPDATE ROOM
const updateRoom = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { roomNumber, roomName, floor, isActive } = req.body;

    const fields = [];
    const values = [];

    if (roomNumber !== undefined) {
      fields.push("room_number = ?");
      values.push(roomNumber);
    }

    if (roomName !== undefined) {
      fields.push("room_name = ?");
      values.push(roomName);
    }

    if (floor !== undefined) {
      fields.push("floor = ?");
      values.push(floor);
    }

    if (isActive !== undefined) {
      fields.push("is_active = ?");
      values.push(isActive ? 1 : 0);
    }

    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update",
      });
    }

    values.push(id);

    const [result] = await pool.query(
      `
      UPDATE rooms
      SET ${fields.join(", ")}
      WHERE id = ?
      `,
      values,
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        isActive === true
          ? "Room reopened successfully"
          : isActive === false
            ? "Room deactivated successfully"
            : "Room updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

// 8. DELETE ROOM
const deleteRoom = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      `
      UPDATE rooms
      SET is_active = FALSE
      WHERE id = ?
        AND is_active = TRUE
      `,
      [id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Room not found or already inactive",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Room deactivated successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ========================================
// ASSIGN DOCTOR TO ROOM
// + RECURRING ON WEEKLY WORKING DAYS
// + CREATE OPD SESSION
// + SYNC DOCTOR SPECIALIZATION
// ========================================

const assignDoctorToRoom = async (req, res, next) => {
  const connection = await pool.getConnection();

  try {
    const {
      doctorId,
      roomId,
      assignmentDate,
      startTime,
      consultationStartTime,
      endTime,
      isRecurring = true,
    } = req.body;

    // ========================================
    // VALIDATION
    // ========================================

    if (
      !doctorId ||
      !roomId ||
      !assignmentDate ||
      !startTime ||
      !consultationStartTime ||
      !endTime
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Doctor, room, assignment date, start time, consultation start time and end time are required",
      });
    }

    await connection.beginTransaction();

    // ========================================
    // CHECK DOCTOR
    // ========================================

    const [doctors] = await connection.query(
      `
      SELECT
        id,
        doctor_code,
        name,
        specialization,
        is_active
      FROM doctors
      WHERE id = ?
      LIMIT 1
      `,
      [doctorId]
    );

    if (doctors.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    const doctor = doctors[0];

    if (!doctor.is_active) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Doctor is inactive",
      });
    }

    // ========================================
    // SPECIALIZATION REQUIRED
    // ========================================

    if (!doctor.specialization?.trim()) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Doctor does not have a specialization",
      });
    }

    // ========================================
    // GET DOCTOR WORKING DAYS
    // ========================================

    const [workingDays] = await connection.query(
      `
      SELECT day_of_week
      FROM doctor_weekly_schedule
      WHERE doctor_id = ?
        AND is_active = TRUE
      ORDER BY FIELD(
        day_of_week,
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
        'SUNDAY'
      )
      `,
      [doctorId]
    );

    if (workingDays.length === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Doctor has no active working days. Please configure working days first.",
      });
    }

    // ========================================
    // CHECK SELECTED DATE IS WORKING DAY
    // ========================================

    const [selectedDayResult] = await connection.query(
      `
      SELECT day_of_week
      FROM doctor_weekly_schedule
      WHERE doctor_id = ?
        AND day_of_week = UPPER(DAYNAME(?))
        AND is_active = TRUE
      LIMIT 1
      `,
      [doctorId, assignmentDate]
    );

    if (selectedDayResult.length === 0) {
      await connection.rollback();

      const availableDays = workingDays.map(
        (row) => row.day_of_week
      );

      const requestedDay = new Date(
        `${assignmentDate}T00:00:00`
      )
        .toLocaleDateString("en-US", {
          weekday: "long",
          timeZone: "UTC",
        })
        .toUpperCase();

      return res.status(400).json({
        success: false,
        message: `Doctor is not available on ${requestedDay}`,
        requestedDay,
        workingDays: availableDays,
      });
    }

    // ========================================
    // CHECK ROOM
    // ========================================

    const [rooms] = await connection.query(
      `
      SELECT
        id,
        room_number,
        room_name,
        is_active
      FROM rooms
      WHERE id = ?
      LIMIT 1
      `,
      [roomId]
    );

    if (rooms.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    if (!rooms[0].is_active) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Room is inactive",
      });
    }

    // ========================================
    // LOCK ROOM
    // ========================================

    await connection.query(
      `
      SELECT id
      FROM rooms
      WHERE id = ?
      FOR UPDATE
      `,
      [roomId]
    );

    // ========================================
    // CHECK EXISTING ASSIGNMENT
    //
    // For normal assignment:
    // same doctor + same date
    //
    // For recurring assignment:
    // same doctor + same room + recurring
    // ========================================

    let existingAssignmentQuery;
    let existingAssignmentParams;

    if (Boolean(isRecurring)) {
      existingAssignmentQuery = `
        SELECT id
        FROM doctor_room_assignments
        WHERE doctor_id = ?
          AND room_id = ?
          AND is_recurring = TRUE
          AND is_active = TRUE
        LIMIT 1
      `;

      existingAssignmentParams = [
        doctorId,
        roomId,
      ];
    } else {
      existingAssignmentQuery = `
        SELECT id
        FROM doctor_room_assignments
        WHERE doctor_id = ?
          AND assignment_date = ?
          AND is_active = TRUE
        LIMIT 1
      `;

      existingAssignmentParams = [
        doctorId,
        assignmentDate,
      ];
    }

    const [existingAssignment] =
      await connection.query(
        existingAssignmentQuery,
        existingAssignmentParams
      );

    if (existingAssignment.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: Boolean(isRecurring)
          ? "Doctor already has a recurring room assignment"
          : "Doctor is already assigned for this date",
      });
    }

    // ========================================
    // CHECK ROOM DOCTOR LIMIT
    // MAX 3 DOCTORS PER ROOM PER DATE
    //
    // IMPORTANT:
    // recurring assignment itself should not
    // count as a permanent date assignment.
    // ========================================

    const [roomAssignments] = await connection.query(
      `
      SELECT
        dra.id,
        dra.doctor_id,
        d.name AS doctor_name,
        dra.start_time,
        dra.end_time
      FROM doctor_room_assignments dra

      INNER JOIN doctors d
        ON d.id = dra.doctor_id

      WHERE dra.room_id = ?
        AND dra.assignment_date = ?
        AND dra.is_active = TRUE

      ORDER BY dra.id ASC
      `,
      [roomId, assignmentDate]
    );

    if (roomAssignments.length >= 3) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Maximum 3 doctors can be assigned to this room for this date",

        roomId,
        assignmentDate,

        assignedDoctors:
          roomAssignments.map((row) => ({
            doctorId: row.doctor_id,
            doctorName: row.doctor_name,
            startTime: row.start_time,
            endTime: row.end_time,
          })),
      });
    }

    // ========================================
    // GET / CREATE SPECIALIZATION
    // ========================================

    const specializationName =
      doctor.specialization.trim();

    let specializationId;

    const [specializations] =
      await connection.query(
        `
        SELECT
          id,
          is_active
        FROM specializations
        WHERE LOWER(TRIM(name)) =
              LOWER(TRIM(?))
        LIMIT 1
        `,
        [specializationName]
      );

    if (specializations.length > 0) {
      specializationId =
        specializations[0].id;

      if (!specializations[0].is_active) {
        await connection.query(
          `
          UPDATE specializations
          SET is_active = TRUE
          WHERE id = ?
          `,
          [specializationId]
        );
      }
    } else {
      const [specializationResult] =
        await connection.query(
          `
          INSERT INTO specializations
          (
            name,
            description,
            is_active
          )
          VALUES (?, ?, TRUE)
          `,
          [
            specializationName,
            null,
          ]
        );

      specializationId =
        specializationResult.insertId;
    }

    // ========================================
    // ROOM ↔ SPECIALIZATION
    // ========================================

    const [roomSpecialization] =
      await connection.query(
        `
        SELECT id
        FROM room_specializations
        WHERE room_id = ?
          AND specialization_id = ?
        LIMIT 1
        `,
        [
          roomId,
          specializationId,
        ]
      );

    if (roomSpecialization.length === 0) {
      await connection.query(
        `
        INSERT INTO room_specializations
        (
          room_id,
          specialization_id,
          is_active
        )
        VALUES (?, ?, TRUE)
        `,
        [
          roomId,
          specializationId,
        ]
      );
    } else {
      await connection.query(
        `
        UPDATE room_specializations
        SET is_active = TRUE
        WHERE id = ?
        `,
        [roomSpecialization[0].id]
      );
    }

    // ========================================
    // CREATE DOCTOR ROOM ASSIGNMENT
    //
    // assignment_date = selected/start date
    // is_recurring = TRUE means:
    // assignment continues according to
    // doctor_weekly_schedule
    // ========================================

    const [assignmentResult] =
      await connection.query(
        `
        INSERT INTO doctor_room_assignments
        (
          doctor_id,
          room_id,
          assignment_date,
          start_time,
          end_time,
          is_active,
          is_recurring
        )
        VALUES (?, ?, ?, ?, ?, TRUE, ?)
        `,
        [
          doctorId,
          roomId,
          assignmentDate,
          startTime,
          endTime,
          Boolean(isRecurring),
        ]
      );

    // ========================================
    // CREATE OPD SESSION
    //
    // Create session for the selected/start date
    // ========================================

    const [sessionResult] =
      await connection.query(
        `
        INSERT INTO opd_sessions
        (
          room_id,
          doctor_id,
          opd_date,
          token_start_time,
          consultation_start_time,
          token_close_time,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, 'NOT_STARTED')
        `,
        [
          roomId,
          doctorId,
          assignmentDate,
          startTime,
          consultationStartTime,
          endTime,
        ]
      );

    // ========================================
    // COMMIT
    // ========================================

    await connection.commit();

    // ========================================
    // RESPONSE
    // ========================================

    return res.status(201).json({
      success: true,

      message: Boolean(isRecurring)
        ? "Doctor assigned to room with recurring weekly schedule"
        : "Doctor assigned to room successfully",

      data: {
        assignmentId:
          assignmentResult.insertId,

        opdSessionId:
          sessionResult.insertId,

        doctorId,
        roomId,

        specializationId,
        specialization:
          specializationName,

        assignmentDate,

        startTime,
        consultationStartTime,
        endTime,

        isRecurring:
          Boolean(isRecurring),

        workingDays:
          workingDays.map(
            (row) => row.day_of_week
          ),
      },
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {}

    console.error(
      "Assign doctor to room error:",
      error
    );

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message:
          "Doctor-room assignment or OPD session already exists",
      });
    }

    next(error);
  } finally {
    connection.release();
  }
};
// ========================================
// GET ASSIGNMENTS
// ========================================

const getDoctorRoomAssignments = async (
  req,
  res,
  next,
) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT
        dra.id,
        dra.assignment_date,
        dra.start_time,
        dra.end_time,
        dra.is_active,
        dra.is_recurring,

        d.id AS doctor_id,
        d.name AS doctor_name,

        r.id AS room_id,
        r.room_number,
        r.room_name

      FROM doctor_room_assignments dra

      INNER JOIN doctors d
        ON d.id = dra.doctor_id

      INNER JOIN rooms r
        ON r.id = dra.room_id

      ORDER BY
        dra.assignment_date DESC,
        r.room_number ASC,
        dra.start_time ASC
      `,
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error(
      "Get doctor room assignments error:",
      error,
    );

    next(error);
  }
};

// ========================================
// UPDATE DOCTOR ROOM ASSIGNMENT
// ========================================

const updateDoctorRoomAssignment = async (
  req,
  res,
  next,
) => {
  const connection = await pool.getConnection();

  try {
    const { id } = req.params;

    const {
      doctorId,
      roomId,
      assignmentDate,
      startTime,
      endTime,
      isActive,
    } = req.body;

    // ========================================
    // GET EXISTING ASSIGNMENT
    // ========================================

    const [existingRows] = await connection.query(
      `
      SELECT
        id,
        doctor_id,
        room_id,
        assignment_date,
        start_time,
        end_time,
        is_active
      FROM doctor_room_assignments
      WHERE id = ?
      LIMIT 1
      `,
      [id],
    );

    if (existingRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found",
      });
    }

    const existing = existingRows[0];

    // ========================================
    // FINAL VALUES
    // ========================================

    const finalDoctorId =
      doctorId !== undefined &&
      doctorId !== null
        ? doctorId
        : existing.doctor_id;

    const finalRoomId =
      roomId !== undefined &&
      roomId !== null
        ? roomId
        : existing.room_id;

    const finalDate =
      assignmentDate || existing.assignment_date;

    const finalStartTime =
      startTime || existing.start_time;

    const finalEndTime =
      endTime || existing.end_time;

    const finalIsActive =
      isActive !== undefined
        ? Boolean(isActive)
        : Boolean(existing.is_active);

    // ========================================
    // START TRANSACTION
    // ========================================

    await connection.beginTransaction();

    // ========================================
    // CHECK DOCTOR
    // ========================================

    const [doctors] = await connection.query(
      `
      SELECT
        id,
        doctor_code,
        name,
        specialization,
        is_active
      FROM doctors
      WHERE id = ?
      LIMIT 1
      `,
      [finalDoctorId],
    );

    if (doctors.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    const doctor = doctors[0];

    if (!doctor.is_active) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Doctor is inactive",
      });
    }

    // ========================================
    // CHECK DOCTOR WEEKLY WORKING DAY
    // ========================================

    const [weeklySchedule] = await connection.query(
      `
      SELECT day_of_week
      FROM doctor_weekly_schedule
      WHERE doctor_id = ?
        AND day_of_week = UPPER(DAYNAME(?))
        AND is_active = TRUE
      LIMIT 1
      `,
      [finalDoctorId, finalDate],
    );

    if (weeklySchedule.length === 0) {
      await connection.rollback();

      const [workingDays] = await connection.query(
        `
        SELECT day_of_week
        FROM doctor_weekly_schedule
        WHERE doctor_id = ?
          AND is_active = TRUE
        ORDER BY FIELD(
          day_of_week,
          'MONDAY',
          'TUESDAY',
          'WEDNESDAY',
          'THURSDAY',
          'FRIDAY',
          'SATURDAY',
          'SUNDAY'
        )
        `,
        [finalDoctorId],
      );

      const availableDays = workingDays.map(
        (row) => row.day_of_week,
      );

      const requestedDay = new Date(
        `${finalDate}T00:00:00`,
      )
        .toLocaleDateString("en-US", {
          weekday: "long",
          timeZone: "UTC",
        })
        .toUpperCase();

      return res.status(400).json({
        success: false,
        message:
          `Doctor is not available on ${requestedDay}`,
        requestedDay,
        workingDays: availableDays,
      });
    }

    // ========================================
    // CHECK ROOM
    // ========================================

    const [rooms] = await connection.query(
      `
      SELECT
        id,
        room_number,
        room_name,
        is_active
      FROM rooms
      WHERE id = ?
      LIMIT 1
      `,
      [finalRoomId],
    );

    if (rooms.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    if (!rooms[0].is_active) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Room is inactive",
      });
    }

    // ========================================
    // IF ACTIVE:
    // LOCK ROOM + CHECK LIMIT
    // ========================================

    if (finalIsActive) {
      // Lock room
      await connection.query(
        `
        SELECT id
        FROM rooms
        WHERE id = ?
        FOR UPDATE
        `,
        [finalRoomId],
      );

      // ========================================
      // CHECK DOCTOR DUPLICATE ASSIGNMENT
      // SAME DOCTOR + SAME DATE
      // ========================================

      const [doctorAssignments] =
        await connection.query(
          `
          SELECT id
          FROM doctor_room_assignments
          WHERE
            doctor_id = ?
            AND assignment_date = ?
            AND is_active = TRUE
            AND id != ?
          LIMIT 1
          `,
          [
            finalDoctorId,
            finalDate,
            id,
          ],
        );

      if (doctorAssignments.length > 0) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Doctor is already assigned for this date",
        });
      }

      // ========================================
      // CHECK ROOM DOCTOR LIMIT
      // MAX 3 DOCTORS PER ROOM PER DATE
      // SAME TIME IS ALLOWED
      // ========================================

      const [roomAssignments] =
        await connection.query(
          `
          SELECT
            dra.id,
            dra.doctor_id,
            d.name AS doctor_name,
            dra.start_time,
            dra.end_time
          FROM doctor_room_assignments dra

          INNER JOIN doctors d
            ON d.id = dra.doctor_id

          WHERE
            dra.room_id = ?
            AND dra.assignment_date = ?
            AND dra.is_active = TRUE
            AND dra.id != ?

          ORDER BY dra.id ASC
          `,
          [
            finalRoomId,
            finalDate,
            id,
          ],
        );

      // Maximum 3 doctors
      if (roomAssignments.length >= 3) {
        await connection.rollback();

        return res.status(409).json({
          success: false,

          message:
            "Maximum 3 doctors can be assigned to this room for this date",

          roomId: finalRoomId,

          assignmentDate: finalDate,

          assignedDoctors:
            roomAssignments.map((row) => ({
              doctorId: row.doctor_id,
              doctorName: row.doctor_name,
              startTime: row.start_time,
              endTime: row.end_time,
            })),
        });
      }
    }

    // ========================================
    // UPDATE ASSIGNMENT
    // ========================================

    await connection.query(
      `
      UPDATE doctor_room_assignments
      SET
        doctor_id = ?,
        room_id = ?,
        assignment_date = ?,
        start_time = ?,
        end_time = ?,
        is_active = ?
      WHERE id = ?
      `,
      [
        finalDoctorId,
        finalRoomId,
        finalDate,
        finalStartTime,
        finalEndTime,
        finalIsActive,
        id,
      ],
    );

    // ========================================
    // UPDATE OPD SESSION
    // ========================================

    const [sessionResult] =
      await connection.query(
        `
        UPDATE opd_sessions
        SET
          doctor_id = ?,
          room_id = ?,
          opd_date = ?,
          token_start_time = ?,
          token_close_time = ?

        WHERE
          doctor_id = ?
          AND room_id = ?
          AND opd_date = ?
        `,
        [
          finalDoctorId,
          finalRoomId,
          finalDate,
          finalStartTime,
          finalEndTime,

          existing.doctor_id,
          existing.room_id,
          existing.assignment_date,
        ],
      );

    // ========================================
    // IF OPD SESSION DOES NOT EXIST
    // CREATE NEW ONE
    // ========================================

    if (
      sessionResult.affectedRows === 0 &&
      finalIsActive
    ) {
      await connection.query(
        `
        INSERT INTO opd_sessions
        (
          room_id,
          doctor_id,
          opd_date,
          token_start_time,
          consultation_start_time,
          token_close_time,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, 'NOT_STARTED')
        `,
        [
          finalRoomId,
          finalDoctorId,
          finalDate,
          finalStartTime,
          finalStartTime,
          finalEndTime,
        ],
      );
    }

    // ========================================
    // COMMIT
    // ========================================

    await connection.commit();

    // ========================================
    // RESPONSE
    // ========================================

    return res.status(200).json({
      success: true,

      message:
        "Doctor-room assignment and OPD session updated successfully",

      data: {
        id: Number(id),

        doctorId: finalDoctorId,

        roomId: finalRoomId,

        assignmentDate: finalDate,

        startTime: finalStartTime,

        endTime: finalEndTime,

        isActive: finalIsActive,
      },
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {}

    console.error(
      "Update doctor-room assignment error:",
      error,
    );

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message:
          "Doctor-room assignment or OPD session already exists",
      });
    }

    next(error);
  } finally {
    connection.release();
  }
};

// 1. MAIN DASHBOARD
const getDashboard = async (req, res, next) => {
  try {
    const [doctorCount] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM doctors
      WHERE is_active = TRUE
      `,
    );

    const [roomCount] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM rooms
      WHERE is_active = TRUE
      `,
    );

    const [patientCount] = await pool.query(
      `
      SELECT COUNT(DISTINCT patient_id) AS total
      FROM tokens
      WHERE token_date = CURDATE()
      `,
    );

    const [stock] = await pool.query(
      `
      SELECT
        COALESCE(SUM(stock_quantity), 0) AS remaining_stock
      FROM medicines
      WHERE is_active = TRUE
      `,
    );

    const [usedToday] = await pool.query(
      `
      SELECT
        COALESCE(SUM(quantity), 0) AS used_today
      FROM inventory_transactions
      WHERE transaction_type = 'DISPENSE'
        AND DATE(created_at) = CURDATE()
      `,
    );

    const [tokens] = await pool.query(
      `
      SELECT
        status,
        COUNT(*) AS total
      FROM tokens
      WHERE token_date = CURDATE()
      GROUP BY status
      `,
    );

    return res.status(200).json({
      success: true,
      data: {
        doctors: {
          total: doctorCount[0].total,
        },

        rooms: {
          total: roomCount[0].total,
        },

        patients: {
          today: patientCount[0].total,
        },

        inventory: {
          remainingStock: stock[0].remaining_stock,

          usedToday: usedToday[0].used_today,
        },

        tokens,
      },
    });
  } catch (error) {
    next(error);
  }
};

// 2. PATIENT STATISTICS
const getPatientStats = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT
        status,
        COUNT(*) AS total
      FROM tokens
      WHERE token_date = CURDATE()
      GROUP BY status
      ORDER BY total DESC
      `,
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
};

// 3. MEDICINE STATISTICS
const getMedicineStats = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT

        m.id,
        m.name,
        m.stock_quantity,

        COALESCE(
          SUM(
            CASE
              WHEN it.transaction_type = 'DISPENSE'
              AND DATE(it.created_at) = CURDATE()
              THEN it.quantity
              ELSE 0
            END
          ),
          0
        ) AS used_today

      FROM medicines m

      LEFT JOIN inventory_transactions it
        ON it.medicine_id = m.id

      WHERE m.is_active = TRUE

      GROUP BY
        m.id,
        m.name,
        m.stock_quantity

      ORDER BY m.name ASC
      `,
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
};

// 4. ROOM STATISTICS
const getRoomStats = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT

        r.id,
        r.room_number,
        r.room_name,

        COUNT(
          CASE
            WHEN t.token_date = CURDATE()
            THEN t.id
          END
        ) AS total_patients

      FROM rooms r

      LEFT JOIN opd_sessions os
        ON os.room_id = r.id
        AND os.opd_date = CURDATE()

      LEFT JOIN tokens t
        ON t.opd_session_id = os.id

      WHERE r.is_active = TRUE

      GROUP BY
        r.id,
        r.room_number,
        r.room_name

      ORDER BY r.room_number ASC
      `,
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
};

// 5. DOCTOR STATISTICS
const getDoctorStats = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT

        d.id,
        d.name,

        COUNT(
          CASE
            WHEN t.token_date = CURDATE()
            AND t.status IN (
              'COMPLETED',
              'MEDICINE_PENDING',
              'MEDICINE_COMPLETED'
            )
            THEN t.id
          END
        ) AS completed_patients

      FROM doctors d

      LEFT JOIN opd_sessions os
        ON os.doctor_id = d.id
        AND os.opd_date = CURDATE()

      LEFT JOIN tokens t
        ON t.opd_session_id = os.id

      WHERE d.is_active = TRUE

      GROUP BY
        d.id,
        d.name

      ORDER BY completed_patients DESC
      `,
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// GET ALL PRESCRIPTIONS
// ============================================
const getPrescriptions = async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        p.id AS id,

        p.token_id AS tokenId,
        t.token_number AS tokenNumber,

        p.patient_id AS patientId,
        pt.name AS patientName,
        pt.mobile AS patientMobile,

        p.doctor_id AS doctorId,
        d.name AS doctorName,
        d.specialization AS specialization,

        p.room_id AS roomId,
        r.room_number AS roomNumber,

        p.advice AS advice,

        p.status AS status,

        p.cancellation_reason AS cancelReason,
        p.cancelled_by AS cancelledBy,
        p.cancelled_at AS cancelledAt,

        p.prescribed_at AS prescribedAt,
        p.completed_at AS completedAt,

        COUNT(pi.id) AS medicineCount

      FROM prescriptions p

      LEFT JOIN tokens t
        ON t.id = p.token_id

      LEFT JOIN patients pt
        ON pt.id = p.patient_id

      LEFT JOIN doctors d
        ON d.id = p.doctor_id

      LEFT JOIN rooms r
        ON r.id = p.room_id

      LEFT JOIN prescription_items pi
        ON pi.prescription_id = p.id

      GROUP BY
        p.id,
        p.token_id,
        t.token_number,
        p.patient_id,
        pt.name,
        pt.mobile,
        p.doctor_id,
        d.name,
        d.specialization,
        p.room_id,
        r.room_number,
        p.advice,
        p.status,
        p.cancellation_reason,
        p.cancelled_by,
        p.cancelled_at,
        p.prescribed_at,
        p.completed_at

      ORDER BY p.prescribed_at DESC
    `);

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
};

// 1. CANCEL PRESCRIPTION
const cancelPrescription = async (req, res, next) => {
  const connection = await pool.getConnection();

  try {
    const adminId = req.user.userId;

    const { id } = req.params;

    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: "Cancellation reason is required",
      });
    }

    await connection.beginTransaction();

    // ---------------------------------------------
    // Find prescription
    // ---------------------------------------------

    const [prescriptions] = await connection.query(
      `
      SELECT
        id,
        token_id,
        patient_id,
        status

      FROM prescriptions

      WHERE id = ?

      FOR UPDATE
      `,
      [id],
    );

    if (prescriptions.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Prescription not found",
      });
    }

    const prescription = prescriptions[0];

    // ---------------------------------------------
    // Check status
    // ---------------------------------------------

    if (prescription.status === "CANCELLED") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Prescription is already cancelled",
      });
    }

    if (prescription.status === "COMPLETED") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Completed prescription cannot be cancelled",
      });
    }

    // ---------------------------------------------
    // Update prescription
    // ---------------------------------------------

    await connection.query(
      `
      UPDATE prescriptions

      SET

        status = 'CANCELLED',

        cancellation_reason = ?,

        cancelled_by = ?,

        cancelled_at = NOW()

      WHERE id = ?
      `,
      [reason.trim(), adminId, id],
    );

    // ---------------------------------------------
    // Update token
    // ---------------------------------------------

    await connection.query(
      `
      UPDATE tokens

      SET status = 'PRESCRIPTION_CANCELLED'

      WHERE id = ?

        AND status = 'MEDICINE_PENDING'
      `,
      [prescription.token_id],
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Prescription cancelled successfully",
      data: {
        prescriptionId: id,
        status: "CANCELLED",
      },
    });
  } catch (error) {
    await connection.rollback();

    next(error);
  } finally {
    connection.release();
  }
};

// 2. GET CANCELLED PRESCRIPTIONS
const getCancelledPrescriptions = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT

        p.id AS prescription_id,

        p.token_id,
        t.token_number,

        pt.patient_id,
        pt.name AS patient_name,

        d.name AS doctor_name,

        p.cancellation_reason,
        p.cancelled_by,
        p.cancelled_at

      FROM prescriptions p

      INNER JOIN tokens t
        ON t.id = p.token_id

      INNER JOIN patients pt
        ON pt.id = p.patient_id

      INNER JOIN doctors d
        ON d.id = p.doctor_id

      WHERE p.status = 'CANCELLED'

      ORDER BY p.cancelled_at DESC
      `,
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
};

// 1. CLOSE DAY
const closeDay = async (req, res, next) => {
  const connection = await pool.getConnection();

  try {
    const adminId = req.user.userId;

    const reportDate = req.body.date || new Date().toISOString().split("T")[0];

    await connection.beginTransaction();

    // ---------------------------------------------
    // Check if report already exists
    // ---------------------------------------------

    const [existingReports] = await connection.query(
      `
      SELECT id
      FROM day_end_reports
      WHERE report_date = ?
      LIMIT 1
      `,
      [reportDate],
    );

    if (existingReports.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "Day-end report already exists for this date",
      });
    }

    // ---------------------------------------------
    // Total patients
    // ---------------------------------------------

    const [patientRows] = await connection.query(
      `
      SELECT
        COUNT(DISTINCT patient_id) AS total_patients
      FROM tokens
      WHERE token_date = ?
      `,
      [reportDate],
    );

    // ---------------------------------------------
    // Total tokens
    // ---------------------------------------------

    const [tokenRows] = await connection.query(
      `
      SELECT
        COUNT(*) AS total_tokens
      FROM tokens
      WHERE token_date = ?
      `,
      [reportDate],
    );

    // ---------------------------------------------
    // Token status summary
    // ---------------------------------------------

    const [statusRows] = await connection.query(
      `
      SELECT
        status,
        COUNT(*) AS total
      FROM tokens
      WHERE token_date = ?
      GROUP BY status
      `,
      [reportDate],
    );

    let completed = 0;
    let waiting = 0;
    let hold = 0;
    let skipped = 0;
    let medicinePending = 0;
    let medicineCompleted = 0;

    statusRows.forEach((row) => {
      switch (row.status) {
        case "COMPLETED":
          completed = row.total;
          break;

        case "WAITING":
          waiting = row.total;
          break;

        case "HOLD":
          hold = row.total;
          break;

        case "SKIPPED":
          skipped = row.total;
          break;

        case "MEDICINE_PENDING":
          medicinePending = row.total;
          break;

        case "MEDICINE_COMPLETED":
          medicineCompleted = row.total;
          break;
      }
    });

    // ---------------------------------------------
    // Total prescriptions
    // ---------------------------------------------

    const [prescriptionRows] = await connection.query(
      `
      SELECT
        COUNT(*) AS total_prescriptions
      FROM prescriptions
      WHERE DATE(prescribed_at) = ?
      `,
      [reportDate],
    );

    // ---------------------------------------------
    // Medicine usage
    // ---------------------------------------------

    const [medicineRows] = await connection.query(
      `
      SELECT

        COALESCE(
          SUM(
            CASE
              WHEN transaction_type = 'DISPENSE'
              THEN quantity
              ELSE 0
            END
          ),
          0
        ) AS medicines_used

      FROM inventory_transactions

      WHERE DATE(created_at) = ?
      `,
      [reportDate],
    );

    // ---------------------------------------------
    // Medicine given / unavailable
    // ---------------------------------------------

    const [dispensingRows] = await connection.query(
      `
      SELECT

        COALESCE(
          SUM(
            CASE
              WHEN md.status = 'GIVEN'
              THEN md.given_quantity
              ELSE 0
            END
          ),
          0
        ) AS medicines_given,

        COUNT(
          CASE
            WHEN md.status = 'UNAVAILABLE'
            THEN 1
          END
        ) AS medicines_unavailable

      FROM medicine_dispensing md

      INNER JOIN prescription_items pi
        ON pi.id = md.prescription_item_id

      INNER JOIN prescriptions p
        ON p.id = pi.prescription_id

      WHERE DATE(p.prescribed_at) = ?
      `,
      [reportDate],
    );

    // ---------------------------------------------
    // Remaining stock
    // ---------------------------------------------

    const [stockRows] = await connection.query(
      `
      SELECT
        COALESCE(
          SUM(stock_quantity),
          0
        ) AS remaining_stock
      FROM medicines
      WHERE is_active = TRUE
      `,
    );

    // ---------------------------------------------
    // Create report
    // ---------------------------------------------

    const [result] = await connection.query(
      `
      INSERT INTO day_end_reports
      (
        report_date,
        total_patients,
        total_tokens,
        completed_tokens,
        waiting_tokens,
        hold_tokens,
        skipped_tokens,
        medicine_pending_tokens,
        medicine_completed_tokens,
        total_prescriptions,
        medicines_used,
        medicines_given,
        medicines_unavailable,
        remaining_stock,
        closed_by,
        closed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        reportDate,

        patientRows[0].total_patients,

        tokenRows[0].total_tokens,

        completed,
        waiting,
        hold,
        skipped,
        medicinePending,
        medicineCompleted,

        prescriptionRows[0].total_prescriptions,

        medicineRows[0].medicines_used,

        dispensingRows[0].medicines_given,

        dispensingRows[0].medicines_unavailable,

        stockRows[0].remaining_stock,

        adminId,
      ],
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Day-end report created successfully",
      data: {
        reportId: result.insertId,
        reportDate,
      },
    });
  } catch (error) {
    await connection.rollback();

    next(error);
  } finally {
    connection.release();
  }
};

// 2. GET DAY-END REPORTS
const getReports = async (req, res, next) => {
  try {
    const { from, to } = req.query;

    let query = `
      SELECT

        id,
        report_date,

        total_patients,
        total_tokens,

        completed_tokens,
        waiting_tokens,
        hold_tokens,
        skipped_tokens,

        medicine_pending_tokens,
        medicine_completed_tokens,

        total_prescriptions,

        medicines_used,
        medicines_given,
        medicines_unavailable,

        remaining_stock,

        closed_by,
        closed_at

      FROM day_end_reports

      WHERE 1 = 1
    `;

    const params = [];

    if (from) {
      query += `
        AND report_date >= ?
      `;

      params.push(from);
    }

    if (to) {
      query += `
        AND report_date <= ?
      `;

      params.push(to);
    }

    query += `
      ORDER BY report_date DESC
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

// 3. GET SINGLE DAY-END REPORT
const getReportById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      `
      SELECT

        id,
        report_date,

        total_patients,
        total_tokens,

        completed_tokens,
        waiting_tokens,
        hold_tokens,
        skipped_tokens,

        medicine_pending_tokens,
        medicine_completed_tokens,

        total_prescriptions,

        medicines_used,
        medicines_given,
        medicines_unavailable,

        remaining_stock,

        closed_by,
        closed_at

      FROM day_end_reports

      WHERE id = ?

      LIMIT 1
      `,
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Day-end report not found",
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

// 1. GET MEDICINES
const getMedicines = async (req, res, next) => {
  try {
    const { search = "", includeInactive = "false" } = req.query;

    let query = `
      SELECT
        id,
        name,
        generic_name,
        unit,
        stock_quantity,
        is_active,
        created_at,
        updated_at
      FROM medicines
      WHERE 1 = 1
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

    if (includeInactive !== "true") {
      query += `
        AND is_active = TRUE
      `;
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

// 2. ADD MEDICINE
const addMedicine = async (req, res, next) => {
  try {
    const { name, genericName, unit, stockQuantity } = req.body;

    if (!name || stockQuantity === undefined) {
      return res.status(400).json({
        success: false,
        message: "Medicine name and stock quantity are required",
      });
    }

    if (Number(stockQuantity) < 0) {
      return res.status(400).json({
        success: false,
        message: "Stock quantity cannot be negative",
      });
    }

    const [existing] = await pool.query(
      `
      SELECT id
      FROM medicines
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
      [name.trim()],
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Medicine already exists",
      });
    }

    const [result] = await pool.query(
      `
      INSERT INTO medicines
      (
        name,
        generic_name,
        unit,
        stock_quantity,
        is_active
      )
      VALUES (?, ?, ?, ?, TRUE)
      `,
      [
        name.trim(),
        genericName || null,
        unit || "TABLET",
        Number(stockQuantity),
      ],
    );

    return res.status(201).json({
      success: true,
      message: "Medicine added successfully",
      data: {
        id: result.insertId,
        name: name.trim(),
        stockQuantity: Number(stockQuantity),
      },
    });
  } catch (error) {
    next(error);
  }
};

// 3. UPDATE MEDICINE
const updateMedicine = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { name, genericName, unit, stockQuantity } = req.body;

    const [medicines] = await pool.query(
      `
      SELECT id
      FROM medicines
      WHERE id = ?
      LIMIT 1
      `,
      [id],
    );

    if (medicines.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Medicine not found",
      });
    }

    if (stockQuantity !== undefined && Number(stockQuantity) < 0) {
      return res.status(400).json({
        success: false,
        message: "Stock quantity cannot be negative",
      });
    }

    await pool.query(
      `
      UPDATE medicines
      SET
        name = COALESCE(?, name),
        generic_name = COALESCE(?, generic_name),
        unit = COALESCE(?, unit),
        stock_quantity = COALESCE(?, stock_quantity)
      WHERE id = ?
      `,
      [
        name || null,
        genericName || null,
        unit || null,
        stockQuantity !== undefined ? Number(stockQuantity) : null,
        id,
      ],
    );

    return res.status(200).json({
      success: true,
      message: "Medicine updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

// 4. DELETE / DEACTIVATE MEDICINE
const deleteMedicine = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      `
      UPDATE medicines
      SET is_active = FALSE
      WHERE id = ?
        AND is_active = TRUE
      `,
      [id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Medicine not found or already inactive",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Medicine removed successfully",
    });
  } catch (error) {
    next(error);
  }
};

// 5. CURRENT INVENTORY
const getInventory = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT
        id,
        name,
        generic_name,
        unit,
        stock_quantity
      FROM medicines
      WHERE is_active = TRUE
      ORDER BY name ASC
      `,
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
};

// 6. INVENTORY TRANSACTIONS
const getInventoryTransactions = async (req, res, next) => {
  try {
    const { medicineId, from, to } = req.query;

    let query = `
      SELECT

        it.id,

        it.medicine_id,
        m.name AS medicine_name,

        it.transaction_type,
        it.quantity,

        it.stock_before,
        it.stock_after,

        it.prescription_item_id,
        it.notes,

        it.created_at

      FROM inventory_transactions it

      INNER JOIN medicines m
        ON m.id = it.medicine_id

      WHERE 1 = 1
    `;

    const params = [];

    if (medicineId) {
      query += ` AND it.medicine_id = ? `;
      params.push(medicineId);
    }

    if (from) {
      query += ` AND DATE(it.created_at) >= ? `;
      params.push(from);
    }

    if (to) {
      query += ` AND DATE(it.created_at) <= ? `;
      params.push(to);
    }

    query += `
      ORDER BY it.created_at DESC
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

// START OPD
// START OPD
const startOpd = async (req, res, next) => {
  const connection = await pool.getConnection();

  try {
    const { opdSessionId, roomId } = req.body;

    if (!opdSessionId && !roomId) {
      return res.status(400).json({
        success: false,
        message: "opdSessionId or roomId is required",
      });
    }

    await connection.beginTransaction();

    let sessionId = opdSessionId;

    // ========================================
    // CASE 1: Session ID already exists
    // ========================================
    if (opdSessionId) {
      const [result] = await connection.query(
        `
        UPDATE opd_sessions
        SET
          status = 'RUNNING',
          started_at = NOW(),
          ended_at = NULL
        WHERE id = ?
          AND opd_date = CURDATE()
          AND status = 'NOT_STARTED'
        `,
        [opdSessionId],
      );

      if (result.affectedRows === 0) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "OPD cannot be started",
        });
      }
    }

    // ========================================
    // CASE 2: No session exists
    // Create today's session
    // ========================================
    else {
      const [assignments] = await connection.query(
        `
        SELECT
          dra.doctor_id,
          dra.room_id
        FROM doctor_room_assignments dra
        WHERE dra.room_id = ?
          AND dra.assignment_date = CURDATE()
          AND dra.is_active = 1
        LIMIT 1
        `,
        [roomId],
      );

      if (assignments.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message: "No active doctor assignment found for this room",
        });
      }

      const { doctor_id, room_id } = assignments[0];

      // Check whether session was created by another request
      const [existingSessions] = await connection.query(
        `
        SELECT id, status
        FROM opd_sessions
        WHERE doctor_id = ?
          AND room_id = ?
          AND opd_date = CURDATE()
        LIMIT 1
        `,
        [doctor_id, room_id],
      );

      if (existingSessions.length > 0) {
        sessionId = existingSessions[0].id;

        if (existingSessions[0].status !== "NOT_STARTED") {
          await connection.rollback();

          return res.status(400).json({
            success: false,
            message: `OPD is already ${existingSessions[0].status}`,
          });
        }

        await connection.query(
          `
          UPDATE opd_sessions
          SET
            status = 'RUNNING',
            started_at = NOW(),
            ended_at = NULL
          WHERE id = ?
          `,
          [sessionId],
        );
      } else {
        const [insertResult] = await connection.query(
          `
          INSERT INTO opd_sessions
          (
            doctor_id,
            room_id,
            opd_date,
            status,
            started_at
          )
          VALUES (?, ?, CURDATE(), 'RUNNING', NOW())
          `,
          [doctor_id, room_id],
        );

        sessionId = insertResult.insertId;
      }
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "OPD started successfully",
      status: "RUNNING",
      opdSessionId: sessionId,
    });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};

// END OPD
const endOpd = async (req, res, next) => {
  try {
    const { opdSessionId } = req.body;

    if (!opdSessionId) {
      return res.status(400).json({
        success: false,
        message: "opdSessionId is required",
      });
    }

    const [result] = await pool.query(
      `
        UPDATE opd_sessions
        SET
          status = 'ENDED',
          ended_at = NOW()
        WHERE id = ?
          AND opd_date = CURDATE()
          AND status = 'RUNNING'
        `,
      [opdSessionId],
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: "OPD cannot be ended",
      });
    }

    return res.status(200).json({
      success: true,
      message: "OPD ended successfully",
      status: "ENDED",
    });
  } catch (error) {
    next(error);
  }
};

const getTodayOpd = async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        r.id AS roomId,
        r.room_number AS roomNumber,
        r.room_name AS roomName,
        r.floor AS floor,

        d.id AS doctorId,
        d.name AS doctorName,
        d.specialization AS specialization,

        os.id AS opdSessionId,
        COALESCE(os.status, 'NOT_STARTED') AS status,
        os.started_at AS startedAt,
        os.ended_at AS endedAt,
        os.current_token_number AS currentToken

      FROM rooms r

LEFT JOIN doctor_room_assignments dra
  ON dra.room_id = r.id
  AND dra.is_active = 1
  AND (
    /* NORMAL ASSIGNMENT */
    (
      dra.is_recurring = 0
      AND dra.assignment_date = CURDATE()
    )

    OR

    /* RECURRING ASSIGNMENT */
    (
      dra.is_recurring = 1
      AND dra.assignment_date <= CURDATE()

      AND EXISTS (
        SELECT 1
        FROM doctor_weekly_schedule dws
        WHERE dws.doctor_id = dra.doctor_id
          AND dws.day_of_week =
              UPPER(DAYNAME(CURDATE()))
          AND dws.is_active = TRUE
      )
    )
  )

      LEFT JOIN doctors d
        ON d.id = dra.doctor_id

      LEFT JOIN opd_sessions os
        ON os.room_id = r.id
        AND os.doctor_id = dra.doctor_id
        AND os.opd_date = CURDATE()

      WHERE r.is_active = 1

      ORDER BY r.room_number ASC
    `);

    const data = rows.map((row) => ({
      id: row.roomId,
      number: String(row.roomNumber),
      roomName: row.roomName || null,
      floor: row.floor || null,

      doctorId: row.doctorId || null,
      doctorName: row.doctorName || null,
      specialization: row.specialization || null,

      opdSessionId: row.opdSessionId || null,
      status: row.status || "NOT_STARTED",

      startedAt: row.startedAt || null,
      endedAt: row.endedAt || null,

      currentToken: row.currentToken || null,
      totalPatients: 0,
    }));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};
module.exports = {
  addDoctor,
  getDoctors,
  updateDoctor,
  deleteDoctor,

  addRoom,
  getRooms,
  updateRoom,
  deleteRoom,

  assignDoctorToRoom,
  getDoctorRoomAssignments,
  updateDoctorRoomAssignment,

  startOpd,
  endOpd,
  getTodayOpd,

  getInventoryTransactions,
  getMedicines,
  addMedicine,
  updateMedicine,
  deleteMedicine,
  getInventory,

  getPrescriptions,
  cancelPrescription,
  getCancelledPrescriptions,

  closeDay,
  getReports,
  getReportById,

  getDashboard,
  getPatientStats,
  getMedicineStats,
  getRoomStats,
  getDoctorStats,
};
