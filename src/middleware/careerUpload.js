
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = path.resolve(
  process.cwd(),
  "uploads",
  "internship-applications",
);

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    const uniqueName =
      `${Date.now()}-${require("crypto").randomUUID()}.pdf`;

    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname).toLowerCase();

  if (
    extension !== ".pdf" ||
    file.mimetype !== "application/pdf"
  ) {
    const error = new Error("Only PDF files are allowed.");
    error.status = 400;
    return cb(error);
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 5,
    fields: 25,
    fieldSize: 10 * 1024,
  },
});

const careerUpload = (req, res, next) => {
  upload.fields([
    { name: "resume", maxCount: 1 },
    { name: "documents", maxCount: 4 },
  ])(req, res, (error) => {
    if (error) {
      return next(error);
    }

    next();
  });
};

module.exports = { careerUpload };
