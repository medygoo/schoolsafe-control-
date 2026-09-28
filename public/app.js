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
    closeAdminAccessForm();
    $('adminAccessBody').textContent = '';
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
    return {
      pending: 'En attente',
      printed: 'Imprimée',
      failed: 'Échouée',
      trial: 'Essai (14j)',
      grace: 'Grâce (3j)',
      active: 'Active',
      suspended: 'Suspendue',
      blocked: 'Bloquée'
    }[status] || status;
  }

  function formatBadge(fmt) {
    return fmt === 'badge' ? 'Badge vertical' : 'Carte PVC';
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function copyToClipboard(text, label) {
    navigator.clipboard.writeText(text).then(() => toast(`${label} copié`), () => toast('Copie échouée', 'error'));
  }

  function maskToken(token) {
    if (!token || token.length < 12) return token || '—';
    return token.slice(0, 6) + '…' + token.slice(-6);
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
      renderInstances();
    } catch (e) {
      toast(e.message, 'error');
      if (e.message.includes('401')) logout();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TABS
  // ═══════════════════════════════════════════════════════════════════════
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $('requestsPanel').classList.toggle('hidden', name !== 'requests');
    $('instancesPanel').classList.toggle('hidden', name !== 'instances');
    $('adminAccessPanel').classList.toggle('hidden', name !== 'adminAccess');
    closeAdminAccessForm();
    if (name === 'adminAccess') loadAdminAccesses();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // REQUESTS
  // ═══════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════
  // INSTANCES
  // ═══════════════════════════════════════════════════════════════════════
  function formatDateOnly(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function renderTrialInfo(i) {
    if (i.status === 'trial') {
      const start = i.trial_started_at ? formatDateOnly(i.trial_started_at) : '—';
      return `<div style="font-size:0.85em;color:#666">Début: ${start}</div>`;
    }
    if (i.status === 'grace') {
      const ends = i.grace_ends_at ? formatDateOnly(i.grace_ends_at) : '—';
      return `<div style="font-size:0.85em;color:#b8860b">Grâce jusqu'au: ${ends}</div>`;
    }
    if (i.status === 'active' && i.activated_at) {
      return `<div style="font-size:0.85em;color:#0a8">Activée le: ${formatDateOnly(i.activated_at)}</div>`;
    }
    if (i.status === 'suspended') {
      return `<div style="font-size:0.85em;color:#c22f2f">Suspendue</div>`;
    }
    return '';
  }

  function renderInstances() {
    const tbody = $('instancesBody');
    if (!instancesCache.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">Aucune école créée.</td></tr>';
      return;
    }
    tbody.innerHTML = instancesCache.map(i => {
      const blocked = i.status === 'blocked';
      const suspended = i.status === 'suspended';
      const inTrialOrGrace = i.status === 'trial' || i.status === 'grace';
      const showToken = inTrialOrGrace && i.setup_token;
      return `<tr>
        <td data-label="Nom"><b>${esc(i.school_name)}</b></td>
        <td data-label="Slug">${esc(i.school_slug)}</td>
        <td data-label="Domaine">${esc(i.domain)}</td>
        <td data-label="Statut"><span class="status ${i.status}">${statusLabel(i.status)}</span>${renderTrialInfo(i)}</td>
        <td data-label="Token setup">
          ${showToken
            ? `<code title="${esc(i.setup_token)}">${maskToken(i.setup_token)}</code><button class="small" data-copy-token="${esc(i.setup_token)}">Copier</button>`
            : '<span style="color:#999">Consommé</span>'}
        </td>
        <td data-label="Secret HMAC">
          <code title="${esc(i.hmac_secret)}">${maskToken(i.hmac_secret)}</code>
          <button class="small" data-copy-hmac="${esc(i.hmac_secret)}">Copier</button>
        </td>
        <td data-label="Actions" class="actions">
          ${inTrialOrGrace ? '' : `<button class="small warning" data-token="${i.id}">Nouveau token</button>`}
          <button class="small warning" data-hmac="${i.id}">Nouveau HMAC</button>
          ${blocked
            ? `<button class="small success" data-unblock="${i.id}">Débloquer</button>`
            : suspended
              ? `<button class="small success" data-activate="${i.id}">Activer</button>`
              : `<button class="small danger" data-block="${i.id}">Bloquer</button>`}
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('button[data-copy-token]').forEach(btn => {
      btn.addEventListener('click', () => copyToClipboard(btn.dataset.copyToken, 'Token setup'));
    });
    tbody.querySelectorAll('button[data-copy-hmac]').forEach(btn => {
      btn.addEventListener('click', () => copyToClipboard(btn.dataset.copyHmac, 'Secret HMAC'));
    });
    tbody.querySelectorAll('button[data-token]').forEach(btn => {
      btn.addEventListener('click', () => regenerateToken(btn.dataset.token));
    });
    tbody.querySelectorAll('button[data-hmac]').forEach(btn => {
      btn.addEventListener('click', () => regenerateHmac(btn.dataset.hmac));
    });
    tbody.querySelectorAll('button[data-block]').forEach(btn => {
      btn.addEventListener('click', () => setInstanceStatus(btn.dataset.block, 'block'));
    });
    tbody.querySelectorAll('button[data-unblock]').forEach(btn => {
      btn.addEventListener('click', () => setInstanceStatus(btn.dataset.unblock, 'unblock'));
    });
    tbody.querySelectorAll('button[data-activate]').forEach(btn => {
      btn.addEventListener('click', () => activateSuspendedInstance(btn.dataset.activate));
    });
  }

  async function activateSuspendedInstance(id) {
    try {
      await api('POST', `/instances/${id}/activate`);
      toast('Instance activée');
      await loadDashboard();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function regenerateToken(id) {
    try {
      await api('POST', `/instances/${id}/token`);
      toast('Token régénéré');
      await loadDashboard();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function regenerateHmac(id) {
    try {
      await api('POST', `/instances/${id}/revoke-hmac`);
      toast('Secret HMAC régénéré');
      await loadDashboard();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function setInstanceStatus(id, action) {
    try {
      await api('POST', `/instances/${id}/${action}`);
      toast(action === 'block' ? 'École bloquée' : 'École débloquée');
      await loadDashboard();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function toggleCreateForm(show) {
    $('createInstanceForm').classList.toggle('hidden', !show);
    $('createInstanceBtn').classList.toggle('hidden', show);
  }

  async function createInstance(e) {
    e.preventDefault();
    const body = {
      school_name: $('newSchoolName').value.trim(),
      school_slug: $('newSchoolSlug').value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, ''),
      domain: $('newSchoolDomain').value.trim(),
      api_base: $('newSchoolApiBase').value.trim(),
      supabase_url: $('newSchoolSupabaseUrl').value.trim()
    };
    try {
      const res = await api('POST', '/instances', body);
      toast('École créée : ' + res.data.school_name);
      e.target.reset();
      toggleCreateForm(false);
      await loadDashboard();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════════════════
  $('loginBtn').addEventListener('click', () => login($('adminToken').value.trim()));
  $('loginMainBtn').addEventListener('click', () => login($('adminTokenMain').value.trim()));
  $('logoutBtn').addEventListener('click', logout);
  $('refreshBtn').addEventListener('click', loadDashboard);
  $('filterStatus').addEventListener('change', renderRequests);
  $('filterInstance').addEventListener('change', renderRequests);

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  $('createInstanceBtn').addEventListener('click', () => toggleCreateForm(true));
  $('cancelCreateBtn').addEventListener('click', () => toggleCreateForm(false));
  $('createInstanceForm').addEventListener('submit', createInstance);


  let accessEditId = null;
  function closeAdminAccessForm() {
    $('adminAccessForm').reset();
    $('accessPassword').type = 'password';
    $('accessPasswordConfirm').type = 'password';
    $('adminAccessError').textContent = '';
    $('adminAccessForm').classList.add('hidden');
    accessEditId = null;
  }
  function openAdminAccessForm(id = null) {
    closeAdminAccessForm();
    accessEditId = id;
    $('adminAccessIdentity').classList.toggle('hidden', Boolean(id));
    $('accessDisplayName').required = !id;
    $('adminAccessFormTitle').textContent = id ? 'Réinitialiser mot de passe' : 'Créer administrateur';
    $('saveAdminAccess').textContent = id ? 'RÉINITIALISER LE MOT DE PASSE' : 'CRÉER L’ACCÈS';
    $('adminAccessForm').classList.remove('hidden');
    $(id ? 'accessPassword' : 'accessDisplayName').focus();
  }
  async function loadAdminAccesses() {
    try {
      const result = await api('GET', '/school-admin-access');
      const body = $('adminAccessBody');
      body.innerHTML = result.data.map(row => {
        const actions = row.status === 'revoked' ? 'Accès révoqué' :
          '<button type="button" data-access-action="reset-password" data-access-id="' + esc(row.id) + '">Réinitialiser mot de passe</button> ' +
          '<button type="button" data-access-action="' + (row.status === 'active' ? 'suspend' : 'reactivate') + '" data-access-id="' + esc(row.id) + '">' +
          (row.status === 'active' ? 'Suspendre' : 'Réactiver') + '</button> ' +
          '<button type="button" class="danger" data-access-action="revoke" data-access-id="' + esc(row.id) + '">Supprimer l’accès</button>';
        return '<tr><td>' + esc(row.display_name) + '</td><td>' + esc(row.email_normalized || '—') +
          '</td><td>' + esc(row.phone_normalized || '—') + '</td><td><span class="access-status access-status-' + esc(row.status) + '">' +
          esc(row.status.toUpperCase()) + '</span></td><td>' + esc(row.school_id || '—') + '</td><td>' +
          (row.onboarding_state === 'completed' ? 'École créée' : 'À créer') + '</td><td>' +
          esc(formatDate(row.created_at)) + '</td><td class="access-actions">' + actions + '</td></tr>';
      }).join('') || '<tr><td colspan="8" class="empty">Aucun accès administrateur.</td></tr>';
    } catch (error) {
      $('adminAccessBody').textContent = 'Impossible de charger les accès.';
      toast(error.message, 'error');
    }
  }
  $('createAdminAccessBtn').addEventListener('click', () => openAdminAccessForm());
  $('cancelAdminAccess').addEventListener('click', closeAdminAccessForm);
  $('refreshAdminAccessBtn').addEventListener('click', loadAdminAccesses);
  $('generateAccessPassword').addEventListener('click', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const password = Array.from(bytes, byte => alphabet[byte & 63]).join('');
    $('accessPassword').type = 'text';
    $('accessPassword').value = password;
    $('accessPasswordConfirm').value = password;
  });
  $('copyAccessPassword').addEventListener('click', () => {
    if ($('accessPassword').value) copyToClipboard($('accessPassword').value, 'Mot de passe');
  });
  $('adminAccessForm').addEventListener('submit', async event => {
    event.preventDefault();
    const password = $('accessPassword').value;
    if (password !== $('accessPasswordConfirm').value) {
      $('adminAccessError').textContent = 'Les mots de passe ne correspondent pas.';
      return;
    }
    const email = $('accessEmail').value.trim() || null;
    const phone = $('accessPhone').value.trim() || null;
    if (!accessEditId && !email && !phone) {
      $('adminAccessError').textContent = 'E-mail ou téléphone requis.';
      return;
    }
    if (accessEditId && !confirm('Réinitialiser le mot de passe ? L’ancien mot de passe sera immédiatement invalidé.')) return;
    $('saveAdminAccess').disabled = true;
    try {
      const path = accessEditId ? '/school-admin-access/' + encodeURIComponent(accessEditId) + '/reset-password' : '/school-admin-access';
      await api('POST', path, accessEditId ? { password } : { display_name: $('accessDisplayName').value.trim(), email, phone, password });
      closeAdminAccessForm();
      toast('Accès administrateur enregistré.');
      await loadAdminAccesses();
    } catch (error) {
      $('adminAccessError').textContent = error.message;
    } finally { $('saveAdminAccess').disabled = false; }
  });
  $('adminAccessBody').addEventListener('click', async event => {
    const button = event.target.closest('button[data-access-action]');
    if (!button || button.disabled) return;
    const id = button.dataset.accessId, action = button.dataset.accessAction;
    if (action === 'reset-password') { openAdminAccessForm(id); return; }
    const message = action === 'revoke' ? 'Révoquer définitivement cet accès ?\nL’historique sera conservé.' :
      action === 'suspend' ? 'Suspendre cet accès administrateur ?' : 'Réactiver cet accès administrateur ?';
    if (!confirm(message)) return;
    button.disabled = true;
    try {
      await api('POST', '/school-admin-access/' + encodeURIComponent(id) + '/' + action);
      await loadAdminAccesses();
    } catch (error) { toast(error.message, 'error'); }
    finally { button.disabled = false; }
  });

  if (adminToken) setLoggedIn(true);
})();
