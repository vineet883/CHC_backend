const { pool } = require("../config/db");
const PDFDocument = require("pdfkit");
// ======================================================
// HELPER: FORMAT GENDER
// ======================================================

function formatGender(gender) {
  if (gender === "MALE") return "Male";
  if (gender === "FEMALE") return "Female";
  if (gender === "OTHER") return "Other";

  return "";
}

const formatDate = (date) => {
  if (!date) return null;

  const d = new Date(date);

  if (Number.isNaN(d.getTime())) {
    return null;
  }

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${day}-${month}-${year}`;
};

// ======================================================
// ALLOWED CERTIFICATE TYPES
// ======================================================

const ALLOWED_CERTIFICATE_TYPES = [
  "MEDICAL_FITNESS",
  "SICK_LEAVE",
  "MEDICAL_EXAMINATION",
  "VACCINATION",
  "OTHER",
];

// ======================================================
// GET PATIENT PROFILE
// ======================================================

exports.getPatientCertificateProfile = async (req, res) => {
  try {
    const userId = req.user.userId;

    const [[patient]] = await pool.query(
      `
      SELECT
        p.id,
        p.patient_id,
        p.name,
        p.age,
        p.gender,
        p.mobile,
        p.address,
        ua.abha_number
      FROM patients p
      LEFT JOIN user_abha ua
        ON ua.user_id = p.user_id
      WHERE p.user_id = ?
        AND p.is_active = 1
      LIMIT 1
      `,
      [userId],
    );

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        patientId: patient.id,

        hospitalPatientId: patient.patient_id,

        name: patient.name || "",

        abhaNumber: patient.abha_number || "",

        age:
          patient.age !== null && patient.age !== undefined
            ? String(patient.age)
            : "",

        gender: formatGender(patient.gender),

        mobile: patient.mobile || "",

        address: patient.address || "",

        // patients table me DOB nahi hai
        dob: "",
      },
    });
  } catch (error) {
    console.error("[getPatientCertificateProfile]", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load patient profile",
    });
  }
};

// ======================================================
// GET DEPARTMENTS
// ======================================================

exports.getCertificateDepartments = async (req, res) => {
  try {
    const [departments] = await pool.query(
      `
      SELECT
        id,
        name
      FROM medical_certificate_departments
      WHERE is_active = 1
      ORDER BY name ASC
      `,
    );

    return res.status(200).json({
      success: true,
      data: departments,
    });
  } catch (error) {
    console.error("[getCertificateDepartments]", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load departments",
    });
  }
};

// ======================================================
// GET DOCTORS BY DEPARTMENT
// ======================================================

exports.getCertificateDoctors = async (req, res) => {
  try {
    const { departmentId } = req.query;

    if (!departmentId) {
      return res.status(400).json({
        success: false,
        message: "Department ID is required",
      });
    }

    const [doctors] = await pool.query(
      `
      SELECT
        d.id,
        d.name,
        d.specialization
      FROM doctors d
      INNER JOIN medical_certificate_doctor_departments mcd
        ON mcd.doctor_id = d.id
      WHERE mcd.department_id = ?
        AND mcd.is_active = 1
        AND d.is_active = 1
      ORDER BY d.name ASC
      `,
      [departmentId],
    );

    return res.status(200).json({
      success: true,
      data: doctors,
    });
  } catch (error) {
    console.error("[getCertificateDoctors]", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load doctors",
    });
  }
};

// ======================================================
// CREATE MEDICAL CERTIFICATE REQUEST
// ======================================================

exports.createMedicalCertificateRequest = async (req, res) => {
  const connection = await pool.getConnection();

  let transactionStarted = false;

  try {
    const userId = req.user.userId;

    const {
      certificateType,
      departmentId,
      doctorId,
      purpose,
      additionalNotes,
      patientAddress,
    } = req.body;

    // ==================================================
    // VALIDATION
    // ==================================================

    if (!certificateType) {
      return res.status(400).json({
        success: false,
        message: "Certificate type is required",
      });
    }

    if (!ALLOWED_CERTIFICATE_TYPES.includes(certificateType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid certificate type",
      });
    }

    if (!departmentId) {
      return res.status(400).json({
        success: false,
        message: "Department is required",
      });
    }

    if (!doctorId) {
      return res.status(400).json({
        success: false,
        message: "Doctor is required",
      });
    }

    if (!purpose || !String(purpose).trim()) {
      return res.status(400).json({
        success: false,
        message: "Purpose is required",
      });
    }

    // ==================================================
    // GET PATIENT
    // ==================================================

    const [[patient]] = await connection.query(
      `
      SELECT
        p.id,
        p.patient_id,
        p.name,
        p.age,
        p.gender,
        p.mobile,
        p.address,
        ua.abha_number
      FROM patients p
      LEFT JOIN user_abha ua
        ON ua.user_id = p.user_id
      WHERE p.user_id = ?
        AND p.is_active = 1
      LIMIT 1
      `,
      [userId],
    );

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient profile not found",
      });
    }

    // ==================================================
    // GET DEPARTMENT
    // ==================================================

    const [[department]] = await connection.query(
      `
      SELECT
        id,
        name
      FROM medical_certificate_departments
      WHERE id = ?
        AND is_active = 1
      LIMIT 1
      `,
      [departmentId],
    );

    if (!department) {
      return res.status(404).json({
        success: false,
        message: "Department not found",
      });
    }

    // ==================================================
    // GET DOCTOR
    // ==================================================

    const [[doctor]] = await connection.query(
      `
      SELECT
        d.id,
        d.name,
        d.specialization
      FROM doctors d
      INNER JOIN medical_certificate_doctor_departments mcd
        ON mcd.doctor_id = d.id
      WHERE d.id = ?
        AND mcd.department_id = ?
        AND d.is_active = 1
        AND mcd.is_active = 1
      LIMIT 1
      `,
      [doctorId, departmentId],
    );

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Selected doctor is not available in this department",
      });
    }

    // ==================================================
    // START TRANSACTION
    // ==================================================

    await connection.beginTransaction();

    transactionStarted = true;

    // ==================================================
    // INSERT REQUEST
    // ==================================================

    const [result] = await connection.query(
      `
      INSERT INTO medical_certificate_requests
      (
        patient_id,
        abha_number,

        patient_name,
        patient_age,
        patient_gender,
        patient_mobile,
        patient_address,

        certificate_type,

        department_id,
        department_name,

        doctor_id,
        doctor_name,

        purpose,
        additional_notes,

        status
      )
      VALUES
      (
        ?, ?,
        ?, ?, ?, ?, ?,
        ?,
        ?, ?,
        ?, ?,
        ?, ?,
        'PENDING'
      )
      `,
      [
        patient.id,
        patient.abha_number || null,

        patient.name,
        patient.age ?? null,
        patient.gender || null,
        patient.mobile || null,
        patient.address || null,

        certificateType,
        patientAddress,

        department.id,
        department.name,

        doctor.id,
        doctor.name,

        String(purpose).trim(),
        additionalNotes ? String(additionalNotes).trim() : null,
      ],
    );

    // ==================================================
    // COMMIT
    // ==================================================

    await connection.commit();

    transactionStarted = false;

    return res.status(201).json({
      success: true,
      message: "Medical certificate request submitted successfully",

      data: {
        requestId: result.insertId,
        status: "PENDING",
      },
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (_) {}
    }

    console.error("[createMedicalCertificateRequest]", error);

    return res.status(500).json({
      success: false,
      message: "Failed to submit medical certificate request",
    });
  } finally {
    connection.release();
  }
};

// ======================================================
// GET MY MEDICAL CERTIFICATES
// ======================================================

exports.getMyMedicalCertificates = async (req, res) => {
  try {
    const userId = req.user.userId;

    // ==================================================
    // GET PATIENT
    // ==================================================

    const [[patient]] = await pool.query(
      `
      SELECT
        id
      FROM patients
      WHERE user_id = ?
        AND is_active = 1
      LIMIT 1
      `,
      [userId],
    );

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient profile not found",
      });
    }

    // ==================================================
    // GET REQUESTS
    // ==================================================

    const [rows] = await pool.query(
      `
      SELECT
        id,

        certificate_type AS certificateType,

        department_id AS departmentId,

        department_name AS departmentName,

        doctor_id AS doctorId,

        doctor_name AS doctorName,

        purpose,

        additional_notes AS additionalNotes,

        status,

        created_at AS requestedAt,

        updated_at AS updatedAt

      FROM medical_certificate_requests

      WHERE patient_id = ?

      ORDER BY created_at DESC, id DESC
      `,
      [patient.id],
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("[getMyMedicalCertificates]", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load medical certificates",
    });
  }
};

// ======================================================
// GET MEDICAL CERTIFICATE DETAILS - PATIENT
// ======================================================

exports.getMedicalCertificateDetails = async (req, res) => {
  try {
    const userId = req.user.userId;

    const requestId = Number(req.params.id);

    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: "Invalid certificate request ID",
      });
    }

    // ==================================================
    // GET PATIENT
    // ==================================================

    const [[patient]] = await pool.query(
      `
      SELECT
        id
      FROM patients
      WHERE user_id = ?
        AND is_active = 1
      LIMIT 1
      `,
      [userId],
    );

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient profile not found",
      });
    }

    // ==================================================
    // GET CERTIFICATE
    // ==================================================

    const [[request]] = await pool.query(
      `
      SELECT
        id,

        patient_id,
        abha_number,

        patient_name,
        patient_age,
        patient_gender,
        patient_mobile,
        patient_address,

        certificate_type,

        department_id,
        department_name,

        doctor_id,
        doctor_name,

        purpose,
        additional_notes,

        status,

        created_at,
        updated_at,

        examination_date,
        examination_findings,
        diagnosis,
        medical_condition,
        fitness_status,
        rest_required,
        rest_from,
        rest_to,
        medical_advice,
        doctor_remarks,
        certificate_validity,
        doctor_submitted_at

      FROM medical_certificate_requests

      WHERE id = ?
        AND patient_id = ?

      LIMIT 1
      `,
      [requestId, patient.id],
    );

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Medical certificate request not found",
      });
    }

    return res.status(200).json({
      success: true,

      data: {
        id: request.id,

        certificateType: request.certificate_type,

        purpose: request.purpose,

        departmentName: request.department_name,

        doctorName: request.doctor_name || "",

        additionalNotes: request.additional_notes || "",

        requestedAt: request.created_at,

        updatedAt: request.updated_at,

        status: request.status,

        patient: {
          patientId: String(request.patient_id),

          abhaNumber: request.abha_number || "",

          name: request.patient_name || "",

          age: request.patient_age || 0,

          gender: request.patient_gender || "",

          dob: "",

          mobile: request.patient_mobile || "",

          address: request.patient_address || "",

          bloodGroup: "",
        },

        doctorAssessment:
          request.examination_date ||
          request.examination_findings ||
          request.diagnosis
            ? {
                examinationDate: request.examination_date || "",

                examinationFindings: request.examination_findings || "",

                diagnosis: request.diagnosis || "",

                medicalCondition: request.medical_condition || "",

                fitnessStatus: request.fitness_status || "",

                restRequired: Boolean(request.rest_required),

                restFrom: request.rest_from || "",

                restTo: request.rest_to || "",

                medicalAdvice: request.medical_advice || "",

                doctorRemarks: request.doctor_remarks || "",

                certificateValidity: request.certificate_validity || "",

                doctorSubmittedAt: request.doctor_submitted_at || "",
              }
            : null,

        // Documents table abhi provided schema me nahi hai
        documents: [],
        medicalReport: null,
        prescription: null,
        idProof: null,
      },
    });
  } catch (error) {
    console.error("[getMedicalCertificateDetails]", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load medical certificate details",
    });
  }
};

// ======================================================
// DOWNLOAD APPROVED MEDICAL CERTIFICATE PDF
// GET /certificates/:id/download
// ======================================================

exports.downloadMedicalCertificate = async (req, res) => {
  try {
    const userId = req.user.userId;
    const requestId = Number(req.params.id);

    // ==================================================
    // VALIDATION
    // ==================================================

    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: "Invalid certificate ID",
      });
    }

    // ==================================================
    // GET PATIENT
    // ==================================================

    const [[patient]] = await pool.query(
      `
      SELECT
        id
      FROM patients
      WHERE user_id = ?
        AND is_active = 1
      LIMIT 1
      `,
      [userId],
    );

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient profile not found",
      });
    }

    // ==================================================
    // GET APPROVED CERTIFICATE
    // ==================================================

    const [[certificate]] = await pool.query(
      `
      SELECT
        id,

        patient_name,
        patient_age,
        patient_gender,
        patient_mobile,
        patient_address,
        abha_number,

        certificate_type,

        department_name,

        doctor_name,

        purpose,
        additional_notes,

        examination_date,
        examination_findings,
        diagnosis,
        medical_condition,

        fitness_status,

        rest_required,
        rest_from,
        rest_to,

        medical_advice,
        doctor_remarks,
        certificate_validity,

        status,

        created_at,
        updated_at,
        doctor_submitted_at

      FROM medical_certificate_requests

      WHERE id = ?
        AND patient_id = ?
        AND status = 'APPROVED'

      LIMIT 1
      `,
      [requestId, patient.id],
    );

    if (!certificate) {
      return res.status(404).json({
        success: false,
        message: "Approved medical certificate not found",
      });
    }

    // ==================================================
    // CERTIFICATE NUMBER
    // ==================================================
    //
    // Current DB schema me certificate_number column
    // nahi hai, isliye temporary generated number.
    //
    const certificateNumber = `MCR-${new Date().getFullYear()}-${String(
      certificate.id,
    ).padStart(6, "0")}`;

    // ==================================================
    // ISSUE DATE
    // ==================================================

    const issueDate = certificate.updated_at || certificate.created_at;

    // ==================================================
    // PDF RESPONSE HEADERS
    // ==================================================

    res.setHeader("Content-Type", "application/pdf");

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="medical-certificate-${certificateNumber}.pdf"`,
    );

    // ==================================================
    // CREATE PDF
    // ==================================================

    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      info: {
        Title: "Medical Certificate",
        Author: "District Hospital",
        Subject: "Medical Certificate",
      },
    });

    // PDF directly response me jayega
    doc.pipe(res);

    // ==================================================
    // HEADER
    // ==================================================

    doc.fontSize(10).fillColor("#64748b").text("DISTRICT HOSPITAL", {
      align: "center",
    });

    doc
      .moveDown(0.3)
      .fontSize(18)
      .fillColor("#0f172a")
      .font("Helvetica-Bold")
      .text("MEDICAL CERTIFICATE", {
        align: "center",
      });

    doc
      .moveDown(0.3)
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#64748b")
      .text("Official Medical Certificate", {
        align: "center",
      });

    // ==================================================
    // LINE
    // ==================================================

    doc
      .moveDown(1)
      .strokeColor("#cbd5e1")
      .lineWidth(1)
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .stroke();

    // ==================================================
    // CERTIFICATE INFORMATION
    // ==================================================

    doc.moveDown(1);

    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .fillColor("#0f172a")
      .text("Certificate Information");

    doc.moveDown(0.5);

    addRow(doc, "Certificate Number", certificateNumber);

    addRow(doc, "Issue Date", formatPdfDate(issueDate));

    addRow(doc, "Certificate Type", certificate.certificate_type);

    addRow(doc, "Purpose", certificate.purpose);

    // ==================================================
    // PATIENT INFORMATION
    // ==================================================

    doc.moveDown(1);

    sectionHeading(doc, "Patient Information");

    addRow(doc, "Patient Name", certificate.patient_name);

    addRow(doc, "ABHA Number", certificate.abha_number || "-");

    addRow(
      doc,
      "Age",
      certificate.patient_age ? String(certificate.patient_age) : "-",
    );

    addRow(doc, "Gender", formatGenderForPdf(certificate.patient_gender));

    addRow(doc, "Mobile", certificate.patient_mobile || "-");

    addRow(doc, "Address", certificate.patient_address || "-");

    // ==================================================
    // DEPARTMENT / DOCTOR
    // ==================================================

    doc.moveDown(1);

    sectionHeading(doc, "Medical Details");

    addRow(doc, "Department", certificate.department_name);

    addRow(doc, "Doctor", certificate.doctor_name);

    addRow(
      doc,
      "Examination Date",
      formatPdfDate(certificate.examination_date),
    );

    // ==================================================
    // EXAMINATION FINDINGS
    // ==================================================

    addLongText(doc, "Examination Findings", certificate.examination_findings);

    // ==================================================
    // DIAGNOSIS
    // ==================================================

    addLongText(doc, "Diagnosis", certificate.diagnosis);

    // ==================================================
    // MEDICAL CONDITION
    // ==================================================

    addLongText(doc, "Medical Condition", certificate.medical_condition);

    // ==================================================
    // FITNESS STATUS
    // ==================================================

    addRow(
      doc,
      "Fitness Status",
      formatFitnessStatus(certificate.fitness_status),
    );

    // ==================================================
    // REST PERIOD
    // ==================================================

    if (Number(certificate.rest_required) === 1) {
      addRow(doc, "Rest Required", "Yes");

      addRow(doc, "Rest From", formatPdfDate(certificate.rest_from));

      addRow(doc, "Rest To", formatPdfDate(certificate.rest_to));
    } else {
      addRow(doc, "Rest Required", "No");
    }

    // ==================================================
    // MEDICAL ADVICE
    // ==================================================

    addLongText(doc, "Medical Advice", certificate.medical_advice);

    // ==================================================
    // DOCTOR REMARKS
    // ==================================================

    if (certificate.doctor_remarks) {
      addLongText(doc, "Doctor Remarks", certificate.doctor_remarks);
    }

    // ==================================================
    // VALIDITY
    // ==================================================

    if (certificate.certificate_validity) {
      addRow(doc, "Certificate Validity", certificate.certificate_validity);
    }

    // ==================================================
    // APPROVAL
    // ==================================================

    doc.moveDown(1);

    sectionHeading(doc, "Approval");

    addRow(doc, "Status", "APPROVED");

    addRow(doc, "Approved Date", formatPdfDate(issueDate));

    // ==================================================
    // FOOTER
    // ==================================================

    doc.moveDown(2);

    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#64748b")
      .text("This is a digitally generated medical certificate.", {
        align: "center",
      });

    doc.moveDown(0.3).text("This certificate is issued by District Hospital.", {
      align: "center",
    });

    // ==================================================
    // FINISH PDF
    // ==================================================

    doc.end();
  } catch (error) {
    console.error("[downloadMedicalCertificate]", error);

    // Agar headers already send ho chuke hain
    // to JSON response nahi bhejna
    if (res.headersSent) {
      return;
    }

    return res.status(500).json({
      success: false,
      message: "Unable to generate medical certificate PDF",
    });
  }
};

