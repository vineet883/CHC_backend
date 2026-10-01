const { pool } = require("../config/db");
const prescriptionReceipt = require("../utils/prescriptionReceipt");
// ======================================================
// 1. GET PENDING PRESCRIPTIONS
// GET /api/clinic/prescriptions/pending
// ======================================================

// ======================================================
// GET DISPENSING PRESCRIPTIONS
// GET /api/clinic/prescriptions/pending
// ======================================================

const getPendingPrescriptions = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `
        SELECT

          p.id AS prescription_id,

          t.id AS token_id,
          t.token_number,

          pt.patient_id,
          pt.name AS patient_name,

          d.id AS doctor_id,
          d.name AS doctor_name,

          r.id AS room_id,
          r.room_number,

          p.status AS prescription_status,

          p.prescribed_at,
          p.completed_at,

          COUNT(pi.id) AS medicine_count,

          COALESCE(
            SUM(
              CASE
                WHEN COALESCE(
                  md.status,
                  'PENDING'
                ) = 'GIVEN'
                THEN 1
                ELSE 0
              END
            ),
            0
          ) AS given_medicine_count,

          COALESCE(
            SUM(
              CASE
                WHEN COALESCE(
                  md.status,
                  'PENDING'
                ) = 'UNAVAILABLE'
                THEN 1
                ELSE 0
              END
            ),
            0
          ) AS unavailable_medicine_count,

          COALESCE(
            SUM(
              CASE
                WHEN COALESCE(
                  md.status,
                  'PENDING'
                ) = 'PENDING'
                THEN 1
                ELSE 0
              END
            ),
            0
          ) AS pending_medicine_count

        FROM prescriptions p

        INNER JOIN tokens t
          ON t.id = p.token_id

        INNER JOIN patients pt
          ON pt.id = p.patient_id

        INNER JOIN doctors d
          ON d.id = p.doctor_id

        INNER JOIN rooms r
          ON r.id = p.room_id

        LEFT JOIN prescription_items pi
          ON pi.prescription_id = p.id

        LEFT JOIN medicine_dispensing md
          ON md.prescription_item_id = pi.id

        WHERE p.status IN (
          'ACTIVE',
          'COMPLETED'
        )

        GROUP BY

          p.id,

          t.id,
          t.token_number,

          pt.patient_id,
          pt.name,

          d.id,
          d.name,

          r.id,
          r.room_number,

          p.status,

          p.prescribed_at,
          p.completed_at

        ORDER BY

          CASE
            WHEN p.status = 'ACTIVE'
            THEN 0
            ELSE 1
          END,

          p.prescribed_at ASC
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

// ======================================================
// 2. GET PRESCRIPTION DETAILS
// GET /api/clinic/prescriptions/:prescriptionId
// ======================================================

const getPrescriptionDetails = async (req, res, next) => {
  try {
    const { prescriptionId } = req.params;

    const [prescriptions] = await pool.query(
      `
      SELECT

        p.id AS prescription_id,

        t.id AS token_id,
        t.token_number,

        pt.patient_id,
        pt.name AS patient_name,
        pt.age,
        pt.gender,

        d.name AS doctor_name,

        r.room_number,

        p.advice,
        p.status,
        p.prescribed_at

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

      LIMIT 1
      `,
      [prescriptionId],
    );

    if (prescriptions.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Prescription not found",
      });
    }

    const prescription = prescriptions[0];

    const [items] = await pool.query(
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

        m.stock_quantity AS available_stock

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

    return res.status(200).json({
      success: true,
      data: {
        prescription,
        medicines: items,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// 3. DISPENSE MEDICINE
// POST /api/clinic/dispensing/:itemId
// ======================================================

const dispenseMedicine = async (req, res, next) => {
  const connection = await pool.getConnection();

  try {
    const { itemId } = req.params;
    const { status } = req.body;

    if (!["GIVEN", "UNAVAILABLE"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be GIVEN or UNAVAILABLE",
      });
    }

    await connection.beginTransaction();

    // ---------------------------------------------
    // Get prescription item
    // ---------------------------------------------

    const [items] = await connection.query(
      `
      SELECT

        pi.id,
        pi.prescription_id,
        pi.medicine_id,
        pi.quantity,

        p.patient_id,
        p.status AS prescription_status,

        m.name AS medicine_name,
        m.stock_quantity

      FROM prescription_items pi

      INNER JOIN prescriptions p
        ON p.id = pi.prescription_id

      INNER JOIN medicines m
        ON m.id = pi.medicine_id

      WHERE pi.id = ?

      FOR UPDATE
      `,
      [itemId],
    );

    if (items.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Prescription medicine not found",
      });
    }

    const item = items[0];

    // ---------------------------------------------
    // Prevent duplicate dispensing
    // ---------------------------------------------

    const [existing] = await connection.query(
      `
      SELECT id, status
      FROM medicine_dispensing
      WHERE prescription_item_id = ?
      LIMIT 1
      `,
      [itemId],
    );

    if (existing.length > 0 && existing[0].status !== "PENDING") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Medicine has already been processed",
      });
    }

    // ---------------------------------------------
    // GIVEN
    // ---------------------------------------------

    if (status === "GIVEN") {
      if (item.stock_quantity < item.quantity) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${item.medicine_name}`,
          data: {
            required: item.quantity,
            available: item.stock_quantity,
          },
        });
      }

      const stockBefore = item.stock_quantity;

      const stockAfter = stockBefore - item.quantity;

      // Update stock
      await connection.query(
        `
        UPDATE medicines
        SET stock_quantity = ?
        WHERE id = ?
        `,
        [stockAfter, item.medicine_id],
      );

      // Inventory transaction
      await connection.query(
        `
        INSERT INTO inventory_transactions
        (
          medicine_id,
          transaction_type,
          quantity,
          stock_before,
          stock_after,
          prescription_item_id,
          notes
        )
        VALUES
        (?, 'DISPENSE', ?, ?, ?, ?, ?)
        `,
        [
          item.medicine_id,
          item.quantity,
          stockBefore,
          stockAfter,
          item.id,
          "Medicine dispensed to patient",
        ],
      );

      // Dispensing record
      if (existing.length === 0) {
        await connection.query(
          `
          INSERT INTO medicine_dispensing
          (
            prescription_item_id,
            status,
            given_quantity,
            dispensed_at
          )
          VALUES (?, 'GIVEN', ?, NOW())
          `,
          [item.id, item.quantity],
        );
      } else {
        await connection.query(
          `
          UPDATE medicine_dispensing
          SET
            status = 'GIVEN',
            given_quantity = ?,
            dispensed_at = NOW()
          WHERE prescription_item_id = ?
          `,
          [item.quantity, item.id],
        );
      }
    }

    // ---------------------------------------------
    // UNAVAILABLE
    // ---------------------------------------------
    else {
      if (existing.length === 0) {
        await connection.query(
          `
          INSERT INTO medicine_dispensing
          (
            prescription_item_id,
            status,
            given_quantity,
            dispensed_at
          )
          VALUES (?, 'UNAVAILABLE', 0, NOW())
          `,
          [item.id],
        );
      } else {
        await connection.query(
          `
          UPDATE medicine_dispensing
          SET
            status = 'UNAVAILABLE',
            given_quantity = 0,
            dispensed_at = NOW()
          WHERE prescription_item_id = ?
          `,
          [item.id],
        );
      }
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message:
        status === "GIVEN"
          ? "Medicine dispensed successfully"
          : "Medicine marked as unavailable",
      data: {
        prescriptionItemId: item.id,
        medicineName: item.medicine_name,
        status,
      },
    });
  } catch (error) {
    await connection.rollback();

    next(error);
  } finally {
    connection.release();
  }
};

