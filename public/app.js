const modeBadge = document.getElementById('modeBadge');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchResults = document.getElementById('searchResults');
const tokenInput = document.getElementById('tokenInput');
const patientIdInput = document.getElementById('patientIdInput');
const joinBtn = document.getElementById('joinBtn');
const vitalsFeed = document.getElementById('vitalsFeed');
const notesFeed = document.getElementById('notesFeed');
const noteInput = document.getElementById('noteInput');
const noteBtn = document.getElementById('noteBtn');

let currentPatientId = null;

fetch('/api/mode')
  .then((r) => r.json())
  .then(({ secureMode }) => {
    modeBadge.textContent = secureMode ? 'mode: SECURE' : 'mode: VULNERABLE';
    modeBadge.className = secureMode ? 'secure' : 'vulnerable';
  });

// --- Patient profile look-up ------------------------------------------------
async function runSearch() {
  const q = searchInput.value;
  const res = await fetch(`/api/patients/search?q=${encodeURIComponent(q)}`);
  const data = await res.json();

  if (data.error) {
    // NOTE: rendered with innerHTML, same as every other feed on this
    // dashboard — this is intentional per the app's threat model.
    searchResults.innerHTML = `<div class="result-card">Query error: ${data.detail}</div>`;
    return;
  }

  searchResults.innerHTML = data.patients.map((p) => `
    <div class="result-card">
      <b>${p.full_name}</b> (ID ${p.id})<br/>
      SSN: <span class="pii">${p.ssn}</span> &nbsp; DOB: <span class="pii">${p.dob}</span><br/>
      Diagnosis: ${p.diagnosis}<br/>
      Doctor's Notes: ${p.doctors_notes}<br/>
      Assigned Doctor Token: ${p.assigned_doctor}
    </div>
  `).join('') || '<div class="result-card">No results.</div>';
}
searchBtn.addEventListener('click', runSearch);
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });

// --- Socket.io real-time vitals + notes -------------------------------------
const socket = io({
  auth: { token: tokenInput.value || undefined },
});

joinBtn.addEventListener('click', () => {
  const patientId = patientIdInput.value.trim();
  if (!patientId) return;
  currentPatientId = patientId;

  // Reconnect with whatever token is currently in the box, in case the
  // user typed one after the page loaded.
  socket.auth = { token: tokenInput.value || undefined };
  if (!socket.connected) socket.connect();

  socket.emit('join_patient_stream', patientId);
  vitalsFeed.innerHTML += `<div class="vital-line">Requested stream for patient ${patientId}...</div>`;
});

socket.on('joined', ({ patientId }) => {
  vitalsFeed.innerHTML += `<div class="vital-line">Joined live feed for patient ${patientId}.</div>`;
});

socket.on('auth_error', (msg) => {
  vitalsFeed.innerHTML += `<div class="vital-line">Auth error: ${msg}</div>`;
});

socket.on('vitals_update', (v) => {
  vitalsFeed.innerHTML += `
    <div class="vital-line">
      [${v.recordedAt}] Patient ${v.patientId} &mdash; HR ${v.heartRate} bpm,
      BP ${v.systolic}/${v.diastolic} mmHg
    </div>`;
  vitalsFeed.scrollTop = vitalsFeed.scrollHeight;
});

socket.on('note_update', (n) => {
  // VULNERABLE by default (Stored/Reflected XSS sink): raw server data
  // is injected via innerHTML with no escaping in SECURE_MODE=false.
  notesFeed.innerHTML += `
    <div class="note-line">[${n.ts}] Patient ${n.patientId}: ${n.note}</div>`;
  notesFeed.scrollTop = notesFeed.scrollHeight;
});

noteBtn.addEventListener('click', () => {
  if (!currentPatientId) {
    notesFeed.innerHTML += `<div class="note-line">Join a patient stream first.</div>`;
    return;
  }
  socket.emit('doctor_note', { patientId: currentPatientId, note: noteInput.value });
  noteInput.value = '';
});
