/* ══════════════════════════════════════════════════════════════════════════════
   BMS Super Admin Panel – Client Logic
   Pure vanilla JS — no frameworks, no build step.
   ══════════════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // ─── Config ─────────────────────────────────────────────────────────────────
  const API_BASE = window.location.origin + '/api/admin';
  const STORAGE_KEY = 'bms_admin_key';

  let adminKey = sessionStorage.getItem(STORAGE_KEY) || '';
  let currentPage = 'overview';

  // ─── DOM Refs ───────────────────────────────────────────────────────────────
  const $loginScreen   = document.getElementById('login-screen');
  const $adminApp      = document.getElementById('admin-app');
  const $loginForm     = document.getElementById('login-form');
  const $loginError    = document.getElementById('login-error');
  const $keyInput      = document.getElementById('admin-key-input');
  const $logoutBtn     = document.getElementById('logout-btn');
  const $backBtn       = document.getElementById('back-to-businesses');

  // ─── API Helper ─────────────────────────────────────────────────────────────
  async function api(path, opts = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json', ...opts.headers },
    });
    if (res.status === 401) {
      showLogin();
      throw new Error('Unauthorized');
    }
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  }

  // ─── Utilities ──────────────────────────────────────────────────────────────
  function formatNum(n) {
    if (n == null) return '0';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString();
  }

  function formatCurrency(n) {
    return '$' + (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  function skeleton(h = 16, w = '60%') {
    return `<div class="skeleton" style="height:${h}px;width:${w};"></div>`;
  }

  // ─── Toast Notifications ────────────────────────────────────────────────────
  function showToast(message, type = 'success') {
    let $container = document.querySelector('.toast-container');
    if (!$container) {
      $container = document.createElement('div');
      $container.className = 'toast-container';
      document.body.appendChild($container);
    }
    const $toast = document.createElement('div');
    $toast.className = `toast toast-${type}`;
    $toast.textContent = message;
    $container.appendChild($toast);
    setTimeout(() => {
      $toast.remove();
      if (!$container.children.length) $container.remove();
    }, 4000);
  }

  // ─── Confirmation Modal ─────────────────────────────────────────────────────
  function showConfirmModal({ title, message, warningText, confirmText, confirmType = 'danger', onConfirm }) {
    const $overlay = document.createElement('div');
    $overlay.className = 'confirm-overlay';
    $overlay.innerHTML = `
      <div class="confirm-card" onclick="event.stopPropagation()">
        <h3>⚠️ ${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        ${warningText ? `<div class="warning-text ${confirmType === 'warning' ? 'warning-amber' : ''}">${escapeHtml(warningText)}</div>` : ''}
        <div class="confirm-actions">
          <button class="btn-cancel">Cancel</button>
          <button class="btn-confirm-${confirmType}">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    const close = () => $overlay.remove();
    $overlay.addEventListener('click', close);
    $overlay.querySelector('.btn-cancel').addEventListener('click', close);
    $overlay.querySelector(`.btn-confirm-${confirmType}`).addEventListener('click', async () => {
      const $btn = $overlay.querySelector(`.btn-confirm-${confirmType}`);
      $btn.disabled = true;
      $btn.textContent = 'Processing...';
      try {
        await onConfirm();
        close();
      } catch (err) {
        $btn.disabled = false;
        $btn.textContent = confirmText;
      }
    });

    document.body.appendChild($overlay);
  }

  // ─── Business Actions ───────────────────────────────────────────────────────
  window.__suspendBiz = (e, id, name, isSuspended) => {
    if (e && e.stopPropagation) e.stopPropagation();
    showConfirmModal({
      title: isSuspended ? 'Unsuspend Business?' : 'Suspend Business?',
      message: isSuspended
        ? `Are you sure you want to unsuspend "${name}"? This will restore access for all its team members and API integrations.`
        : `Are you sure you want to suspend "${name}"?`,
      warningText: isSuspended
        ? `Team members will immediately regain login access and API requests will resume.`
        : `All team members will be temporarily blocked from logging in or making API requests. No data will be deleted.`,
      confirmText: isSuspended ? 'Unsuspend' : 'Suspend',
      confirmType: isSuspended ? 'success' : 'warning',
      onConfirm: async () => {
        try {
          const res = await api(`/businesses/${id}/suspend`, { method: 'PATCH' });
          showToast(res.message, 'success');
          // Refresh view depending on what is open
          if (document.getElementById('page-business-detail').classList.contains('active')) {
            window.__viewBiz(id);
          } else {
            loadBusinesses(bizPage);
          }
        } catch (err) {
          showToast('Failed to change suspension status', 'error');
          throw err;
        }
      }
    });
  };

  window.__deleteBiz = (e, id, name) => {
    if (e && e.stopPropagation) e.stopPropagation();
    showConfirmModal({
      title: 'Permanently Delete Business?',
      message: `You are about to completely delete "${name}" from the database.`,
      warningText: `CRITICAL ACTION: This is a hard delete with cascade! All associated data belonging to this business (users, products, transactions, customers, payments, stock records, audit logs) will be PERMANENTLY destroyed to prevent orphaned data. This cannot be undone!`,
      confirmText: 'Delete Everything',
      confirmType: 'danger',
      onConfirm: async () => {
        try {
          const res = await api(`/businesses/${id}`, { method: 'DELETE' });
          showToast(`Deleted "${name}" (${res.deleted.transactions || 0} transactions, ${res.deleted.products || 0} products, ${res.deleted.users || 0} users removed)`, 'success');
          if (document.getElementById('page-business-detail').classList.contains('active')) {
            navigateTo('businesses');
          } else {
            loadBusinesses(bizPage);
          }
        } catch (err) {
          showToast('Failed to delete business', 'error');
          throw err;
        }
      }
    });
  };


  // ─── Auth ───────────────────────────────────────────────────────────────────
  function showLogin() {
    adminKey = '';
    sessionStorage.removeItem(STORAGE_KEY);
    $loginScreen.style.display = '';
    $adminApp.style.display = 'none';
  }

  function showApp() {
    $loginScreen.style.display = 'none';
    $adminApp.style.display = '';
    navigateTo('overview');
  }

  $loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $keyInput.value.trim();
    if (!key) return;

    adminKey = key;
    try {
      await api('/overview'); // Test the key
      sessionStorage.setItem(STORAGE_KEY, key);
      $loginError.style.display = 'none';
      showApp();
    } catch {
      $loginError.textContent = 'Invalid admin key. Please try again.';
      $loginError.style.display = 'block';
      adminKey = '';
    }
  });

  $logoutBtn.addEventListener('click', showLogin);

  // ─── Navigation ─────────────────────────────────────────────────────────────
  function navigateTo(page) {
    currentPage = page;

    // Toggle active nav
    document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === page);
    });

    // Toggle page views
    document.querySelectorAll('.page-view').forEach(view => {
      view.classList.remove('active');
    });

    const targetView = document.getElementById(`page-${page}`);
    if (targetView) targetView.classList.add('active');

    // Load data
    switch (page) {
      case 'overview': loadOverview(); break;
      case 'businesses': loadBusinesses(); break;
      case 'users': loadUsers(); break;
      case 'activity': loadActivity(); break;
    }
  }

  document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  $backBtn.addEventListener('click', () => navigateTo('businesses'));

  // ─── Overview Page ──────────────────────────────────────────────────────────
  async function loadOverview() {
    const $stats = document.getElementById('overview-stats');
    const $activity = document.getElementById('overview-activity');

    // Show skeletons
    $stats.innerHTML = Array(6).fill(0).map(() =>
      `<div class="stat-card">${skeleton(20,'40%')}<div style="margin-top:12px">${skeleton(32,'50%')}</div><div style="margin-top:8px">${skeleton(14,'70%')}</div></div>`
    ).join('');

    try {
      const [data, activityData] = await Promise.all([
        api('/overview'),
        api('/activity?limit=8'),
      ]);

      $stats.innerHTML = `
        <div class="stat-card">
          <div class="stat-icon purple">🏢</div>
          <div class="stat-value">${formatNum(data.totalBusinesses)}</div>
          <div class="stat-label">Total Businesses</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon blue">👥</div>
          <div class="stat-value">${formatNum(data.totalUsers)}</div>
          <div class="stat-label">Total Users</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green">💰</div>
          <div class="stat-value">${formatCurrency(data.totalRevenue)}</div>
          <div class="stat-label">Total Revenue</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon orange">📦</div>
          <div class="stat-value">${formatNum(data.totalProducts)}</div>
          <div class="stat-label">Total Products</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon blue">🧾</div>
          <div class="stat-value">${formatNum(data.totalTransactions)}</div>
          <div class="stat-label">Total Transactions</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green">📈</div>
          <div class="stat-value">${formatCurrency(data.todayRevenue)}</div>
          <div class="stat-label">Today's Revenue</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon purple">🆕</div>
          <div class="stat-value">${formatNum(data.newBusinesses30d)}</div>
          <div class="stat-label">New Businesses (30d)</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon orange">👤</div>
          <div class="stat-value">${formatNum(data.newUsers30d)}</div>
          <div class="stat-label">New Users (30d)</div>
        </div>
      `;

      $activity.innerHTML = renderActivityList(activityData);
    } catch (err) {
      console.error('Overview load failed:', err);
      $stats.innerHTML = '<p style="color:var(--danger);padding:20px;">Failed to load overview data.</p>';
    }
  }

  // ─── Businesses Page ────────────────────────────────────────────────────────
  let bizPage = 1;

  async function loadBusinesses(page = 1) {
    bizPage = page;
    const $tbody = document.getElementById('biz-tbody');
    const $pag = document.getElementById('biz-pagination');
    const search = document.getElementById('biz-search').value.trim();

    $tbody.innerHTML = Array(5).fill(0).map(() =>
      `<tr>${Array(9).fill(0).map(() => `<td>${skeleton(16, '80%')}</td>`).join('')}</tr>`
    ).join('');

    try {
      const params = new URLSearchParams({ page, limit: 20 });
      if (search) params.set('search', search);
      const data = await api(`/businesses?${params}`);

      if (!data.data.length) {
        $tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><p>No businesses found</p></div></td></tr>`;
        $pag.innerHTML = '';
        return;
      }

      $tbody.innerHTML = data.data.map(biz => `
        <tr onclick="window.__viewBiz('${biz.id}')" class="${biz.isSuspended ? 'row-suspended' : ''}">
          <td>
            <div style="display:flex;align-items:center;gap:10px;">
              ${biz.logo
                ? `<img src="${biz.logo}" style="width:32px;height:32px;border-radius:8px;object-fit:cover;" />`
                : `<div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#a855f7);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;">${(biz.name||'B')[0].toUpperCase()}</div>`
              }
              <strong>${escapeHtml(biz.name)}</strong>
            </div>
          </td>
          <td style="color:var(--text-muted);font-size:12.5px;">${biz.slug || '—'}</td>
          <td>
            <span class="badge ${biz.isSuspended ? 'badge-suspended' : 'badge-active'}">
              ${biz.isSuspended ? 'Suspended' : 'Active'}
            </span>
          </td>
          <td>${biz.users}</td>
          <td>${biz.products}</td>
          <td>${formatNum(biz.transactions)}</td>
          <td>${biz.customers}</td>
          <td style="color:var(--success);font-weight:600;">${formatCurrency(biz.revenue)}</td>
          <td style="text-align:right;" onclick="event.stopPropagation()">
            <div class="action-btns" style="justify-content:flex-end;">
              <button class="btn-action ${biz.isSuspended ? 'btn-unsuspend' : 'btn-suspend'}"
                      onclick="window.__suspendBiz(event, '${biz.id}', '${escapeHtml(biz.name).replace(/'/g, "\\'")}', ${biz.isSuspended})">
                ${biz.isSuspended ? '▶ Unsuspend' : '⏸ Suspend'}
              </button>
              <button class="btn-action btn-delete"
                      onclick="window.__deleteBiz(event, '${biz.id}', '${escapeHtml(biz.name).replace(/'/g, "\\'")}')">
                🗑 Delete
              </button>
            </div>
          </td>
        </tr>
      `).join('');

      $pag.innerHTML = `
        <button ${page <= 1 ? 'disabled' : ''} onclick="window.__bizPage(${page - 1})">← Prev</button>
        <span>Page ${data.page} of ${data.totalPages}</span>
        <button ${page >= data.totalPages ? 'disabled' : ''} onclick="window.__bizPage(${page + 1})">Next →</button>
      `;
    } catch (err) {
      console.error('Businesses load failed:', err);
      $tbody.innerHTML = `<tr><td colspan="9" style="color:var(--danger);padding:20px;">Failed to load.</td></tr>`;
    }
  }

  // Expose page handler globally
  window.__bizPage = (p) => loadBusinesses(p);

  // Search with debounce
  let searchTimeout;
  document.getElementById('biz-search').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadBusinesses(1), 350);
  });

  // ─── Business Detail ───────────────────────────────────────────────────────
  window.__viewBiz = async (id) => {
    // Show detail page
    document.querySelectorAll('.page-view').forEach(v => v.classList.remove('active'));
    document.getElementById('page-business-detail').classList.add('active');

    // Deselect nav
    document.querySelectorAll('.nav-item[data-page]').forEach(b => b.classList.remove('active'));

    const $content = document.getElementById('biz-detail-content');
    $content.innerHTML = `<div style="padding:40px;text-align:center;">${skeleton(24,'30%')}<div style="margin-top:16px">${skeleton(18,'50%')}</div></div>`;

    try {
      const data = await api(`/businesses/${id}`);
      const biz = data.business;

      $content.innerHTML = `
        ${biz.isSuspended ? `
          <div class="suspended-banner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div>
              <strong>This business is currently suspended.</strong> All users associated with this business are blocked from logging in or making API requests.
            </div>
          </div>
        ` : ''}
        <div class="page-header" style="display:flex;align-items:center;gap:16px;margin-bottom:28px;flex-wrap:wrap;">
          ${biz.logo
            ? `<img src="${biz.logo}" style="width:56px;height:56px;border-radius:14px;object-fit:cover;border:2px solid var(--border);" />`
            : `<div style="width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#6366f1,#a855f7);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#fff;">${(biz.name||'B')[0].toUpperCase()}</div>`
          }
          <div>
            <div style="display:flex;align-items:center;gap:10px;">
              <h2 style="margin-bottom:2px;">${escapeHtml(biz.name)}</h2>
              <span class="badge ${biz.isSuspended ? 'badge-suspended' : 'badge-active'}">
                ${biz.isSuspended ? 'Suspended' : 'Active'}
              </span>
            </div>
            <p style="color:var(--text-muted);font-size:13px;margin:4px 0 0;">
              ${biz.slug ? `/${biz.slug}` : ''} ${biz.phone ? ` · ${biz.phone}` : ''} · Currency: ${biz.currency || '$'} · VAT: ${biz.vatRate ?? 0}%
            </p>
          </div>
          <div class="detail-header-actions">
            <button class="btn-action ${biz.isSuspended ? 'btn-unsuspend' : 'btn-suspend'}" style="padding:8px 18px;font-size:13px;"
                    onclick="window.__suspendBiz(event, '${biz._id}', '${escapeHtml(biz.name).replace(/'/g, "\\'")}', ${biz.isSuspended})">
              ${biz.isSuspended ? '▶ Unsuspend Business' : '⏸ Suspend Business'}
            </button>
            <button class="btn-action btn-delete" style="padding:8px 18px;font-size:13px;"
                    onclick="window.__deleteBiz(event, '${biz._id}', '${escapeHtml(biz.name).replace(/'/g, "\\'")}')">
              🗑 Delete Permanently
            </button>
          </div>
        </div>

        <div class="mini-stats">
          <div class="mini-stat">
            <div class="value" style="color:var(--accent-light);">${data.users.length}</div>
            <div class="label">Users</div>
          </div>
          <div class="mini-stat">
            <div class="value" style="color:var(--info);">${data.products.length}</div>
            <div class="label">Products</div>
          </div>
          <div class="mini-stat">
            <div class="value" style="color:var(--success);">${data.recentTransactions.length > 0 ? formatNum(data.recentTransactions.length) + '+' : '0'}</div>
            <div class="label">Recent TXN</div>
          </div>
          <div class="mini-stat">
            <div class="value" style="color:var(--warning);">${formatCurrency(data.credit.totalOwed)}</div>
            <div class="label">Outstanding Credit</div>
          </div>
          <div class="mini-stat">
            <div class="value" style="color:var(--success);">${formatCurrency(data.credit.totalPaid)}</div>
            <div class="label">Credit Paid</div>
          </div>
          <div class="mini-stat">
            <div class="value">${data.categories}</div>
            <div class="label">Categories</div>
          </div>
        </div>

        <!-- Revenue by Day -->
        ${data.revenueByDay.length > 0 ? `
        <div class="panel">
          <div class="panel-header"><h3>📊 Revenue (Last 14 Days)</h3></div>
          <div class="panel-body" style="overflow-x:auto;">
            <table class="data-table">
              <thead><tr><th>Date</th><th>Transactions</th><th>Revenue</th></tr></thead>
              <tbody>
                ${data.revenueByDay.map(d => `
                  <tr>
                    <td>${d._id}</td>
                    <td>${d.count}</td>
                    <td style="color:var(--success);font-weight:600;">${formatCurrency(d.total)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        ` : ''}

        <!-- Staff / Users -->
        <div class="panel">
          <div class="panel-header"><h3>👥 Team Members (${data.users.length})</h3></div>
          <div class="panel-body" style="padding:0;overflow-x:auto;">
            <table class="data-table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead>
              <tbody>
                ${data.users.map(u => `
                  <tr>
                    <td><strong>${escapeHtml(u.name)}</strong></td>
                    <td style="color:var(--text-muted);">${escapeHtml(u.email)}</td>
                    <td><span class="badge ${u.role === 'OWNER' ? 'badge-owner' : 'badge-staff'}">${u.role}</span></td>
                    <td style="color:var(--text-muted);font-size:12.5px;">${formatDate(u.createdAt)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Recent Transactions -->
        ${data.recentTransactions.length > 0 ? `
        <div class="panel">
          <div class="panel-header"><h3>🧾 Recent Transactions</h3></div>
          <div class="panel-body" style="padding:0;overflow-x:auto;">
            <table class="data-table">
              <thead><tr><th>ID</th><th>Customer</th><th>Method</th><th>Status</th><th>Total</th><th>Date</th></tr></thead>
              <tbody>
                ${data.recentTransactions.map(tx => `
                  <tr>
                    <td style="font-family:monospace;font-size:12px;color:var(--text-muted);">${(tx._id || tx.id || '').toString().slice(-8)}</td>
                    <td>${tx.customer?.name || tx.guestName || '<em style="color:var(--text-muted)">Guest</em>'}</td>
                    <td>${tx.paymentMethod || '—'}</td>
                    <td><span class="badge ${tx.status === 'PAID' ? 'badge-create' : tx.status === 'CREDIT' ? 'badge-update' : 'badge-staff'}">${tx.status}</span></td>
                    <td style="font-weight:600;">${formatCurrency(tx.total)}</td>
                    <td style="color:var(--text-muted);font-size:12.5px;">${timeAgo(tx.createdAt)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        ` : ''}

        <!-- Products Preview -->
        ${data.products.length > 0 ? `
        <div class="panel">
          <div class="panel-header"><h3>📦 Products (showing up to 50)</h3></div>
          <div class="panel-body" style="padding:0;overflow-x:auto;">
            <table class="data-table">
              <thead><tr><th>Product</th><th>SKU</th><th>Price</th><th>Stock</th><th>Category</th></tr></thead>
              <tbody>
                ${data.products.map(p => `
                  <tr>
                    <td><strong>${escapeHtml(p.name)}</strong></td>
                    <td style="font-family:monospace;font-size:12px;color:var(--text-muted);">${p.sku || '—'}</td>
                    <td>${formatCurrency(p.price)}</td>
                    <td>${p.stock <= p.minStock ? `<span style="color:var(--danger);font-weight:600;">${p.stock}</span>` : p.stock}</td>
                    <td style="color:var(--text-muted);">${p.category?.name || '—'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        ` : ''}
      `;
    } catch (err) {
      console.error('Business detail failed:', err);
      $content.innerHTML = `<p style="color:var(--danger);padding:24px;">Failed to load business details.</p>`;
    }
  };

  // ─── Users Page ─────────────────────────────────────────────────────────────
  let usersPage = 1;

  async function loadUsers(page = 1) {
    usersPage = page;
    const $tbody = document.getElementById('users-tbody');
    const $pag = document.getElementById('users-pagination');

    $tbody.innerHTML = Array(5).fill(0).map(() =>
      `<tr>${Array(5).fill(0).map(() => `<td>${skeleton(16, '75%')}</td>`).join('')}</tr>`
    ).join('');

    try {
      const data = await api(`/users?page=${page}&limit=20`);

      if (!data.data.length) {
        $tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>No users found</p></div></td></tr>`;
        $pag.innerHTML = '';
        return;
      }

      $tbody.innerHTML = data.data.map(u => `
        <tr class="${u.businessSuspended ? 'row-suspended' : ''}">
          <td><strong>${escapeHtml(u.name)}</strong></td>
          <td style="color:var(--text-muted);">${escapeHtml(u.email)}</td>
          <td><span class="badge ${u.role === 'OWNER' ? 'badge-owner' : 'badge-staff'}">${u.role}</span></td>
          <td>
            ${escapeHtml(u.businessName)}
            ${u.businessSuspended ? `<span class="badge badge-suspended" style="margin-left:6px;font-size:10px;">Suspended</span>` : ''}
          </td>
          <td style="color:var(--text-muted);font-size:12.5px;">${formatDate(u.createdAt)}</td>
        </tr>
      `).join('');

      $pag.innerHTML = `
        <button ${page <= 1 ? 'disabled' : ''} onclick="window.__usersPage(${page - 1})">← Prev</button>
        <span>Page ${data.page} of ${data.totalPages}</span>
        <button ${page >= data.totalPages ? 'disabled' : ''} onclick="window.__usersPage(${page + 1})">Next →</button>
      `;
    } catch (err) {
      console.error('Users load failed:', err);
      $tbody.innerHTML = `<tr><td colspan="5" style="color:var(--danger);padding:20px;">Failed to load.</td></tr>`;
    }
  }

  window.__usersPage = (p) => loadUsers(p);

  // ─── Activity Page ──────────────────────────────────────────────────────────
  async function loadActivity() {
    const $feed = document.getElementById('activity-feed');
    $feed.innerHTML = Array(6).fill(0).map(() =>
      `<div class="activity-item"><div>${skeleton(8,'8px')}</div><div style="flex:1;">${skeleton(16,'80%')}<div style="margin-top:6px;">${skeleton(12,'50%')}</div></div></div>`
    ).join('');

    try {
      const data = await api('/activity?limit=50');
      $feed.innerHTML = renderActivityList(data);
    } catch (err) {
      console.error('Activity load failed:', err);
      $feed.innerHTML = `<p style="color:var(--danger);">Failed to load activity.</p>`;
    }
  }

  function renderActivityList(items) {
    if (!items || !items.length) {
      return `<div class="empty-state"><p>No activity recorded yet</p></div>`;
    }
    return items.map(item => `
      <div class="activity-item">
        <div class="activity-dot ${item.action?.toLowerCase() || 'create'}"></div>
        <div class="activity-text">
          <div>
            <strong>${escapeHtml(item.user)}</strong>
            <span class="badge ${item.action === 'CREATE' ? 'badge-create' : item.action === 'UPDATE' ? 'badge-update' : 'badge-delete'}" style="margin-left:8px;font-size:10px;">
              ${item.action}
            </span>
            <span class="entity" style="margin-left:6px;">${item.entity}</span>
          </div>
          <div class="activity-meta">${timeAgo(item.createdAt)}${item.email ? ` · ${item.email}` : ''}${item.ip ? ` · ${item.ip}` : ''}</div>
        </div>
      </div>
    `).join('');
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Init ───────────────────────────────────────────────────────────────────
  if (adminKey) {
    // Try to auto-login with stored key
    api('/overview')
      .then(() => showApp())
      .catch(() => showLogin());
  } else {
    showLogin();
  }
})();
