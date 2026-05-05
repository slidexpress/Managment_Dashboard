/* ═══════════════════════════════════════════════════════════
   Slidexpress Project Tracker — Frontend
═══════════════════════════════════════════════════════════ */

const S = {
  token: localStorage.getItem('slidexpress_token'),
  user: null,
  section: 'dashboard',
  chatRoom: 'general',
  projects: [],
  users: [],
  files: [],
  onlineUsers: [],
  socket: null,
  charts: {},
  scanResults: null,
  fileFilters: { project_id: '', status: '', assigned_to: '', search: '' }
};

// ─── API ─────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    ...(body != null ? { body: JSON.stringify(body) } : {})
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ─── SOCKET ──────────────────────────────────────────────────────────────────
function initSocket() {
  S.socket = io({ auth: { token: S.token } });
  S.socket.on('new_message', (msg) => {
    if (S.section === 'chat' && msg.room === S.chatRoom) { appendChatMessage(msg); scrollChatToBottom(); }
    else {
      const b = document.getElementById('chat-badge');
      b.textContent = (parseInt(b.textContent || 0) + 1);
      b.style.display = 'inline-block';
    }
  });
  S.socket.on('file_status_changed', ({ filename, newStatus, changedBy }) => {
    showToast(`<b>${changedBy}</b> updated <i>${filename}</i> → ${statusLabel(newStatus)}`, 'info');
    if (S.section === 'files') loadFiles();
    if (S.section === 'dashboard') loadDashboard();
  });
  S.socket.on('files_imported', ({ count, by }) => {
    showToast(`<b>${by}</b> imported ${count} new file${count > 1 ? 's' : ''}`, 'success');
    if (S.section === 'files') loadFiles();
    if (S.section === 'dashboard') loadDashboard();
  });
  S.socket.on('signup_request_new', ({ name, email }) => {
    showToast(`<b>New access request</b> from ${name} (${email})`, 'info');
    refreshRequestsBadge();
  });
  S.socket.on('notification', ({ title, message }) => {
    showToast(`<b>${title}:</b> ${message}`, 'info');
    document.getElementById('notif-dot').style.display = 'block';
  });
  S.socket.on('users_online', (ids) => {
    S.onlineUsers = ids;
    document.getElementById('online-count').textContent = ids.length;
    document.querySelectorAll('.online-indicator').forEach(el =>
      el.style.background = ids.includes(parseInt(el.dataset.uid)) ? '#10b981' : '#94a3b8'
    );
  });
}

// ─── NAVIGATION ──────────────────────────────────────────────────────────────
function navigate(section) {
  document.querySelectorAll('.section').forEach(el => { el.classList.remove('active-section'); el.style.display = ''; });
  const target = document.getElementById('section-' + section);
  if (section === 'chat') { target.style.display = 'flex'; target.classList.add('active-section'); }
  else { target.style.display = 'block'; target.classList.add('active-section'); }
  document.querySelectorAll('.nav-item').forEach(a => a.classList.remove('active'));
  document.querySelector(`[data-section="${section}"]`)?.classList.add('active');
  const titles = { dashboard:'Dashboard', files:'Files', chat:'Chat', projects:'Projects', reports:'Reports', requests:'Access Requests', team:'Team', settings:'Settings' };
  document.getElementById('page-title').textContent = titles[section] || section;
  S.section = section;
  const loaders = { dashboard: loadDashboard, files: loadFiles, chat: loadChat, projects: loadProjects, reports: loadReports, requests: loadRequests, team: loadTeam, settings: loadSettings };
  loaders[section]?.();
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
async function loadDashboard() {
  const el = document.getElementById('section-dashboard');
  el.innerHTML = spinner();
  try {
    const [files, projects] = await Promise.all([api('GET', '/files'), api('GET', '/projects')]);
    S.files = files; S.projects = projects;
    let reports = null;
    if (isLeadOrAdmin()) reports = await api('GET', '/reports/summary');
    const total = files.length, completed = files.filter(f=>f.status==='completed').length;
    const inprogress = files.filter(f=>f.status==='in_progress').length, review = files.filter(f=>f.status==='review').length;
    el.innerHTML = `
      <div class="stats-grid">
        ${statCard('Total Files', total, 'fa-file-alt', '#3b82f6', '#eff6ff')}
        ${statCard('Completed', completed, 'fa-check-circle', '#10b981', '#f0fdf4')}
        ${statCard('In Progress', inprogress, 'fa-spinner', '#f59e0b', '#fffbeb')}
        ${statCard('In Review', review, 'fa-eye', '#8b5cf6', '#f5f3ff')}
        ${isLeadOrAdmin() ? statCard('Active Projects', projects.filter(p=>p.status==='active').length, 'fa-folder-open', '#64748b', '#f8fafc') : ''}
      </div>
      <div class="row g-4">
        <div class="col-lg-8">${S.user.role==='member' ? renderMyFiles(files) : renderAllFilesQuick(files)}</div>
        <div class="col-lg-4">${renderRecentActivity(reports?.recentActivity||[])}</div>
      </div>`;
    el.querySelectorAll('.file-card').forEach(card => card.addEventListener('click', () => openFileDetail(parseInt(card.dataset.id))));
  } catch(e) { el.innerHTML = errorMsg(e.message); }
}

function statCard(label, value, icon, color, bg) {
  return `<div class="stat-card">
    <div class="stat-icon" style="background:${bg};color:${color}"><i class="fas ${icon}"></i></div>
    <div><div class="stat-value" style="color:${color}">${value}</div><div class="stat-label">${label}</div></div>
  </div>`;
}
function renderMyFiles(files) {
  const myFiles = files.filter(f=>f.assigned_to===S.user.id&&f.status!=='completed').slice(0,6);
  return `<div class="card-panel"><div class="card-panel-header"><h3>My Active Files</h3><button class="btn btn-sm btn-primary" onclick="navigate('files')">View All</button></div>
    <div class="card-panel-body p-3">${myFiles.length?myFiles.map(f=>fileCard(f)).join(''):emptyState('fa-inbox','No active files assigned to you')}</div></div>`;
}
function renderAllFilesQuick(files) {
  const urgent = files.filter(f=>f.priority==='urgent'&&f.status!=='completed').slice(0,5);
  const review = files.filter(f=>f.status==='review').slice(0,5);
  return `${urgent.length?`<div class="card-panel mb-4"><div class="card-panel-header"><h3><i class="fas fa-exclamation-circle text-danger me-2"></i>Urgent Files</h3></div><div class="card-panel-body p-3">${urgent.map(f=>fileCard(f)).join('')}</div></div>`:''
  }<div class="card-panel"><div class="card-panel-header"><h3>In Review (${review.length})</h3><button class="btn btn-sm btn-primary" onclick="navigate('files')">All Files</button></div>
    <div class="card-panel-body p-3">${review.length?review.map(f=>fileCard(f)).join(''):emptyState('fa-check','No files awaiting review')}</div></div>`;
}
function renderRecentActivity(activities) {
  const sc = {pending:'#94a3b8',assigned:'#3b82f6',in_progress:'#f59e0b',review:'#8b5cf6',revision:'#ef4444',completed:'#10b981'};
  return `<div class="card-panel" style="height:100%"><div class="card-panel-header"><h3>Recent Activity</h3></div><div class="card-panel-body">
    ${activities.length?activities.slice(0,15).map(a=>`<div class="activity-item">
      <div class="activity-icon" style="background:${sc[a.new_status]||'#94a3b8'}22;color:${sc[a.new_status]||'#94a3b8'}"><i class="fas fa-arrow-right"></i></div>
      <div class="activity-body"><div class="activity-text"><b>${esc(a.user_name)}</b> → ${statusLabel(a.new_status)}</div>
      <div class="activity-time">${esc(a.filename)} · ${timeAgo(a.changed_at)}</div></div></div>`).join('')
    :`<div class="notif-empty">No activity yet</div>`}</div></div>`;
}

// ─── FILES ────────────────────────────────────────────────────────────────────
async function loadFiles() {
  const el = document.getElementById('section-files');
  el.innerHTML = spinner();
  try {
    const [files, projects, users] = await Promise.all([api('GET', buildFilesQuery()), api('GET', '/projects'), api('GET', '/users')]);
    S.files = files; S.projects = projects; S.users = users;
    renderFilesSection(files, projects, users);
  } catch(e) { el.innerHTML = errorMsg(e.message); }
}

function buildFilesQuery() {
  const { project_id, status, assigned_to } = S.fileFilters;
  let q = '/files?x=1';
  if (project_id) q += '&project_id=' + project_id;
  if (status) q += '&status=' + status;
  if (assigned_to) q += '&assigned_to=' + assigned_to;
  return q;
}

function renderFilesSection(files, projects, users) {
  const el = document.getElementById('section-files');
  const members = users.filter(u => u.role === 'member' && u.is_active);
  const filtered = S.fileFilters.search
    ? files.filter(f => f.filename.toLowerCase().includes(S.fileFilters.search.toLowerCase()))
    : files;

  el.innerHTML = `
    <div class="page-header">
      <h3>Files <span class="text-muted" style="font-size:14px;font-weight:400">(${filtered.length})</span></h3>
      <div class="d-flex gap-2">
        ${isLeadOrAdmin() ? `<button class="btn btn-outline-secondary btn-sm" id="scan-folder-btn"><i class="fas fa-folder-open me-1"></i>Scan Folder</button>
        <button class="btn btn-primary btn-sm" id="add-file-btn"><i class="fas fa-plus me-1"></i>Add File</button>` : ''}
      </div>
    </div>
    <div class="file-filters">
      <input type="text" placeholder="Search filename..." id="filter-search" value="${S.fileFilters.search}"
        style="width:200px" oninput="S.fileFilters.search=this.value;renderFilesSection(S.files,S.projects,S.users)">
      <select id="filter-status" onchange="S.fileFilters.status=this.value;loadFiles()">
        <option value="">All Statuses</option>
        ${['pending','assigned','in_progress','review','revision','completed'].map(s=>`<option value="${s}" ${S.fileFilters.status===s?'selected':''}>${statusLabel(s)}</option>`).join('')}
      </select>
      ${isLeadOrAdmin() ? `<select id="filter-project" onchange="S.fileFilters.project_id=this.value;loadFiles()">
        <option value="">All Projects</option>
        ${projects.map(p=>`<option value="${p.id}" ${S.fileFilters.project_id==p.id?'selected':''}>${esc(p.name)}</option>`).join('')}
      </select>
      <select id="filter-member" onchange="S.fileFilters.assigned_to=this.value;loadFiles()">
        <option value="">All Members</option>
        ${members.map(u=>`<option value="${u.id}" ${S.fileFilters.assigned_to==u.id?'selected':''}>${esc(u.name)}</option>`).join('')}
      </select>` : ''}
      <div class="filter-spacer"></div>
      <button class="btn btn-sm btn-outline-secondary" onclick="S.fileFilters={project_id:'',status:'',assigned_to:'',search:''};loadFiles()"><i class="fas fa-times me-1"></i>Clear</button>
    </div>
    <div class="file-list" id="file-list">
      ${filtered.length ? filtered.map(f => fileCard(f)).join('') : emptyState('fa-file-powerpoint', isLeadOrAdmin() ? 'No files found. Use "Scan Folder" or "Add File" to get started.' : 'No files assigned to you yet.')}
    </div>`;

  el.querySelectorAll('.file-card').forEach(card => {
    card.addEventListener('click', e => { if (!e.target.closest('.action-btn')) openFileDetail(parseInt(card.dataset.id)); });
  });
  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const { action, id, status } = btn.dataset;
      if (action === 'status') promptStatusChange(parseInt(id), status);
      if (action === 'edit') openFileModal(parseInt(id));
      if (action === 'delete') confirmDeleteFile(parseInt(id));
    });
  });
  if (isLeadOrAdmin()) {
    document.getElementById('add-file-btn')?.addEventListener('click', () => openFileModal());
    document.getElementById('scan-folder-btn')?.addEventListener('click', openScanModal);
  }
}