// ======================================================
// PDF HELPER: SECTION HEADING
// ======================================================

function sectionHeading(doc, title) {
  doc
    .moveDown(0.5)
    .fontSize(11)
    .font("Helvetica-Bold")
    .fillColor("#0f172a")
    .text(title);

  doc
    .moveDown(0.25)
    .strokeColor("#e2e8f0")
    .lineWidth(0.8)
    .moveTo(50, doc.y)
    .lineTo(545, doc.y)
    .stroke();

  doc.moveDown(0.4);
}

// ======================================================
// PDF HELPER: NORMAL ROW
// ======================================================

function addRow(doc, label, value) {
  const safeValue =
    value === null || value === undefined || value === "" ? "-" : String(value);

  doc
    .fontSize(9)
    .font("Helvetica-Bold")
    .fillColor("#475569")
    .text(`${label}:`, {
      continued: true,
    });

  doc.font("Helvetica").fillColor("#0f172a").text(` ${safeValue}`);

  doc.moveDown(0.25);
}

// ======================================================
// PDF HELPER: LONG TEXT
// ======================================================

function addLongText(doc, label, value) {
  const safeValue =
    value === null || value === undefined || String(value).trim() === ""
      ? "-"
      : String(value).trim();

  doc
    .moveDown(0.3)
    .fontSize(9)
    .font("Helvetica-Bold")
    .fillColor("#475569")
    .text(label);

  doc
    .moveDown(0.2)
    .fontSize(9)
    .font("Helvetica")
    .fillColor("#0f172a")
    .text(safeValue, {
      width: 495,
      lineGap: 2,
    });
}

