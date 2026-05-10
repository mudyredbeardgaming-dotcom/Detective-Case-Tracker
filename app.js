// ─── Persistence ─────────────────────────────────────────────────────────────

const DB_KEY       = 'lapd_cases';
const USERS_KEY    = 'cid_users';
const SESSION_KEY  = 'cid_session';
const COUNTERS_KEY = 'cid_case_counters';

function loadDB()          { try { return JSON.parse(localStorage.getItem(DB_KEY))       || []; } catch { return []; } }
function saveDB(d)         { localStorage.setItem(DB_KEY, JSON.stringify(d)); }
function loadUsers()       { try { return JSON.parse(localStorage.getItem(USERS_KEY))    || []; } catch { return []; } }
function saveUsers(d)      { localStorage.setItem(USERS_KEY, JSON.stringify(d)); }
function loadSession()     { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } }
function saveSession(uid)  { localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: uid })); }
function clearSession()    { localStorage.removeItem(SESSION_KEY); }

// ─── App State ────────────────────────────────────────────────────────────────

let cases         = loadDB();
let currentCaseId = null;
let activePoiRole = 'Suspect';

// ─── Case Types ───────────────────────────────────────────────────────────────

const CASE_TYPES = [
  { label: 'ARSON',                code: 'A' },
  { label: 'GANG-RELATED CRIMES',  code: 'G' },
  { label: 'NARCOTICS',            code: 'N' },
  { label: 'HOMICIDE',             code: 'H' },
  { label: 'KIDNAPPING',           code: 'K' },
  { label: 'DOMESTIC/ABUSE',       code: 'D' },
  { label: 'HIGH-LEVEL ROBBERY',   code: 'R' },
  { label: 'OTHER INVESTIGATIONS', code: 'O' },
  { label: 'INTERNAL AFFAIRS',     code: 'I' },
];

function loadCounters() { try { return JSON.parse(localStorage.getItem(COUNTERS_KEY)) || {}; } catch { return {}; } }

function peekCaseNumber(code) {
  const c = loadCounters();
  return `${code}-${(c[code] || 999) + 1}`;
}

function claimCaseNumber(code) {
  const c = loadCounters();
  const n = (c[code] || 999) + 1;
  c[code] = n;
  localStorage.setItem(COUNTERS_KEY, JSON.stringify(c));
  return `${code}-${n}`;
}