// ======================================================
// 4. COMPLETE DISPENSING
// POST /api/clinic/dispensing/:prescriptionId/complete
// ======================================================

const completeDispensing = async (req, res, next) => {
  const connection = await pool.getConnection();

  try {
    const { prescriptionId } = req.params;

    await connection.beginTransaction();

    // ---------------------------------------------
    // Get all prescription items
    // ---------------------------------------------

    const [items] = await connection.query(
      `
      SELECT

        pi.id,

        COALESCE(
          md.status,
          'PENDING'
        ) AS dispensing_status

      FROM prescription_items pi

      LEFT JOIN medicine_dispensing md
        ON md.prescription_item_id = pi.id

      WHERE pi.prescription_id = ?

      FOR UPDATE
      `,
      [prescriptionId],
    );

    if (items.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Prescription items not found",
      });
    }

    const incompleteItems = items.filter(
      (item) => !["GIVEN", "UNAVAILABLE"].includes(item.dispensing_status),
    );

    if (incompleteItems.length > 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "All medicines must be marked GIVEN or UNAVAILABLE first",
      });
    }

    // ---------------------------------------------
    // Update prescription
    // ---------------------------------------------

    await connection.query(
      `
      UPDATE prescriptions
      SET
        status = 'COMPLETED',
        completed_at = NOW()
      WHERE id = ?
      `,
      [prescriptionId],
    );

    // ---------------------------------------------
    // Get patient + token
    // ---------------------------------------------

    const [prescriptionRows] = await connection.query(
      `
      SELECT
        patient_id,
        token_id
      FROM prescriptions
      WHERE id = ?
      LIMIT 1
      `,
      [prescriptionId],
    );

    if (prescriptionRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Prescription not found",
      });
    }

    const prescription = prescriptionRows[0];

    // ---------------------------------------------
    // Token → Medicine Completed
    // ---------------------------------------------

    await connection.query(
      `
      UPDATE tokens
      SET status = 'MEDICINE_COMPLETED'
      WHERE id = ?
      `,
      [prescription.token_id],
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Medicine dispensing completed",
      data: {
        prescriptionId,
        tokenId: prescription.token_id,
        status: "MEDICINE_COMPLETED",
      },
    });
  } catch (error) {
    await connection.rollback();

    next(error);
  } finally {
    connection.release();
  }
};

