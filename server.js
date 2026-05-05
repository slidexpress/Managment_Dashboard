const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const JWT_SECRET = process.env.JWT_SECRET || 'slidexpress-tracker-secret-key-2026';
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ─── JSON FILE STORE ──────────────────────────────────────────────────────────
const COLLECTIONS = ['users', 'projects', 'files', 'file_history', 'messages', 'notifications', 'signup_requests', 'settings'];
const db = {};
const nextId = {};

function loadAll() {
  for (const col of COLLECTIONS) {
    const file = path.join(DATA_DIR, col + '.json');
    db[col] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    
    // Sanitize files to support multiple assignees if they were old single-assignee records
    if (col === 'files') {
      db.files = db.files.map(f => ({
        ...f,
        assigned_to: Array.isArray(f.assigned_to) ? f.assigned_to : (f.assigned_to ? [f.assigned_to] : [])
      }));
    }

    nextId[col] = db[col].length ? Math.max(0, ...db[col].map(x => x.id)) + 1 : 1;
  }
}

function save(col) {
  fs.writeFileSync(path.join(DATA_DIR, col + '.json'), JSON.stringify(db[col], null, 2));
}

function insert(col, obj) {
  const record = { id: nextId[col]++, created_at: new Date().toISOString(), ...obj };
  db[col].push(record);
  save(col);
  return record;
}

function update(col, id, changes) {
  const idx = db[col].findIndex(x => x.id === id);
  if (idx === -1) return null;
  db[col][idx] = { ...db[col][idx], ...changes, updated_at: new Date().toISOString() };
  save(col);
  return db[col][idx];
}

function remove(col, id) {
  db[col] = db[col].filter(x => x.id !== id);
  save(col);
}

function find(col, predicate) { return db[col].filter(predicate); }
function findOne(col, predicate) { return db[col].find(predicate); }

// ─── SETTINGS HELPERS ─────────────────────────────────────────────────────────
function getSetting(key, defaultVal = null) {
  const s = findOne('settings', x => x.key === key);
  return s != null ? s.value : defaultVal;
}

function setSetting(key, value) {
  const existing = findOne('settings', x => x.key === key);
  if (existing) update('settings', existing.id, { value });
  else insert('settings', { key, value });
}

function getAllSettings() {
  const out = {};
  db.settings.forEach(s => { out[s.key] = s.value; });
  return out;
}

loadAll();

// ─── SEED DEFAULTS ────────────────────────────────────────────────────────────
if (!db.users.find(u => u.email === 'admin@mecstudio.com')) {
  insert('users', {
    name: 'Admin', email: 'admin@mecstudio.com',
    password: bcrypt.hashSync('admin123', 10),
    role: 'admin', team: 'general', is_active: true
  });
  console.log('  Default admin ensured: admin@mecstudio.com / admin123');
}

if (!db.projects.length) {
  const adminId = db.users.find(u => u.role === 'admin')?.id;
  insert('projects', {
    name: 'PDF to PPT – Batch 1',
    description: 'Convert client PDF documents to editable PowerPoint presentations.',
    deadline: null, status: 'active', created_by: adminId
  });
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function userPublic(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}

function enrichFile(f) {
  const assignees = Array.isArray(f.assigned_to) 
    ? f.assigned_to.map(id => findOne('users', u => u.id === id)).filter(Boolean)
    : [];
  const assigner = f.assigned_by ? findOne('users', u => u.id === f.assigned_by) : null;
  const project = f.project_id ? findOne('projects', p => p.id === f.project_id) : null;
  return {
    ...f,
    assigned_to_names: assignees.map(u => u.name),
    assigned_to_teams: [...new Set(assignees.map(u => u.team))],
    assigned_by_name: assigner?.name || null,
    project_name: project?.name || null
  };
}

function priorityOrder(p) { return { urgent: 0, high: 1, medium: 2, low: 3 }[p] ?? 4; }

function notify(userId, title, message, type = 'info') {
  insert('notifications', { user_id: userId, title, message, type, is_read: false });
  io.to(`user_${userId}`).emit('notification', { title, message });
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ─── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
};

const role = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Forbidden' });

// ─── AUTH ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const loginEmail = (email || '').trim().toLowerCase();
  const user = findOne('users', u => u.email.toLowerCase() === loginEmail && u.is_active);
  if (!user) {
    // Give helpful message if there's a signup request
    const req_ = findOne('signup_requests', r => r.email.toLowerCase() === loginEmail);
    if (req_?.status === 'pending')
      return res.status(401).json({ error: 'Your account is pending admin approval. Please wait.' });
    if (req_?.status === 'rejected')
      return res.status(401).json({ error: 'Your access request was not approved.' + (req_.review_note ? ' Note: ' + req_.review_note : '') });
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid email or password' });
  const payload = { id: user.id, name: user.name, email: user.email, role: user.role, team: user.team };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: payload });
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json(userPublic(findOne('users', u => u.id === req.user.id)));
});