function fileCard(f) {
  const isPpt = f.filename.toLowerCase().endsWith('.ppt') || f.filename.toLowerCase().endsWith('.pptx');
  const icon = isPpt ? 'fa-file-powerpoint' : 'fa-file-pdf';
  const iconColor = isPpt ? '#d97706' : '#ef4444';
  
  const memberActions = () => {
    if (S.user.role !== 'member' || !f.assigned_to.includes(S.user.id)) return '';
    const map = { assigned:['Start Working','in_progress','action-btn-primary'], in_progress:['Submit for Review','review','action-btn-success'], revision:['Resubmit','review','action-btn-warning'] };
    const a = map[f.status];
    return a ? `<button class="action-btn ${a[2]}" data-action="status" data-id="${f.id}" data-status="${a[1]}">${a[0]}</button>` : '';
  };
  const leadActions = () => {
    if (!isLeadOrAdmin()) return '';
    const reviewBtns = f.status === 'review'
      ? `<button class="action-btn action-btn-success" data-action="status" data-id="${f.id}" data-status="completed">Approve</button>
         <button class="action-btn action-btn-danger" data-action="status" data-id="${f.id}" data-status="revision">Revision</button>` : '';
    return `${reviewBtns}<button class="action-btn action-btn-ghost" data-action="edit" data-id="${f.id}"><i class="fas fa-edit"></i></button>
      <button class="action-btn action-btn-ghost" data-action="delete" data-id="${f.id}" style="color:#ef4444"><i class="fas fa-trash"></i></button>`;
  };
  
  const assignedNames = (f.assigned_to_names || []).join(', ');
  const assignedTeams = (f.assigned_to_teams || []).map(t => teamLabel(t)).join(', ');

  return `<div class="file-card priority-${f.priority}" data-id="${f.id}">
    <div class="file-card-top">
      <div>
        <div class="file-card-name"><i class="fas ${icon} me-2" style="color:${iconColor}"></i>${esc(f.filename)}</div>
        ${f.description && f.description !== f.filename ? `<div class="small text-muted mt-1"><i class="fas fa-folder me-1"></i>${esc(f.description)}</div>` : ''}
        ${f.project_name ? `<div class="small text-muted mt-1"><i class="fas fa-layer-group me-1"></i>${esc(f.project_name)}</div>` : ''}
      </div>
      <div class="d-flex gap-2 align-items-center flex-shrink-0">
        <span class="badge-status status-${f.status}">${statusLabel(f.status)}</span>
        <span class="badge-priority priority-${f.priority}-badge">${f.priority}</span>
      </div>
    </div>
    <div class="file-card-meta">
      ${assignedNames ? `<span class="team-badge" title="${assignedTeams}"><i class="fas fa-users me-1"></i>${esc(assignedNames)}</span>` : `<span class="text-muted small">Unassigned</span>`}
      ${f.page_count ? `<span class="text-muted small"><i class="fas fa-copy me-1"></i>${f.page_count} pages</span>` : ''}
      ${f.deadline ? `<span class="text-muted small"><i class="fas fa-calendar me-1"></i>${formatDate(f.deadline)}</span>` : ''}
    </div>
    <div class="file-card-actions">
      ${S.user.role === 'member' ? memberActions() : leadActions()}
      <button class="action-btn action-btn-ghost ms-auto"><i class="fas fa-chevron-right"></i> Details</button>
    </div>
  </div>`;
}

// ─── FILE DETAIL PANEL ────────────────────────────────────────────────────────
async function openFileDetail(fileId) {
  const file = S.files.find(f => f.id === fileId);
  if (!file) return;
  const offcanvas = new bootstrap.Offcanvas(document.getElementById('fileDetail'));
  document.getElementById('fd-filename').textContent = file.filename;
  document.getElementById('fd-project-name').textContent = file.project_name || '';
  document.getElementById('fd-body').innerHTML = spinner();
  offcanvas.show();
  try {
    const history = await api('GET', `/files/${fileId}/history`);
    renderFileDetailBody(file, history);
  } catch(e) { document.getElementById('fd-body').innerHTML = errorMsg(e.message); }
}