function updateCaseNumberPreview() {
  const te = document.getElementById('f-type');
  const ne = document.getElementById('f-caseNumber');
  if (!te || !ne) return;
  const t = CASE_TYPES.find(x => x.label === te.value);
  ne.value = t ? peekCaseNumber(t.code) : '';
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function genId() { return Math.random().toString(36).slice(2, 10).toUpperCase(); }

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getCaseById(id) { return cases.find(c => c.id === id); }

// ─── Auth & Permissions ───────────────────────────────────────────────────────

function getCurrentUser() {
  const session = loadSession();
  if (!session) return null;
  return loadUsers().find(u => u.id === session.userId) || null;
}

function canManageUsers() {
  const u = getCurrentUser();
  return !!u && ['Det III', 'Command'].includes(u.role);
}

function userInitials(name) {
  return (name || '?').split(/[\s._-]+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

// ─── Header ───────────────────────────────────────────────────────────────────

function updateHeader() {
  const user = getCurrentUser();
  if (!user) return;
  document.getElementById('header-username').textContent    = user.discordUsername;
  document.getElementById('header-role').textContent        = user.role + (user.badge ? ' · #' + user.badge : '');
  document.getElementById('user-initials-badge').textContent = userInitials(user.discordUsername);
  document.getElementById('btn-admin').style.display        = canManageUsers() ? '' : 'none';
}

// ─── View Management ─────────────────────────────────────────────────────────

function showView(name) {
  ['view-dashboard', 'view-detail', 'view-admin'].forEach(id => {
    document.getElementById(id).style.display = (id === `view-${name}`) ? '' : 'none';
  });
}

// ─── Login / Logout ───────────────────────────────────────────────────────────

function initApp() {
  const user = getCurrentUser();
  if (!user) {
    showLoginScreen();
  } else {
    showMainApp();
  }
}

function showLoginScreen() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-body').style.display     = 'none';

  const isFirstRun = loadUsers().length === 0;
  document.getElementById('login-setup-notice').style.display = isFirstRun ? '' : 'none';
  document.getElementById('l-badge-group').style.display      = isFirstRun ? '' : 'none';
  document.getElementById('btn-login-submit').textContent      = isFirstRun ? 'Create Account & Sign In' : 'Sign In';
  document.getElementById('login-error').style.display        = 'none';
  document.getElementById('l-username').value  = '';
  document.getElementById('l-discordId').value = '';
}

function showMainApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-body').style.display     = '';
  updateHeader();
  showView('dashboard');
  renderDashboard();
}

function doLogin() {
  const username  = document.getElementById('l-username').value.trim();
  const discordId = document.getElementById('l-discordId').value.trim();
  const errEl     = document.getElementById('login-error');
  errEl.style.display = 'none';

  if (!username || !discordId) {
    errEl.textContent   = 'Discord Username and Discord ID are required.';
    errEl.style.display = '';
    return;
  }

  const users = loadUsers();

  if (users.length === 0) {
    const badge   = (document.getElementById('l-badge')?.value || '').trim();
    const newUser = {
      id: genId(), discordUsername: username, discordId,
      role: 'Command', badge,
      addedAt: new Date().toISOString(), addedBy: 'system',
    };
    saveUsers([newUser]);
    saveSession(newUser.id);
    showMainApp();
    return;
  }

  const user = users.find(u => u.discordId === discordId);
  if (!user) {
    errEl.textContent   = 'Discord ID not found. Contact a Det III or Command to be added to the system.';
    errEl.style.display = '';
    return;
  }

  saveSession(user.id);
  showMainApp();
}

function doLogout() {
  clearSession();
  showLoginScreen();
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function renderDashboard() {
  const search       = document.getElementById('search-input').value.toLowerCase();
  const filterStatus = document.getElementById('filter-status').value;
  const filterType   = document.getElementById('filter-type').value;

  let filtered = cases.filter(c => {
    const matchSearch = !search ||
      c.caseNumber.toLowerCase().includes(search) ||
      c.title.toLowerCase().includes(search) ||
      (c.detective || '').toLowerCase().includes(search) ||
      (c.persons || []).some(p => p.name.toLowerCase().includes(search));
    return matchSearch &&
      (!filterStatus || c.status === filterStatus) &&
      (!filterType   || c.type   === filterType);
  });

  document.getElementById('count-open').textContent   = cases.filter(c => c.status === 'Open').length;
  document.getElementById('count-active').textContent = cases.filter(c => c.status === 'Active').length;
  document.getElementById('count-closed').textContent = cases.filter(c => c.status === 'Closed').length;
  document.getElementById('count-total').textContent  = cases.length;

  const tbody = document.getElementById('cases-tbody');
  tbody.innerHTML = '';

  if (!filtered.length) {
    document.getElementById('no-cases-msg').style.display = '';
    document.getElementById('cases-table').style.display  = 'none';
    return;
  }
  document.getElementById('no-cases-msg').style.display = 'none';
  document.getElementById('cases-table').style.display  = '';

  filtered.sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));

  for (const c of filtered) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="case-number">${escHtml(c.caseNumber)}</span></td>
      <td>${escHtml(c.type)}</td>
      <td>${escHtml(c.title)}</td>
      <td>${escHtml(c.detective || '— Unassigned')}</td>
      <td><span class="status-badge status-${escHtml(c.status)}">${escHtml(c.status)}</span></td>
      <td>${fmtDate(c.openedAt)}</td>
      <td>${(c.reports || []).length}</td>
      <td><div class="table-actions">
        <button class="btn btn-sm btn-secondary" onclick="openCase('${c.id}')">Open</button>
      </div></td>`;
    tbody.appendChild(tr);
  }
}

// ─── Case Detail ─────────────────────────────────────────────────────────────

function openCase(id) {
  currentCaseId = id;
  activePoiRole = 'Suspect';
  showView('detail');
  renderDetail();
}

function renderDetail() {
  const c = getCaseById(currentCaseId);
  if (!c) return;

  document.getElementById('detail-case-number').textContent = c.caseNumber;
  const badge = document.getElementById('detail-status-badge');
  badge.textContent = c.status;
  badge.className   = `status-badge status-${c.status}`;

  document.getElementById('detail-info-grid').innerHTML = `
    <div class="info-item"><label>Title</label><span>${escHtml(c.title)}</span></div>
    <div class="info-item"><label>Type</label><span>${escHtml(c.type)}</span></div>
    <div class="info-item"><label>Status</label><span>${escHtml(c.status)}</span></div>
    <div class="info-item"><label>Priority</label><span>${escHtml(c.priority || '—')}</span></div>
    <div class="info-item"><label>Assigned Detective</label><span>${escHtml(c.detective || '— Unassigned')}</span></div>
    <div class="info-item"><label>Badge #</label><span>${escHtml(c.badge || '—')}</span></div>
    <div class="info-item"><label>Opened</label><span>${fmtDate(c.openedAt)}</span></div>
    <div class="info-item"><label>Last Updated</label><span>${fmtDateTime(c.updatedAt)}</span></div>
    ${c.closedAt ? `<div class="info-item"><label>Closed</label><span>${fmtDate(c.closedAt)}</span></div>` : ''}
    ${c.location ? `<div class="info-item full-width"><label>Incident Location</label><span>${escHtml(c.location)}</span></div>` : ''}
    ${c.summary  ? `<div class="info-item full-width"><label>Case Summary</label><span>${escHtml(c.summary)}</span></div>`  : ''}`;

  renderNotes();
  renderReports();
  renderPersons();
  document.querySelectorAll('.poi-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.role === activePoiRole);
  });
}

function renderNotes() {
  const c         = getCaseById(currentCaseId);
  const notes     = (c.notes || []).slice().reverse();
  const container = document.getElementById('notes-list');
  const msg       = document.getElementById('no-notes-msg');

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
  const c         = getCaseById(currentCaseId);
  const reports   = (c.reports || []).slice().reverse();
  const container = document.getElementById('reports-list');
  const msg       = document.getElementById('no-reports-msg');

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
  const c         = getCaseById(currentCaseId);
  const persons   = (c.persons || []).filter(p => p.role === activePoiRole);
  const container = document.getElementById('persons-list');
  const msg       = document.getElementById('no-persons-msg');

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
      ${p.dob         ? `<div class="person-detail">DOB: ${escHtml(p.dob)}</div>`         : ''}
      ${p.phone       ? `<div class="person-detail">Phone: ${escHtml(p.phone)}</div>`     : ''}
      ${p.address     ? `<div class="person-detail">Address: ${escHtml(p.address)}</div>` : ''}
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
  document.getElementById('modal-body').innerHTML    = bodyHtml;
  document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  document.getElementById('modal-body').innerHTML = '';
}

// ─── Case Modal ───────────────────────────────────────────────────────────────

function buildDetectiveField(c, isEdit) {
  const manage = canManageUsers();
  const dets   = loadUsers().filter(u => ['Det I', 'Det II'].includes(u.role));

  if (!manage) {
    if (isEdit && c.detective) {
      return `<div class="form-group">
        <label class="field-label">Assigned Detective</label>
        <input type="text" value="${escHtml(c.detective)}${c.badge ? ' · #' + escHtml(c.badge) : ''}" readonly class="input-readonly" />
      </div>`;
    }
    return '';
  }

  const options = dets.length
    ? dets.map(u => {
        const selected = isEdit && c.detective === u.discordUsername ? 'selected' : '';
        const label    = `${u.discordUsername} · ${u.role}${u.badge ? ' · #' + u.badge : ''}`;
        return `<option value="${u.id}" ${selected}>${escHtml(label)}</option>`;
      }).join('')
    : '<option disabled>No Det I / Det II users registered yet</option>';

  return `<div class="form-row">
    <div class="form-group">
      <label class="field-label">Assign Detective</label>
      <select id="f-detective">
        <option value="">— Unassigned —</option>
        ${options}
      </select>
    </div>
    <div class="form-group">
      <label class="field-label">Badge #</label>
      <input type="text" id="f-badge" value="${escHtml(isEdit ? (c.badge || '') : '')}" readonly class="input-readonly" placeholder="Auto-filled" />
    </div>
  </div>`;
}

function showCaseModal(existing) {
  const isEdit = !!existing;
  const c      = existing || {};
  const manage = canManageUsers();

  showModal(isEdit ? 'Edit Case' : 'New Case', `
    <div class="form-group">
      <label class="field-label">Case Type</label>
      <select id="f-type"${isEdit ? ' disabled' : ''}>
        ${isEdit ? '' : '<option value="">— Select Case Type —</option>'}
        ${CASE_TYPES.map(t => `<option value="${t.label}" ${c.type === t.label ? 'selected' : ''}>${t.label}</option>`).join('')}
      </select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">Case Number</label>
        <input type="text" id="f-caseNumber" value="${escHtml(c.caseNumber || '')}" readonly class="input-readonly" placeholder="Select case type first" />
      </div>
      <div class="form-group">
        <label class="field-label">Status</label>
        <select id="f-status">
          ${['Open','Active','Pending','Closed','Cold'].map(s =>
            `<option value="${s}" ${(c.status || 'Open') === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="field-label">Case Title</label>
      <input type="text" id="f-title" value="${escHtml(c.title || '')}" placeholder="Brief case title" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">Priority</label>
        <select id="f-priority">
          ${['Critical','High','Medium','Low'].map(p =>
            `<option value="${p}" ${(c.priority || 'Medium') === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="field-label">Date Opened</label>
        <input type="date" id="f-openedAt" value="${c.openedAt ? c.openedAt.substring(0, 10) : new Date().toISOString().substring(0, 10)}" />
      </div>
    </div>
    ${buildDetectiveField(c, isEdit)}
    <div class="form-group">
      <label class="field-label">Incident Location</label>
      <input type="text" id="f-location" value="${escHtml(c.location || '')}" placeholder="e.g. 300 N Main St, Los Santos" />
    </div>
    <div class="form-group">
      <label class="field-label">Case Summary</label>
      <textarea id="f-summary" placeholder="Brief overview of the case...">${escHtml(c.summary || '')}</textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveCase(${isEdit ? `'${c.id}'` : 'null'})">${isEdit ? 'Save Changes' : 'Create Case'}</button>
    </div>`);

  if (!isEdit) {
    document.getElementById('f-type').addEventListener('change', updateCaseNumberPreview);
  }

  const detSel = document.getElementById('f-detective');
  if (detSel) detSel.addEventListener('change', onDetectiveSelect);
}

function onDetectiveSelect() {
  const detSel   = document.getElementById('f-detective');
  const badgeInp = document.getElementById('f-badge');
  if (!detSel || !badgeInp) return;
  const det = loadUsers().find(u => u.id === detSel.value);
  badgeInp.value = det ? (det.badge || '') : '';
}

function saveCase(editId) {
  const typeLabel = document.getElementById('f-type').value;
  const title     = document.getElementById('f-title').value.trim();
  if (!typeLabel) { alert('Please select a case type.'); return; }
  if (!title)     { alert('Case title is required.');    return; }

  const now    = new Date().toISOString();
  const manage = canManageUsers();
  const me     = getCurrentUser();

  let detective = '';
  let badge     = '';

  if (manage) {
    const detId = document.getElementById('f-detective')?.value || '';
    if (detId) {
      const det = loadUsers().find(u => u.id === detId);
      if (det) { detective = det.discordUsername; badge = det.badge || ''; }
    }
  } else if (editId) {
    const existing = getCaseById(editId);
    detective = existing.detective || '';
    badge     = existing.badge     || '';
  } else {
    detective = me.discordUsername;
    badge     = me.badge || '';
  }

  if (editId) {
    const c = getCaseById(editId);
    Object.assign(c, {
      title, type: typeLabel,
      status:   document.getElementById('f-status').value,
      priority: document.getElementById('f-priority').value,
      detective, badge,
      location: document.getElementById('f-location').value.trim(),
      summary:  document.getElementById('f-summary').value.trim(),
      openedAt: document.getElementById('f-openedAt').value,
      updatedAt: now,
      closedAt: document.getElementById('f-status').value === 'Closed' ? (c.closedAt || now) : null,
    });
    saveDB(cases);
    closeModal();
    renderDetail();
  } else {
    const typeObj    = CASE_TYPES.find(t => t.label === typeLabel);
    const caseNumber = claimCaseNumber(typeObj.code);
    const newCase = {
      id: genId(), caseNumber, title, type: typeLabel,
      status:   document.getElementById('f-status').value,
      priority: document.getElementById('f-priority').value,
      detective, badge,
      location: document.getElementById('f-location').value.trim(),
      summary:  document.getElementById('f-summary').value.trim(),
      openedAt: document.getElementById('f-openedAt').value,
      updatedAt: now, closedAt: null,
      notes: [], reports: [], persons: [],
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
  const me = getCurrentUser();
  showModal('Add Detective Note', `
    <div class="form-group">
      <label class="field-label">Detective Name</label>
      <input type="text" id="n-detective" value="${escHtml(me?.discordUsername || '')}" placeholder="Detective name" />
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
  const detective    = document.getElementById('n-detective').value.trim();
  const text         = document.getElementById('n-text').value.trim();
  if (!text) { alert('Note text is required.'); return; }

  const c            = getCaseById(currentCaseId);
  const statusUpdate = document.getElementById('n-statusUpdate').value;
  const now          = new Date().toISOString();

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
  c.notes     = c.notes.filter(n => n.id !== noteId);
  c.updatedAt = new Date().toISOString();
  saveDB(cases);
  renderNotes();
}

// ─── Report Modal ─────────────────────────────────────────────────────────────

function showReportModal() {
  const c         = getCaseById(currentCaseId);
  const me        = getCurrentUser();
  const reportNum = `RPT-${c.caseNumber}-${String((c.reports || []).length + 1).padStart(3, '0')}`;

  showModal('File Report', `
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">Report ID</label>
        <input type="text" id="r-reportId" value="${escHtml(reportNum)}" />
      </div>
      <div class="form-group">
        <label class="field-label">Report Type</label>
        <select id="r-type">
          ${['Initial Report','Follow-Up','Crime Scene','Autopsy','Witness Statement','Suspect Interview','Surveillance','Evidence','Other']
            .map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="field-label">Filed By</label>
      <input type="text" id="r-filedBy" value="${escHtml(me?.discordUsername || c.detective || '')}" />
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
  const content  = document.getElementById('r-content').value.trim();
  if (!reportId || !content) { alert('Report ID and content are required.'); return; }

  const c   = getCaseById(currentCaseId);
  const now = new Date().toISOString();
  c.reports.push({
    id: genId(), reportId,
    type:    document.getElementById('r-type').value,
    filedBy: document.getElementById('r-filedBy').value.trim(),
    content, createdAt: now,
  });
  c.updatedAt = now;
  saveDB(cases);
  closeModal();
  renderDetail();
}

function deleteReport(reportId) {
  if (!confirm('Delete this report?')) return;
  const c = getCaseById(currentCaseId);
  c.reports   = c.reports.filter(r => r.id !== reportId);
  c.updatedAt = new Date().toISOString();
  saveDB(cases);
  renderReports();
}

// ─── Person Modal ─────────────────────────────────────────────────────────────

function showPersonModal() {
  const me = getCurrentUser();
  showModal('Add Person of Interest', `
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">Full Name</label>
        <input type="text" id="p-name" placeholder="First Last" />
      </div>
      <div class="form-group">
        <label class="field-label">Role</label>
        <select id="p-role">
          <option value="Suspect" ${activePoiRole === 'Suspect' ? 'selected' : ''}>Suspect</option>
          <option value="Witness" ${activePoiRole === 'Witness' ? 'selected' : ''}>Witness</option>
          <option value="Victim"  ${activePoiRole === 'Victim'  ? 'selected' : ''}>Victim</option>
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
      <input type="text" id="p-spokenBy" value="${escHtml(me?.discordUsername || '')}" placeholder="Detective name" />
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="savePerson()">Add Person</button>
    </div>`);

  document.getElementById('p-spoken').addEventListener('change', function () {
    document.getElementById('p-spokenby-group').style.display = this.checked ? '' : 'none';
  });
}

function savePerson() {
  const name = document.getElementById('p-name').value.trim();
  if (!name) { alert('Name is required.'); return; }

  const c      = getCaseById(currentCaseId);
  const spoken = document.getElementById('p-spoken').checked;
  c.persons.push({
    id: genId(), name,
    role:        document.getElementById('p-role').value,
    dob:         document.getElementById('p-dob').value.trim(),
    phone:       document.getElementById('p-phone').value.trim(),
    address:     document.getElementById('p-address').value.trim(),
    description: document.getElementById('p-description').value.trim(),
    spoken, spokenBy: spoken ? document.getElementById('p-spokenBy').value.trim() : '',
  });
  c.updatedAt   = new Date().toISOString();
  activePoiRole = document.getElementById('p-role').value;
  saveDB(cases);
  closeModal();
  renderDetail();
}

function deletePerson(personId) {
  if (!confirm('Remove this person from the case?')) return;
  const c = getCaseById(currentCaseId);
  c.persons   = c.persons.filter(p => p.id !== personId);
  c.updatedAt = new Date().toISOString();
  saveDB(cases);
  renderPersons();
}

// ─── Delete Case ──────────────────────────────────────────────────────────────

function deleteCase() {
  const c = getCaseById(currentCaseId);
  if (!confirm(`Delete case ${c.caseNumber}? This cannot be undone.`)) return;
  cases         = cases.filter(x => x.id !== currentCaseId);
  currentCaseId = null;
  saveDB(cases);
  showView('dashboard');
  renderDashboard();
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────

function showAdminPanel() {
  showView('admin');
  renderAdminPanel();
}

function renderAdminPanel() {
  const users  = loadUsers();
  const me     = getCurrentUser();
  const list   = document.getElementById('users-list');
  const msg    = document.getElementById('no-users-msg');

  if (!users.length) { list.innerHTML = ''; msg.style.display = ''; return; }
  msg.style.display = 'none';

  const roleClass = r => 'role-' + r.replace(' ', '-');

  list.innerHTML = users.map(u => `
    <div class="user-item">
      <div class="user-item-left">
        <div class="user-item-name">${escHtml(u.discordUsername)}</div>
        <div class="user-item-discord">Discord ID: ${escHtml(u.discordId)}</div>
        ${u.badge ? `<div class="user-item-badge">Badge: #${escHtml(u.badge)}</div>` : ''}
        <div class="user-item-meta">Added by ${escHtml(u.addedBy)} · ${fmtDate(u.addedAt)}</div>
      </div>
      <div class="user-item-right">
        <span class="role-badge ${roleClass(u.role)}">${escHtml(u.role)}</span>
        <button class="btn btn-sm btn-secondary" onclick="showEditUserModal('${u.id}')">Edit</button>
        ${u.id !== me.id
          ? `<button class="btn btn-sm btn-danger" onclick="removeUser('${u.id}')">Remove</button>`
          : `<span class="self-tag">(you)</span>`}
      </div>
    </div>`).join('');
}

function showAddUserModal() {
  showModal('Add Detective', `
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">Discord Username</label>
        <input type="text" id="u-username" placeholder="e.g. mudyr" />
      </div>
      <div class="form-group">
        <label class="field-label">Discord ID</label>
        <input type="text" id="u-discordId" placeholder="18-digit Discord ID" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">Role</label>
        <select id="u-role">
          <option value="Det I">Det I</option>
          <option value="Det II">Det II</option>
          <option value="Det III">Det III</option>
          <option value="Command">Command</option>
        </select>
      </div>
      <div class="form-group">
        <label class="field-label">Badge Number</label>
        <input type="text" id="u-badge" placeholder="#0000" />
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveNewUser()">Add Detective</button>
    </div>`);
}

function showEditUserModal(userId) {
  const u = loadUsers().find(x => x.id === userId);
  if (!u) return;
  showModal('Edit Detective', `
    <div class="form-group">
      <label class="field-label">Discord Username</label>
      <input type="text" id="u-username" value="${escHtml(u.discordUsername)}" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">Role</label>
        <select id="u-role">
          ${['Det I','Det II','Det III','Command'].map(r =>
            `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="field-label">Badge Number</label>
        <input type="text" id="u-badge" value="${escHtml(u.badge || '')}" placeholder="#0000" />
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveEditUser('${userId}')">Save Changes</button>
    </div>`);
}

function saveNewUser() {
  const username  = document.getElementById('u-username').value.trim();
  const discordId = document.getElementById('u-discordId').value.trim();
  if (!username || !discordId) { alert('Discord username and ID are required.'); return; }

  const users = loadUsers();
  if (users.find(u => u.discordId === discordId)) {
    alert('A user with this Discord ID already exists.');
    return;
  }

  const me = getCurrentUser();
  users.push({
    id: genId(), discordUsername: username, discordId,
    role:    document.getElementById('u-role').value,
    badge:   document.getElementById('u-badge').value.trim(),
    addedAt: new Date().toISOString(),
    addedBy: me.discordUsername,
  });
  saveUsers(users);
  closeModal();
  renderAdminPanel();
}

function saveEditUser(userId) {
  const users = loadUsers();
  const u     = users.find(x => x.id === userId);
  if (!u) return;
  u.discordUsername = document.getElementById('u-username').value.trim() || u.discordUsername;
  u.role            = document.getElementById('u-role').value;
  u.badge           = document.getElementById('u-badge').value.trim();
  saveUsers(users);
  if (getCurrentUser()?.id === userId) updateHeader();
  closeModal();
  renderAdminPanel();
}

function removeUser(userId) {
  if (!confirm('Remove this detective from the system? They will no longer be able to sign in.')) return;
  saveUsers(loadUsers().filter(u => u.id !== userId));
  renderAdminPanel();
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

document.getElementById('btn-login-submit').addEventListener('click', doLogin);
['l-username', 'l-discordId', 'l-badge'].forEach(id => {
  document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
});

document.getElementById('btn-logout').addEventListener('click', doLogout);
document.getElementById('btn-admin').addEventListener('click', showAdminPanel);
document.getElementById('btn-admin-back').addEventListener('click', () => { showView('dashboard'); renderDashboard(); });
document.getElementById('btn-add-user').addEventListener('click', showAddUserModal);

document.getElementById('btn-new-case').addEventListener('click', () => showCaseModal(null));
document.getElementById('btn-back').addEventListener('click', () => { showView('dashboard'); renderDashboard(); });
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
  btn.addEventListener('click', function () {
    activePoiRole = this.dataset.role;
    document.querySelectorAll('.poi-tab').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    renderPersons();
  });
});

// ─── Init ─────────────────────────────────────────────────────────────────────

initApp();
