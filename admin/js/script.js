/**
 * script.js — Attendly Admin Dashboard
 * ======================================
 * Handles data loading and UI interactions for all admin pages.
 * Each section is labelled with the page(s) it applies to.
 *
 * Pages: index.html | prof.html | student.html | settings.html
 *
 * FOLDER STRUCTURE expected:
 *   /admin/index.html
 *   /admin/script.js       ← this file
 *   /js/supabase-client.js
 *   /js/database.js
 */

import supabase from '../js/supabase-client.js';
import { calculateAverage, formatDate, hashPassword, changeStudentPassword } from '../js/database.js';

// ============================================================
// DEBUG — open browser DevTools console (F12) to see errors
// ============================================================
window.addEventListener('unhandledrejection', e => {
  console.error('[Attendly] Unhandled promise rejection:', e.reason);
});

// Quick sanity check — if you see this in the console, the script loaded
console.log('[Attendly] script.js loaded on:', document.title);

// ============================================================
// SHARED — runs on every page
// ============================================================

const notifBtn      = document.getElementById('notifBtn');
const notifDropdown = document.getElementById('notifDropdown');
const notifList     = document.getElementById('notifList');

if (notifBtn) {
  notifBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    notifDropdown.classList.toggle('open');
    if (notifDropdown.classList.contains('open')) loadNotifications();
  });
  document.addEventListener('click', () => notifDropdown?.classList.remove('open'));
}

/** Fetch latest 6 notifications and render them in the dropdown */
async function loadNotifications() {
  if (!notifList) return;
  notifList.innerHTML = '<li class="notif-loading">Loading…</li>';
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(6);

    if (error) {
      console.error('[notifs error]', error);
      notifList.innerHTML = '<li class="notif-loading">Error loading.</li>';
      return;
    }
    if (!data?.length) {
      notifList.innerHTML = '<li class="notif-loading">No notifications.</li>';
      return;
    }

    const badge  = document.getElementById('notifBadge');
    const unread = data.filter(n => !n.is_read).length;
    if (badge) badge.textContent = unread || '';

    notifList.innerHTML = data.map(n => `
      <li class="notif-item-drop ${n.is_read ? '' : 'unread'}">
        <strong>${escHtml(n.title || 'Notification')}</strong>
        <span>${escHtml(n.message || '')}</span>
        <time>${formatDate(n.created_at)}</time>
      </li>
    `).join('');
  } catch (err) {
    console.error('[notifs catch]', err);
    notifList.innerHTML = '<li class="notif-loading">Error loading.</li>';
  }
}

/** Escape HTML to prevent XSS */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================
// INDEX.HTML — Dashboard overview
// ============================================================

async function initDashboard() {
  // Guard: only run on the dashboard page
  if (!document.getElementById('statsGrid')) return;

  /** Fetch all four stat counts in parallel */
  async function loadStats() {
    try {
      const [
        { count: sc,  error: e1 },
        { count: pc,  error: e2 },
        { count: ses, error: e3 },
        { count: att, error: e4 }
      ] = await Promise.all([
        supabase.from('students')  .select('*', { count: 'exact', head: true }),
        supabase.from('professors').select('*', { count: 'exact', head: true }),
        supabase.from('sessions')  .select('*', { count: 'exact', head: true }),
        supabase.from('attendance').select('*', { count: 'exact', head: true }),
      ]);

      if (e1) console.error('[stats students]',   e1);
      if (e2) console.error('[stats professors]', e2);
      if (e3) console.error('[stats sessions]',   e3);
      if (e4) console.error('[stats attendance]', e4);

      document.getElementById('countStudents').textContent   = sc  ?? '—';
      document.getElementById('countProfs').textContent      = pc  ?? '—';
      document.getElementById('countSessions').textContent   = ses ?? '—';
      document.getElementById('countAttendance').textContent = att ?? '—';

      console.log('[stats] students:', sc, '| profs:', pc, '| sessions:', ses, '| attendance:', att);
    } catch (err) {
      console.error('[loadStats]', err);
    }
  }

  /** Last 5 students */
  async function loadRecentStudents() {
    const tbody = document.getElementById('recentStudents');
    if (!tbody) return;
    try {
      const { data, error } = await supabase
        .from('students')
        .select('full_name, grade, email')
        .order('id', { ascending: false })
        .limit(5);

      if (error) { console.error('[recentStudents]', error); tbody.innerHTML = '<tr><td colspan="3" class="loading-row">Error.</td></tr>'; return; }
      if (!data?.length) { tbody.innerHTML = '<tr><td colspan="3" class="loading-row">No students yet.</td></tr>'; return; }

      tbody.innerHTML = data.map(s => `
        <tr>
          <td>${escHtml(s.full_name)}</td>
          <td><span class="badge blue">${escHtml(s.grade || '—')}</span></td>
          <td>${escHtml(s.email || '—')}</td>
        </tr>
      `).join('');
    } catch (err) { console.error('[recentStudents catch]', err); }
  }

  /** Last 5 professors */
  async function loadRecentProfs() {
    const tbody = document.getElementById('recentProfs');
    if (!tbody) return;
    try {
      const { data, error } = await supabase
        .from('professors')
        .select('full_name, email')
        .order('id', { ascending: false })
        .limit(5);

      if (error) { console.error('[recentProfs]', error); tbody.innerHTML = '<tr><td colspan="2" class="loading-row">Error.</td></tr>'; return; }
      if (!data?.length) { tbody.innerHTML = '<tr><td colspan="2" class="loading-row">No professors yet.</td></tr>'; return; }

      tbody.innerHTML = data.map(p => `
        <tr>
          <td>${escHtml(p.full_name)}</td>
          <td>${escHtml(p.email || '—')}</td>
        </tr>
      `).join('');
    } catch (err) { console.error('[recentProfs catch]', err); }
  }

  // Run all in parallel
  await Promise.all([loadStats(), loadRecentStudents(), loadRecentProfs()]);
}