// ======================================================
// 5. PRINT / RECEIPT PAGE
// GET /api/clinic/prescriptions/:prescriptionId/receipt
// ======================================================

const getPrescriptionReceipt = async (req, res, next) => {
  try {
    const { prescriptionId } = req.params;

    // ==========================================
    // GET PRESCRIPTION
    // ==========================================

    const [prescriptions] = await pool.query(
      `
      SELECT
        p.id AS prescription_id,
        p.patient_id,
        p.doctor_id,
        p.room_id,
        p.advice,
        p.status,
        p.prescribed_at,
        p.completed_at,

        t.id AS token_id,
        t.token_number,

        pt.name AS patient_name,
        pt.age,
        pt.gender,

        d.name AS doctor_name,

        r.room_number

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

      LIMIT 1
      `,
      [prescriptionId],
    );

    // ==========================================
    // PRESCRIPTION NOT FOUND
    // ==========================================

    if (prescriptions.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Prescription not found",
      });
    }

    const prescription = prescriptions[0];

    // ==========================================
    // GET MEDICINES
    // ==========================================

    const [medicines] = await pool.query(
      `
      SELECT

        pi.id AS prescription_item_id,

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
        ) AS given_quantity

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

    // ==========================================
    // DATE FORMATTER
    // ==========================================

    const formatDateTime = (value) => {
      if (!value) {
        return "—";
      }

      const date = new Date(value);

      if (Number.isNaN(date.getTime())) {
        return String(value);
      }

      return date.toLocaleString("en-IN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    };

    // ==========================================
    // HTML ESCAPE
    // ==========================================

    const escapeHtml = (value) => {
      if (value === null || value === undefined) {
        return "";
      }

      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };

    // ==========================================
    // TOKEN
    // ==========================================

    const tokenNumber =
      prescription.token_number !== null &&
      prescription.token_number !== undefined
        ? `T-${prescription.token_number}`
        : "—";

    // ==========================================
    // CLINIC DETAILS
    // ==========================================

    const clinicName =
      process.env.CLINIC_NAME ||
      process.env.HOSPITAL_NAME ||
      "YD District Hospital";

    const clinicAddress =
      process.env.CLINIC_ADDRESS || process.env.HOSPITAL_ADDRESS || "";

    const clinicPhone =
      process.env.CLINIC_PHONE || process.env.HOSPITAL_PHONE || "";

    // ==========================================
    // AUTO PRINT
    // ==========================================

    const autoPrint = req.query.print === "true";

    // ==========================================
    // GENERATE RECEIPT HTML
    // ==========================================

    const html = prescriptionReceipt({
      clinicName,
      clinicAddress,
      clinicPhone,
      prescription,
      tokenNumber,
      medicines,
      formatDateTime,
      escapeHtml,
      autoPrint,
    });

    // ==========================================
    // SEND HTML
    // ==========================================

    res.setHeader("Content-Type", "text/html; charset=utf-8");

    return res.status(200).send(html);
  } catch (error) {
    next(error);
  }
};
module.exports = {
  getPendingPrescriptions,
  getPrescriptionDetails,
  dispenseMedicine,
  completeDispensing,
  getPrescriptionReceipt,
};
