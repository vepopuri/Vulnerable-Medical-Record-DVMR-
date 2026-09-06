const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'health_records.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    ssn TEXT NOT NULL,
    dob TEXT NOT NULL,
    diagnosis TEXT,
    doctors_notes TEXT,
    assigned_doctor TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vitals_stream (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    heart_rate INTEGER NOT NULL,
    systolic INTEGER NOT NULL,
    diastolic INTEGER NOT NULL,
    recorded_at TEXT NOT NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
  );
`);

// Seed a handful of fake patients on first run so the app works
// immediately after `npm install && npm start` with no extra steps.
const patientCount = db.prepare('SELECT COUNT(*) AS c FROM patients').get().c;
if (patientCount === 0) {
  const insert = db.prepare(`
    INSERT INTO patients (id, full_name, ssn, dob, diagnosis, doctors_notes, assigned_doctor)
    VALUES (@id, @full_name, @ssn, @dob, @diagnosis, @doctors_notes, @assigned_doctor)
  `);

  const seedPatients = [
    { id: 1001, full_name: 'Alice Johnson', ssn: '123-45-6789', dob: '1985-02-14', diagnosis: 'Type 2 Diabetes', doctors_notes: 'Stable, continue metformin.', assigned_doctor: 'doctor-token-1' },
    { id: 1002, full_name: 'Bob Martinez', ssn: '234-56-7890', dob: '1978-11-02', diagnosis: 'Hypertension', doctors_notes: 'Blood pressure trending down.', assigned_doctor: 'doctor-token-2' },
    { id: 1003, full_name: 'Carla Nguyen', ssn: '345-67-8901', dob: '1990-06-23', diagnosis: 'Asthma', doctors_notes: 'Prescribed new inhaler.', assigned_doctor: 'doctor-token-1' },
    { id: 1004, full_name: 'David Okafor', ssn: '456-78-9012', dob: '1966-09-30', diagnosis: 'Coronary Artery Disease', doctors_notes: 'Scheduled for stress test.', assigned_doctor: 'doctor-token-2' },
    { id: 1005, full_name: 'Emma Wilson', ssn: '567-89-0123', dob: '2001-01-19', diagnosis: 'Migraine', doctors_notes: 'Trial of new medication.', assigned_doctor: 'doctor-token-1' },
  ];

  const insertMany = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });
  insertMany(seedPatients);
}

module.exports = db;
