const prescriptionReceipt = ({
  clinicName,
  clinicAddress,
  clinicPhone,
  prescription,
  tokenNumber,
  medicines,
  formatDateTime,
  escapeHtml,
  autoPrint = false,
}) => {
  // =========================================================
  // RECEIPT NUMBER
  // =========================================================

  const receiptNumber = `RX-${String(prescription.prescription_id).padStart(
    6,
    "0",
  )}`;

  // =========================================================
  // DISPENSED MEDICINES
  // =========================================================

  const dispensedMedicines = medicines.filter(
    (medicine) => medicine.dispensing_status === "GIVEN",
  );

  // =========================================================
  // MEDICINE ROWS
  // =========================================================

  const medicineRows =
    medicines.length > 0
      ? medicines
          .map((medicine, index) => {
            const quantity = Number(
              medicine.given_quantity ?? medicine.quantity ?? 0,
            );

            const isDispensed = medicine.dispensing_status === "GIVEN";

            return `
              <tr>
                <td class="center">
                  ${index + 1}
                </td>

                <td>
                  <strong>
                    ${escapeHtml(medicine.medicine_name || "—")}
                  </strong>

                  ${
                    medicine.unit
                      ? `
                        <small>
                          ${escapeHtml(medicine.unit)}
                        </small>
                      `
                      : ""
                  }
                </td>

                <td class="center">
                  ${escapeHtml(quantity)}
                </td>

                <td class="status-cell">
                  <span class="${
                    isDispensed ? "status-dispensed" : "status-unavailable"
                  }">
                    ${isDispensed ? "DISPENSED" : "UNAVAILABLE"}
                  </span>
                </td>
              </tr>
            `;
          })
          .join("")
      : `
          <tr>
            <td
              colspan="4"
              class="empty-row"
            >
              No medicines found
            </td>
          </tr>
        `;

  // =========================================================
  // DATE
  // =========================================================

  const receiptDate = prescription.prescribed_at
    ? formatDateTime(prescription.prescribed_at)
    : formatDateTime(new Date());

  // =========================================================
  // TOKEN
  // =========================================================

  const tokenCode =
    tokenNumber ||
    (prescription.token_number != null
      ? `T-${prescription.token_number}`
      : prescription.token_id != null
        ? `T-${prescription.token_id}`
        : "—");

  // =========================================================
  // HTML
  // =========================================================

  return `
<!DOCTYPE html>

<html lang="en">

<head>

  <meta charset="UTF-8" />

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />

  <title>
    Pharmacy Receipt - ${escapeHtml(receiptNumber)}
  </title>


  <style>

    * {
      box-sizing: border-box;
    }


    html,
    body {
      margin: 0;
      padding: 0;
    }


    body {
      font-family:
        Arial,
        Helvetica,
        sans-serif;

      background: #f1f5f9;

      color: #111827;

      font-size: 13px;
    }


    /* =====================================================
       SCREEN
       ===================================================== */

    .receipt-page {
      min-height: 100vh;

      background: #f1f5f9;

      padding: 30px 20px;
    }


    .receipt {
      width: 100%;

      max-width: 800px;

      margin: 0 auto;

      background: #ffffff;

      padding: 40px;

      border-radius: 12px;

      box-shadow:
        0 4px 20px
        rgba(15, 23, 42, 0.08);

      color: #111827;
    }


    /* =====================================================
       HEADER
       ===================================================== */

    .receipt-header {
      text-align: center;
    }


    .receipt-header h1 {
      margin: 0;

      font-size: 24px;

      font-weight: 800;

      letter-spacing: 0.5px;
    }


    .receipt-subtitle {
      margin: 6px 0 0;

      font-size: 14px;

      font-weight: 600;
    }


    .receipt-address {
      margin: 5px 0 0;

      font-size: 12px;

      color: #64748b;

      line-height: 1.5;
    }


    .receipt-phone {
      margin-top: 3px;

      font-size: 12px;

      color: #64748b;
    }


    /* =====================================================
       LINE
       ===================================================== */

    .receipt-line {
      border-top: 1px solid #e2e8f0;

      margin: 20px 0;
    }


    /* =====================================================
       META
       ===================================================== */

    .receipt-meta {
      display: grid;

      grid-template-columns:
        1fr 1fr;

      gap: 20px;
    }


    .receipt-meta div,
    .receipt-grid div {
      display: flex;

      flex-direction: column;

      gap: 4px;
    }


    .receipt-meta span,
    .receipt-grid span {
      font-size: 11px;

      color: #64748b;
    }


    .receipt-meta strong,
    .receipt-grid strong {
      font-size: 13px;

      color: #111827;
    }


    /* =====================================================
       SECTION
       ===================================================== */

    section {
      margin: 0;
    }


    .receipt h2 {
      margin: 0 0 14px;

      font-size: 14px;

      font-weight: 700;

      color: #111827;
    }


    /* =====================================================
       GRID
       ===================================================== */

    .receipt-grid {
      display: grid;

      grid-template-columns:
        repeat(2, 1fr);

      gap: 16px 24px;
    }


    /* =====================================================
       MEDICINE TABLE
       ===================================================== */

    .medicine-table {
      width: 100%;

      border-collapse: collapse;

      font-size: 12px;
    }


    .medicine-table th {
      padding: 10px 8px;

      text-align: left;

      background: #f8fafc;

      border: 1px solid #cbd5e1;

      font-weight: 700;

      color: #111827;
    }


    .medicine-table td {
      padding: 10px 8px;

      border: 1px solid #cbd5e1;

      vertical-align: top;
    }


    .medicine-table td strong {
      display: block;

      font-size: 12px;
    }


    .medicine-table td small {
      display: block;

      margin-top: 3px;

      font-size: 10px;

      color: #64748b;
    }


    .medicine-table .center {
      text-align: center;

      vertical-align: middle;
    }


    .status-cell {
      vertical-align: middle !important;
    }


    /* =====================================================
       STATUS
       ===================================================== */

    .status-dispensed,
    .status-unavailable {
      display: inline-block;

      font-size: 10px;

      font-weight: 700;

      letter-spacing: 0.2px;
    }


    .status-dispensed {
      color: #166534;
    }


    .status-unavailable {
      color: #b91c1c;
    }


    .empty-row {
      text-align: center;

      color: #64748b;

      padding: 20px !important;
    }


    /* =====================================================
       SUMMARY
       ===================================================== */

    .receipt-summary {
      display: flex;

      justify-content: flex-end;

      gap: 40px;
    }


    .receipt-summary div {
      display: flex;

      flex-direction: column;

      align-items: flex-end;

      gap: 4px;
    }


    .receipt-summary span {
      font-size: 11px;

      color: #64748b;
    }


    .receipt-summary strong {
      font-size: 15px;

      color: #111827;
    }


    /* =====================================================
       ADVICE
       ===================================================== */

    .advice-box {
      padding: 14px;

      background: #f8fafc;

      border: 1px solid #e2e8f0;

      border-radius: 6px;

      font-size: 12px;

      line-height: 1.6;

      color: #334155;

      white-space: pre-wrap;
    }


    /* =====================================================
       FOOTER
       ===================================================== */

    .receipt-footer {
      text-align: center;

      font-size: 12px;
    }


    .receipt-footer strong {
      font-size: 13px;
    }


    .receipt-footer p {
      margin: 6px 0;

      color: #64748b;

      line-height: 1.5;
    }


    .receipt-footer .thank-you {
      margin-top: 18px;

      font-size: 14px;

      font-weight: 700;

      color: #111827;
    }


    /* =====================================================
       PRINT
       ===================================================== */

    @media print {

      @page {
        size: A4;

        margin: 12mm;
      }


      html,
      body {
        margin: 0 !important;

        padding: 0 !important;

        background: white !important;
      }


      body {
        -webkit-print-color-adjust: exact;

        print-color-adjust: exact;
      }


      .receipt-page {
        min-height: auto !important;

        padding: 0 !important;

        background: white !important;
      }


      .receipt {
        max-width: none !important;

        margin: 0 !important;

        padding: 0 !important;

        border-radius: 0 !important;

        box-shadow: none !important;
      }


      .receipt-line {
        margin: 14px 0;
      }


      .medicine-table {
        page-break-inside: auto;
      }


      .medicine-table tr {
        page-break-inside: avoid;

        page-break-after: auto;
      }


      section {
        page-break-inside: avoid;
      }

    }

  </style>

</head>


<body>

  <main class="receipt-page">

    <div class="receipt">


      <!-- =================================================
           HOSPITAL HEADER
           ================================================= -->

      <div class="receipt-header">

        <h1>
          ${escapeHtml(clinicName || "HOSPITAL PHARMACY")}
        </h1>


        <p class="receipt-subtitle">
          Pharmacy Dispensing Receipt
        </p>


        ${
          clinicAddress
            ? `
              <p class="receipt-address">
                ${escapeHtml(clinicAddress)}
              </p>
            `
            : ""
        }


        ${
          clinicPhone
            ? `
              <p class="receipt-phone">
                Phone: ${escapeHtml(clinicPhone)}
              </p>
            `
            : ""
        }

      </div>


      <div class="receipt-line"></div>


      <!-- =================================================
           RECEIPT INFORMATION
           ================================================= -->

      <div class="receipt-meta">

        <div>

          <span>
            Receipt No.
          </span>

          <strong>
            ${escapeHtml(receiptNumber)}
          </strong>

        </div>


        <div>

          <span>
            Date & Time
          </span>

          <strong>
            ${escapeHtml(receiptDate)}
          </strong>

        </div>

      </div>


      <div class="receipt-line"></div>


      <!-- =================================================
           PATIENT DETAILS
           ================================================= -->

      <section>

        <h2>
          Patient Details
        </h2>


        <div class="receipt-grid">

          <div>

            <span>
              Patient Name
            </span>

            <strong>
              ${escapeHtml(prescription.patient_name || "—")}
            </strong>

          </div>


          <div>

            <span>
              Patient ID
            </span>

            <strong>
              ${escapeHtml(prescription.patient_id || "—")}
            </strong>

          </div>


          <div>

            <span>
              Age
            </span>

            <strong>
              ${
                prescription.age != null
                  ? `${escapeHtml(prescription.age)} years`
                  : "—"
              }
            </strong>

          </div>


          <div>

            <span>
              Gender
            </span>

            <strong>
              ${escapeHtml(prescription.gender || "—")}
            </strong>

          </div>

        </div>

      </section>


      <div class="receipt-line"></div>


      <!-- =================================================
           PRESCRIPTION DETAILS
           ================================================= -->

      <section>

        <h2>
          Prescription Details
        </h2>


        <div class="receipt-grid">

          <div>

            <span>
              Prescription ID
            </span>

            <strong>
              #${escapeHtml(prescription.prescription_id)}
            </strong>

          </div>


          <div>

            <span>
              Doctor
            </span>

            <strong>
              ${escapeHtml(prescription.doctor_name || "—")}
            </strong>

          </div>


          <div>

            <span>
              Token
            </span>

            <strong>
              ${escapeHtml(tokenCode)}
            </strong>

          </div>


          <div>

            <span>
              Room
            </span>

            <strong>
              ${escapeHtml(prescription.room_number || "—")}
            </strong>

          </div>


          <div>

            <span>
              Status
            </span>

            <strong>
              ${escapeHtml(prescription.status || "COMPLETED")}
            </strong>

          </div>


          <div>

            <span>
              Prescribed At
            </span>

            <strong>
              ${escapeHtml(receiptDate)}
            </strong>

          </div>

        </div>

      </section>


      <div class="receipt-line"></div>


      <!-- =================================================
           MEDICINES
           ================================================= -->

      <section>

        <h2>
          Medicines Dispensed
        </h2>


        <table class="medicine-table">

          <thead>

            <tr>

              <th>
                #
              </th>

              <th>
                Medicine
              </th>

              <th>
                Qty
              </th>

              <th>
                Status
              </th>

            </tr>

          </thead>


          <tbody>

            ${medicineRows}

          </tbody>

        </table>

      </section>


      <div class="receipt-line"></div>


      <!-- =================================================
           SUMMARY
           ================================================= -->

      <div class="receipt-summary">

        <div>

          <span>
            Total medicines
          </span>

          <strong>
            ${medicines.length}
          </strong>

        </div>


        <div>

          <span>
            Dispensed
          </span>

          <strong>
            ${dispensedMedicines.length}
          </strong>

        </div>


        <div>

          <span>
            Unavailable
          </span>

          <strong>
            ${medicines.length - dispensedMedicines.length}
          </strong>

        </div>

      </div>


      ${
        prescription.advice
          ? `

            <div class="receipt-line"></div>


            <!-- =========================================
                 DOCTOR ADVICE
                 ========================================= -->

            <section>

              <h2>
                Doctor Advice
              </h2>


              <div class="advice-box">
                ${escapeHtml(prescription.advice)}
              </div>

            </section>

          `
          : ""
      }


      <div class="receipt-line"></div>


      <!-- =================================================
           FOOTER
           ================================================= -->

      <div class="receipt-footer">

        <strong>
          Dispensing completed successfully
        </strong>


        <p>
          This receipt confirms the medicines
          processed by the hospital pharmacy.
        </p>


        <p>
          Generated:
          ${escapeHtml(formatDateTime(new Date()))}
        </p>


        <p class="thank-you">
          Thank you
        </p>

      </div>


    </div>

  </main>


  <!-- =====================================================
       AUTO PRINT
       ===================================================== -->

  ${
    autoPrint
      ? `
        <script>

          window.addEventListener(
            "load",
            function () {

              setTimeout(
                function () {

                  window.focus();

                  window.print();

                },
                500
              );

            }
          );

        </script>
      `
      : ""
  }


</body>

</html>
`;
};

module.exports = prescriptionReceipt;
