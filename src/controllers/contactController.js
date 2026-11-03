const { pool } = require("../config/db");
const fs = require("fs/promises");
const path = require("path");


const ALLOWED_ENQUIRY_TYPES = [
  "General Enquiry",
  "Appointment Assistance",
  "Website / Login Support",
  "Feedback / Grievance",
  "Other",
];

exports.submitContactEnquiry = async (req, res) => {
  try {
    const { name, mobile, email, enquiryType, message, consent } =
      req.body || {};

    if (
      typeof name !== "string" ||
      typeof mobile !== "string" ||
      typeof message !== "string" ||
      typeof enquiryType !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields.",
      });
    }

    const cleanName = name.trim();
    const cleanMobile = mobile.replace(/[\s-]/g, "");
    const cleanEmail = typeof email === "string" ? email.trim() : "";
    const cleanMessage = message.trim();

    if (cleanName.length < 2 || cleanName.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Name must contain 2 to 100 characters.",
      });
    }

    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 10-digit mobile number.",
      });
    }

    if (
      cleanEmail &&
      (cleanEmail.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))
    ) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address.",
      });
    }

    if (!ALLOWED_ENQUIRY_TYPES.includes(enquiryType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid enquiry type.",
      });
    }

    if (cleanMessage.length < 10 || cleanMessage.length > 2000) {
      return res.status(400).json({
        success: false,
        message: "Message must contain 10 to 2000 characters.",
      });
    }

    if (consent !== true) {
      return res.status(400).json({
        success: false,
        message: "Consent is required to submit an enquiry.",
      });
    }

    const [result] = await pool.query(
      `INSERT INTO contact_enquiries
        (name, mobile, email, enquiry_type, message, consent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        cleanName,
        cleanMobile,
        cleanEmail || null,
        enquiryType,
        cleanMessage,
        1,
      ],
    );

    return res.status(201).json({
      success: true,
      message: "Your enquiry has been submitted successfully.",
      enquiryId: result.insertId,
    });
  } catch (error) {
    console.error("Contact enquiry submission failed:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to submit your enquiry right now.",
    });
  }
};



const removeUploadedFiles = async (files) => {
  const allFiles = Object.values(files || {}).flat();

  await Promise.all(
    allFiles.map((file) =>
      fs.unlink(file.path).catch(() => {}),
    ),
  );
};

const isValidDate = (value) => {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
};

exports.applyForInternship = async (req, res, next) => {
  try {
    const {
      fullName,
      email,
      mobile,
      gender,
      dateOfBirth,
      course,
      college,
      currentYear,
      councilRegistration,
      preferredDuration,
      preferredStartDate,
      skills,
      experience,
      coverLetter,
      consent,
    } = req.body;

    const clean = (value) =>
      typeof value === "string" ? value.trim() : "";

    const name = clean(fullName);
    const applicantEmail = clean(email).toLowerCase();
    const applicantMobile = clean(mobile);
    const applicantCourse = clean(course);
    const applicantCollege = clean(college);
    const applicantYear = clean(currentYear);
    const duration = clean(preferredDuration);

    const resume = req.files?.resume?.[0];
    const documents = req.files?.documents || [];

    if (
      !name ||
      name.length < 2 ||
      name.length > 100 ||
      !applicantEmail ||
      applicantEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicantEmail) ||
      !/^[6-9]\d{9}$/.test(applicantMobile) ||
      !applicantCourse ||
      applicantCourse.length > 100 ||
      !applicantCollege ||
      applicantCollege.length > 200 ||
      !applicantYear ||
      applicantYear.length > 50 ||
      !duration
    ) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({
        success: false,
        message: "Please provide valid required application details.",
      });
    }

    const allowedCourses = [
      "ANM",
      "GNM",
      "B.Sc. Nursing",
      "Post Basic B.Sc. Nursing",
      "M.Sc. Nursing",
      "Other",
    ];

    const allowedDurations = [
      "1 month",
      "2 months",
      "3 months",
      "6 months",
    ];

    const allowedYears = [
      "1st Year",
      "2nd Year",
      "3rd Year",
      "4th Year",
      "Final Year",
      "Completed",
      "Other",
    ];

    if (
      !allowedCourses.includes(applicantCourse) ||
      !allowedDurations.includes(duration) ||
      !allowedYears.includes(applicantYear)
    ) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({
        success: false,
        message: "Invalid course, year/status or internship duration.",
      });
    }

    if (
      !resume ||
      clean(consent) !== "true" ||
      !isValidDate(dateOfBirth) ||
      !isValidDate(preferredStartDate)
    ) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({
        success: false,
        message:
          "A PDF resume, valid dates and accepted consent are required.",
      });
    }

    if (
      dateOfBirth &&
      dateOfBirth > new Date().toISOString().slice(0, 10)
    ) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({
        success: false,
        message: "Date of birth cannot be in the future.",
      });
    }

    if (
      preferredStartDate &&
      preferredStartDate < new Date().toISOString().slice(0, 10)
    ) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({
        success: false,
        message: "Preferred start date cannot be in the past.",
      });
    }

    const resumePath = path.posix.join(
      "uploads",
      "internship-applications",
      resume.filename,
    );

    const documentPaths = documents.map((file) =>
      path.posix.join(
        "uploads",
        "internship-applications",
        file.filename,
      ),
    );

    const sql = `
      INSERT INTO internship_applications (
        full_name,
        email,
        mobile,
        gender,
        date_of_birth,
        course,
        college,
        current_year,
        council_registration,
        preferred_duration,
        preferred_start_date,
        skills,
        experience,
        cover_letter,
        consent,
        resume_path,
        documents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      name,
      applicantEmail,
      applicantMobile,
      clean(gender) || null,
      dateOfBirth || null,
      applicantCourse,
      applicantCollege,
      applicantYear,
      clean(councilRegistration) || null,
      duration,
      preferredStartDate || null,
      clean(skills) || null,
      clean(experience) || null,
      clean(coverLetter) || null,
      1,
      resumePath,
      JSON.stringify(documentPaths),
    ];

    const [result] = await pool.execute(sql, values);

    return res.status(201).json({
      success: true,
      message: "Your internship application has been submitted successfully.",
      applicationId: result.insertId,
    });
  } catch (error) {
    await removeUploadedFiles(req.files);
    next(error);
  }
};
