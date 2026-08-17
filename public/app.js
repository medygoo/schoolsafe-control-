(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const API_BASE = '';
  let adminToken = localStorage.getItem('ss-control-token') || '';

  function toast(msg, type = 'ok') {
    const el = $('toast');
    el.textContent = msg;
    el.style.background = type === 'error' ? '#c22f2f' : type === 'warning' ? '#b8860b' : '#0b1a3a';
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3500);
  }

  function authHeaders() {
    return { 'x-admin-token': adminToken, 'content-type': 'application/json' };
  }

  async function api(method, path, body) {
    const opts = { method, headers: authHeaders() };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API_BASE + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Erreur ${res.status}`);
    return data;
  }

  function setLoggedIn(logged) {
    $('loginPanel').classList.toggle('hidden', logged);
    $('dashboard').classList.toggle('hidden', !logged);
    $('authSection').classList.toggle('hidden', !logged);
    $('userSection').classList.toggle('hidden', logged);
    if (logged) {
      $('adminToken').value = adminToken;
      loadDashboard();
    }
  }

  function login(token) {
    if (!token || token.length < 16) {
      toast('Token admin invalide', 'error');
      return;
    }
    adminToken = token;
    localStorage.setItem('ss-control-token', adminToken);
    setLoggedIn(true);
  }

  function logout() {
    adminToken = '';
    localStorage.removeItem('ss-control-token');
    setLoggedIn(false);
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function statusLabel(status) {
    return { pending: 'En attente', printed: 'Imprimée', failed: 'Échouée' }[status] || status;
  }

  function formatBadge(fmt) {
    return fmt === 'badge' ? 'Badge vertical' : 'Carte PVC';
  }

  let requestsCache = [];
  let instancesCache = [];

  async function loadDashboard() {
    try {
      const [instRes, reqRes] = await Promise.all([
        api('GET', '/instances'),
        api('GET', '/card-print-requests')
      ]);
      instancesCache = instRes.data || [];
      requestsCache = reqRes.data || [];
      renderInstancesFilter();
      renderStats();
      renderRequests();
    } catch (e) {
      toast(e.message, 'error');
      if (e.message.includes('401')) logout();
    }
  }

  function renderInstancesFilter() {
    const sel = $('filterInstance');
    const current = sel.value;
    sel.innerHTML = '<option value="">Toutes</option>' +
      instancesCache.map(i => `<option value="${i.id}">${esc(i.school_name)}</option>`).join('');
    sel.value = current;
  }

  function renderStats() {
    const counts = { pending: 0, printed: 0, failed: 0, total: requestsCache.length };
    requestsCache.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
    $('stats').innerHTML = `
      <div class="stat"><b>${counts.pending}</b><span>En attente</span></div>
      <div class="stat"><b>${counts.printed}</b><span>Imprimées</span></div>
      <div class="stat"><b>${counts.failed}</b><span>Échouées</span></div>
      <div class="stat"><b>${instancesCache.length}</b><span>Écoles</span></div>
    `;
  }

  function renderRequests() {
    const status = $('filterStatus').value;
    const instanceId = $('filterInstance').value;
    let filtered = requestsCache;
    if (status) filtered = filtered.filter(r => r.status === status);
    if (instanceId) filtered = filtered.filter(r => r.instance_id === instanceId);

    const tbody = $('requestsBody');
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">Aucune demande trouvée.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(r => {
      const school = instancesCache.find(i => i.id === r.instance_id);
      const pending = r.status === 'pending';
      return `<tr>
        <td data-label="École">${esc(school ? school.school_name : r.school_id)}</td>
        <td data-label="Élève"><b>${esc(r.student_name)}</b></td>
        <td data-label="Classe">${esc(r.class_name)}</td>
        <td data-label="Année">${esc(r.academic_year)}</td>
        <td data-label="Format">${formatBadge(r.format)}</td>
        <td data-label="Reçue le">${formatDate(r.created_at)}</td>
        <td data-label="Statut"><span class="status ${r.status}">${statusLabel(r.status)}</span></td>
        <td data-label="Actions" class="actions">
          <a href="${r.front_signed_url}" target="_blank" class="button small" style="background:#e8ecf6;color:#17203a;text-decoration:none">Recto</a>
          <a href="${r.back_signed_url}" target="_blank" class="button small" style="background:#e8ecf6;color:#17203a;text-decoration:none">Verso</a>
          ${pending ? `<button class="small success" data-print="${r.id}">Imprimée</button><button class="small danger" data-fail="${r.id}">Échec</button>` : ''}
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('button[data-print]').forEach(btn => {
      btn.addEventListener('click', () => markStatus(btn.dataset.print, 'print'));
    });
    tbody.querySelectorAll('button[data-fail]').forEach(btn => {
      btn.addEventListener('click', () => markStatus(btn.dataset.fail, 'fail'));
    });
  }

  async function markStatus(id, action) {
    try {
      await api('POST', `/card-print-requests/${id}/${action}`);
      toast(action === 'print' ? 'Marquée comme imprimée' : 'Marquée comme échouée');
      await loadDashboard();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  $('loginBtn').addEventListener('click', () => login($('adminToken').value.trim()));
  $('loginMainBtn').addEventListener('click', () => login($('adminTokenMain').value.trim()));
  $('logoutBtn').addEventListener('click', logout);
  $('refreshBtn').addEventListener('click', loadDashboard);
  $('filterStatus').addEventListener('change', renderRequests);
  $('filterInstance').addEventListener('change', renderRequests);

  if (adminToken) setLoggedIn(true);
})();