// ======================================================
// PDF HELPER: DATE
// ======================================================

function formatPdfDate(date) {
  if (!date) {
    return "-";
  }

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return String(date);
  }

  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

// ======================================================
// PDF HELPER: GENDER
// ======================================================

function formatGenderForPdf(gender) {
  if (gender === "MALE") {
    return "Male";
  }

  if (gender === "FEMALE") {
    return "Female";
  }

  if (gender === "OTHER") {
    return "Other";
  }

  return gender || "-";
}

// ======================================================
// PDF HELPER: FITNESS
// ======================================================

function formatFitnessStatus(status) {
  if (status === "FIT") {
    return "Fit";
  }

  if (status === "UNFIT") {
    return "Unfit";
  }

  if (status === "FIT_WITH_RESTRICTIONS") {
    return "Fit With Restrictions";
  }

  return status || "-";
}

// ======================================================
// DOCTOR: GET CERTIFICATE REQUESTS
// ======================================================

exports.getDoctorCertificates = async (req, res) => {
  try {
    const userId = req.user.userId;

    // ==================================================
    // FIND DOCTOR
    // ==================================================

    const [[doctor]] = await pool.query(
      `
      SELECT
        id,
        user_id,
          name
      FROM doctors
      WHERE user_id = ?
      LIMIT 1
      `,
      [userId],
    );

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor profile not found",
      });
    }

    // ==================================================
    // GET REQUESTS
    // ==================================================

    const [rows] = await pool.query(
      `
  SELECT
  id,

  patient_id AS patientId,

  patient_name AS patientName,

  patient_age AS age,

  patient_gender AS gender,

  patient_mobile AS mobile,

  patient_address AS address,

  abha_number AS abhaNumber,

  certificate_type AS certificateType,

  department_id AS departmentId,

  department_name AS departmentName,

  purpose,

  additional_notes AS additionalNotes,

  created_at AS requestedAt,

  status

      FROM medical_certificate_requests

      WHERE doctor_id = ?

      ORDER BY created_at DESC, id DESC
      `,
      [doctor.id],
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("[getDoctorCertificates]", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load doctor medical certificates",
    });
  }
};

