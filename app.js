// ─── State ───────────────────────────────────────────────────────────────────

const DB_KEY = 'lapd_cases';

function loadDB() {
  try { return JSON.parse(localStorage.getItem(DB_KEY)) || []; } catch { return []; }
}
function saveDB(cases) {
  localStorage.setItem(DB_KEY, JSON.stringify(cases));
}

let cases = loadDB();
let currentCaseId = null;
let activePoiRole = 'Suspect';
let modalConfirmCallback = null;

// ─── Utility ─────────────────────────────────────────────────────────────────

function genId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function genCaseNumber() {
  const year = new Date().getFullYear();
  const seq = String(cases.length + 1).padStart(4, '0');
  return `LAPD-${year}-${seq}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getCaseById(id) {
  return cases.find(c => c.id === id);
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function renderDashboard() {
  const search = document.getElementById('search-input').value.toLowerCase();
  const filterStatus = document.getElementById('filter-status').value;
  const filterType = document.getElementById('filter-type').value;

  let filtered = cases.filter(c => {
    const matchSearch = !search ||
      c.caseNumber.toLowerCase().includes(search) ||
      c.title.toLowerCase().includes(search) ||
      (c.detective || '').toLowerCase().includes(search) ||
      (c.persons || []).some(p => p.name.toLowerCase().includes(search));
    const matchStatus = !filterStatus || c.status === filterStatus;
    const matchType = !filterType || c.type === filterType;
    return matchSearch && matchStatus && matchType;
  });

  // Stats always from full data
  document.getElementById('count-open').textContent = cases.filter(c => c.status === 'Open').length;
  document.getElementById('count-active').textContent = cases.filter(c => c.status === 'Active').length;
  document.getElementById('count-closed').textContent = cases.filter(c => c.status === 'Closed').length;
  document.getElementById('count-total').textContent = cases.length;

  const tbody = document.getElementById('cases-tbody');
  tbody.innerHTML = '';

  if (filtered.length === 0) {
    document.getElementById('no-cases-msg').style.display = '';
    document.getElementById('cases-table').style.display = 'none';
    return;
  }

  document.getElementById('no-cases-msg').style.display = 'none';
  document.getElementById('cases-table').style.display = '';

  filtered.sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));

  for (const c of filtered) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="case-number">${escHtml(c.caseNumber)}</span></td>
      <td>${escHtml(c.type)}</td>
      <td>${escHtml(c.title)}</td>
      <td>${escHtml(c.detective || '—')}</td>
      <td><span class="status-badge status-${escHtml(c.status)}">${escHtml(c.status)}</span></td>
      <td>${fmtDate(c.openedAt)}</td>
      <td>${(c.reports || []).length}</td>
      <td>
        <div class="table-actions">
          <button class="btn btn-sm btn-secondary" onclick="openCase('${c.id}')">Open</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  }
}

// ─── Case Detail ─────────────────────────────────────────────────────────────

function openCase(id) {
  currentCaseId = id;
  activePoiRole = 'Suspect';
  document.getElementById('view-dashboard').style.display = 'none';
  document.getElementById('view-detail').style.display = '';
  renderDetail();
}

function renderDetail() {
  const c = getCaseById(currentCaseId);
  if (!c) return;

  document.getElementById('detail-case-number').textContent = c.caseNumber;
  const badge = document.getElementById('detail-status-badge');
  badge.textContent = c.status;
  badge.className = `status-badge status-${c.status}`;

  document.getElementById('detail-info-grid').innerHTML = `
    <div class="info-item"><label>Title</label><span>${escHtml(c.title)}</span></div>
    <div class="info-item"><label>Type</label><span>${escHtml(c.type)}</span></div>
    <div class="info-item"><label>Status</label><span>${escHtml(c.status)}</span></div>
    <div class="info-item"><label>Priority</label><span>${escHtml(c.priority || '—')}</span></div>
    <div class="info-item"><label>Assigned Detective</label><span>${escHtml(c.detective || '—')}</span></div>
    <div class="info-item"><label>Badge #</label><span>${escHtml(c.badge || '—')}</span></div>
    <div class="info-item"><label>Opened</label><span>${fmtDate(c.openedAt)}</span></div>
    <div class="info-item"><label>Last Updated</label><span>${fmtDateTime(c.updatedAt)}</span></div>
    ${c.closedAt ? `<div class="info-item"><label>Closed</label><span>${fmtDate(c.closedAt)}</span></div>` : ''}
    ${c.location ? `<div class="info-item full-width"><label>Incident Location</label><span>${escHtml(c.location)}</span></div>` : ''}
    ${c.summary ? `<div class="info-item full-width"><label>Case Summary</label><span>${escHtml(c.summary)}</span></div>` : ''}`;

  renderNotes();
  renderReports();
  renderPersons();

  // Update poi tab buttons
  document.querySelectorAll('.poi-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.role === activePoiRole);
  });
}

function renderNotes() {
  const c = getCaseById(currentCaseId);
  const container = document.getElementById('notes-list');
  const notes = (c.notes || []).slice().reverse();
  const msg = document.getElementById('no-notes-msg');

  if (!notes.length) { container.innerHTML = ''; msg.style.display = ''; return; }
  msg.style.display = 'none';

  container.innerHTML = notes.map(n => `
    <div class="note-item">
      <div class="note-meta">
        <span class="note-det">Det. ${escHtml(n.detective)}</span>
        <span class="note-date">${fmtDateTime(n.createdAt)}</span>
      </div>
      ${n.statusUpdate ? `<div class="note-status"><span class="status-badge status-${escHtml(n.statusUpdate)}">${escHtml(n.statusUpdate)}</span></div>` : ''}
      <div class="note-text">${escHtml(n.text)}</div>
      <div style="text-align:right;margin-top:6px;">
        <button class="btn-icon" onclick="deleteNote('${n.id}')" title="Delete note">🗑</button>
      </div>
    </div>`).join('');
}

function renderReports() {
  const c = getCaseById(currentCaseId);
  const container = document.getElementById('reports-list');
  const reports = (c.reports || []).slice().reverse();
  const msg = document.getElementById('no-reports-msg');

  if (!reports.length) { container.innerHTML = ''; msg.style.display = ''; return; }
  msg.style.display = 'none';

  container.innerHTML = reports.map(r => `
    <div class="report-item">
      <div class="report-meta">
        <span class="report-id">${escHtml(r.reportId)}</span>
        <span class="report-date">${fmtDateTime(r.createdAt)}</span>
      </div>
      <div class="report-type">${escHtml(r.type)} — Filed by: ${escHtml(r.filedBy || '—')}</div>
      <div class="report-content">${escHtml(r.content)}</div>
      <div style="text-align:right;margin-top:6px;">
        <button class="btn-icon" onclick="deleteReport('${r.id}')" title="Delete report">🗑</button>
      </div>
    </div>`).join('');
}

function renderPersons() {
  const c = getCaseById(currentCaseId);
  const container = document.getElementById('persons-list');
  const msg = document.getElementById('no-persons-msg');

  const persons = (c.persons || []).filter(p => p.role === activePoiRole);

  if (!persons.length) { container.innerHTML = ''; msg.style.display = ''; return; }
  msg.style.display = 'none';

  container.innerHTML = persons.map(p => `
    <div class="person-item">
      <div class="person-header">
        <span class="person-name">${escHtml(p.name)}</span>
        <div style="display:flex;gap:8px;align-items:center;">
          <span class="person-role role-${escHtml(p.role)}">${escHtml(p.role)}</span>
          <button class="btn-icon" onclick="deletePerson('${p.id}')" title="Remove">🗑</button>
        </div>
      </div>
      ${p.dob ? `<div class="person-detail">DOB: ${escHtml(p.dob)}</div>` : ''}
      ${p.phone ? `<div class="person-detail">Phone: ${escHtml(p.phone)}</div>` : ''}
      ${p.address ? `<div class="person-detail">Address: ${escHtml(p.address)}</div>` : ''}
      ${p.description ? `<div class="person-detail" style="margin-top:4px;">${escHtml(p.description)}</div>` : ''}
      <div class="person-spoken">
        ${p.spoken
          ? `<span class="spoken-yes">✔ Interviewed</span>${p.spokenBy ? ` — by Det. ${escHtml(p.spokenBy)}` : ''}`
          : `<span class="spoken-no">✘ Not yet interviewed</span>`}
      </div>
    </div>`).join('');
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function showModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  document.getElementById('modal-body').innerHTML = '';
}

// ─── New / Edit Case Modal ────────────────────────────────────────────────────

function showCaseModal(existing) {
  const isEdit = !!existing;
  const c = existing || {};

  showModal(isEdit ? 'Edit Case' : 'New Case', `
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">Case Number</label>
        <input type="text" id="f-caseNumber" value="${escHtml(c.caseNumber || genCaseNumber())}" placeholder="LAPD-2026-0001" />
      </div>
      <div class="form-group">
        <label class="field-label">Status</label>
        <select id="f-status">
          ${['Open','Active','Pending','Closed','Cold'].map(s =>
            `<option value="${s}" ${c.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="field-label">Case Title</label>
      <input type="text" id="f-title" value="${escHtml(c.title||'')}" placeholder="Brief case title" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">Case Type</label>
        <select id="f-type">
          ${['Homicide','Robbery','Assault','Narcotics','Gang Activity','Fraud','Missing Person','Other'].map(t =>
            `<option value="${t}" ${c.type===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="field-label">Priority</label>
        <select id="f-priority">
          ${['Critical','High','Medium','Low'].map(p =>
            `<option value="${p}" ${c.priority===p?'selected':''}>${p}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">Assigned Detective</label>
        <input type="text" id="f-detective" value="${escHtml(c.detective||'')}" placeholder="Det. Last Name" />
      </div>
      <div class="form-group">
        <label class="field-label">Badge Number</label>
        <input type="text" id="f-badge" value="${escHtml(c.badge||'')}" placeholder="#0000" />
      </div>
    </div>
    <div class="form-group">
      <label class="field-label">Incident Location</label>
      <input type="text" id="f-location" value="${escHtml(c.location||'')}" placeholder="e.g. 300 N Main St, Los Santos" />
    </div>
    <div class="form-group">
      <label class="field-label">Date Opened</label>
      <input type="date" id="f-openedAt" value="${c.openedAt ? c.openedAt.substring(0,10) : new Date().toISOString().substring(0,10)}" />
    </div>
    <div class="form-group">
      <label class="field-label">Case Summary</label>
      <textarea id="f-summary" placeholder="Brief overview of the case...">${escHtml(c.summary||'')}</textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveCase(${isEdit ? `'${c.id}'` : 'null'})">${isEdit ? 'Save Changes' : 'Create Case'}</button>
    </div>`);
}

function saveCase(editId) {
  const caseNumber = document.getElementById('f-caseNumber').value.trim();
  const title = document.getElementById('f-title').value.trim();
  if (!caseNumber || !title) { alert('Case Number and Title are required.'); return; }

  const now = new Date().toISOString();

  if (editId) {
    const c = getCaseById(editId);
    Object.assign(c, {
      caseNumber,
      title,
      status: document.getElementById('f-status').value,
      type: document.getElementById('f-type').value,
      priority: document.getElementById('f-priority').value,
      detective: document.getElementById('f-detective').value.trim(),
      badge: document.getElementById('f-badge').value.trim(),
      location: document.getElementById('f-location').value.trim(),
      summary: document.getElementById('f-summary').value.trim(),
      openedAt: document.getElementById('f-openedAt').value,
      updatedAt: now,
      closedAt: document.getElementById('f-status').value === 'Closed' ? (c.closedAt || now) : null,
    });
    saveDB(cases);
    closeModal();
    renderDetail();
  } else {
    const newCase = {
      id: genId(),
      caseNumber,
      title,
      status: document.getElementById('f-status').value,
      type: document.getElementById('f-type').value,
      priority: document.getElementById('f-priority').value,
      detective: document.getElementById('f-detective').value.trim(),
      badge: document.getElementById('f-badge').value.trim(),
      location: document.getElementById('f-location').value.trim(),
      summary: document.getElementById('f-summary').value.trim(),
      openedAt: document.getElementById('f-openedAt').value,
      updatedAt: now,
      closedAt: null,
      notes: [],
      reports: [],
      persons: [],
    };
    cases.push(newCase);
    saveDB(cases);
    closeModal();
    renderDashboard();
    openCase(newCase.id);
  }
}

// ─── Note Modal ───────────────────────────────────────────────────────────────

function showNoteModal() {
  const c = getCaseById(currentCaseId);
  showModal('Add Detective Note', `
    <div class="form-group">
      <label class="field-label">Detective Name</label>
      <input type="text" id="n-detective" value="${escHtml(c.detective||'')}" placeholder="Det. Last Name" />
    </div>
    <div class="form-group">
      <label class="field-label">Status Update (optional)</label>
      <select id="n-statusUpdate">
        <option value="">— No status change —</option>
        ${['Open','Active','Pending','Closed','Cold'].map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="field-label">Note / Update</label>
      <textarea id="n-text" placeholder="Enter your case note, findings, or status update..." style="min-height:120px;"></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveNote()">Add Note</button>
    </div>`);
}

function saveNote() {
  const detective = document.getElementById('n-detective').value.trim();
  const text = document.getElementById('n-text').value.trim();
  if (!text) { alert('Note text is required.'); return; }

  const c = getCaseById(currentCaseId);
  const statusUpdate = document.getElementById('n-statusUpdate').value;
  const now = new Date().toISOString();

  c.notes.push({ id: genId(), detective, text, statusUpdate, createdAt: now });
  if (statusUpdate) {
    c.status = statusUpdate;
    if (statusUpdate === 'Closed') c.closedAt = c.closedAt || now;
  }
  c.updatedAt = now;
  saveDB(cases);
  closeModal();
  renderDetail();
}

function deleteNote(noteId) {
  if (!confirm('Delete this note?')) return;
  const c = getCaseById(currentCaseId);
  c.notes = c.notes.filter(n => n.id !== noteId);
  c.updatedAt = new Date().toISOString();
  saveDB(cases);
  renderNotes();
}

// ─── Report Modal ─────────────────────────────────────────────────────────────

function showReportModal() {
  const c = getCaseById(currentCaseId);
  const reportNum = `RPT-${c.caseNumber}-${String((c.reports||[]).length+1).padStart(3,'0')}`;
  showModal('File Report', `
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">Report ID</label>
        <input type="text" id="r-reportId" value="${escHtml(reportNum)}" placeholder="RPT-LAPD-2026-0001-001" />
      </div>
      <div class="form-group">
        <label class="field-label">Report Type</label>
        <select id="r-type">
          ${['Initial Report','Follow-Up','Crime Scene','Autopsy','Witness Statement','Suspect Interview','Surveillance','Evidence','Other'].map(t =>
            `<option value="${t}">${t}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="field-label">Filed By</label>
      <input type="text" id="r-filedBy" value="${escHtml(c.detective||'')}" placeholder="Det. Last Name" />
    </div>
    <div class="form-group">
      <label class="field-label">Report Content</label>
      <textarea id="r-content" placeholder="Enter report details, findings, statements..." style="min-height:150px;"></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveReport()">File Report</button>
    </div>`);
}

function saveReport() {
  const reportId = document.getElementById('r-reportId').value.trim();
  const content = document.getElementById('r-content').value.trim();
  if (!reportId || !content) { alert('Report ID and content are required.'); return; }

  const c = getCaseById(currentCaseId);
  const now = new Date().toISOString();
  c.reports.push({
    id: genId(),
    reportId,
    type: document.getElementById('r-type').value,
    filedBy: document.getElementById('r-filedBy').value.trim(),
    content,
    createdAt: now,
  });
  c.updatedAt = now;
  saveDB(cases);
  closeModal();
  renderDetail();
}

function deleteReport(reportId) {
  if (!confirm('Delete this report?')) return;
  const c = getCaseById(currentCaseId);
  c.reports = c.reports.filter(r => r.id !== reportId);
  c.updatedAt = new Date().toISOString();
  saveDB(cases);
  renderReports();
}

// ─── Person Modal ─────────────────────────────────────────────────────────────

function showPersonModal() {
  showModal('Add Person of Interest', `
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">Full Name</label>
        <input type="text" id="p-name" placeholder="First Last" />
      </div>
      <div class="form-group">
        <label class="field-label">Role</label>
        <select id="p-role">
          <option value="Suspect" ${activePoiRole==='Suspect'?'selected':''}>Suspect</option>
          <option value="Witness" ${activePoiRole==='Witness'?'selected':''}>Witness</option>
          <option value="Victim" ${activePoiRole==='Victim'?'selected':''}>Victim</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">Date of Birth</label>
        <input type="text" id="p-dob" placeholder="MM/DD/YYYY" />
      </div>
      <div class="form-group">
        <label class="field-label">Phone</label>
        <input type="text" id="p-phone" placeholder="(555) 000-0000" />
      </div>
    </div>
    <div class="form-group">
      <label class="field-label">Address</label>
      <input type="text" id="p-address" placeholder="Street Address, City" />
    </div>
    <div class="form-group">
      <label class="field-label">Description / Notes</label>
      <textarea id="p-description" placeholder="Physical description, known associates, notes..."></textarea>
    </div>
    <div class="form-group">
      <label class="checkbox-row">
        <input type="checkbox" id="p-spoken" />
        Mark as interviewed / spoken to
      </label>
    </div>
    <div class="form-group" id="p-spokenby-group" style="display:none;">
      <label class="field-label">Interviewed By</label>
      <input type="text" id="p-spokenBy" placeholder="Det. Last Name" />
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="savePerson()">Add Person</button>
    </div>`);

  document.getElementById('p-spoken').addEventListener('change', function() {
    document.getElementById('p-spokenby-group').style.display = this.checked ? '' : 'none';
  });
}

function savePerson() {
  const name = document.getElementById('p-name').value.trim();
  if (!name) { alert('Name is required.'); return; }

  const c = getCaseById(currentCaseId);
  const spoken = document.getElementById('p-spoken').checked;
  c.persons.push({
    id: genId(),
    name,
    role: document.getElementById('p-role').value,
    dob: document.getElementById('p-dob').value.trim(),
    phone: document.getElementById('p-phone').value.trim(),
    address: document.getElementById('p-address').value.trim(),
    description: document.getElementById('p-description').value.trim(),
    spoken,
    spokenBy: spoken ? document.getElementById('p-spokenBy').value.trim() : '',
  });
  c.updatedAt = new Date().toISOString();
  activePoiRole = document.getElementById('p-role').value;
  saveDB(cases);
  closeModal();
  renderDetail();
}

function deletePerson(personId) {
  if (!confirm('Remove this person from the case?')) return;
  const c = getCaseById(currentCaseId);
  c.persons = c.persons.filter(p => p.id !== personId);
  c.updatedAt = new Date().toISOString();
  saveDB(cases);
  renderPersons();
}

// ─── Delete Case ──────────────────────────────────────────────────────────────

function deleteCase() {
  const c = getCaseById(currentCaseId);
  if (!confirm(`Delete case ${c.caseNumber}? This cannot be undone.`)) return;
  cases = cases.filter(x => x.id !== currentCaseId);
  saveDB(cases);
  currentCaseId = null;
  document.getElementById('view-detail').style.display = 'none';
  document.getElementById('view-dashboard').style.display = '';
  renderDashboard();
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

document.getElementById('btn-new-case').addEventListener('click', () => showCaseModal(null));
document.getElementById('btn-back').addEventListener('click', () => {
  document.getElementById('view-detail').style.display = 'none';
  document.getElementById('view-dashboard').style.display = '';
  renderDashboard();
});
document.getElementById('btn-edit-case').addEventListener('click', () => showCaseModal(getCaseById(currentCaseId)));
document.getElementById('btn-delete-case').addEventListener('click', deleteCase);
document.getElementById('btn-add-note').addEventListener('click', showNoteModal);
document.getElementById('btn-add-report').addEventListener('click', showReportModal);
document.getElementById('btn-add-person').addEventListener('click', showPersonModal);
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});
document.getElementById('search-input').addEventListener('input', renderDashboard);
document.getElementById('filter-status').addEventListener('change', renderDashboard);
document.getElementById('filter-type').addEventListener('change', renderDashboard);

document.querySelectorAll('.poi-tab').forEach(btn => {
  btn.addEventListener('click', function() {
    activePoiRole = this.dataset.role;
    document.querySelectorAll('.poi-tab').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    renderPersons();
  });
});

// ─── Init ─────────────────────────────────────────────────────────────────────

renderDashboard();