function renderFileDetailBody(file, history) {
  const sc = {pending:'#94a3b8',assigned:'#3b82f6',in_progress:'#f59e0b',review:'#8b5cf6',revision:'#ef4444',completed:'#10b981'};
  const memberActions = () => {
    if (S.user.role !== 'member' || file.assigned_to !== S.user.id) return '';
    const map = { assigned:['Start Working','in_progress','action-btn-primary'], in_progress:['Submit for Review','review','action-btn-success'], revision:['Resubmit','review','action-btn-warning'] };
    const a = map[file.status];
    return a ? `<button class="action-btn ${a[2]} mt-2" onclick="promptStatusChange(${file.id},'${a[1]}')">${a[0]}</button>` : '';
  };
  const leadActions = () => {
    if (!isLeadOrAdmin()) return '';
    if (file.status === 'review') return `<div class="d-flex gap-2 mt-2">
      <button class="action-btn action-btn-success flex-fill" onclick="promptStatusChange(${file.id},'completed')"><i class="fas fa-check me-1"></i>Approve</button>
      <button class="action-btn action-btn-danger flex-fill" onclick="promptStatusChange(${file.id},'revision')"><i class="fas fa-undo me-1"></i>Revision</button></div>`;
    return `<div class="d-flex gap-2 mt-2"><button class="action-btn action-btn-ghost flex-fill"
      onclick="openFileModal(${file.id});bootstrap.Offcanvas.getInstance(document.getElementById('fileDetail')).hide()">
      <i class="fas fa-edit me-1"></i>Edit File</button></div>`;
  };
  document.getElementById('fd-body').innerHTML = `
    <div class="fd-section">
      <div class="d-flex align-items-center gap-3 mb-3">
        <span class="badge-status status-${file.status}" style="font-size:13px;padding:5px 14px">${statusLabel(file.status)}</span>
        <span class="badge-priority priority-${file.priority}-badge">${file.priority} priority</span>
      </div>
      <div class="fd-grid">
        <div class="fd-item"><div class="fd-item-label">Assigned To</div><div class="fd-item-value">${file.assigned_to_name||'—'}</div></div>
        <div class="fd-item"><div class="fd-item-label">Team</div><div class="fd-item-value">${teamLabel(file.assigned_to_team)}</div></div>
        <div class="fd-item"><div class="fd-item-label">Pages</div><div class="fd-item-value">${file.page_count||'—'}</div></div>
        <div class="fd-item"><div class="fd-item-label">Deadline</div><div class="fd-item-value">${file.deadline?formatDate(file.deadline):'—'}</div></div>
        <div class="fd-item"><div class="fd-item-label">Added</div><div class="fd-item-value">${timeAgo(file.created_at)}</div></div>
        <div class="fd-item"><div class="fd-item-label">Updated</div><div class="fd-item-value">${timeAgo(file.updated_at)}</div></div>
      </div>
      ${file.notes ? `<div class="mt-3"><div class="fd-item-label">Notes</div><div class="timeline-note mt-1">${esc(file.notes)}</div></div>` : ''}
      ${memberActions()}${leadActions()}
    </div>
    <div class="fd-section">
      <div class="fd-label">Status History</div>
      <div class="timeline">
        ${history.map(h=>`<div class="timeline-item">
          <div class="timeline-dot" style="background:${sc[h.new_status]||'#94a3b8'}22;color:${sc[h.new_status]||'#94a3b8'}"><i class="fas fa-circle" style="font-size:8px"></i></div>
          <div class="timeline-content">
            <div class="timeline-title">${h.old_status?`<span style="color:#94a3b8">${statusLabel(h.old_status)}</span> → `:''}<b>${statusLabel(h.new_status)}</b></div>
            <div class="timeline-meta">${esc(h.changed_by_name)} · ${timeAgo(h.changed_at)}</div>
            ${h.note?`<div class="timeline-note">${esc(h.note)}</div>`:''}
          </div></div>`).join('')}
        ${!history.length?`<div class="text-muted small">No history yet</div>`:''}
      </div>
    </div>`;
}

// ─── STATUS CHANGE ────────────────────────────────────────────────────────────
function promptStatusChange(fileId, newStatus) {
  const descs = { in_progress:'Mark as In Progress — actively working on it.', review:'Submit for team lead review.', revision:'Send back to member for revision.', completed:'Mark as fully completed.', assigned:'Re-open as assigned.' };
  document.getElementById('sm-title').textContent = 'Update to: ' + statusLabel(newStatus);
  document.getElementById('sm-desc').textContent = descs[newStatus] || '';
  document.getElementById('sm-file-id').value = fileId;
  document.getElementById('sm-new-status').value = newStatus;
  document.getElementById('sm-note').value = '';
  new bootstrap.Modal(document.getElementById('statusModal')).show();
}

async function confirmStatusChange() {
  const fileId = parseInt(document.getElementById('sm-file-id').value);
  const newStatus = document.getElementById('sm-new-status').value;
  const note = document.getElementById('sm-note').value.trim();
  try {
    await api('PUT', '/files/' + fileId, { status: newStatus, note });
    bootstrap.Modal.getInstance(document.getElementById('statusModal')).hide();
    bootstrap.Offcanvas.getInstance(document.getElementById('fileDetail'))?.hide();
    showToast('Status updated to ' + statusLabel(newStatus), 'success');
    if (S.section === 'files') loadFiles();
    if (S.section === 'dashboard') loadDashboard();
  } catch(e) { showToast(e.message, 'error'); }
}