// ======================================================
// DOCTOR: GET CERTIFICATE DETAILS
// ======================================================

exports.getDoctorCertificateDetails = async (req, res) => {
  try {
    const userId = req.user.userId;

    const requestId = Number(req.params.id);

    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: "Invalid certificate request ID",
      });
    }

    // ==================================================
    // FIND DOCTOR
    // ==================================================

    const [[doctor]] = await pool.query(
      `
      SELECT
        id,
        user_id,
        name
      FROM doctors
      WHERE user_id = ?
      LIMIT 1
      `,
      [userId],
    );

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor profile not found",
      });
    }

    // ==================================================
    // GET REQUEST
    // ==================================================

    const [[request]] = await pool.query(
      `
      SELECT
        id,

        patient_id,
        abha_number,

        patient_name,
        patient_age,
        patient_gender,
        patient_mobile,
        patient_address,

        certificate_type,

        department_id,
        department_name,

        doctor_id,
        doctor_name,

        purpose,
        additional_notes,

        status,

        created_at,
        updated_at,

        examination_date,
        examination_findings,
        diagnosis,
        medical_condition,
        fitness_status,
        rest_required,
        rest_from,
        rest_to,
        medical_advice,
        doctor_remarks,
        certificate_validity,
        doctor_submitted_at

      FROM medical_certificate_requests

      WHERE id = ?
        AND doctor_id = ?

      LIMIT 1
      `,
      [requestId, doctor.id],
    );

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Medical certificate request not found",
      });
    }

    return res.status(200).json({
      success: true,

      data: {
        id: request.id,

        certificateType: request.certificate_type,

        purpose: request.purpose,

        departmentName: request.department_name,

        doctorName: request.doctor_name || doctor.full_name,

        additionalNotes: request.additional_notes || "",

        requestedAt: request.created_at,

        updatedAt: request.updated_at,

        status: request.status,

        patient: {
          patientId: String(request.patient_id),

          abhaNumber: request.abha_number || "",

          name: request.patient_name || "",

          age: request.patient_age || 0,

          gender: request.patient_gender || "",

          dob: "",

          mobile: request.patient_mobile || "",

          address: request.patient_address || "",

          bloodGroup: "",
        },

        doctorAssessment:
          request.examination_date ||
          request.examination_findings ||
          request.diagnosis
            ? {
                examinationDate: request.examination_date || "",

                examinationFindings: request.examination_findings || "",

                diagnosis: request.diagnosis || "",

                medicalCondition: request.medical_condition || "",

                fitnessStatus: request.fitness_status || "",

                restRequired: Boolean(request.rest_required),

                restFrom: request.rest_from || "",

                restTo: request.rest_to || "",

                medicalAdvice: request.medical_advice || "",

                doctorRemarks: request.doctor_remarks || "",

                certificateValidity: request.certificate_validity || "",

                doctorSubmittedAt: request.doctor_submitted_at || "",
              }
            : null,

        // Documents table/schema abhi available nahi hai
        medicalReport: null,
        prescription: null,
        idProof: null,
      },
    });
  } catch (error) {
    console.error("[getDoctorCertificateDetails]", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load medical certificate request",
    });
  }
};

