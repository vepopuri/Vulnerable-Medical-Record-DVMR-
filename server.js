const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const db = require('./db');

// =====================================================================
// SECURE_MODE — flip this one flag to switch the whole app between the
// vulnerable behavior and the fixed behavior for each flaw below.
//   false = VULNERABLE: SQL injection, BOLA on the socket stream, and
//           stored XSS via doctor's notes are all live.
//   true  = SECURE: parameterized queries, per-socket authorization,
//           and output sanitization are enforced instead.
// =====================================================================
const SECURE_MODE = false;

// Stand-in for a real login/session system: each token represents one
// authenticated doctor and which patients they are allowed to view.
const AUTH_TOKENS = {
  'doctor-token-1': { doctorName: 'Dr. Patel' },
  'doctor-token-2': { doctorName: 'Dr. Reyes' },
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/mode', (req, res) => {
  res.json({ secureMode: SECURE_MODE });
});

// ---------------------------------------------------------------------
// Patient profile look-up
// ---------------------------------------------------------------------
app.get('/api/patients/search', (req, res) => {
  const q = req.query.q === undefined ? '' : String(req.query.q);

  if (!SECURE_MODE) {
    // VULNERABLE (CWE-89, SQL Injection): the query string is built by
    // raw concatenation. Try searching for:
    //   ' OR '1'='1
    //   1001' UNION SELECT id,full_name,ssn,dob,diagnosis,doctors_notes,assigned_doctor FROM patients--
    const sql = `SELECT id, full_name, ssn, dob, diagnosis, doctors_notes, assigned_doctor
                 FROM patients
                 WHERE full_name LIKE '%${q}%' OR id = '${q}'`;
    try {
      const rows = db.prepare(sql).all();
      return res.json({ patients: rows, sqlExecuted: sql });
    } catch (err) {
      return res.status(500).json({ error: 'Query failed', detail: err.message, sqlExecuted: sql });
    }
  }

  // SECURE: parameterized query; free-text and numeric-id lookups are
  // bound separately instead of interpolated into the SQL string.
  const sanitizedQ = q.replace(/[%_]/g, '\\$&');
  const numericId = /^\d+$/.test(q) ? Number(q) : -1;
  const rows = db.prepare(`
    SELECT id, full_name, ssn, dob, diagnosis, doctors_notes, assigned_doctor
    FROM patients
    WHERE full_name LIKE ? ESCAPE '\\' OR id = ?
  `).all(`%${sanitizedQ}%`, numericId);
  res.json({ patients: rows });
});

const server = http.createServer(app);
const io = new Server(server);

// patientId -> count of sockets currently watching it, so the vitals
// simulator only streams for patients someone is actually viewing.
const activePatients = new Map();

io.on('connection', (socket) => {
  if (SECURE_MODE) {
    // SECURE: require a valid doctor token at handshake time before the
    // socket can do anything at all.
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!AUTH_TOKENS[token]) {
      socket.emit('auth_error', 'Invalid or missing doctor token.');
      socket.disconnect(true);
      return;
    }
  }

  const watchedPatients = new Set();

  socket.on('join_patient_stream', (patientId) => {
    if (!SECURE_MODE) {
      // VULNERABLE (CWE-639, Broken Object Level Authorization / IDOR):
      // any connected client can join any patient_id's room and start
      // receiving that patient's live PHI, with no ownership check at all.
      socket.join(`patient_${patientId}`);
      watchedPatients.add(String(patientId));
      activePatients.set(String(patientId), (activePatients.get(String(patientId)) || 0) + 1);
      socket.emit('joined', { patientId });
      return;
    }

    // SECURE: confirm the authenticated doctor is actually assigned to
    // this patient before allowing them into the room.
    const token = socket.handshake.auth.token;
    const patient = db.prepare('SELECT assigned_doctor FROM patients WHERE id = ?').get(patientId);
    if (!patient || patient.assigned_doctor !== token) {
      socket.emit('auth_error', 'Not authorized for this patient record.');
      return;
    }
    socket.join(`patient_${patientId}`);
    watchedPatients.add(String(patientId));
    activePatients.set(String(patientId), (activePatients.get(String(patientId)) || 0) + 1);
    socket.emit('joined', { patientId });
  });

  socket.on('doctor_note', ({ patientId, note }) => {
    if (!SECURE_MODE) {
      // VULNERABLE (CWE-79, Stored XSS): the note is written to the DB
      // and rebroadcast completely raw. A malicious nurse can submit a
      // <script>/<img onerror> payload here that fires instantly on
      // every physician currently viewing this patient's chart.
      db.prepare(`UPDATE patients SET doctors_notes = '${note}' WHERE id = ${patientId}`).run();
      io.to(`patient_${patientId}`).emit('note_update', {
        patientId, note, ts: new Date().toISOString(),
      });
      return;
    }

    // SECURE: escape before storing/broadcasting, plus a parameterized write.
    const safeNote = escapeHtml(note).slice(0, 500);
    db.prepare('UPDATE patients SET doctors_notes = ? WHERE id = ?').run(safeNote, patientId);
    io.to(`patient_${patientId}`).emit('note_update', {
      patientId, note: safeNote, ts: new Date().toISOString(),
    });
  });

  socket.on('disconnect', () => {
    for (const patientId of watchedPatients) {
      const remaining = (activePatients.get(patientId) || 1) - 1;
      if (remaining <= 0) activePatients.delete(patientId);
      else activePatients.set(patientId, remaining);
    }
  });
});

// ---------------------------------------------------------------------
// Real-time vitals simulation: every 3 seconds, generate a reading for
// each patient someone is actively watching and stream it to that room.
// ---------------------------------------------------------------------
setInterval(() => {
  for (const patientId of activePatients.keys()) {
    const heartRate = 60 + Math.floor(Math.random() * 50);
    const systolic = 100 + Math.floor(Math.random() * 40);
    const diastolic = 60 + Math.floor(Math.random() * 25);
    const recordedAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO vitals_stream (patient_id, heart_rate, systolic, diastolic, recorded_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(Number(patientId), heartRate, systolic, diastolic, recordedAt);

    io.to(`patient_${patientId}`).emit('vitals_update', {
      patientId, heartRate, systolic, diastolic, recordedAt,
    });
  }
}, 3000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`DVMR listening on http://localhost:${PORT}  (SECURE_MODE=${SECURE_MODE})`);
});