// ─── FILE MODAL ───────────────────────────────────────────────────────────────
async function openFileModal(fileId) {
  const modal = new bootstrap.Modal(document.getElementById('fileModal'));
  const members = S.users.filter(u => u.role === 'member' && u.is_active);
  document.getElementById('fm-project').innerHTML = `<option value="">— No Project —</option>` + S.projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  
  const assigneeList = document.getElementById('fm-assigned-list');
  const renderAssignees = (selectedIds = []) => {
    assigneeList.innerHTML = members.map(u => `
      <div class="form-check">
        <input class="form-check-input fm-assignee-check" type="checkbox" value="${u.id}" id="fm-as-${u.id}" ${selectedIds.includes(u.id) ? 'checked' : ''}>
        <label class="form-check-label small" for="fm-as-${u.id}">${esc(u.name)} (${teamLabel(u.team)})</label>
      </div>
    `).join('');
  };

  if (fileId) {
    document.getElementById('fileModalTitle').textContent = 'Edit File';
    const file = S.files.find(f => f.id === fileId);
    document.getElementById('fm-id').value = fileId;
    document.getElementById('fm-filename').value = file.filename;
    document.getElementById('fm-pages').value = file.page_count || '';
    document.getElementById('fm-project').value = file.project_id || '';
    renderAssignees(file.assigned_to || []);
    document.getElementById('fm-priority').value = file.priority;
    document.getElementById('fm-status').value = file.status;
    document.getElementById('fm-deadline').value = file.deadline || '';
    document.getElementById('fm-notes').value = file.notes || '';
  } else {
    document.getElementById('fileModalTitle').textContent = 'Add File';
    ['fm-id','fm-filename','fm-pages','fm-deadline','fm-notes'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('fm-project').value = S.fileFilters.project_id || '';
    renderAssignees(S.fileFilters.assigned_to ? [parseInt(S.fileFilters.assigned_to)] : []);
    document.getElementById('fm-priority').value = 'medium';
    document.getElementById('fm-status').value = 'pending';
  }
  modal.show();
}

async function saveFile() {
  const id = document.getElementById('fm-id').value;
  const assigned_to = Array.from(document.querySelectorAll('.fm-assignee-check:checked')).map(cb => parseInt(cb.value));
  const payload = {
    filename: document.getElementById('fm-filename').value.trim(),
    page_count: document.getElementById('fm-pages').value || null,
    project_id: document.getElementById('fm-project').value || null,
    assigned_to,
    priority: document.getElementById('fm-priority').value,
    status: document.getElementById('fm-status').value,
    deadline: document.getElementById('fm-deadline').value || null,
    notes: document.getElementById('fm-notes').value.trim() || null
  };
  if (!payload.filename) { showToast('Filename is required', 'error'); return; }
  try {
    if (id) await api('PUT', '/files/' + id, payload);
    else await api('POST', '/files', payload);
    bootstrap.Modal.getInstance(document.getElementById('fileModal')).hide();
    showToast(id ? 'File updated' : 'File added', 'success');
    loadFiles();
  } catch(e) { showToast(e.message, 'error'); }
}

async function confirmDeleteFile(fileId) {
  const file = S.files.find(f => f.id === fileId);
  if (!confirm(`Delete "${file?.filename}"? This cannot be undone.`)) return;
  try { await api('DELETE', '/files/' + fileId); showToast('File deleted', 'success'); loadFiles(); }
  catch(e) { showToast(e.message, 'error'); }
}

// ─── SCAN FOLDER ─────────────────────────────────────────────────────────────
async function openScanModal() {
  resetScanModal();
  // Pre-fill folder from settings
  try {
    const settings = await api('GET', '/settings');
    if (settings.watch_folder) document.getElementById('scan-folder-path').value = settings.watch_folder;
  } catch {}
  // Populate dropdowns
  const members = S.users.filter(u => u.role === 'member' && u.is_active);
  document.getElementById('scan-project').innerHTML = `<option value="">— No Project —</option>` + S.projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  
  document.getElementById('scan-assignee-list').innerHTML = members.map(u => `
    <div class="form-check">
      <input class="form-check-input scan-assignee-check" type="checkbox" value="${u.id}" id="scan-as-${u.id}">
      <label class="form-check-label small" for="scan-as-${u.id}">${esc(u.name)}</label>
    </div>
  `).join('');

  new bootstrap.Modal(document.getElementById('scanModal')).show();
}

function resetScanModal() {
  S.scanResults = null;
  document.getElementById('scan-step-2').style.display = 'none';
  document.getElementById('scan-step-1').style.display = 'block';
  document.getElementById('scan-footer').style.display = 'none';
  document.getElementById('scan-error').style.display = 'none';
  document.getElementById('scan-has-new').style.display = 'none';
  document.getElementById('scan-no-new').style.display = 'none';
  document.getElementById('scan-btn').disabled = false;
  document.getElementById('scan-btn').innerHTML = '<i class="fas fa-search me-1"></i>Scan';
}

async function scanFolder() {
  const folderPath = document.getElementById('scan-folder-path').value.trim();
  if (!folderPath) { showToast('Please enter a folder path', 'error'); return; }
  document.getElementById('scan-btn').disabled = true;
  document.getElementById('scan-btn').innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Scanning...';
  document.getElementById('scan-error').style.display = 'none';

  try {
    const result = await api('POST', '/files/scan-folder', { folder_path: folderPath });
    S.scanResults = result;
    document.getElementById('scan-step-2').style.display = 'block';
    document.getElementById('scan-total').textContent = result.total;
    document.getElementById('scan-new').textContent = result.new_count;
    document.getElementById('scan-existing').textContent = result.existing_count;

    if (result.new_count === 0) {
      document.getElementById('scan-no-new').style.display = 'block';
      document.getElementById('scan-has-new').style.display = 'none';
    } else {
      document.getElementById('scan-no-new').style.display = 'none';
      document.getElementById('scan-has-new').style.display = 'block';
      renderScanFileList(result.new_files);
      document.getElementById('scan-footer').style.display = 'flex';
      updateScanSelectedCount();
    }
    document.getElementById('scan-btn').innerHTML = '<i class="fas fa-sync me-1"></i>Rescan';
  } catch(e) {
    document.getElementById('scan-error').textContent = e.message;
    document.getElementById('scan-error').style.display = 'block';
    document.getElementById('scan-btn').innerHTML = '<i class="fas fa-search me-1"></i>Scan';
  }
  document.getElementById('scan-btn').disabled = false;
}

function renderScanFileList(files) {
  const list = document.getElementById('scan-file-list');
  list.innerHTML = files.map(f => {
    const isPpt = f.name.toLowerCase().endsWith('.ppt') || f.name.toLowerCase().endsWith('.pptx');
    const icon = isPpt ? 'fa-file-powerpoint' : 'fa-file-pdf';
    const iconColor = isPpt ? '#d97706' : '#ef4444';
    return `
    <label class="scan-file-item">
      <input type="checkbox" class="scan-file-check" value="${esc(f.name)}" data-file='${JSON.stringify(f).replace(/'/g,"&apos;")}' checked onchange="updateScanSelectedCount()">
      <div class="scan-file-info">
        <div class="scan-file-name"><i class="fas ${icon} me-2" style="color:${iconColor}"></i>${esc(f.name)}</div>
        ${f.relative_path !== f.name ? `<div class="scan-file-path">${esc(f.relative_path)}</div>` : ''}
      </div>
      <div class="scan-file-meta">
        <span>${f.size_label}</span>
        <span>${timeAgo(f.modified)}</span>
      </div>
    </label>`;
  }).join('');
}

function selectAllScanFiles(checked) {
  document.querySelectorAll('.scan-file-check').forEach(cb => cb.checked = checked);
  updateScanSelectedCount();
}

function updateScanSelectedCount() {
  const count = document.querySelectorAll('.scan-file-check:checked').length;
  document.getElementById('scan-selected-count').textContent = count;
  document.getElementById('scan-import-btn').disabled = count === 0;
}

async function batchImportFiles() {
  const checked = [...document.querySelectorAll('.scan-file-check:checked')];
  if (!checked.length) { showToast('Select at least one file', 'error'); return; }
  const files = checked.map(cb => JSON.parse(cb.dataset.file.replace(/&apos;/g,"'")));
  const project_id = document.getElementById('scan-project').value || null;
  const assigned_to = Array.from(document.querySelectorAll('.scan-assignee-check:checked')).map(cb => parseInt(cb.value));
  const priority = document.getElementById('scan-priority').value;

  document.getElementById('scan-import-btn').disabled = true;
  document.getElementById('scan-import-btn').innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Importing...';
  try {
    const result = await api('POST', '/files/batch-import', { files, project_id, assigned_to, priority });
    bootstrap.Modal.getInstance(document.getElementById('scanModal')).hide();
    showToast(`${result.imported} file${result.imported !== 1 ? 's' : ''} imported successfully`, 'success');
    resetScanModal();
    if (S.section === 'files') loadFiles();
    if (S.section === 'dashboard') loadDashboard();
  } catch(e) {
    showToast(e.message, 'error');
    document.getElementById('scan-import-btn').disabled = false;
    document.getElementById('scan-import-btn').innerHTML = '<i class="fas fa-file-import me-1"></i>Import Selected (<span id="scan-selected-count">' + checked.length + '</span>)';
  }
}

// ─── CHAT ─────────────────────────────────────────────────────────────────────
async function loadChat() {
  const el = document.getElementById('section-chat');
  const [projects, users] = await Promise.all([
    S.projects.length ? S.projects : api('GET', '/projects'),
    api('GET', '/users')
  ]);
  S.projects = projects;
  S.users = users;

  const channels = [{ id:'general', name:'General', icon:'fa-hashtag' }, ...projects.map(p=>({ id:'project_'+p.id, name:p.name, icon:'fa-folder' }))];
  const members = users.filter(u => u.id !== S.user.id && u.is_active);

  el.innerHTML = `
    <div class="chat-sidebar">
      <div class="chat-sidebar-header">Channels</div>
      <div class="chat-rooms mb-3" id="chat-rooms">
        ${channels.map(r=>`<div class="chat-room-item ${r.id===S.chatRoom?'active':''}" data-room="${r.id}"><i class="fas ${r.icon}"></i>${esc(r.name)}</div>`).join('')}
      </div>
      <div class="chat-sidebar-header">Direct Messages</div>
      <div class="chat-rooms" id="private-rooms">
        ${members.map(u => {
          const roomId = [S.user.id, u.id].sort((a,b)=>a-b).join('_');
          const fullRoomId = 'private_' + roomId;
          return `<div class="chat-room-item ${fullRoomId===S.chatRoom?'active':''}" data-room="${fullRoomId}">
            <i class="fas fa-circle online-indicator" data-uid="${u.id}" style="font-size:8px;color:${S.onlineUsers.includes(u.id)?'#10b981':'#94a3b8'}"></i>
            ${esc(u.name)}
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="chat-main">
      <div class="chat-topbar"><i class="fas fa-hashtag" style="color:var(--text-muted)"></i><span class="chat-topbar-name" id="chat-room-name">General</span></div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-area">
        <textarea class="chat-input" id="chat-input" placeholder="Type a message... (Enter to send)" rows="1"></textarea>
        <button class="btn-send" id="chat-send"><i class="fas fa-paper-plane"></i></button>
      </div>
    </div>`;

  const allRooms = [...channels, ...members.map(u => ({ 
    id: 'private_' + [S.user.id, u.id].sort((a,b)=>a-b).join('_'), 
    name: u.name 
  }))];

  el.querySelectorAll('.chat-room-item').forEach(item => item.addEventListener('click', () => switchChatRoom(item.dataset.room, allRooms)));
  document.getElementById('chat-send').addEventListener('click', sendMessage);
  document.getElementById('chat-input').addEventListener('keydown', e => { if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();} });
  
  switchChatRoom(S.chatRoom, allRooms);
  document.getElementById('chat-badge').style.display = 'none';
  document.getElementById('chat-badge').textContent = '';
}

async function switchChatRoom(room, rooms) {
  S.chatRoom = room;
  if (S.socket) S.socket.emit('join_room', room);
  document.querySelectorAll('.chat-room-item').forEach(el => el.classList.toggle('active', el.dataset.room === room));
  const r = rooms?.find(x => x.id === room);
  if (r) document.getElementById('chat-room-name').textContent = r.name;
  const msgEl = document.getElementById('chat-messages');
  msgEl.innerHTML = spinner();
  try {
    const messages = await api('GET', '/messages?room=' + room);
    msgEl.innerHTML = messages.length ? messages.map(m=>chatMessageHTML(m)).join('') : `<div class="text-center text-muted py-5" style="font-size:13px"><i class="fas fa-comments d-block mb-2" style="font-size:28px"></i>No messages yet.</div>`;
    scrollChatToBottom();
  } catch(e) { msgEl.innerHTML = errorMsg(e.message); }
}

function chatMessageHTML(msg) {
  const isOwn = msg.user_id === S.user.id;
  const initials = (msg.user_name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const teamColors = {design:'#8b5cf6',ppt:'#3b82f6',general:'#10b981',admin:'#ef4444',team_lead:'#f59e0b'};
  const color = teamColors[msg.user_team] || teamColors[msg.user_role] || '#3b82f6';
  return `<div class="chat-message ${isOwn?'own':''}">
    <div class="msg-avatar" style="background:${color}">${initials}</div>
    <div><div class="msg-meta">${isOwn?'You':esc(msg.user_name)} · ${timeAgo(msg.created_at)}</div>
    <div class="msg-bubble">${esc(msg.message)}</div></div></div>`;
}

function appendChatMessage(msg) {
  const el = document.getElementById('chat-messages');
  if (!el) return;
  const wasEmpty = el.querySelector('.text-center');
  if (wasEmpty) el.innerHTML = '';
  el.insertAdjacentHTML('beforeend', chatMessageHTML(msg));
}

function scrollChatToBottom() { const el = document.getElementById('chat-messages'); if (el) el.scrollTop = el.scrollHeight; }
function sendMessage() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg || !S.socket) return;
  S.socket.emit('send_message', { room: S.chatRoom, message: msg });
  input.value = '';
}

// ─── REPORTS ──────────────────────────────────────────────────────────────────
async function loadReports() {
  const el = document.getElementById('section-reports');
  el.innerHTML = spinner();
  try { renderReports(el, await api('GET', '/reports/summary')); }
  catch(e) { el.innerHTML = errorMsg(e.message); }
}

function renderReports(el, data) {
  const sc = {pending:'#94a3b8',assigned:'#3b82f6',in_progress:'#f59e0b',review:'#8b5cf6',revision:'#ef4444',completed:'#10b981'};
  el.innerHTML = `
    <div class="page-header"><h3>Reports & Analytics</h3>
      <button class="btn btn-sm btn-outline-secondary" onclick="exportReport()"><i class="fas fa-download me-1"></i>Export CSV</button>
    </div>
    <div class="stats-grid mb-4">
      ${statCard('Total Files', data.totalFiles, 'fa-file-alt', '#3b82f6', '#eff6ff')}
      ${statCard('Team Members', data.totalUsers, 'fa-users', '#8b5cf6', '#f5f3ff')}
      ${statCard('Active Projects', data.totalProjects, 'fa-folder-open', '#10b981', '#f0fdf4')}
      ${statCard('Completed', data.byStatus.find(s=>s.status==='completed')?.count||0, 'fa-check-circle', '#10b981', '#f0fdf4')}
    </div>
    <div class="reports-grid mb-4">
      <div class="card-panel"><div class="card-panel-header"><h3>Status Distribution</h3></div>
        <div class="card-panel-body p-4"><div class="chart-container"><canvas id="status-chart"></canvas></div></div></div>
      <div class="card-panel"><div class="card-panel-header"><h3>Files by Priority</h3></div>
        <div class="card-panel-body p-4"><div class="chart-container"><canvas id="priority-chart"></canvas></div></div></div>
    </div>
    <div class="card-panel mb-4"><div class="card-panel-header"><h3>Member Performance</h3></div>
      <div class="card-panel-body">
        <table class="member-table"><thead><tr><th>Member</th><th>Team</th><th>Total</th><th>Done</th><th>In Progress</th><th>Review</th><th>Revision</th><th>Progress</th></tr></thead>
        <tbody>${data.byMember.map(m=>{const pct=m.total?Math.round(m.completed/m.total*100):0;return `<tr>
          <td><b>${esc(m.name)}</b></td><td><span class="team-badge">${teamLabel(m.team)}</span></td><td>${m.total}</td>
          <td><span style="color:#10b981;font-weight:600">${m.completed}</span></td>
          <td><span style="color:#f59e0b">${m.in_progress}</span></td>
          <td><span style="color:#8b5cf6">${m.review}</span></td>
          <td><span style="color:#ef4444">${m.revision}</span></td>
          <td><div class="d-flex align-items-center gap-2"><div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pct}%"></div></div><span style="font-size:12px;color:var(--text-muted)">${pct}%</span></div></td>
        </tr>`;}).join('')}${!data.byMember.length?'<tr><td colspan="8" class="text-center text-muted py-4">No members yet</td></tr>':''}</tbody></table>
      </div></div>
    
    <div class="card-panel mb-4"><div class="card-panel-header"><h3>Detailed Work Log</h3></div>
      <div class="card-panel-body">
        <table class="member-table"><thead><tr><th>File Name</th><th>Assigned To</th><th>Start Time</th><th>Stop Time</th><th>Current Status</th></tr></thead>
        <tbody>${data.fileWorkLogs.map(f=>`<tr>
          <td><i class="fas fa-file-pdf me-2 text-danger"></i>${esc(f.filename)}</td>
          <td>${esc(f.assigned_to)}</td>
          <td>${f.start_time ? new Date(f.start_time).toLocaleString() : '—'}</td>
          <td>${f.stop_time ? new Date(f.stop_time).toLocaleString() : '—'}</td>
          <td><span class="badge-status status-${f.status}">${statusLabel(f.status)}</span></td>
        </tr>`).join('')}${!data.fileWorkLogs.length?'<tr><td colspan="5" class="text-center text-muted py-4">No work logs found</td></tr>':''}</tbody></table>
      </div></div>

    <div class="card-panel"><div class="card-panel-header"><h3>Recent Activity</h3></div>
      <div class="card-panel-body">${data.recentActivity.slice(0,15).map(a=>`<div class="activity-item">
        <div class="activity-icon" style="background:${sc[a.new_status]||'#94a3b8'}22;color:${sc[a.new_status]||'#94a3b8'}"><i class="fas fa-arrow-right"></i></div>
        <div class="activity-body"><div class="activity-text"><b>${esc(a.user_name)}</b> → ${statusLabel(a.new_status)}</div>
        <div class="activity-time">${esc(a.filename)} · ${timeAgo(a.changed_at)}</div></div></div>`).join('')||'<div class="notif-empty">No activity yet</div>'}
      </div></div>`;

  if (data.byStatus.length && window.Chart) {
    if (S.charts.status) S.charts.status.destroy();
    S.charts.status = new Chart(document.getElementById('status-chart').getContext('2d'), {
      type: 'doughnut',
      data: { labels: data.byStatus.map(s=>statusLabel(s.status)), datasets:[{data:data.byStatus.map(s=>s.count),backgroundColor:data.byStatus.map(s=>sc[s.status]||'#94a3b8'),borderWidth:2}] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'right',labels:{font:{family:'Inter',size:12}}}} }
    });
    if (S.charts.priority) S.charts.priority.destroy();
    const pc = {low:'#94a3b8',medium:'#3b82f6',high:'#f59e0b',urgent:'#ef4444'};
    S.charts.priority = new Chart(document.getElementById('priority-chart').getContext('2d'), {
      type: 'bar',
      data: { labels:data.byPriority.map(p=>p.priority), datasets:[{data:data.byPriority.map(p=>p.count),backgroundColor:data.byPriority.map(p=>pc[p.priority]||'#94a3b8')}] },
      options: { responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{stepSize:1}}} }
    });
  }
  window._reportData = data;
}

function exportReport() {
  const data = window._reportData;
  if (!data) return;
  const rows = [['Member','Team','Total','Completed','In Progress','Review','Revision','Pending','Assigned'],
    ...data.byMember.map(m=>[m.name,m.team,m.total,m.completed,m.in_progress,m.review,m.revision,m.pending,m.assigned])];
  const csv = rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`slidexpress_report_${new Date().toISOString().split('T')[0]}.csv`; a.click();
  URL.revokeObjectURL(url); showToast('Report exported','success');
}

// ─── ACCESS REQUESTS ─────────────────────────────────────────────────────────
async function loadRequests() {
  const el = document.getElementById('section-requests');
  el.innerHTML = spinner();
  try {
    const requests = await api('GET', '/signup-requests');
    renderRequests(el, requests);
    refreshRequestsBadge();
  } catch(e) { el.innerHTML = errorMsg(e.message); }
}

function renderRequests(el, requests) {
  const pending = requests.filter(r=>r.status==='pending');
  const processed = requests.filter(r=>r.status!=='pending');
  el.innerHTML = `
    <div class="page-header"><h3>Access Requests</h3>
      <span class="badge-status status-in_progress">${pending.length} pending</span>
    </div>
    
    ${pending.length ? `
      <div class="card-panel mb-3 p-3 bg-light border">
        <div class="d-flex align-items-center justify-content-between">
          <div class="d-flex align-items-center gap-3">
            <input type="checkbox" id="select-all-requests" onchange="toggleAllRequests(this.checked)">
            <label for="select-all-requests" class="mb-0 fw-600 small">Select All Pending</label>
          </div>
          <div id="bulk-actions" style="display:none">
            <span class="small me-3"><b id="selected-count">0</b> selected</span>
            <button class="btn btn-sm btn-success" onclick="bulkApprove()"><i class="fas fa-check-double me-1"></i>Approve Selected</button>
          </div>
        </div>
      </div>
      <h5 class="section-group-label">Pending Review (${pending.length})</h5>
      <div class="team-grid mb-4">${pending.map(r=>requestCard(r)).join('')}</div>` : `<div class="card-panel mb-4"><div class="card-panel-body"><div class="empty-state"><i class="fas fa-check-circle" style="color:#10b981"></i><p>No pending requests</p></div></div></div>`}
    
    ${processed.length ? `
      <h5 class="section-group-label">Previously Reviewed (${processed.length})</h5>
      <div class="team-grid">${processed.map(r=>requestCard(r)).join('')}</div>` : ''}
  `;
  el.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', () => openApproveModal(parseInt(btn.dataset.approve), btn.dataset.name)));
  el.querySelectorAll('[data-reject]').forEach(btn => btn.addEventListener('click', () => openRejectModal(parseInt(btn.dataset.reject), btn.dataset.name)));
  
  // Bind checkbox changes
  el.querySelectorAll('.request-check').forEach(cb => cb.addEventListener('change', updateBulkActionVisibility));
}

function requestCard(r) {
  const statusBadge = { pending:'status-in_progress', approved:'status-completed', rejected:'status-revision' };
  const teamColors = {design:'#8b5cf6',ppt:'#3b82f6',general:'#10b981'};
  const initials = r.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  return `<div class="request-card ${r.status}">
    <div class="d-flex align-items-start gap-3 mb-3">
      ${r.status === 'pending' ? `<input type="checkbox" class="request-check mt-2" value="${r.id}">` : ''}
      <div class="member-avatar" style="background:${teamColors[r.team]||'#64748b'};width:42px;height:42px;font-size:15px">${initials}</div>
      <div class="flex-fill min-width-0">
        <div class="fw-600">${esc(r.name)}</div>
        <div class="small text-muted">${esc(r.email)}</div>
        <div class="d-flex gap-2 mt-1 flex-wrap">
          <span class="team-badge">${teamLabel(r.team)}</span>
          <span class="badge-status ${statusBadge[r.status]||'status-pending'}" style="font-size:10px">${r.status}</span>
        </div>
      </div>
    </div>
    ${r.message ? `<div class="request-message">"${esc(r.message)}"</div>` : ''}
    <div class="small text-muted mb-3"><i class="fas fa-clock me-1"></i>Requested ${timeAgo(r.created_at)}</div>
    ${r.status === 'pending' ? `<div class="d-flex gap-2">
      <button class="btn btn-sm btn-success flex-fill" data-approve="${r.id}" data-name="${esc(r.name)}"><i class="fas fa-check me-1"></i>Approve</button>
      <button class="btn btn-sm btn-outline-danger flex-fill" data-reject="${r.id}" data-name="${esc(r.name)}"><i class="fas fa-times me-1"></i>Reject</button>
    </div>` : r.status === 'approved' ? `<div class="small text-success"><i class="fas fa-check-circle me-1"></i>Approved by ${esc(r.reviewed_by_name||'admin')} · ${timeAgo(r.reviewed_at)}</div>`
    : `<div class="small text-danger"><i class="fas fa-times-circle me-1"></i>Rejected by ${esc(r.reviewed_by_name||'admin')} · ${timeAgo(r.reviewed_at)}${r.review_note?'<br><span class="text-muted">'+esc(r.review_note)+'</span>':''}</div>`}
  </div>`;
}

function toggleAllRequests(checked) {
  document.querySelectorAll('.request-check').forEach(cb => cb.checked = checked);
  updateBulkActionVisibility();
}

function updateBulkActionVisibility() {
  const checked = document.querySelectorAll('.request-check:checked');
  const bar = document.getElementById('bulk-actions');
  const count = document.getElementById('selected-count');
  if (!bar) return;
  if (checked.length > 0) {
    bar.style.display = 'block';
    count.textContent = checked.length;
  } else {
    bar.style.display = 'none';
    document.getElementById('select-all-requests').checked = false;
  }
}

async function bulkApprove() {
  const ids = Array.from(document.querySelectorAll('.request-check:checked')).map(cb => parseInt(cb.value));
  if (!ids.length) return;
  
  if (!confirm(`Approve ${ids.length} requests and create accounts?`)) return;
  
  try {
    const res = await api('POST', '/signup-requests/bulk-approve', { ids, role: 'member' });
    showToast(`Successfully approved ${res.approved} requests.`, 'success');
    if (res.errors.length) {
      console.warn('Bulk approve errors:', res.errors);
      showToast(`${res.errors.length} requests skipped (already exists).`, 'warning');
    }
    loadRequests();
  } catch(e) { showToast(e.message, 'error'); }
}

function openApproveModal(reqId, name) {
  document.getElementById('approve-req-id').value = reqId;
  document.getElementById('approve-name').textContent = name;
  document.getElementById('approve-role').value = 'member';
  new bootstrap.Modal(document.getElementById('approveModal')).show();
}

function openRejectModal(reqId, name) {
  document.getElementById('reject-req-id').value = reqId;
  document.getElementById('reject-name').textContent = name;
  document.getElementById('reject-reason').value = '';
  new bootstrap.Modal(document.getElementById('rejectModal')).show();
}

async function approveRequest() {
  const id = parseInt(document.getElementById('approve-req-id').value);
  const role = document.getElementById('approve-role').value;
  try {
    await api('PUT', `/signup-requests/${id}/approve`, { role });
    bootstrap.Modal.getInstance(document.getElementById('approveModal')).hide();
    showToast('Access request approved. Account created.', 'success');
    loadRequests();
  } catch(e) { showToast(e.message, 'error'); }
}

async function rejectRequest() {
  const id = parseInt(document.getElementById('reject-req-id').value);
  const reason = document.getElementById('reject-reason').value.trim();
  try {
    await api('PUT', `/signup-requests/${id}/reject`, { reason });
    bootstrap.Modal.getInstance(document.getElementById('rejectModal')).hide();
    showToast('Request rejected', 'info');
    loadRequests();
  } catch(e) { showToast(e.message, 'error'); }
}

async function refreshRequestsBadge() {
  if (!isLeadOrAdmin()) return;
  try {
    const { pending } = await api('GET', '/signup-requests/count');
    const badge = document.getElementById('requests-badge');
    badge.textContent = pending;
    badge.style.display = pending > 0 ? 'inline-block' : 'none';
  } catch {}
}

// ─── TEAM ─────────────────────────────────────────────────────────────────────
async function loadTeam() {
  const el = document.getElementById('section-team');
  el.innerHTML = spinner();
  try { S.users = await api('GET', '/users'); renderTeam(el, S.users); }
  catch(e) { el.innerHTML = errorMsg(e.message); }
}

function renderTeam(el, users) {
  const groups = { admin:[], team_lead:[], member:[] };
  users.forEach(u => { if (groups[u.role]) groups[u.role].push(u); });
  el.innerHTML = `
    <div class="page-header"><h3>Team Members</h3>
      <button class="btn btn-primary btn-sm" id="add-user-btn"><i class="fas fa-plus me-1"></i>Add Member</button>
    </div>
    ${Object.entries({Admin:groups.admin,'Team Leads':groups.team_lead,Members:groups.member}).map(([label,list])=>
      list.length?`<h5 class="section-group-label">${label}</h5><div class="team-grid mb-2">${list.map(u=>memberCard(u)).join('')}</div>`:''
    ).join('')}`;
  el.querySelectorAll('[data-edit-user]').forEach(btn => btn.addEventListener('click', () => openUserModal(parseInt(btn.dataset.editUser))));
  document.getElementById('add-user-btn').addEventListener('click', () => openUserModal());
}

function memberCard(u) {
  const initials = u.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const roleColors = {admin:'#ef4444',team_lead:'#f59e0b',member:'#3b82f6'};
  const isOnline = S.onlineUsers.includes(u.id);
  return `<div class="member-card ${u.is_active?'':'opacity-50'}">
    <div class="member-avatar" style="background:${roleColors[u.role]||'#3b82f6'};position:relative">
      ${initials}
      <span class="online-indicator" data-uid="${u.id}" style="position:absolute;bottom:0;right:0;width:10px;height:10px;border-radius:50%;border:2px solid white;background:${isOnline?'#10b981':'#94a3b8'}"></span>
    </div>
    <div class="member-info">
      <div class="member-name">${esc(u.name)}</div>
      <div class="member-email">${esc(u.email)}</div>
      <div class="member-meta">
        <span class="team-badge">${teamLabel(u.team)}</span>
        <span class="badge-status ${u.role==='admin'?'status-revision':u.role==='team_lead'?'status-in_progress':'status-assigned'}" style="font-size:10px">${u.role.replace('_',' ')}</span>
        ${!u.is_active?`<span class="badge-priority priority-urgent-badge" style="font-size:10px">Inactive</span>`:''}
      </div>
    </div>
    <button class="btn btn-sm btn-outline-secondary ms-auto" data-edit-user="${u.id}"><i class="fas fa-edit"></i></button>
  </div>`;
}

function openUserModal(userId) {
  const modal = new bootstrap.Modal(document.getElementById('userModal'));
  if (userId) {
    const user = S.users.find(u => u.id === userId);
    document.getElementById('userModalTitle').textContent = 'Edit Member';
    document.getElementById('um-id').value = userId;
    document.getElementById('um-name').value = user.name;
    document.getElementById('um-email').value = user.email;
    document.getElementById('um-password').value = '';
    document.getElementById('um-role').value = user.role;
    document.getElementById('um-team').value = user.team;
    document.getElementById('um-active').value = user.is_active ? '1' : '0';
    document.getElementById('um-pw-hint').textContent = '(leave blank to keep)';
  } else {
    document.getElementById('userModalTitle').textContent = 'Add Team Member';
    ['um-name','um-email','um-password'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('um-id').value = '';
    document.getElementById('um-role').value = 'member';
    document.getElementById('um-team').value = 'design';
    document.getElementById('um-active').value = '1';
    document.getElementById('um-pw-hint').textContent = '(required for new)';
  }
  modal.show();
}

async function saveUser() {
  const id = document.getElementById('um-id').value;
  const payload = { name:document.getElementById('um-name').value.trim(), email:document.getElementById('um-email').value.trim(), password:document.getElementById('um-password').value, role:document.getElementById('um-role').value, team:document.getElementById('um-team').value, is_active:parseInt(document.getElementById('um-active').value) };
  if (!payload.name||!payload.email) { showToast('Name and email required','error'); return; }
  if (!id&&!payload.password) { showToast('Password required for new members','error'); return; }
  try {
    if (id) await api('PUT','/users/'+id,payload); else await api('POST','/users',payload);
    bootstrap.Modal.getInstance(document.getElementById('userModal')).hide();
    showToast(id?'Member updated':'Member added','success'); loadTeam();
  } catch(e) { showToast(e.message,'error'); }
}

// ─── PROJECTS ─────────────────────────────────────────────────────────────────
async function loadProjects() {
  const el = document.getElementById('section-projects');
  el.innerHTML = spinner();
  try { S.projects = await api('GET','/projects'); renderProjects(el,S.projects); }
  catch(e) { el.innerHTML = errorMsg(e.message); }
}

function renderProjects(el, projects) {
  el.innerHTML = `
    <div class="page-header"><h3>Projects</h3>
      <button class="btn btn-primary btn-sm" id="add-project-btn"><i class="fas fa-plus me-1"></i>New Project</button>
    </div>
    <div class="project-cards">
      ${projects.map(p=>projectCard(p)).join('')}
      ${!projects.length?emptyState('fa-folder-open','No projects yet'):''}
    </div>`;
  el.querySelectorAll('[data-edit-project]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openProjectModal(parseInt(btn.dataset.editProject)); }));
  el.querySelectorAll('.project-card').forEach(card => card.addEventListener('click', e => { if (!e.target.closest('[data-edit-project]')) { S.fileFilters.project_id = card.dataset.id; navigate('files'); } }));
  document.getElementById('add-project-btn').addEventListener('click', () => openProjectModal());
}

function projectCard(p) {
  const pct = p.total_files ? Math.round(p.completed_files/p.total_files*100) : 0;
  const statusColors = {active:'status-assigned',completed:'status-completed',paused:'status-pending'};
  return `<div class="project-card" data-id="${p.id}" title="Click to view files">
    <div class="d-flex justify-content-between align-items-start mb-2">
      <div class="project-card-name">${esc(p.name)}</div>
      <button class="btn btn-sm btn-outline-secondary" data-edit-project="${p.id}"><i class="fas fa-edit"></i></button>
    </div>
    <div class="project-card-desc">${esc(p.description||'')}</div>
    <div class="project-progress">
      <div class="progress-label"><span>Progress</span><span>${p.completed_files}/${p.total_files} · ${pct}%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>
    <div class="project-footer">
      <div class="d-flex gap-2"><span class="badge-status ${statusColors[p.status]||'status-pending'}">${p.status}</span><span class="text-muted small">${p.inprogress_files} in progress</span></div>
      ${p.deadline?`<span class="text-muted small"><i class="fas fa-calendar me-1"></i>${formatDate(p.deadline)}</span>`:''}
    </div>
  </div>`;
}

function openProjectModal(projectId) {
  const modal = new bootstrap.Modal(document.getElementById('projectModal'));
  if (projectId) {
    const p = S.projects.find(x=>x.id===projectId);
    document.getElementById('projectModalTitle').textContent = 'Edit Project';
    document.getElementById('pm-id').value = projectId;
    document.getElementById('pm-name').value = p.name;
    document.getElementById('pm-desc').value = p.description||'';
    document.getElementById('pm-deadline').value = p.deadline||'';
    document.getElementById('pm-status').value = p.status;
  } else {
    document.getElementById('projectModalTitle').textContent = 'New Project';
    ['pm-id','pm-name','pm-desc','pm-deadline'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('pm-status').value = 'active';
  }
  modal.show();
}

async function saveProject() {
  const id = document.getElementById('pm-id').value;
  const payload = { name:document.getElementById('pm-name').value.trim(), description:document.getElementById('pm-desc').value.trim(), deadline:document.getElementById('pm-deadline').value||null, status:document.getElementById('pm-status').value };
  if (!payload.name) { showToast('Project name required','error'); return; }
  try {
    if (id) await api('PUT','/projects/'+id,payload); else await api('POST','/projects',payload);
    bootstrap.Modal.getInstance(document.getElementById('projectModal')).hide();
    showToast(id?'Project updated':'Project created','success'); loadProjects();
  } catch(e) { showToast(e.message,'error'); }
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const el = document.getElementById('section-settings');
  el.innerHTML = spinner();
  try {
    const [settings, projects] = await Promise.all([api('GET', '/settings'), api('GET', '/projects')]);
    renderSettings(el, settings, projects);
  } catch(e) { el.innerHTML = errorMsg(e.message); }
}

function renderSettings(el, settings, projects) {
  el.innerHTML = `
    <div class="page-header"><h3>Settings</h3></div>
    <div class="row g-4">
      <div class="col-lg-6">
        <div class="card-panel">
          <div class="card-panel-header"><h3><i class="fas fa-folder me-2 text-warning"></i>Folder Watch</h3></div>
          <div class="card-panel-body p-4">
            <div class="mb-3">
              <label class="form-label fw-600">Watch Folder Path</label>
              <input type="text" id="set-folder" class="form-control font-mono" value="${esc(settings.watch_folder||'')}" placeholder="e.g.  D:\\Projects\\PDFs">
              <div class="form-text">Server PC folder path. PDFs here will be detected and can be imported automatically.</div>
            </div>
            <div class="mb-3">
              <label class="form-label fw-600">Default Project for Auto-Import</label>
              <select id="set-project" class="form-select">
                <option value="">— No default project —</option>
                ${projects.map(p=>`<option value="${p.id}" ${settings.default_project_id==p.id?'selected':''}>${esc(p.name)}</option>`).join('')}
              </select>
            </div>
            <hr>
            <div class="mb-3">
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="set-autoscan" ${settings.auto_scan?'checked':''}>
                <label class="form-check-label fw-600" for="set-autoscan">Enable Auto-Scan</label>
              </div>
              <div class="form-text">When enabled, the server automatically checks the folder at the interval below and adds new PDFs to the tracker.</div>
            </div>
            <div class="mb-3">
              <label class="form-label">Auto-Scan Interval</label>
              <div class="input-group" style="width:180px">
                <input type="number" id="set-interval" class="form-control" value="${settings.auto_scan_interval||5}" min="1" max="1440">
                <span class="input-group-text">minutes</span>
              </div>
            </div>
            <button class="btn btn-primary" id="save-settings-btn"><i class="fas fa-save me-1"></i>Save Settings</button>
            <div id="settings-saved" class="text-success mt-2" style="display:none"><i class="fas fa-check me-1"></i>Settings saved</div>
          </div>
        </div>
      </div>
      <div class="col-lg-6">
        <div class="card-panel">
          <div class="card-panel-header"><h3><i class="fas fa-info-circle me-2 text-primary"></i>How to Use Folder Scan</h3></div>
          <div class="card-panel-body p-4">
            <div class="settings-help">
              <div class="help-step"><div class="help-num">1</div><div><b>Set the folder path</b> to where PDF files are stored on this server PC (e.g., a shared drive folder).</div></div>
              <div class="help-step"><div class="help-num">2</div><div><b>Go to Files</b> and click <b>"Scan Folder"</b> to manually check for new PDFs at any time.</div></div>
              <div class="help-step"><div class="help-num">3</div><div><b>Or enable Auto-Scan</b> — the server will check automatically every N minutes and add new PDFs as pending files.</div></div>
              <div class="help-step"><div class="help-num">4</div><div><b>Assign</b> the imported files to team members from the Files page.</div></div>
            </div>
            <div class="alert alert-info mt-3 small mb-0">
              <i class="fas fa-lightbulb me-1"></i>
              <b>Tip:</b> Put all client PDFs in one folder (or subfolders). The scanner reads all subfolders too, so you can organize by client or date.
            </div>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const payload = {
      watch_folder: document.getElementById('set-folder').value.trim(),
      default_project_id: document.getElementById('set-project').value || null,
      auto_scan: document.getElementById('set-autoscan').checked,
      auto_scan_interval: parseInt(document.getElementById('set-interval').value) || 5
    };
    try {
      await api('PUT', '/settings', payload);
      document.getElementById('settings-saved').style.display = 'block';
      setTimeout(() => { document.getElementById('settings-saved').style.display = 'none'; }, 3000);
      showToast('Settings saved', 'success');
    } catch(e) { showToast(e.message, 'error'); }
  });
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
async function loadNotifications() {
  try {
    const notifs = await api('GET', '/notifications');
    const unread = notifs.filter(n => !n.is_read).length;
    if (unread) document.getElementById('notif-dot').style.display = 'block';
    document.getElementById('notif-list').innerHTML = notifs.length
      ? notifs.map(n=>`<div class="notif-item ${n.is_read?'':'unread'}">
          <div class="notif-title">${esc(n.title)}</div>
          <div class="notif-msg">${esc(n.message)}</div>
          <div class="notif-time">${timeAgo(n.created_at)}</div></div>`).join('')
      : `<div class="notif-empty"><i class="fas fa-bell-slash d-block mb-2" style="font-size:24px"></i>All caught up!</div>`;
  } catch {}
}