// ======================================================
// DOCTOR: SUBMIT CERTIFICATE FOR MEDICAL OFFICER
// APPROVAL
// ======================================================

exports.submitDoctorCertificate = async (req, res) => {
  const connection = await pool.getConnection();

  let transactionStarted = false;

  try {
    const userId = req.user.userId;

    const requestId = Number(req.params.id);

    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: "Invalid certificate request ID",
      });
    }

    const {
      examinationDate,
      examinationFindings,
      diagnosis,
      medicalCondition,
      fitnessStatus,
      restRequired,
      restFrom,
      restTo,
      medicalAdvice,
      doctorRemarks,
      certificateValidity,
    } = req.body;

    // ==================================================
    // VALIDATION
    // ==================================================

    if (!examinationDate) {
      return res.status(400).json({
        success: false,
        message: "Examination date is required",
      });
    }

    if (!examinationFindings || !String(examinationFindings).trim()) {
      return res.status(400).json({
        success: false,
        message: "Examination findings are required",
      });
    }

    if (!diagnosis || !String(diagnosis).trim()) {
      return res.status(400).json({
        success: false,
        message: "Diagnosis is required",
      });
    }

    // ==================================================
    // FITNESS STATUS
    // ==================================================

    const allowedFitnessStatuses = ["FIT", "UNFIT", "FIT_WITH_RESTRICTIONS"];

    if (!allowedFitnessStatuses.includes(fitnessStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid fitness status",
      });
    }

    // ==================================================
    // REST REQUIRED
    // ==================================================

    if (!["YES", "NO"].includes(restRequired)) {
      return res.status(400).json({
        success: false,
        message: "Invalid rest required value",
      });
    }

    if (restRequired === "YES" && (!restFrom || !restTo)) {
      return res.status(400).json({
        success: false,
        message: "Rest period is required",
      });
    }

    // ==================================================
    // MEDICAL ADVICE
    // ==================================================

    if (!medicalAdvice || !String(medicalAdvice).trim()) {
      return res.status(400).json({
        success: false,
        message: "Medical advice is required",
      });
    }

    // ==================================================
    // FIND DOCTOR
    // ==================================================

    const [[doctor]] = await connection.query(
      `
      SELECT
        id,
        user_id,
        name
      FROM doctors
      WHERE user_id = ?
      LIMIT 1
      `,
      [userId],
    );

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor profile not found",
      });
    }

    // ==================================================
    // START TRANSACTION
    // ==================================================

    await connection.beginTransaction();

    transactionStarted = true;

    // ==================================================
    // LOCK REQUEST
    // ==================================================

    const [[request]] = await connection.query(
      `
        SELECT
          id,
          doctor_id,
          status
        FROM medical_certificate_requests
        WHERE id = ?
          AND doctor_id = ?
        FOR UPDATE
        `,
      [requestId, doctor.id],
    );

    if (!request) {
      await connection.rollback();

      transactionStarted = false;

      return res.status(404).json({
        success: false,
        message: "Medical certificate request not found",
      });
    }

    // ==================================================
    // STATUS CHECK
    // ==================================================

    const allowedStatuses = ["PENDING", "IN_REVIEW", "RETURNED"];

    if (!allowedStatuses.includes(request.status)) {
      await connection.rollback();

      transactionStarted = false;

      return res.status(400).json({
        success: false,
        message: `Certificate cannot be submitted from ${request.status} status`,
      });
    }

    // ==================================================
    // UPDATE DOCTOR ASSESSMENT
    // ==================================================

    await connection.query(
      `
      UPDATE medical_certificate_requests

      SET
        examination_date = ?,

        examination_findings = ?,

        diagnosis = ?,

        medical_condition = ?,

        fitness_status = ?,

        rest_required = ?,

        rest_from = ?,

        rest_to = ?,

        medical_advice = ?,

        doctor_remarks = ?,

        certificate_validity = ?,

        status = 'SUBMITTED_FOR_APPROVAL',

        doctor_submitted_at = NOW(),

        updated_at = CURRENT_TIMESTAMP

      WHERE id = ?
        AND doctor_id = ?
      `,
      [
        examinationDate,

        String(examinationFindings).trim(),

        String(diagnosis).trim(),

        medicalCondition ? String(medicalCondition).trim() : null,

        fitnessStatus,

        restRequired === "YES" ? 1 : 0,

        restRequired === "YES" ? restFrom : null,

        restRequired === "YES" ? restTo : null,

        String(medicalAdvice).trim(),

        doctorRemarks ? String(doctorRemarks).trim() : null,

        certificateValidity ? String(certificateValidity).trim() : null,

        requestId,

        doctor.id,
      ],
    );

    // ==================================================
    // COMMIT
    // ==================================================

    await connection.commit();

    transactionStarted = false;

    return res.status(200).json({
      success: true,

      message: "Medical certificate submitted for Medical Officer approval",

      data: {
        id: requestId,

        status: "SUBMITTED_FOR_APPROVAL",
        examinationDate: formatDate(examinationDate),
        restFrom: restRequired === "YES" ? formatDate(restFrom) : null,
        restTo: restRequired === "YES" ? formatDate(restTo) : null,
      },
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (_) {}
    }

    console.error("[submitDoctorCertificate]", error);

    return res.status(500).json({
      success: false,
      message: "Unable to submit medical certificate",
    });
  } finally {
    connection.release();
  }
};

