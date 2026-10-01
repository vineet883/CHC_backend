const { pool } = require("../config/db");

const generatePatientId = async () => {
  const [rows] = await pool.query(
    `
    SELECT patient_id
    FROM patients
    ORDER BY id DESC
    LIMIT 1
    `
  );

  if (rows.length === 0) {
    return "YD000001";
  }

  const lastPatientId = rows[0].patient_id;

  const lastNumber = parseInt(
    lastPatientId.replace("YD", ""),
    10
  );

  const nextNumber = lastNumber + 1;

  return `YD${String(nextNumber).padStart(6, "0")}`;
};

module.exports = generatePatientId;