function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  panel.style.display = 'flex';
  loadNotifications();
}

async function markAllRead() {
  try { await api('PUT','/notifications/read-all'); document.getElementById('notif-dot').style.display='none'; loadNotifications(); } catch {}
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function statusLabel(s) { return {pending:'Pending',assigned:'Assigned',in_progress:'In Progress',review:'Review',revision:'Revision',completed:'Completed'}[s]||s; }
function teamLabel(t) { return {design:'Design',ppt:'PPT',general:'General',admin:'Admin'}[t]||t||'—'; }
function isLeadOrAdmin() { return S.user && (S.user.role==='admin'||S.user.role==='team_lead'); }
function formatDate(d) { if (!d) return '—'; return new Date(d+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); }
function timeAgo(dt) {
  if (!dt) return '';
  const diff = Date.now() - new Date(dt).getTime(), m = Math.floor(diff/60000);
  if (m<1) return 'just now'; if (m<60) return m+'m ago';
  const h = Math.floor(m/60); if (h<24) return h+'h ago';
  const d = Math.floor(h/24); if (d<7) return d+'d ago';
  return new Date(dt).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
}
function esc(str) { return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function spinner() { return `<div class="spinner"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</div>`; }
function errorMsg(m) { return `<div class="empty-state text-danger"><i class="fas fa-exclamation-circle"></i><p>${esc(m)}</p></div>`; }
function emptyState(icon,msg) { return `<div class="empty-state"><i class="fas ${icon}"></i><p>${msg}</p></div>`; }

function showToast(msg, type) {
  const colors = {success:'#10b981',error:'#ef4444',info:'#3b82f6',warning:'#f59e0b'};
  const id = 'toast-'+Date.now();
  document.getElementById('toast-container').insertAdjacentHTML('beforeend',
    `<div id="${id}" class="toast align-items-center show" role="alert" style="border-left:4px solid ${colors[type]||colors.info};background:white;min-width:280px">
      <div class="d-flex"><div class="toast-body">${msg}</div>
      <button type="button" class="btn-close me-2 m-auto" onclick="document.getElementById('${id}').remove()"></button></div></div>`);
  setTimeout(() => document.getElementById(id)?.remove(), 4500);
}

// ─── LOGIN & SIGNUP ───────────────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  document.getElementById('login-text').style.display = 'none';
  document.getElementById('login-loading').style.display = 'inline';
  errEl.style.display = 'none';
  try {
    const data = await api('POST', '/auth/login', { email, password });
    S.token = data.token; S.user = data.user;
    localStorage.setItem('slidexpress_token', data.token);
    startApp();
  } catch(e) {
    errEl.textContent = e.message; errEl.style.display = 'block';
    document.getElementById('login-text').style.display = 'inline';
    document.getElementById('login-loading').style.display = 'none';
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const name = document.getElementById('su-name').value.trim();
  const email = document.getElementById('su-email').value.trim();
  const password = document.getElementById('su-password').value;
  const confirm = document.getElementById('su-confirm').value;
  const team = document.getElementById('su-team').value;
  const message = document.getElementById('su-message').value;
  const errEl = document.getElementById('signup-error');

  errEl.style.display = 'none';
  if (password !== confirm) { errEl.textContent = 'Passwords do not match'; errEl.style.display = 'block'; return; }
  if (password.length < 6) { errEl.textContent = 'Password must be at least 6 characters'; errEl.style.display = 'block'; return; }

  document.getElementById('signup-text').style.display = 'none';
  document.getElementById('signup-loading').style.display = 'inline';
  try {
    await api('POST', '/auth/signup', { name, email, password, team, message });
    document.getElementById('signup-form').style.display = 'none';
    document.getElementById('signup-success-msg').style.display = 'block';
  } catch(err) {
    errEl.textContent = err.message; errEl.style.display = 'block';
    document.getElementById('signup-text').style.display = 'inline';
    document.getElementById('signup-loading').style.display = 'none';
  }
}

// ─── APP BOOT ─────────────────────────────────────────────────────────────────
async function startApp() {
  try { S.user = await api('GET', '/auth/me'); } catch {
    localStorage.removeItem('slidexpress_token'); S.token = null;
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none'; return;
  }
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  const initials = S.user.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  document.getElementById('sidebar-avatar').textContent = initials;
  document.getElementById('sidebar-name').textContent = S.user.name;
  document.getElementById('sidebar-role').textContent = S.user.role.replace('_',' ');

  if (isLeadOrAdmin()) document.querySelectorAll('.lead-admin-only').forEach(el=>el.style.display='');
  if (S.user.role === 'admin') document.querySelectorAll('.admin-only').forEach(el=>el.style.display='');

  initSocket();
  navigate('dashboard');
  if (isLeadOrAdmin()) refreshRequestsBadge();

  // Event bindings
  document.getElementById('notif-btn').addEventListener('click', e => { e.stopPropagation(); toggleNotifPanel(); });
  document.getElementById('mark-all-read').addEventListener('click', markAllRead);
  document.getElementById('logout-btn').addEventListener('click', () => { localStorage.removeItem('slidexpress_token'); location.reload(); });
  document.addEventListener('click', e => { if (!e.target.closest('#notif-panel')&&!e.target.closest('#notif-btn')) document.getElementById('notif-panel').style.display='none'; });
  document.querySelectorAll('.nav-item[data-section]').forEach(item => item.addEventListener('click', e => { e.preventDefault(); navigate(item.dataset.section); }));
  document.getElementById('fm-save').addEventListener('click', saveFile);
  document.getElementById('pm-save').addEventListener('click', saveProject);
  document.getElementById('um-save').addEventListener('click', saveUser);
  document.getElementById('sm-confirm').addEventListener('click', confirmStatusChange);
  document.getElementById('approve-confirm').addEventListener('click', approveRequest);
  document.getElementById('reject-confirm').addEventListener('click', rejectRequest);
  document.getElementById('scan-btn').addEventListener('click', scanFolder);
  document.getElementById('scan-import-btn').addEventListener('click', batchImportFiles);
  document.getElementById('end-shift-btn').addEventListener('click', openEndShiftModal);
  document.getElementById('esm-logout').addEventListener('click', confirmEndShift);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('signup-form').addEventListener('submit', handleSignup);
  document.getElementById('show-signup').addEventListener('click', e => { e.preventDefault(); document.getElementById('login-form-wrap').style.display='none'; document.getElementById('signup-form-wrap').style.display='block'; });
  document.getElementById('show-login').addEventListener('click', e => { e.preventDefault(); document.getElementById('signup-form-wrap').style.display='none'; document.getElementById('login-form-wrap').style.display='block'; });
  if (S.token) startApp();
  else { document.getElementById('login-screen').style.display='flex'; document.getElementById('app').style.display='none'; }
});
