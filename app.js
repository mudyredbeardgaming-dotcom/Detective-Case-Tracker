// ─── Supabase Config ─────────────────────────────────────────────────────────
// FILL THESE IN after creating your Supabase project
// Found at: Supabase Dashboard → Settings → API
const SUPABASE_URL      = 'https://koskswavnwvvifjvhxjl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtvc2tzd2F2bnd2dmlmanZoeGpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NTYwNDIsImV4cCI6MjA5NDAzMjA0Mn0.Q4ThnYoehrZ9g84VC-o2CPgrdMnSUpU-tVwVsGH8FjY';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: 'implicit', persistSession: true, storageKey: 'cid-session' }
});

console.log('[CID URL] hash:', window.location.hash.slice(0, 80) || '(empty)');
console.log('[CID URL] search:', window.location.search || '(empty)');

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
  { label: 'INTERNAL AFFAIRS',     code: 'IA' },
];

// ─── App State ────────────────────────────────────────────────────────────────

let currentUser    = null;
let currentProfile = null;
let cases          = [];   // local cache, populated from Supabase
let currentCaseId  = null;
let activePoiRole  = 'Suspect';
let activeAdminTab = 'detectives';

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

function userInitials(name) {
  return (name || '?').split(/[\s._-]+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function detName(profile) {
  return (profile?.display_name || profile?.discord_username || 'Unknown').trim();
}

function canManageUsers() {
  return !!currentProfile && ['Det III', 'Command'].includes(currentProfile.role);
}

// ─── Screen Management ────────────────────────────────────────────────────────

function showScreen(name) {
  console.log('[CID] showScreen ->', name);
  document.getElementById('loading-screen').style.display  = 'none';
  document.getElementById('login-screen').style.display   = name === 'login'   ? 'flex' : 'none';
  document.getElementById('pending-screen').style.display = name === 'pending' ? 'flex' : 'none';
  document.getElementById('app-body').style.display       = name === 'app'     ? ''     : 'none';
}

// After 6s still loading: database is waking up from pause — let the user know
setTimeout(() => {
  const ls = document.getElementById('loading-screen');
  if (ls && ls.style.display !== 'none') {
    document.getElementById('loading-msg').textContent = 'Waking up database...';
  }
}, 6000);

// After 20s still loading: database is waking up from pause — let the user know
setTimeout(() => {
  const ls = document.getElementById('loading-screen');
  if (ls && ls.style.display !== 'none') {
    document.getElementById('loading-msg').textContent = 'Almost there...';
  }
}, 20000);

// Safety net — fall back to login after 35 seconds
setTimeout(() => {
  const ls = document.getElementById('loading-screen');
  if (ls && ls.style.display !== 'none') {
    console.warn('[CID] Auth timed out — falling back to login');
    showScreen('login');
    const errEl = document.getElementById('login-error');
    errEl.textContent   = 'Connection timed out. Please try logging in again.';
    errEl.style.display = '';
  }
}, 35000);

function showView(name) {
  ['view-dashboard', 'view-detail', 'view-admin'].forEach(id => {
    document.getElementById(id).style.display = (id === `view-${name}`) ? '' : 'none';
  });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

db.auth.onAuthStateChange(async (event, session) => {
  console.log('[CID Auth]', event, session ? 'HAS SESSION' : 'NO SESSION', session?.user?.id ?? '');
  if (session?.user) {
    currentUser = session.user;
    try {
      await handleUserSession();
    } catch (err) {
      console.error('[CID Auth] handleUserSession error:', err);
      const errEl = document.getElementById('login-error');
      errEl.textContent   = 'Login error: ' + (err.message || 'Unknown error — check browser console (F12).');
      errEl.style.display = '';
      showScreen('login');
    }
  } else {
    currentUser    = null;
    currentProfile = null;
    cases          = [];
    showScreen('login');
  }
});

async function handleUserSession() {
  console.log('[CID] handleUserSession start, uid:', currentUser.id);
  // Load this user's profile
  const { data: profile, error: profileErr } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
  console.log('[CID] profile query result:', profile ? 'found' : 'not found', profileErr?.code ?? '');

  if (profileErr && profileErr.code !== 'PGRST116') {
    // PGRST116 = no rows found (expected for new users); anything else is a real error
    throw new Error('Profile lookup failed: ' + profileErr.message + ' (code: ' + profileErr.code + '). Make sure you have run schema.sql in Supabase.');
  }

  let resolvedProfile = profile;

  if (!resolvedProfile) {
    // Trigger should have created it — create manually as fallback
    const discordName = currentUser.user_metadata?.full_name
      || currentUser.user_metadata?.name
      || 'Unknown';
    const discordId = currentUser.user_metadata?.provider_id || '';
    const { error: upsertErr } = await db.from('profiles').upsert({
      id: currentUser.id, discord_username: discordName,
      discord_id: discordId, role: 'pending', approved: false, added_by: 'discord',
    });
    if (upsertErr) throw new Error('Profile creation failed: ' + upsertErr.message);
    const { data: fresh, error: freshErr } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
    if (freshErr) throw new Error('Profile refetch failed: ' + freshErr.message);
    resolvedProfile = fresh;
  }

  // Auto-approve first Discord user ever as Command
  if (resolvedProfile && !resolvedProfile.approved) {
    const { count } = await db.from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('approved', true);
    if (count === 0) {
      const { error: approveErr } = await db.from('profiles')
        .update({ approved: true, role: 'Command' }).eq('id', currentUser.id);
      if (approveErr) throw new Error('Auto-approve failed: ' + approveErr.message);
      resolvedProfile.approved = true;
      resolvedProfile.role     = 'Command';
    }
  }

  currentProfile = resolvedProfile;
  console.log('[CID] profile approved:', currentProfile?.approved, 'role:', currentProfile?.role);

  if (currentProfile?.approved) {
    await enterApp();
  } else {
    showScreen('pending');
  }
}

async function enterApp() {
  updateHeader();
  showScreen('app');
  showView('dashboard');
  await renderDashboard();
}

async function signInWithDiscord() {
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  const { error } = await db.auth.signInWithOAuth({
    provider: 'discord',
    options:  { redirectTo: window.location.origin },
  });
  if (error) {
    errEl.textContent   = 'Could not connect to Discord. Check your Supabase Discord provider setup.';
    errEl.style.display = '';
  }
}

async function signOut() {
  await db.auth.signOut();
}

// ─── Header ───────────────────────────────────────────────────────────────────

function updateHeader() {
  if (!currentProfile) return;
  const name = detName(currentProfile);
  document.getElementById('header-username').textContent     = name;
  document.getElementById('header-role').textContent         = currentProfile.role + (currentProfile.badge ? ' · #' + currentProfile.badge : '');
  document.getElementById('user-initials-badge').textContent = userInitials(name);
  document.getElementById('btn-admin').style.display         = canManageUsers() ? '' : 'none';
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

async function renderDashboard() {
  const { data, error } = await db.from('cases').select('*').order('opened_at', { ascending: false });
  if (error) { console.error(error); return; }
  cases = data || [];

  const search       = document.getElementById('search-input').value.toLowerCase();
  const filterStatus = document.getElementById('filter-status').value;
  const filterType   = document.getElementById('filter-type').value;

  let filtered = cases.filter(c => {
    const matchSearch = !search ||
      c.case_number.toLowerCase().includes(search) ||
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

  for (const c of filtered) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="case-number">${escHtml(c.case_number)}</span></td>
      <td>${escHtml(c.type)}</td>
      <td>${escHtml(c.title)}</td>
      <td>${escHtml(c.detective || '— Unassigned')}</td>
      <td><span class="status-badge status-${escHtml(c.status)}">${escHtml(c.status)}</span></td>
      <td>${fmtDate(c.opened_at)}</td>
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

  document.getElementById('detail-case-number').textContent = c.case_number;
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
    <div class="info-item"><label>Opened</label><span>${fmtDate(c.opened_at)}</span></div>
    <div class="info-item"><label>Last Updated</label><span>${fmtDateTime(c.updated_at)}</span></div>
    ${c.closed_at  ? `<div class="info-item"><label>Closed</label><span>${fmtDate(c.closed_at)}</span></div>` : ''}
    ${c.location   ? `<div class="info-item full-width"><label>Incident Location</label><span>${escHtml(c.location)}</span></div>` : ''}
    ${c.summary    ? `<div class="info-item full-width"><label>Case Summary</label><span>${escHtml(c.summary)}</span></div>` : ''}`;

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
        <button class="btn-icon" onclick="deleteNote('${n.id}')" title="Delete">🗑</button>
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
        <button class="btn-icon" onclick="deleteReport('${r.id}')" title="Delete">🗑</button>
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

// ─── Case Number ─────────────────────────────────────────────────────────────

async function peekCaseNumber(code) {
  const { data } = await db.from('case_counters').select('counter').eq('code', code).maybeSingle();
  return `${code}-${(data?.counter ?? 999) + 1}`;
}

async function claimCaseNumber(code) {
  const { data } = await db.from('case_counters').select('counter').eq('code', code).maybeSingle();
  const next = (data?.counter ?? 999) + 1;
  await db.from('case_counters').upsert({ code, counter: next });
  return `${code}-${next}`;
}

async function updateCaseNumberPreview() {
  const te = document.getElementById('f-type');
  const ne = document.getElementById('f-caseNumber');
  if (!te || !ne) return;
  const t = CASE_TYPES.find(x => x.label === te.value);
  ne.value = t ? await peekCaseNumber(t.code) : '';
}

// ─── Case Modal ───────────────────────────────────────────────────────────────

async function buildDetectiveField(c, isEdit) {
  const manage = canManageUsers();
  if (!manage) {
    if (isEdit && c.detective) {
      return `<div class="form-group">
        <label class="field-label">Assigned Detective</label>
        <input type="text" value="${escHtml(c.detective)}${c.badge ? ' · #' + escHtml(c.badge) : ''}" readonly class="input-readonly" />
      </div>`;
    }
    return '';
  }

  let dets = [];
  try {
    const { data } = await db.from('profiles')
      .select('id, discord_username, display_name, role, badge')
      .in('role', ['Det I', 'Det II', 'Det III', 'Command'])
      .eq('approved', true)
      .order('discord_username');
    dets = data || [];
  } catch (err) {
    console.error('Could not load detective list:', err);
  }

  const options = dets.length
    ? dets.map(u => {
        const name  = detName(u);
        const sel   = isEdit && c.detective === name ? 'selected' : '';
        const label = `${name} · ${u.role}${u.badge ? ' · #' + u.badge : ''}`;
        return `<option value="${u.id}" ${sel}>${escHtml(label)}</option>`;
      }).join('')
    : '<option disabled>No approved detectives yet</option>';

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

  // Open modal immediately — don't wait on any Supabase query
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
        <input type="text" id="f-caseNumber" value="${escHtml(c.case_number || '')}" readonly class="input-readonly" placeholder="Select case type first" />
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
        <input type="date" id="f-openedAt" value="${c.opened_at ? c.opened_at.substring(0, 10) : new Date().toISOString().substring(0, 10)}" />
      </div>
    </div>
    <div id="detective-field-container">${canManageUsers() ? '<div style="color:var(--text-muted);font-size:12px;padding:4px 0;">Loading detective list...</div>' : ''}</div>
    <div class="form-group">
      <label class="field-label">Incident Location</label>
      <input type="text" id="f-location" value="${escHtml(c.location || '')}" placeholder="e.g. 300 N Main St, Los Santos" />
    </div>
    <div class="form-group">
      <label class="field-label">Case Summary</label>
      <textarea id="f-summary" placeholder="Brief overview of the case...">${escHtml(c.summary || '')}</textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">${isEdit ? 'Cancel' : 'Done'}</button>
      <button class="btn btn-primary" onclick="saveCase(${isEdit ? `'${c.id}'` : 'null'})">${isEdit ? 'Save Changes' : 'Create Case'}</button>
    </div>`);

  if (!isEdit) {
    document.getElementById('f-type').addEventListener('change', updateCaseNumberPreview);
  }

  // Load detective dropdown asynchronously — modal is already open and usable
  if (canManageUsers()) {
    buildDetectiveField(c, isEdit).then(detField => {
      const container = document.getElementById('detective-field-container');
      if (!container) return;
      container.innerHTML = detField;
      const detSel = document.getElementById('f-detective');
      if (detSel) {
        detSel.addEventListener('change', async () => {
          const { data: det } = await db.from('profiles').select('badge').eq('id', detSel.value).maybeSingle();
          const badgeInp = document.getElementById('f-badge');
          if (badgeInp) badgeInp.value = det?.badge || '';
        });
      }
    }).catch(err => {
      console.error('Detective field load error:', err);
      const container = document.getElementById('detective-field-container');
      if (container) container.innerHTML = '';
    });
  }
}

async function saveCase(editId) {
  const typeLabel = document.getElementById('f-type').value;
  const title     = document.getElementById('f-title').value.trim();
  if (!typeLabel) { alert('Please select a case type.'); return; }
  if (!title)     { alert('Case title is required.');    return; }

  try {
    const now    = new Date().toISOString();
    const manage = canManageUsers();

    let detective = '';
    let badge     = '';

    if (manage) {
      const detId = document.getElementById('f-detective')?.value || '';
      if (detId) {
        const { data: det } = await db.from('profiles')
          .select('discord_username, display_name, badge').eq('id', detId).maybeSingle();
        if (det) { detective = detName(det); badge = det.badge || ''; }
      }
    } else if (editId) {
      const existing = getCaseById(editId);
      detective = existing.detective || '';
      badge     = existing.badge     || '';
    } else {
      detective = detName(currentProfile);
      badge     = currentProfile.badge || '';
    }

    const payload = {
      title, type: typeLabel,
      status:    document.getElementById('f-status').value,
      priority:  document.getElementById('f-priority').value,
      detective, badge,
      location:  document.getElementById('f-location').value.trim(),
      summary:   document.getElementById('f-summary').value.trim(),
      opened_at: document.getElementById('f-openedAt').value,
      updated_at: now,
      closed_at: document.getElementById('f-status').value === 'Closed' ? now : null,
    };

    if (editId) {
      const existing = getCaseById(editId);
      if (existing && existing.closed_at && payload.status === 'Closed') {
        payload.closed_at = existing.closed_at;
      }
      const { data, error } = await db.from('cases').update(payload).eq('id', editId).select().single();
      if (error) { alert('Error saving case: ' + error.message); return; }
      const idx = cases.findIndex(c => c.id === editId);
      if (idx !== -1) cases[idx] = data;
      closeModal();
      renderDetail();
    } else {
      const typeObj    = CASE_TYPES.find(t => t.label === typeLabel);
      const caseNumber = await claimCaseNumber(typeObj.code);
      const newCase = {
        id: genId(), case_number: caseNumber, created_by: currentUser.id,
        notes: [], reports: [], persons: [], closed_at: null,
        ...payload,
      };
      const { data, error } = await db.from('cases').insert(newCase).select().single();
      if (error) { alert('Error creating case: ' + error.message); return; }
      cases.push(data);

      // Reset form for another case rather than navigating away
      await renderDashboard();
      document.getElementById('f-title').value   = '';
      document.getElementById('f-summary').value = '';
      document.getElementById('f-location').value = '';
      document.getElementById('f-type').value    = '';
      document.getElementById('f-caseNumber').value = '';
      document.getElementById('f-status').value  = 'Open';
      document.getElementById('f-priority').value = 'Medium';
      document.getElementById('f-openedAt').value = new Date().toISOString().substring(0, 10);

      const successBanner = document.createElement('div');
      successBanner.style.cssText = 'color:#3fb950;background:rgba(63,185,80,0.1);border:1px solid rgba(63,185,80,0.3);border-radius:6px;padding:8px 12px;font-size:13px;margin-bottom:12px;';
      successBanner.textContent = `✓ Case ${caseNumber} created. Fill in the form to add another, or click Cancel to close.`;
      document.getElementById('modal-body').prepend(successBanner);
      setTimeout(() => successBanner.remove(), 5000);
    }
  } catch (err) {
    console.error('saveCase error:', err);
    alert('Error: ' + err.message);
  }
}

// ─── Note Modal ───────────────────────────────────────────────────────────────

function showNoteModal() {
  showModal('Add Case Note', `
    <div id="note-success" style="display:none;color:#3fb950;background:rgba(63,185,80,0.1);border:1px solid rgba(63,185,80,0.3);border-radius:6px;padding:8px 12px;font-size:13px;margin-bottom:12px;"></div>
    <div class="form-group">
      <label class="field-label">Detective Name</label>
      <input type="text" id="n-detective" value="${escHtml(detName(currentProfile))}" />
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
      <button class="btn btn-ghost" onclick="closeModal()">Done</button>
      <button class="btn btn-primary" onclick="saveNote()">Add Note</button>
    </div>`);
}

async function saveNote() {
  const detective    = document.getElementById('n-detective').value.trim();
  const text         = document.getElementById('n-text').value.trim();
  if (!text) { alert('Note text is required.'); return; }
  try {
    const c            = getCaseById(currentCaseId);
    const statusUpdate = document.getElementById('n-statusUpdate').value;
    const now          = new Date().toISOString();
    const notes   = [...(c.notes || []), { id: genId(), detective, text, statusUpdate, createdAt: now }];
    const updates = { notes, updated_at: now };
    if (statusUpdate) {
      updates.status = statusUpdate;
      if (statusUpdate === 'Closed') updates.closed_at = c.closed_at || now;
    }
    const { data, error } = await db.from('cases').update(updates).eq('id', currentCaseId).select().single();
    if (error) { alert('Error saving note: ' + error.message); return; }
    const idx = cases.findIndex(x => x.id === currentCaseId);
    if (idx !== -1) cases[idx] = data;
    renderDetail();
    document.getElementById('n-text').value         = '';
    document.getElementById('n-statusUpdate').value = '';
    const s = document.getElementById('note-success');
    if (s) { s.textContent = '✓ Note added'; s.style.display = ''; setTimeout(() => { if (s) s.style.display = 'none'; }, 3000); }
    document.getElementById('n-text').focus();
  } catch (err) { console.error('saveNote:', err); alert('Error: ' + err.message); }
}

async function deleteNote(noteId) {
  if (!confirm('Delete this note?')) return;
  const c     = getCaseById(currentCaseId);
  const notes = (c.notes || []).filter(n => n.id !== noteId);
  const { data, error } = await db.from('cases').update({ notes, updated_at: new Date().toISOString() }).eq('id', currentCaseId).select().single();
  if (error) { alert('Error: ' + error.message); return; }
  const idx = cases.findIndex(x => x.id === currentCaseId);
  if (idx !== -1) cases[idx] = data;
  renderNotes();
}

// ─── Report Modal ─────────────────────────────────────────────────────────────

function showReportModal() {
  const c         = getCaseById(currentCaseId);
  const reportNum = () => `RPT-${c.case_number}-${String((getCaseById(currentCaseId)?.reports || []).length + 1).padStart(3, '0')}`;
  showModal('File Report', `
    <div id="report-success" style="display:none;color:#3fb950;background:rgba(63,185,80,0.1);border:1px solid rgba(63,185,80,0.3);border-radius:6px;padding:8px 12px;font-size:13px;margin-bottom:12px;"></div>
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">Report ID</label>
        <input type="text" id="r-reportId" value="${escHtml(reportNum())}" />
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
      <input type="text" id="r-filedBy" value="${escHtml(detName(currentProfile) || c.detective || '')}" />
    </div>
    <div class="form-group">
      <label class="field-label">Report Content</label>
      <textarea id="r-content" placeholder="Enter report details, findings, statements..." style="min-height:150px;"></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Done</button>
      <button class="btn btn-primary" onclick="saveReport()">File Report</button>
    </div>`);
}

async function saveReport() {
  const reportId = document.getElementById('r-reportId').value.trim();
  const content  = document.getElementById('r-content').value.trim();
  if (!reportId || !content) { alert('Report ID and content are required.'); return; }
  try {
    const c       = getCaseById(currentCaseId);
    const now     = new Date().toISOString();
    const reports = [...(c.reports || []), {
      id: genId(), reportId,
      type:    document.getElementById('r-type').value,
      filedBy: document.getElementById('r-filedBy').value.trim(),
      content, createdAt: now,
    }];
    const { data, error } = await db.from('cases').update({ reports, updated_at: now }).eq('id', currentCaseId).select().single();
    if (error) { alert('Error: ' + error.message); return; }
    const idx = cases.findIndex(x => x.id === currentCaseId);
    if (idx !== -1) cases[idx] = data;
    renderDetail();
    const nextId = `RPT-${data.case_number}-${String(data.reports.length + 1).padStart(3, '0')}`;
    document.getElementById('r-reportId').value = nextId;
    document.getElementById('r-content').value  = '';
    document.getElementById('r-type').value     = 'Initial Report';
    const s = document.getElementById('report-success');
    if (s) { s.textContent = `✓ ${reportId} filed`; s.style.display = ''; setTimeout(() => { if (s) s.style.display = 'none'; }, 3000); }
    document.getElementById('r-content').focus();
  } catch (err) { console.error('saveReport:', err); alert('Error: ' + err.message); }
}

async function deleteReport(reportId) {
  if (!confirm('Delete this report?')) return;
  const c       = getCaseById(currentCaseId);
  const reports = (c.reports || []).filter(r => r.id !== reportId);
  const { data, error } = await db.from('cases').update({ reports, updated_at: new Date().toISOString() }).eq('id', currentCaseId).select().single();
  if (error) { alert('Error: ' + error.message); return; }
  const idx = cases.findIndex(x => x.id === currentCaseId);
  if (idx !== -1) cases[idx] = data;
  renderReports();
}

// ─── Person Modal ─────────────────────────────────────────────────────────────

function showPersonModal() {
  showModal('Add Person of Interest', `
    <div id="person-success" style="display:none;color:#3fb950;background:rgba(63,185,80,0.1);border:1px solid rgba(63,185,80,0.3);border-radius:6px;padding:8px 12px;font-size:13px;margin-bottom:12px;"></div>
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
      <input type="text" id="p-spokenBy" value="${escHtml(detName(currentProfile))}" />
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Done</button>
      <button class="btn btn-primary" onclick="savePerson()">Add Person</button>
    </div>`);

  document.getElementById('p-spoken').addEventListener('change', function () {
    document.getElementById('p-spokenby-group').style.display = this.checked ? '' : 'none';
  });
}

async function savePerson() {
  const name = document.getElementById('p-name').value.trim();
  if (!name) { alert('Name is required.'); return; }
  try {
    const c       = getCaseById(currentCaseId);
    const spoken  = document.getElementById('p-spoken').checked;
    const role    = document.getElementById('p-role').value;
    const persons = [...(c.persons || []), {
      id: genId(), name, role,
      dob:         document.getElementById('p-dob').value.trim(),
      phone:       document.getElementById('p-phone').value.trim(),
      address:     document.getElementById('p-address').value.trim(),
      description: document.getElementById('p-description').value.trim(),
      spoken, spokenBy: spoken ? document.getElementById('p-spokenBy').value.trim() : '',
    }];
    activePoiRole = role;
    const { data, error } = await db.from('cases').update({ persons, updated_at: new Date().toISOString() }).eq('id', currentCaseId).select().single();
    if (error) { alert('Error: ' + error.message); return; }
    const idx = cases.findIndex(x => x.id === currentCaseId);
    if (idx !== -1) cases[idx] = data;
    renderDetail();
    document.getElementById('p-name').value        = '';
    document.getElementById('p-dob').value         = '';
    document.getElementById('p-phone').value       = '';
    document.getElementById('p-address').value     = '';
    document.getElementById('p-description').value = '';
    document.getElementById('p-spoken').checked    = false;
    document.getElementById('p-spokenby-group').style.display = 'none';
    const s = document.getElementById('person-success');
    if (s) { s.textContent = `✓ ${name} added`; s.style.display = ''; setTimeout(() => { if (s) s.style.display = 'none'; }, 3000); }
    document.getElementById('p-name').focus();
  } catch (err) { console.error('savePerson:', err); alert('Error: ' + err.message); }
}

async function deletePerson(personId) {
  if (!confirm('Remove this person from the case?')) return;
  const c       = getCaseById(currentCaseId);
  const persons = (c.persons || []).filter(p => p.id !== personId);
  const { data, error } = await db.from('cases').update({ persons, updated_at: new Date().toISOString() }).eq('id', currentCaseId).select().single();
  if (error) { alert('Error: ' + error.message); return; }
  const idx = cases.findIndex(x => x.id === currentCaseId);
  if (idx !== -1) cases[idx] = data;
  renderPersons();
}

// ─── Delete Case ──────────────────────────────────────────────────────────────

async function deleteCaseAction() {
  const c = getCaseById(currentCaseId);
  if (!confirm(`Delete case ${c.case_number}? This cannot be undone.`)) return;
  const { error } = await db.from('cases').delete().eq('id', currentCaseId);
  if (error) { alert('Error: ' + error.message); return; }
  cases = cases.filter(x => x.id !== currentCaseId);
  currentCaseId = null;
  showView('dashboard');
  await renderDashboard();
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────

async function showAdminPanel() {
  showView('admin');
  switchAdminTab('detectives');
}

function switchAdminTab(tab) {
  activeAdminTab = tab;
  document.getElementById('admin-detectives-panel').style.display = tab === 'detectives' ? '' : 'none';
  document.getElementById('admin-pending-panel').style.display    = tab === 'pending'    ? '' : 'none';
  document.getElementById('tab-detectives').classList.toggle('active', tab === 'detectives');
  document.getElementById('tab-pending').classList.toggle('active', tab === 'pending');
  if (tab === 'detectives') renderAdminDetectives();
  else renderPendingUsers();
}

async function renderAdminDetectives() {
  const { data: users } = await db.from('profiles')
    .select('*').eq('approved', true).order('discord_username');
  const list = document.getElementById('users-list');
  const msg  = document.getElementById('no-users-msg');
  if (!users?.length) { list.innerHTML = ''; msg.style.display = ''; return; }
  msg.style.display = 'none';
  const roleClass = r => 'role-' + r.replace(' ', '-');
  list.innerHTML = users.map(u => `
    <div class="user-item">
      <div class="user-item-left">
        <div class="user-item-name">${escHtml(detName(u))}</div>
        ${u.display_name ? `<div class="user-item-discord">Discord: ${escHtml(u.discord_username)}</div>` : ''}
        <div class="user-item-discord">Discord ID: ${escHtml(u.discord_id || '—')}</div>
        ${u.badge ? `<div class="user-item-badge">Badge: #${escHtml(u.badge)}</div>` : ''}
        <div class="user-item-meta">Added ${fmtDate(u.created_at)}</div>
      </div>
      <div class="user-item-right">
        <span class="role-badge ${roleClass(u.role)}">${escHtml(u.role)}</span>
        <button class="btn btn-sm btn-secondary" onclick="showEditUserModal('${u.id}')">Edit</button>
        ${u.id !== currentUser.id
          ? `<button class="btn btn-sm btn-danger" onclick="revokeUser('${u.id}')">Revoke</button>`
          : `<span class="self-tag">(you)</span>`}
      </div>
    </div>`).join('');
}

async function renderPendingUsers() {
  const { data: users } = await db.from('profiles')
    .select('*').eq('approved', false).order('created_at');
  const list = document.getElementById('pending-list');
  const msg  = document.getElementById('no-pending-msg');

  const badge = document.getElementById('pending-count-badge');
  if (users?.length) {
    badge.textContent   = users.length;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }

  if (!users?.length) { list.innerHTML = ''; msg.style.display = ''; return; }
  msg.style.display = 'none';
  list.innerHTML = users.map(u => `
    <div class="user-item">
      <div class="user-item-left">
        <div class="user-item-name">${escHtml(u.discord_username)}</div>
        <div class="user-item-discord">Discord ID: ${escHtml(u.discord_id || '—')}</div>
        <div class="user-item-meta">Requested ${fmtDateTime(u.created_at)}</div>
      </div>
      <div class="user-item-right">
        <input type="text" id="name-inp-${u.id}" class="approve-badge-inp" placeholder="Display Name" style="width:160px;" />
        <select id="role-sel-${u.id}" class="approve-role-sel">
          <option value="Det I">Det I</option>
          <option value="Det II">Det II</option>
          <option value="Det III">Det III</option>
          <option value="Command">Command</option>
        </select>
        <input type="text" id="badge-inp-${u.id}" class="approve-badge-inp" placeholder="Badge #" />
        <button class="btn btn-sm btn-primary" onclick="approveUser('${u.id}')">Approve</button>
        <button class="btn btn-sm btn-danger"  onclick="denyUser('${u.id}')">Deny</button>
      </div>
    </div>`).join('');
}

async function approveUser(userId) {
  const role        = document.getElementById(`role-sel-${userId}`)?.value || 'Det I';
  const badge       = document.getElementById(`badge-inp-${userId}`)?.value.trim() || '';
  const displayName = document.getElementById(`name-inp-${userId}`)?.value.trim() || '';
  const { error } = await db.from('profiles').update({ approved: true, role, badge, display_name: displayName }).eq('id', userId);
  if (error) { alert('Error: ' + error.message); return; }
  renderPendingUsers();
  // Update pending badge count
  const { count } = await db.from('profiles').select('id', { count: 'exact', head: true }).eq('approved', false);
  const b = document.getElementById('pending-count-badge');
  if (count) { b.textContent = count; b.style.display = ''; } else { b.style.display = 'none'; }
}

async function denyUser(userId) {
  if (!confirm('Deny this user? Their Discord account will be removed from the system.')) return;
  await db.from('profiles').delete().eq('id', userId);
  renderPendingUsers();
}

async function revokeUser(userId) {
  if (!confirm('Revoke this detective\'s access? They will need to be re-approved to log in again.')) return;
  await db.from('profiles').update({ approved: false, role: 'pending' }).eq('id', userId);
  renderAdminDetectives();
}

function showAddUserModal() {
  showModal('Add Detective', `
    <div id="add-user-success" style="display:none;color:#3fb950;background:rgba(63,185,80,0.1);border:1px solid rgba(63,185,80,0.3);border-radius:6px;padding:8px 12px;font-size:13px;margin-bottom:12px;"></div>
    <div class="form-group">
      <label class="field-label">Display Name</label>
      <input type="text" id="u-displayName" placeholder="e.g. Det Chris Hannegan" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">Discord Username</label>
        <input type="text" id="u-username" placeholder="e.g. mudyr" />
      </div>
      <div class="form-group">
        <label class="field-label">Discord ID</label>
        <input type="text" id="u-discordId" placeholder="18-digit Discord ID (optional)" />
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
      <button class="btn btn-ghost" onclick="closeModal()">Done</button>
      <button class="btn btn-primary" onclick="saveManualUser()">Add Detective</button>
    </div>`);
}

async function saveManualUser() {
  const username    = document.getElementById('u-username').value.trim();
  const discordId   = document.getElementById('u-discordId').value.trim();
  const displayName = document.getElementById('u-displayName').value.trim();
  const role        = document.getElementById('u-role').value;
  const badge       = document.getElementById('u-badge').value.trim();

  if (!username) { alert('Discord username is required.'); return; }

  try {
    // Check for duplicate discord_id only if one was provided
    if (discordId) {
      const { data: existing } = await db.from('profiles')
        .select('id').eq('discord_id', discordId).maybeSingle();
      if (existing) { alert('A user with this Discord ID already exists.'); return; }
    }

    const { error } = await db.from('profiles').insert({
      id:               crypto.randomUUID(),
      discord_username: username,
      display_name:     displayName,
      discord_id:       discordId || null,
      role, badge,
      approved:         true,
      added_by:         detName(currentProfile),
    });

    if (error) {
      console.error('Insert error:', error);
      alert('Error adding detective:\n' + error.message + (error.hint ? '\n\nHint: ' + error.hint : ''));
      return;
    }

    // Show success, clear form, stay open for more entries
    const label = displayName || username;
    const successEl = document.getElementById('add-user-success');
    if (successEl) {
      successEl.textContent   = `✓ ${label} added successfully`;
      successEl.style.display = '';
      setTimeout(() => { if (successEl) successEl.style.display = 'none'; }, 4000);
    }
    document.getElementById('u-displayName').value = '';
    document.getElementById('u-username').value    = '';
    document.getElementById('u-discordId').value   = '';
    document.getElementById('u-badge').value       = '';
    document.getElementById('u-displayName').focus();

    renderAdminDetectives();
  } catch (err) {
    console.error('saveManualUser exception:', err);
    alert('Unexpected error: ' + err.message);
  }
}

function showEditUserModal(userId) {
  db.from('profiles').select('*').eq('id', userId).single().then(({ data: u }) => {
    if (!u) return;
    showModal('Edit Detective', `
      <div class="form-group">
        <label class="field-label">Display Name</label>
        <input type="text" id="u-displayName" value="${escHtml(u.display_name || '')}" placeholder="e.g. Det Chris Hannegan" />
      </div>
      <div class="form-group">
        <label class="field-label">Discord Username</label>
        <input type="text" id="u-username" value="${escHtml(u.discord_username)}" />
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
  });
}

async function saveEditUser(userId) {
  const { error } = await db.from('profiles').update({
    display_name:     document.getElementById('u-displayName').value.trim(),
    discord_username: document.getElementById('u-username').value.trim(),
    role:             document.getElementById('u-role').value,
    badge:            document.getElementById('u-badge').value.trim(),
  }).eq('id', userId);
  if (error) { alert('Error: ' + error.message); return; }
  if (currentUser.id === userId) {
    const { data } = await db.from('profiles').select('*').eq('id', userId).single();
    currentProfile = data;
    updateHeader();
  }
  closeModal();
  renderAdminDetectives();
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

document.getElementById('btn-discord-login').addEventListener('click', signInWithDiscord);
document.getElementById('btn-pending-logout').addEventListener('click', signOut);
document.getElementById('btn-logout').addEventListener('click', signOut);
document.getElementById('btn-admin').addEventListener('click', showAdminPanel);
document.getElementById('btn-admin-back').addEventListener('click', () => { showView('dashboard'); renderDashboard(); });
document.getElementById('btn-add-user').addEventListener('click', showAddUserModal);

document.getElementById('tab-detectives').addEventListener('click', () => switchAdminTab('detectives'));
document.getElementById('tab-pending').addEventListener('click',    () => switchAdminTab('pending'));

document.getElementById('btn-new-case').addEventListener('click',    () => showCaseModal(null));
document.getElementById('btn-back').addEventListener('click',        () => { showView('dashboard'); renderDashboard(); });
document.getElementById('btn-edit-case').addEventListener('click',   () => showCaseModal(getCaseById(currentCaseId)));
document.getElementById('btn-delete-case').addEventListener('click', deleteCaseAction);
document.getElementById('btn-add-note').addEventListener('click',    showNoteModal);
document.getElementById('btn-add-report').addEventListener('click',  showReportModal);
document.getElementById('btn-add-person').addEventListener('click',  showPersonModal);
document.getElementById('modal-close').addEventListener('click',     closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

document.getElementById('search-input').addEventListener('input',   renderDashboard);
document.getElementById('filter-status').addEventListener('change', renderDashboard);
document.getElementById('filter-type').addEventListener('change',   renderDashboard);

document.querySelectorAll('.poi-tab').forEach(btn => {
  btn.addEventListener('click', function () {
    activePoiRole = this.dataset.role;
    document.querySelectorAll('.poi-tab').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    renderPersons();
  });
});