// ─── SIGNUP REQUESTS ──────────────────────────────────────────────────────────
app.post('/api/auth/signup', (req, res) => {
  const { name, email, password, team, message } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  
  const signupEmail = email.trim().toLowerCase();
  if (findOne('users', u => u.email.toLowerCase() === signupEmail))
    return res.status(400).json({ error: 'This email is already registered. Try logging in.' });
  if (findOne('signup_requests', r => r.email.toLowerCase() === signupEmail && r.status === 'pending'))
    return res.status(400).json({ error: 'A request with this email is already pending approval.' });

  insert('signup_requests', {
    name: name.trim(), email: signupEmail,
    password: bcrypt.hashSync(password, 10),
    team: team || 'general',
    message: (message || '').trim(),
    status: 'pending', reviewed_by: null, review_note: null, reviewed_at: null
  });

  // Notify all admins and team leads
  find('users', u => (u.role === 'admin' || u.role === 'team_lead') && u.is_active).forEach(lead => {
    notify(lead.id, 'New Access Request', `${name.trim()} (${signupEmail}) is requesting access`, 'info');
    io.to(`user_${lead.id}`).emit('signup_request_new', { name, email: signupEmail });
  });

  res.json({ success: true });
});

app.get('/api/signup-requests', auth, role('admin', 'team_lead'), (req, res) => {
  const { status } = req.query;
  let requests = db.signup_requests.map(r => {
    const { password, ...rest } = r;
    const reviewer = r.reviewed_by ? findOne('users', u => u.id === r.reviewed_by) : null;
    return { ...rest, reviewed_by_name: reviewer?.name || null };
  });
  if (status) requests = requests.filter(r => r.status === status);
  res.json(requests.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.get('/api/signup-requests/count', auth, role('admin', 'team_lead'), (req, res) => {
  res.json({ pending: find('signup_requests', r => r.status === 'pending').length });
});

app.put('/api/signup-requests/:id/approve', auth, role('admin', 'team_lead'), (req, res) => {
  const id = parseInt(req.params.id);
  const request = findOne('signup_requests', r => r.id === id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
  if (findOne('users', u => u.email.toLowerCase() === request.email.toLowerCase()))
    return res.status(400).json({ error: 'User with this email already exists' });

  const assignedRole = req.body.role || 'member';
  insert('users', {
    name: request.name, email: request.email, password: request.password,
    role: assignedRole, team: request.team, is_active: true
  });
  update('signup_requests', id, {
    status: 'approved', reviewed_by: req.user.id, reviewed_at: new Date().toISOString()
  });
  res.json({ success: true });
});

app.put('/api/signup-requests/:id/reject', auth, role('admin', 'team_lead'), (req, res) => {
  const id = parseInt(req.params.id);
  const request = findOne('signup_requests', r => r.id === id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
  update('signup_requests', id, {
    status: 'rejected', reviewed_by: req.user.id,
    review_note: (req.body.reason || '').trim() || null,
    reviewed_at: new Date().toISOString()
  });
  res.json({ success: true });
});

app.post('/api/signup-requests/bulk-approve', auth, role('admin', 'team_lead'), (req, res) => {
  const { ids, role: assignedRole } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'IDs array required' });
  
  const results = { approved: 0, errors: [] };
  
  for (const id of ids) {
    const request = findOne('signup_requests', r => r.id === id);
    if (!request || request.status !== 'pending') continue;
    
    if (findOne('users', u => u.email.toLowerCase() === request.email.toLowerCase())) {
      results.errors.push(`${request.email}: User already exists`);
      continue;
    }
    
    insert('users', {
      name: request.name, email: request.email, password: request.password,
      role: assignedRole || 'member', team: request.team, is_active: true
    });
    update('signup_requests', id, {
      status: 'approved', reviewed_by: req.user.id, reviewed_at: new Date().toISOString()
    });
    results.approved++;
  }
  
  res.json(results);
});

// ─── ERROR HANDLING ───────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(' [SERVER ERROR]', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// ─── USERS ────────────────────────────────────────────────────────────────────
app.get('/api/users', auth, (req, res) => {
  res.json(db.users.map(userPublic).sort((a, b) => a.name.localeCompare(b.name)));
});

app.post('/api/users', auth, role('admin'), (req, res) => {
  const { name, email, password, role: r, team } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, password required' });
  if (findOne('users', u => u.email === email)) return res.status(400).json({ error: 'Email already exists' });
  const user = insert('users', { name, email, password: bcrypt.hashSync(password, 10), role: r || 'member', team: team || 'general', is_active: true });
  res.json(userPublic(user));
});

app.put('/api/users/:id', auth, role('admin'), (req, res) => {
  const { name, email, role: r, team, is_active, password } = req.body;
  const id = parseInt(req.params.id);
  const changes = { name, email, role: r, team, is_active };
  if (password) changes.password = bcrypt.hashSync(password, 10);
  update('users', id, changes);
  res.json({ success: true });
});

// ─── PROJECTS ─────────────────────────────────────────────────────────────────
app.get('/api/projects', auth, (req, res) => {
  const projects = db.projects.map(p => {
    const creator = findOne('users', u => u.id === p.created_by);
    const projectFiles = find('files', f => f.project_id === p.id);
    return {
      ...p, created_by_name: creator?.name || '',
      total_files: projectFiles.length,
      completed_files: projectFiles.filter(f => f.status === 'completed').length,
      inprogress_files: projectFiles.filter(f => f.status === 'in_progress').length
    };
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(projects);
});

app.post('/api/projects', auth, role('admin', 'team_lead'), (req, res) => {
  const { name, description, deadline } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const p = insert('projects', { name, description: description || '', deadline: deadline || null, status: 'active', created_by: req.user.id });
  res.json(p);
});

app.put('/api/projects/:id', auth, role('admin', 'team_lead'), (req, res) => {
  const { name, description, deadline, status } = req.body;
  update('projects', parseInt(req.params.id), { name, description, deadline, status });
  res.json({ success: true });
});

app.delete('/api/projects/:id', auth, role('admin'), (req, res) => {
  const projectId = parseInt(req.params.id);
  
  // 1. Find all files in this project
  const projectFiles = find('files', f => f.project_id === projectId);
  const fileIds = projectFiles.map(f => f.id);
  
  // 2. Remove history for all those files
  db.file_history = db.file_history.filter(h => !fileIds.includes(h.file_id));
  save('file_history');
  
  // 3. Remove the files themselves
  db.files = db.files.filter(f => f.project_id !== projectId);
  save('files');
  
  // 4. Finally remove the project
  remove('projects', projectId);
  
  res.json({ success: true, deleted_files: fileIds.length });
});

// ─── FILES ────────────────────────────────────────────────────────────────────
app.get('/api/files', auth, (req, res) => {
  const { project_id, status, assigned_to } = req.query;
  let files = [...db.files];

  if (req.user.role === 'member') {
    files = files.filter(f => Array.isArray(f.assigned_to) && f.assigned_to.includes(req.user.id));
  } else if (assigned_to) {
    files = files.filter(f => Array.isArray(f.assigned_to) && f.assigned_to.includes(parseInt(assigned_to)));
  }
  
  if (project_id) files = files.filter(f => f.project_id === parseInt(project_id));
  if (status) files = files.filter(f => f.status === status);

  files.sort((a, b) => {
    const pd = priorityOrder(a.priority) - priorityOrder(b.priority);
    if (pd !== 0) return pd;
    return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
  });
  res.json(files.map(enrichFile));
});

app.post('/api/files', auth, role('admin', 'team_lead'), (req, res) => {
  const { project_id, filename, description, assigned_to, priority, deadline, page_count, notes } = req.body;
  if (!filename) return res.status(400).json({ error: 'Filename required' });
  
  const assigneeIds = Array.isArray(assigned_to) ? assigned_to.map(id => parseInt(id)) : [];
  const status = assigneeIds.length ? 'assigned' : 'pending';
  
  const file = insert('files', {
    project_id: project_id ? parseInt(project_id) : null, filename, description: description || '',
    assigned_to: assigneeIds, assigned_by: req.user.id,
    status, priority: priority || 'medium', deadline: deadline || null,
    page_count: page_count ? parseInt(page_count) : null, notes: notes || ''
  });
  insert('file_history', { file_id: file.id, changed_by: req.user.id, old_status: null, new_status: status, note: 'File added' });
  
  assigneeIds.forEach(uid => {
    notify(uid, 'New File Assigned', `You've been assigned: ${filename}`);
  });
  
  res.json(file);
});

app.put('/api/files/:id', auth, (req, res) => {
  const id = parseInt(req.params.id);
  const file = findOne('files', f => f.id === id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  
  if (req.user.role === 'member' && (!Array.isArray(file.assigned_to) || !file.assigned_to.includes(req.user.id)))
    return res.status(403).json({ error: 'Not your file' });

  const { filename, description, assigned_to, status, priority, deadline, page_count, notes, note } = req.body;
  const newStatus = status || file.status;
  const oldStatus = file.status;
  let changes = {};

  if (req.user.role === 'member') {
    changes = { status: newStatus, notes: notes ?? file.notes };
  } else {
    const newAssigneeIds = assigned_to !== undefined ? (Array.isArray(assigned_to) ? assigned_to.map(id => parseInt(id)) : []) : file.assigned_to;
    changes = {
      filename: filename ?? file.filename, description: description ?? file.description,
      assigned_to: newAssigneeIds, assigned_by: req.user.id,
      status: newStatus, priority: priority ?? file.priority, deadline: deadline ?? file.deadline,
      page_count: page_count !== undefined ? (page_count ? parseInt(page_count) : null) : file.page_count,
      notes: notes ?? file.notes
    };
    
    // Notify only new assignees
    if (assigned_to !== undefined && Array.isArray(newAssigneeIds)) {
      const oldSet = new Set(file.assigned_to || []);
      newAssigneeIds.filter(uid => !oldSet.has(uid)).forEach(uid => {
        notify(uid, 'File Assigned to You', `You've been assigned: ${file.filename}`);
      });
    }
  }

  update('files', id, changes);

  if (oldStatus !== newStatus) {
    insert('file_history', { file_id: id, changed_by: req.user.id, old_status: oldStatus, new_status: newStatus, note: note || null });
    io.emit('file_status_changed', { fileId: id, oldStatus, newStatus, changedBy: req.user.name, filename: file.filename });
    if (req.user.role === 'member') {
      find('users', u => (u.role === 'admin' || u.role === 'team_lead') && u.is_active).forEach(l => {
        notify(l.id, 'Status Update', `${file.filename}: ${oldStatus} → ${newStatus} by ${req.user.name}`);
      });
    }
  }
  res.json({ success: true });
});

app.delete('/api/files/:id', auth, role('admin', 'team_lead'), (req, res) => {
  const id = parseInt(req.params.id);
  db.file_history = db.file_history.filter(h => h.file_id !== id);
  save('file_history');
  remove('files', id);
  res.json({ success: true });
});

app.get('/api/files/:id/history', auth, (req, res) => {
  const id = parseInt(req.params.id);
  res.json(find('file_history', h => h.file_id === id)
    .map(h => ({ ...h, changed_by_name: findOne('users', u => u.id === h.changed_by)?.name || 'System' }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

// ─── FOLDER SCAN ──────────────────────────────────────────────────────────────
function scanFolderForFiles(dir, baseDir, results = []) {
  if (!baseDir) baseDir = dir;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanFolderForFiles(fullPath, baseDir, results);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (['.pdf', '.ppt', '.pptx'].includes(ext)) {
        try {
          const stat = fs.statSync(fullPath);
          results.push({
            name: entry.name,
            relative_path: path.relative(baseDir, fullPath).replace(/\\/g, '/'),
            full_path: fullPath,
            size: stat.size,
            size_label: formatBytes(stat.size),
            modified: stat.mtime.toISOString()
          });
        } catch {}
      }
    }
  }
  return results;
}

app.post('/api/files/scan-folder', auth, role('admin', 'team_lead'), (req, res) => {
  let folderPath = (req.body.folder_path || getSetting('watch_folder', '')).trim();
  if (!folderPath) return res.status(400).json({ error: 'No folder path provided. Set one in Settings.' });
  if (!fs.existsSync(folderPath)) return res.status(400).json({ error: `Folder not found: ${folderPath}` });

  const allFiles = scanFolderForFiles(folderPath, folderPath);
  const existingNames = new Set(db.files.map(f => f.filename));
  const newFiles = allFiles.filter(f => !existingNames.has(f.name));
  const alreadyAdded = allFiles.filter(f => existingNames.has(f.name));

  res.json({
    folder: folderPath,
    total: allFiles.length,
    new_count: newFiles.length,
    existing_count: alreadyAdded.length,
    new_files: newFiles,
    existing_files: alreadyAdded.map(f => f.name)
  });
});

app.post('/api/files/batch-import', auth, role('admin', 'team_lead'), (req, res) => {
  const { files, project_id, assigned_to, priority } = req.body;
  if (!files?.length) return res.status(400).json({ error: 'No files selected' });

  const assigneeIds = Array.isArray(assigned_to) ? assigned_to.map(id => parseInt(id)) : [];
  const status = assigneeIds.length ? 'assigned' : 'pending';
  const imported = [];

  for (const f of files) {
    // Skip if already exists
    if (findOne('files', x => x.filename === f.name)) continue;
    const file = insert('files', {
      project_id: project_id ? parseInt(project_id) : null,
      filename: f.name,
      description: f.relative_path && f.relative_path !== f.name ? f.relative_path : '',
      assigned_to: assigneeIds, assigned_by: req.user.id,
      status, priority: priority || 'medium',
      deadline: null, page_count: null, notes: ''
    });
    insert('file_history', { file_id: file.id, changed_by: req.user.id, old_status: null, new_status: status, note: 'Imported from folder scan' });
    assigneeIds.forEach(uid => {
      notify(uid, 'New File Assigned', `You've been assigned: ${f.name}`);
    });
    imported.push(file.id);
  }

  io.emit('files_imported', { count: imported.length, by: req.user.name });
  res.json({ imported: imported.length });
});

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
app.get('/api/settings', auth, role('admin', 'team_lead'), (req, res) => {
  res.json(getAllSettings());
});

app.put('/api/settings', auth, role('admin'), (req, res) => {
  Object.entries(req.body).forEach(([key, value]) => setSetting(key, value));
  // Restart auto-scan if interval/enable changed
  if ('auto_scan' in req.body || 'auto_scan_interval' in req.body) setupAutoScan();
  res.json({ success: true });
});

// ─── MESSAGES ─────────────────────────────────────────────────────────────────
app.get('/api/messages', auth, (req, res) => {
  const { room } = req.query;
  // If it's a private room (format: private_ID1_ID2), ensure user is one of the participants
  if (room && room.startsWith('private_')) {
    const parts = room.split('_');
    if (!parts.includes(req.user.id.toString())) {
      return res.status(403).json({ error: 'Access denied to this private chat' });
    }
  }

  res.json(find('messages', m => m.room === (room || 'general'))
    .slice(-150)
    .map(m => {
      const user = findOne('users', u => u.id === m.user_id);
      return { ...m, user_name: user?.name || '?', user_role: user?.role, user_team: user?.team };
    }));
});

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
app.get('/api/notifications', auth, (req, res) => {
  res.json(find('notifications', n => n.user_id === req.user.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 50));
});

app.put('/api/notifications/read-all', auth, (req, res) => {
  db.notifications = db.notifications.map(n => n.user_id === req.user.id ? { ...n, is_read: true } : n);
  save('notifications');
  res.json({ success: true });
});

// ─── REPORTS ──────────────────────────────────────────────────────────────────
app.get('/api/reports/summary', auth, role('admin', 'team_lead'), (req, res) => {
  const statuses = ['pending','assigned','in_progress','review','revision','completed'];
  const priorities = ['low','medium','high','urgent'];
  const byStatus = statuses.map(s => ({ status: s, count: find('files', f => f.status === s).length })).filter(x => x.count > 0);
  const byPriority = priorities.map(p => ({ priority: p, count: find('files', f => f.priority === p).length })).filter(x => x.count > 0);
  const members = find('users', u => u.role === 'member' && u.is_active);
  const byMember = members.map(u => {
    const mFiles = find('files', f => Array.isArray(f.assigned_to) && f.assigned_to.includes(u.id));
    return {
      id: u.id, name: u.name, team: u.team, total: mFiles.length,
      completed: mFiles.filter(f => f.status === 'completed').length,
      in_progress: mFiles.filter(f => f.status === 'in_progress').length,
      review: mFiles.filter(f => f.status === 'review').length,
      revision: mFiles.filter(f => f.status === 'revision').length,
      pending: mFiles.filter(f => f.status === 'pending').length,
      assigned: mFiles.filter(f => f.status === 'assigned').length
    };
  }).sort((a, b) => b.total - a.total);

  const fileWorkLogs = db.files.map(f => {
    const history = find('file_history', h => h.file_id === f.id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const startLog = history.find(h => h.new_status === 'in_progress');
    const stopLog = [...history].reverse().find(h => ['completed', 'review', 'revision'].includes(h.new_status));
    
    const assigneeNames = Array.isArray(f.assigned_to) 
      ? f.assigned_to.map(id => findOne('users', u => u.id === id)?.name).filter(Boolean)
      : [];
    
    return {
      id: f.id,
      filename: f.filename,
      assigned_to: assigneeNames.length ? assigneeNames.join(', ') : 'Unassigned',
      start_time: startLog ? startLog.created_at : null,
      stop_time: stopLog ? stopLog.created_at : null,
      status: f.status
    };
  });

  const recentActivity = db.file_history
    .map(h => ({ ...h, filename: findOne('files', f => f.id === h.file_id)?.filename || '?', user_name: findOne('users', u => u.id === h.changed_by)?.name || 'System' }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 25);
  res.json({
    totalFiles: db.files.length,
    totalUsers: members.length,
    totalProjects: find('projects', p => p.status === 'active').length,
    byStatus, byPriority, byMember, recentActivity, fileWorkLogs
  });
});

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
const onlineUsers = new Map();

io.use((socket, next) => {
  try { socket.user = jwt.verify(socket.handshake.auth.token, JWT_SECRET); next(); }
  catch { next(new Error('Auth error')); }
});

io.on('connection', (socket) => {
  const uid = socket.user.id;
  onlineUsers.set(uid, socket.id);
  socket.join(`user_${uid}`);
  io.emit('users_online', Array.from(onlineUsers.keys()));

  socket.on('join_room', (room) => socket.join(room));
  socket.on('send_message', ({ room, message }) => {
    if (!message?.trim()) return;
    const msg = insert('messages', { room, user_id: uid, message: message.trim() });
    const user = findOne('users', u => u.id === uid);
    const msgPayload = { ...msg, user_name: user?.name || '?', user_role: user?.role, user_team: user?.team };
    
    io.to(room).emit('new_message', msgPayload);

    // If private room, notify the other person specifically if they aren't in the room
    if (room.startsWith('private_')) {
      const otherId = room.split('_').find(id => id !== 'private' && parseInt(id) !== uid);
      if (otherId) {
        notify(parseInt(otherId), 'New Private Message', `${user.name} sent you a message`, 'info');
      }
    }
  });
  socket.on('disconnect', () => {
    onlineUsers.delete(uid);
    io.emit('users_online', Array.from(onlineUsers.keys()));
  });
});

// ─── AUTO-SCAN ────────────────────────────────────────────────────────────────
let autoScanTimer = null;

function setupAutoScan() {
  if (autoScanTimer) { clearInterval(autoScanTimer); autoScanTimer = null; }
  const enabled = getSetting('auto_scan', false);
  const intervalMin = parseInt(getSetting('auto_scan_interval', '5')) || 5;
  if (!enabled) return;

  autoScanTimer = setInterval(() => {
    const folder = getSetting('watch_folder', '');
    if (!folder || !fs.existsSync(folder)) return;
    const allFiles = scanFolderForFiles(folder, folder);
    const existingNames = new Set(db.files.map(f => f.filename));
    const newFiles = allFiles.filter(f => !existingNames.has(f.name));
    if (!newFiles.length) return;

    const defaultProjectId = getSetting('default_project_id', null);
    for (const f of newFiles) {
      const file = insert('files', {
        project_id: defaultProjectId ? parseInt(defaultProjectId) : null,
        filename: f.name, description: f.relative_path && f.relative_path !== f.name ? f.relative_path : '',
        assigned_to: [], assigned_by: null, status: 'pending', priority: 'medium',
        deadline: null, page_count: null, notes: ''
      });
      insert('file_history', { file_id: file.id, changed_by: null, old_status: null, new_status: 'pending', note: 'Auto-detected from folder' });
    }

    find('users', u => (u.role === 'admin' || u.role === 'team_lead') && u.is_active).forEach(u => {
      notify(u.id, 'New Files Detected', `${newFiles.length} new file${newFiles.length > 1 ? 's' : ''} found in watch folder`);
    });
    io.emit('files_imported', { count: newFiles.length, by: 'Auto-scan' });
    console.log(`  [Auto-scan] Imported ${newFiles.length} new file(s)`);
  }, intervalMin * 60 * 1000);

  console.log(`  Auto-scan enabled: every ${intervalMin} minute(s)`);
}

setupAutoScan();

// ─── START ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  let localIP = 'YOUR-PC-IP';
  for (const n of Object.values(nets))
    for (const net of n)
      if (net.family === 'IPv4' && !net.internal) { localIP = net.address; break; }
  console.log('\n========================================');
  console.log('  Slidexpress Project Tracker');
  console.log('========================================');
  console.log(`  This PC:    http://localhost:${PORT}`);
  console.log(`  Other PCs:  http://${localIP}:${PORT}`);
  console.log(`  Login:      admin@mecstudio.com / admin123`);
  console.log('========================================\n');
});