initDashboard();

// ============================================================
// PROF.HTML — Full professor list
// ============================================================

async function initProfessors() {
  if (!document.getElementById('profTableBody')) return;

  let allProfs  = [];
  let sesCount  = {};
  let noteCount = {};

  function renderProfTable(profs) {
    const tbody = document.getElementById('profTableBody');
    if (!profs.length) { tbody.innerHTML = '<tr><td colspan="5" class="loading-row">No results.</td></tr>'; return; }
    tbody.innerHTML = profs.map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escHtml(p.full_name)}</td>
        <td>${escHtml(p.email || '—')}</td>
        <td>${sesCount[p.id]  || 0}</td>
        <td>${noteCount[p.id] || 0}</td>
      </tr>
    `).join('');
  }

  try {
    const [
      { data: profs,    error: e1 },
      { data: sessions, error: e2 },
      { data: notes,    error: e3 }
    ] = await Promise.all([
      supabase.from('professors').select('id, full_name, email'),
      supabase.from('sessions')  .select('professor_id'),
      supabase.from('notes')     .select('professor_id'),
    ]);

    if (e1) { console.error('[profs]', e1); }
    if (e2) console.error('[prof sessions]', e2);
    if (e3) console.error('[prof notes]',    e3);

    if (!profs?.length) {
      document.getElementById('profTableBody').innerHTML =
        '<tr><td colspan="5" class="loading-row">No professors found.</td></tr>';
      return;
    }

    sesCount  = buildCountMap(sessions, 'professor_id');
    noteCount = buildCountMap(notes,    'professor_id');

    document.getElementById('totalProfs').textContent    = profs.length;
    document.getElementById('totalSessions').textContent = sessions?.length ?? 0;
    document.getElementById('totalNotes').textContent    = notes?.length    ?? 0;

    allProfs = profs;
    renderProfTable(profs);

    // Live search filter
    document.getElementById('profSearch')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      renderProfTable(allProfs.filter(p =>
        p.full_name.toLowerCase().includes(q) ||
        (p.email || '').toLowerCase().includes(q)
      ));
    });
  } catch (err) { console.error('[initProfessors]', err); }
}

initProfessors();

// ============================================================
// STUDENT.HTML — Full student list
// ============================================================

async function initStudents() {
  if (!document.getElementById('stuTableBody')) return;

  let allStudents = [];
  let attMap      = {};
  let notesMap    = {};

  function renderStudentTable(students) {
    const tbody = document.getElementById('stuTableBody');
    if (!students.length) { tbody.innerHTML = '<tr><td colspan="7" class="loading-row">No results.</td></tr>'; return; }
    tbody.innerHTML = students.map((s, i) => {
      const avg = calculateAverage(notesMap[s.id] || []);
      return `
        <tr>
          <td>${i + 1}</td>
          <td>${escHtml(s.full_name)}</td>
          <td>${escHtml(s.email || '—')}</td>
          <td><span class="badge blue">${escHtml(s.grade || '—')}</span></td>
          <td>${escHtml(s.td_group || '—')}</td>
          <td>${attMap[s.id] || 0}</td>
          <td>${avg}/20</td>
        </tr>
      `;
    }).join('');
  }

  function applyFilters() {
    const grade = document.getElementById('gradeFilter')?.value || '';
    const q     = (document.getElementById('stuSearch')?.value || '').toLowerCase();
    renderStudentTable(allStudents.filter(s =>
      (!grade || s.grade === grade) &&
      (!q || s.full_name.toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q))
    ));
  }

  try {
    const [
      { data: students,   error: e1 },
      { data: attendance, error: e2 },
      { data: notes,      error: e3 }
    ] = await Promise.all([
      supabase.from('students')  .select('id, full_name, email, grade, td_group'),
      supabase.from('attendance').select('student_id'),
      supabase.from('notes')     .select('student_id, note, max_note'),
    ]);

    if (e1) { console.error('[students]',       e1); }
    if (e2) console.error('[stu attendance]',   e2);
    if (e3) console.error('[stu notes]',        e3);

    if (!students?.length) {
      document.getElementById('stuTableBody').innerHTML =
        '<tr><td colspan="7" class="loading-row">No students found.</td></tr>';
      return;
    }

    attMap   = buildCountMap(attendance, 'student_id');
    notesMap = buildNotesMap(notes);

    document.getElementById('totalStudents').textContent   = students.length;
    document.getElementById('totalAttendance').textContent = attendance?.length ?? 0;
    document.getElementById('totalNotesS').textContent     = notes?.length      ?? 0;

    // Populate grade filter dropdown with unique grades
    const grades      = [...new Set(students.map(s => s.grade).filter(Boolean))].sort();
    const gradeFilter = document.getElementById('gradeFilter');
    if (gradeFilter) {
      grades.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g; opt.textContent = g;
        gradeFilter.appendChild(opt);
      });
      gradeFilter.addEventListener('change', applyFilters);
    }

    document.getElementById('stuSearch')?.addEventListener('input', applyFilters);

    allStudents = students;
    renderStudentTable(students);
  } catch (err) { console.error('[initStudents]', err); }
}

initStudents();

// ============================================================
// SETTINGS.HTML — Preferences & password
// ============================================================

function initSettings() {
  if (!document.getElementById('saveProfile')) return;

  // Save name/email to localStorage session
  document.getElementById('saveProfile').addEventListener('click', () => {
    const name  = document.getElementById('adminName').value.trim();
    const email = document.getElementById('adminEmail').value.trim();
    const user  = JSON.parse(localStorage.getItem('attendly_user') || '{}');
    user.name   = name;
    user.email  = email;
    localStorage.setItem('attendly_user', JSON.stringify(user));
    showMsg('✓ Profile saved.', 'green');
  });

  // Toggle preference switches
  document.querySelectorAll('.toggle').forEach(t =>
    t.addEventListener('click', () => t.classList.toggle('active'))
  );

  // Change password — uses hashPassword & changeStudentPassword imported at the top
  document.getElementById('changePwd').addEventListener('click', async () => {
    const currentRaw = document.getElementById('currentPwd').value;
    const newRaw     = document.getElementById('newPwd').value;

    if (!currentRaw || !newRaw) { showMsg('Please fill in both fields.', 'red'); return; }

    const user = JSON.parse(localStorage.getItem('attendly_user') || '{}');
    if (!user.id) { showMsg('Not logged in.', 'red'); return; }

    try {
      const currentHash = await hashPassword(currentRaw);
      const newHash     = await hashPassword(newRaw);
      await changeStudentPassword(user.id, currentHash, newHash);
      showMsg('✓ Password updated.', 'green');
    } catch (err) {
      console.error('[changePwd]', err);
      showMsg(err.message, 'red');
    }
  });

  function showMsg(text, color) {
    const el = document.getElementById('pwdMsg');
    if (!el) return;
    el.textContent = text;
    el.style.color = color === 'green' ? '#22c55e' : '#ef4444';
  }
}

initSettings();

// ============================================================
// HELPERS — used across multiple pages
// ============================================================

/**
 * Build { id: count } map from an array of rows
 * Example: [{student_id:1}, {student_id:1}] → {1: 2}
 */
function buildCountMap(arr, key) {
  if (!arr) return {};
  return arr.reduce((acc, item) => {
    const id = item[key];
    acc[id] = (acc[id] || 0) + 1;
    return acc;
  }, {});
}

/**
 * Build { studentId: [{note, max_note}] } map
 * Used to feed calculateAverage() from database.js
 */
function buildNotesMap(notes) {
  if (!notes) return {};
  return notes.reduce((acc, n) => {
    if (!acc[n.student_id]) acc[n.student_id] = [];
    acc[n.student_id].push({ note: n.note, max_note: n.max_note });
    return acc;
  }, {});
}
