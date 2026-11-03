const cron = require("node-cron");
const { pool } = require("../config/db");

// Find the latest active recurring assignment effective on a date.
// Historical assignments remain stored; the latest one takes priority.
const syncFutureOpdSessions = async () => {
  const [result] = await pool.query(`
    UPDATE opd_sessions os

    INNER JOIN doctor_room_assignments dra
      ON dra.id = (
        SELECT dra2.id
        FROM doctor_room_assignments dra2
        WHERE dra2.doctor_id = os.doctor_id
          AND dra2.is_active = TRUE
          AND dra2.is_recurring = TRUE
          AND dra2.assignment_date <= os.opd_date
        ORDER BY dra2.assignment_date DESC, dra2.id DESC
        LIMIT 1
      )

    INNER JOIN doctors d
      ON d.id = dra.doctor_id
      AND d.is_active = TRUE

    INNER JOIN rooms r
      ON r.id = dra.room_id
      AND r.is_active = TRUE

    INNER JOIN doctor_weekly_schedule dws
      ON dws.doctor_id = dra.doctor_id
      AND dws.day_of_week = UPPER(DAYNAME(os.opd_date))
      AND dws.is_active = TRUE

    SET
      os.room_id = dra.room_id,
      os.token_start_time = dra.start_time,
      os.consultation_start_time = dra.start_time,
      os.token_close_time = dra.end_time

    WHERE os.opd_date >= CURDATE()
      AND os.status = 'NOT_STARTED'
      AND dra.start_time IS NOT NULL
      AND dra.end_time IS NOT NULL
  `);

  return result.affectedRows;
};

// Create today's missing sessions.
// At most one effective assignment is selected per doctor.
const ensureTodayOpdSessions = async () => {
  const updated = await syncFutureOpdSessions();

  const [result] = await pool.query(`
    INSERT IGNORE INTO opd_sessions (
      room_id,
      doctor_id,
      opd_date,
      token_start_time,
      consultation_start_time,
      token_close_time,
      status
    )
    SELECT
      dra.room_id,
      dra.doctor_id,
      CURDATE(),
      dra.start_time,
      dra.start_time,
      dra.end_time,
      'NOT_STARTED'

    FROM doctor_room_assignments dra

    INNER JOIN doctors d
      ON d.id = dra.doctor_id
      AND d.is_active = TRUE

    INNER JOIN rooms r
      ON r.id = dra.room_id
      AND r.is_active = TRUE

    INNER JOIN doctor_weekly_schedule dws
      ON dws.doctor_id = dra.doctor_id
      AND dws.day_of_week = UPPER(DAYNAME(CURDATE()))
      AND dws.is_active = TRUE

    WHERE dra.is_active = TRUE
      AND dra.is_recurring = TRUE
      AND dra.assignment_date <= CURDATE()
      AND dra.start_time IS NOT NULL
      AND dra.end_time IS NOT NULL

      AND dra.id = (
        SELECT dra2.id
        FROM doctor_room_assignments dra2
        WHERE dra2.doctor_id = dra.doctor_id
          AND dra2.is_active = TRUE
          AND dra2.is_recurring = TRUE
          AND dra2.assignment_date <= CURDATE()
        ORDER BY dra2.assignment_date DESC, dra2.id DESC
        LIMIT 1
      )
  `);

  return {
    created: result.affectedRows,
    updated,
  };
};

const startOpdSessionScheduler = () => {
  cron.schedule(
    "5 0 * * *",
    async () => {
      try {
        const result = await ensureTodayOpdSessions();
      } catch (error) {
        console.error("[OPD Scheduler] Failed:", error);
      }
    },
    { timezone: "Asia/Kolkata" },
  );

  // Reconcile sessions when the server starts.
  ensureTodayOpdSessions()
    .then((result) => {
      console.log(
        `[OPD Scheduler] Startup - Created: ${result.created}, Updated: ${result.updated}`,
      );
    })
    .catch((error) => {
      console.error("[OPD Scheduler] Startup reconciliation failed:", error);
    });
};

module.exports = {
  ensureTodayOpdSessions,
  syncFutureOpdSessions,
  startOpdSessionScheduler,
};