exports.getMedicalOfficerCertificates = async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        m.id,
        m.patient_id AS patientId,
        p.patient_id AS patientHospitalId,

        m.patient_name AS patientName,
        m.patient_age AS age,
        m.patient_gender AS gender,

        m.certificate_type AS certificateType,
        m.department_name AS departmentName,
        m.doctor_name AS doctorName,

        m.purpose,

        COALESCE(
          m.doctor_submitted_at,
          m.updated_at,
          m.created_at
        ) AS submittedAt,

        m.status

      FROM medical_certificate_requests m

      LEFT JOIN patients p
        ON p.id = m.patient_id

      WHERE m.status IN (
        'SUBMITTED_FOR_APPROVAL',
        'RETURNED',
        'APPROVED',
        'REJECTED'
      )

      ORDER BY
        CASE
          WHEN m.status = 'SUBMITTED_FOR_APPROVAL' THEN 1
          WHEN m.status = 'RETURNED' THEN 2
          WHEN m.status = 'APPROVED' THEN 3
          WHEN m.status = 'REJECTED' THEN 4
          ELSE 5
        END,
        m.updated_at DESC
    `);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("[getMedicalOfficerCertificates]", error);

    next(error);
  }
};

// ======================================================
// MEDICAL OFFICER: GET CERTIFICATE DETAILS
// GET /certificates/medical-officer/:id
// ======================================================

exports.getMedicalOfficerCertificateDetails = async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);

    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: "Invalid certificate request ID",
      });
    }

    const [[request]] = await pool.query(
      `
      SELECT
        m.id,

        m.patient_id,
        p.patient_id AS patient_hospital_id,

        m.patient_name,
        m.patient_age,
        m.patient_gender,
        m.patient_mobile,
        m.patient_address,
        m.abha_number,

        m.certificate_type,

        m.department_id,
        m.department_name,

        m.doctor_id,
        m.doctor_name,

        m.purpose,
        m.additional_notes,

        m.status,

        m.created_at,
        m.updated_at,

        m.examination_date,
        m.examination_findings,
        m.diagnosis,
        m.medical_condition,
        m.fitness_status,
        m.rest_required,
        m.rest_from,
        m.rest_to,
        m.medical_advice,
        m.doctor_remarks,
        m.certificate_validity,
        m.doctor_submitted_at,

        m.certificate_number,
        m.issued_date,

        m.medical_officer_id,
        m.medical_officer_name,
        m.medical_officer_designation,
        m.medical_officer_remarks,

        m.reviewed_at,

        m.rejection_reason,
        m.correction_reason,

        m.qr_token

      FROM medical_certificate_requests m

      LEFT JOIN patients p
        ON p.id = m.patient_id

      WHERE m.id = ?

      LIMIT 1
      `,
      [requestId],
    );

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Medical certificate not found",
      });
    }

    return res.status(200).json({
      success: true,

      data: {
        id: request.id,

        patientHospitalId: request.patient_hospital_id || "",

        certificateType: request.certificate_type,

        purpose: request.purpose,

        departmentName: request.department_name,

        doctorName: request.doctor_name || "",

        requestedAt: request.created_at,

        submittedAt:
          request.doctor_submitted_at ||
          request.updated_at ||
          request.created_at,

        status: request.status,

        patient: {
          patientId: String(request.patient_id),

          hospitalPatientId: request.patient_hospital_id || "",

          abhaNumber: request.abha_number || "",

          name: request.patient_name || "",

          age: request.patient_age || 0,

          gender: request.patient_gender || "",

          dob: "",

          mobile: request.patient_mobile || "",

          address: request.patient_address || "",

          bloodGroup: "",
        },

        doctorAssessment:
          request.examination_date ||
          request.examination_findings ||
          request.diagnosis ||
          request.medical_condition
            ? {
                examinationDate: request.examination_date || "",

                examinationFindings: request.examination_findings || "",

                diagnosis: request.diagnosis || "",

                medicalCondition: request.medical_condition || "",

                fitnessStatus: request.fitness_status || "",

                restRequired: Boolean(request.rest_required),

                restFrom: request.rest_from || "",

                restTo: request.rest_to || "",

                medicalAdvice: request.medical_advice || "",

                doctorRemarks: request.doctor_remarks || "",

                certificateValidity: request.certificate_validity || "",

                doctorSubmittedAt: request.doctor_submitted_at || "",
              }
            : null,

        // Documents abhi DB schema me available nahi hain
        medicalReport: null,
        prescription: null,
        idProof: null,

        certificateNumber: request.certificate_number || null,

        issuedDate: request.issued_date || null,

        medicalOfficer:
          request.medical_officer_id ||
          request.medical_officer_name ||
          request.medical_officer_designation
            ? {
                id: request.medical_officer_id || null,

                name: request.medical_officer_name || "",

                designation: request.medical_officer_designation || "",

                remarks: request.medical_officer_remarks || "",

                reviewedAt: request.reviewed_at || "",
              }
            : null,

        correctionReason: request.correction_reason || null,

        rejectionReason: request.rejection_reason || null,

        qrToken: request.qr_token || null,
      },
    });
  } catch (error) {
    console.error("[getMedicalOfficerCertificateDetails]", error);

    next(error);
  }
};

exports.approveMedicalCertificate = async (req, res, next) => {
  const connection = await pool.getConnection();

  try {
    const { id } = req.params;

    const { officerRemarks = "" } = req.body;

    await connection.beginTransaction();

    const [[certificate]] = await connection.query(
      `
      SELECT
        id,
        status,
        patient_name
      FROM medical_certificate_requests
      WHERE id = ?
      FOR UPDATE
      `,
      [id],
    );

    if (!certificate) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Medical certificate not found",
      });
    }

    if (certificate.status !== "SUBMITTED_FOR_APPROVAL") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Only certificates submitted by doctor can be approved",
      });
    }

    const year = new Date().getFullYear();

    const certificateNumber = `MC-${year}-${String(id).padStart(6, "0")}`;

    const officerId = req.user?.id || null;

    const officerName =
      req.user?.name || req.user?.fullName || "Medical Officer";

    const officerDesignation = req.user?.designation || "Medical Officer";

    const qrToken = `MC-${id}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 12)}`;

    await connection.query(
      `
      UPDATE medical_certificate_requests

      SET
        status = 'APPROVED',

        certificate_number = ?,
        issued_date = NOW(),

        medical_officer_id = ?,
        medical_officer_name = ?,
        medical_officer_designation = ?,
        medical_officer_remarks = ?,

        reviewed_at = NOW(),
        correction_reason = NULL,
        rejection_reason = NULL,

        qr_token = ?

      WHERE id = ?
      `,
      [
        certificateNumber,
        officerId,
        officerName,
        officerDesignation,
        officerRemarks || null,
        qrToken,
        id,
      ],
    );

    await connection.commit();

    return res.json({
      success: true,
      message: "Medical certificate approved successfully",

      data: {
        id,
        status: "APPROVED",
        certificateNumber,
      },
    });
  } catch (error) {
    await connection.rollback();

    console.error("[approveMedicalCertificate]", error);

    next(error);
  } finally {
    connection.release();
  }
};

exports.returnMedicalCertificate = async (req, res, next) => {
  const connection = await pool.getConnection();

  try {
    const { id } = req.params;

    const { correctionReason, officerRemarks = "" } = req.body;

    if (!correctionReason?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Correction reason is required",
      });
    }

    await connection.beginTransaction();

    const [[certificate]] = await connection.query(
      `
        SELECT id, status
        FROM medical_certificate_requests
        WHERE id = ?
        FOR UPDATE
        `,
      [id],
    );

    if (!certificate) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Medical certificate not found",
      });
    }

    if (certificate.status !== "SUBMITTED_FOR_APPROVAL") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Only certificates submitted for approval can be returned",
      });
    }

    await connection.query(
      `
      UPDATE medical_certificate_requests

      SET
        status = 'RETURNED',

        correction_reason = ?,

        medical_officer_id = ?,
        medical_officer_name = ?,
        medical_officer_designation = ?,
        medical_officer_remarks = ?,

        reviewed_at = NOW()

      WHERE id = ?
      `,
      [
        correctionReason.trim(),

        req.user?.id || null,

        req.user?.name || req.user?.fullName || "Medical Officer",

        req.user?.designation || "Medical Officer",

        officerRemarks || null,

        id,
      ],
    );

    await connection.commit();

    return res.json({
      success: true,

      message: "Certificate returned to doctor for correction",

      data: {
        id,
        status: "RETURNED",
      },
    });
  } catch (error) {
    await connection.rollback();

    console.error("[returnMedicalCertificate]", error);

    next(error);
  } finally {
    connection.release();
  }
};

exports.rejectMedicalCertificate = async (req, res, next) => {
  const connection = await pool.getConnection();

  try {
    const { id } = req.params;

    const { rejectionReason, officerRemarks = "" } = req.body;

    if (!rejectionReason?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Rejection reason is required",
      });
    }

    await connection.beginTransaction();

    const [[certificate]] = await connection.query(
      `
        SELECT id, status
        FROM medical_certificate_requests
        WHERE id = ?
        FOR UPDATE
        `,
      [id],
    );

    if (!certificate) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Medical certificate not found",
      });
    }

    if (certificate.status !== "SUBMITTED_FOR_APPROVAL") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Only certificates submitted for approval can be rejected",
      });
    }

    await connection.query(
      `
      UPDATE medical_certificate_requests

      SET
        status = 'REJECTED',

        rejection_reason = ?,

        medical_officer_id = ?,
        medical_officer_name = ?,
        medical_officer_designation = ?,
        medical_officer_remarks = ?,

        reviewed_at = NOW()

      WHERE id = ?
      `,
      [
        rejectionReason.trim(),

        req.user?.id || null,

        req.user?.name || req.user?.fullName || "Medical Officer",

        req.user?.designation || "Medical Officer",

        officerRemarks || null,

        id,
      ],
    );

    await connection.commit();

    return res.json({
      success: true,

      message: "Medical certificate rejected",

      data: {
        id,
        status: "REJECTED",
      },
    });
  } catch (error) {
    await connection.rollback();

    console.error("[rejectMedicalCertificate]", error);

    next(error);
  } finally {
    connection.release();
  }
};
