const STORAGE_KEY = "blockhost-demo-state-v1";

const initialState = {
  servers: [
    { id: "survival", name: "Survival SMP", software: "Paper", version: "1.21.4", address: "survival.stonebridge.gg", players: 12, maxPlayers: 40, ram: 6, status: "online", cpu: 38 },
    { id: "creative", name: "Creative Build", software: "Paper", version: "1.21.4", address: "creative.stonebridge.gg", players: 4, maxPlayers: 25, ram: 4, status: "online", cpu: 21 },
    { id: "modded", name: "Modded Realm", software: "Fabric", version: "1.20.1", address: "modded.stonebridge.gg", players: 0, maxPlayers: 20, ram: 8, status: "offline", cpu: 0 },
  ],
  files: [
    { name: "paper-1.21.4.jar", type: "JAR", size: "47.8 MB", modified: "Today, 10:42 AM" },
    { name: "world", type: "Folder", size: "—", modified: "Today, 9:18 AM" },
    { name: "plugins", type: "Folder", size: "—", modified: "Yesterday, 8:32 PM" },
    { name: "server.properties", type: "Config", size: "2.4 KB", modified: "Nov 17, 2025" },
    { name: "eula.txt", type: "Config", size: "12 B", modified: "Nov 16, 2025" },
    { name: "logs", type: "Folder", size: "—", modified: "Nov 16, 2025" },
  ],
  backups: [
    { name: "Automatic backup", detail: "Survival SMP · Nov 19, 2025 at 10:00 AM", size: "1.24 GB" },
    { name: "Automatic backup", detail: "Creative Build · Nov 19, 2025 at 9:30 AM", size: "842 MB" },
    { name: "Manual backup", detail: "Survival SMP · Nov 18, 2025 at 6:12 PM", size: "1.21 GB" },
  ],
  activity: [
    { icon: "↻", tone: "", text: "<strong>Survival SMP</strong> completed an automatic backup", time: "12 minutes ago" },
    { icon: "●", tone: "blue", text: "<strong>AlexTheBuilder</strong> joined Creative Build", time: "38 minutes ago" },
    { icon: "↑", tone: "orange", text: "Server updated to <strong>Paper 1.21.4</strong>", time: "2 hours ago" },
    { icon: "◉", tone: "", text: "<strong>Survival SMP</strong> started successfully", time: "Yesterday, 4:32 PM" },
  ],
};

let state = loadState();
let activePage = "overview";
let currentUser = null;
let toastTimer;
let adminPlans = [];

const pageTitles = {
  overview: "Overview",
  servers: "Servers",
  files: "File manager",
  console: "Console",
  backups: "Backups",
  settings: "Settings",
  infrastructure: "Infrastructure",
  minecraft: "Optional plugin API",
  plans: "Plans & accounts",
};

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return structuredClone(initialState);
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.servers) || !Array.isArray(parsed.files) || !Array.isArray(parsed.backups)) {
      throw new Error("Saved dashboard data is incomplete.");
    }
    return parsed;
  } catch (error) {
    console.error("Could not load saved demo data:", error);
    return structuredClone(initialState);
  }
}

function emptyLiveState() {
  return { servers: [], files: [], backups: [], activity: [] };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Could not save dashboard data:", error);
    showToast("Changes could not be saved in this browser.");
  }
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function setAccountIdentity(displayName, workspaceName, accountLabel) {
  const initials = displayName.trim().split(/\s+/).map((part) => part.charAt(0)).join("").slice(0, 2).toUpperCase() || "A";
  document.getElementById("account-name").textContent = displayName;
  document.getElementById("account-label").textContent = accountLabel;
  document.getElementById("workspace-name").textContent = workspaceName;
  document.getElementById("workspace-crumb").textContent = workspaceName;
  document.getElementById("workspace-avatar").textContent = workspaceName.charAt(0).toUpperCase();
  document.getElementById("user-avatar").textContent = initials;
  document.getElementById("top-avatar").textContent = initials;
}

function setPage(page) {
  if (!pageTitles[page]) return;
  if (page === "infrastructure" && !currentUser?.isAdmin) {
    showToast("Infrastructure statistics are restricted to site administrators.");
    return;
  }
  if (page === "plans" && (!currentUser?.isAdmin || currentUser.demo)) {
    showToast("Plan management is restricted to site administrators.");
    return;
  }
  if (page === "minecraft" && (!currentUser || currentUser.demo)) {
    showToast("Sign in with Discord to manage your own server connections.");
    return;
  }
  activePage = page;
  document.getElementById("breadcrumb-current").textContent = pageTitles[page];
  document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.page === page));
  renderPage();
}

function pageHeading(title, subtitle, action = "") {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${action ? `<div class="heading-actions">${action}</div>` : ""}</div>`;
}

function serverStatus(server) {
  const online = server.status === "online";
  return `<span class="server-status ${online ? "" : "offline"}"><i></i>${online ? "Online" : "Offline"}</span>`;
}

function serverRows() {
  if (!state.servers.length) return `<div class="empty-state"><strong>No servers yet</strong>Create a server to see it here.</div>`;
  return state.servers.map((server) => `<div class="server-row">
    <div class="server-name"><span class="server-glyph">▦</span><span><strong>${esc(server.name)}</strong><small>${esc(server.software)} ${esc(server.version)}</small></span></div>
    ${serverStatus(server)}
    <div class="server-meta">${server.players}<small>of ${server.maxPlayers} players</small></div>
    <div class="row-actions"><button class="mini-action" data-action="toggle-server" data-id="${esc(server.id)}" title="${server.status === "online" ? "Stop" : "Start"} server">${server.status === "online" ? "Ⅱ" : "▶"}</button><button class="mini-action" data-action="server-menu" data-id="${esc(server.id)}" title="Server actions">···</button></div>
  </div>`).join("");
}

function activityItems() {
  return state.activity.slice(0, 5).map((item) => `<div class="activity-item"><span class="activity-icon ${item.tone}">${item.icon}</span><div class="activity-copy">${item.text}<time>${esc(item.time)}</time></div></div>`).join("");
}

function renderOverview() {
  if (currentUser && !currentUser.demo) {
    return `${pageHeading(`Welcome, ${esc(currentUser.username)}`, "Create and manage your hosted Minecraft servers.", `<button class="button button-primary button-small" data-action="create-server"><span class="plus">+</span> Create server</button>`)}
      <section class="panel"><div class="panel-heading"><div><h2>Your servers</h2><p>Live status for your hosted Minecraft servers</p></div><button class="text-link" data-page="servers">View all →</button></div><div class="empty-state"><strong>No hosted servers yet</strong>Create a server to get started. The optional plugin API is available separately.</div></section>`;
  }
  const online = state.servers.filter((server) => server.status === "online").length;
  const players = state.servers.reduce((sum, server) => sum + (server.status === "online" ? server.players : 0), 0);
  return `${pageHeading("Good morning, Jordan <span class='positive'>✳</span>", "Here’s what’s happening across your servers today.", `<button class="button button-dark button-small" data-action="quick-backup">↻ &nbsp;Create backup</button><button class="button button-primary button-small" data-action="create-server"><span class="plus">+</span> New server</button>`)}
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Total servers <span class="stat-icon">▦</span></div><div class="stat-value">${state.servers.length}<small>servers</small></div><div class="stat-meta">${online} currently online</div></div>
      <div class="stat-card"><div class="stat-label">Players online <span class="stat-icon">♙</span></div><div class="stat-value">${players}<small>players</small></div><div class="stat-meta"><span class="positive">↑ 3</span> from yesterday</div></div>
      <div class="stat-card"><div class="stat-label">CPU usage <span class="stat-icon">⌁</span></div><div class="stat-value">32<small>% average</small></div><div class="stat-meta">Across all active servers</div></div>
      <div class="stat-card"><div class="stat-label">Storage used <span class="stat-icon">▤</span></div><div class="stat-value">18.6<small>GB / 50 GB</small></div><div class="stat-meta">37% of your plan</div></div>
    </div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-heading"><div><h2>Your servers</h2><p>A quick look at your Minecraft worlds</p></div><button class="text-link" data-page="servers">View all →</button></div><div class="server-list">${serverRows()}</div></section>
      <section class="panel activity-panel"><div class="panel-heading"><div><h2>Recent activity</h2><p>Updates from your workspace</p></div><button class="text-link" data-action="activity-info">•••</button></div><div class="activity-list">${activityItems()}</div></section>
    </div>
    <section class="panel resource-panel"><div class="panel-heading"><div><h2>Resource overview</h2><p>Usage across your active servers</p></div><button class="text-link" data-page="servers">Manage resources →</button></div><div class="resource-body"><div><div class="resource-label"><span>Memory</span><strong>6.8 GB <span class="muted">/ 16 GB</span></strong></div><div class="meter"><span style="width:43%"></span></div><div class="resource-note">Healthy · 9.2 GB available</div></div><div><div class="resource-label"><span>Storage</span><strong>18.6 GB <span class="muted">/ 50 GB</span></strong></div><div class="meter blue"><span style="width:37%"></span></div><div class="resource-note">37% used · 31.4 GB available</div></div></div></section>`;
}

function renderServers() {
  if (currentUser && !currentUser.demo) {
    return `${pageHeading("Your servers", "Create, configure, and monitor your Minecraft servers.", `<button class="button button-primary button-small" data-action="create-server"><span class="plus">+</span> Create server</button>`)}
      <section class="panel"><div class="empty-state"><strong>No hosted servers yet</strong>Create a server to see its status and settings here.</div></section>`;
  }
  return `${pageHeading("Your servers", "Create, configure, and monitor all of your Minecraft worlds.", `<button class="button button-primary button-small" data-action="create-server"><span class="plus">+</span> Create server</button>`)}
    <div class="notice"><strong>Demo mode:</strong> Server actions update this dashboard only. Connect a hosting provider to provision and control live Minecraft servers.</div>
    ${state.servers.length ? `<div class="servers-grid">${state.servers.map((server) => `<article class="server-card">
      <div class="server-card-top"><div class="server-name"><span class="server-glyph">▦</span><span><strong>${esc(server.name)}</strong><small>${esc(server.software)} ${esc(server.version)} · Java Edition</small></span></div><button class="mini-action" data-action="server-menu" data-id="${esc(server.id)}" aria-label="Server menu">···</button></div>
      <div class="server-card-body"><div><div class="stat-label">STATUS</div><div style="margin-top:8px">${serverStatus(server)}</div></div><div><div class="stat-label">PLAYERS</div><div class="stat-value" style="font-size:15px;margin-top:8px">${server.players}<small>/ ${server.maxPlayers}</small></div></div><div><div class="stat-label">MEMORY</div><div class="stat-value" style="font-size:15px;margin-top:8px">${server.ram}<small>GB</small></div></div><div><div class="stat-label">CPU</div><div class="stat-value" style="font-size:15px;margin-top:8px">${server.cpu}<small>%</small></div></div></div>
      <div class="server-card-bottom"><span class="server-address">${esc(server.address)}</span><button class="button button-dark button-small" data-action="toggle-server" data-id="${esc(server.id)}">${server.status === "online" ? "Stop server" : "Start server"}</button></div>
    </article>`).join("")}</div>` : `<section class="panel empty-state"><strong>Your first server starts here</strong>Create a server to see its status and settings.</section>`}`;
}

function fileIcon(type) {
  return type === "Folder" ? "▰" : type === "JAR" ? "◈" : "▤";
}

function renderFiles() {
  if (currentUser && !currentUser.demo) {
    return `${pageHeading("File manager", "Browse server files and world saves.")}
      <section class="panel"><div class="empty-state"><strong>File management is not connected</strong>No server files are shown until a file-transfer integration is available.</div></section>`;
  }
  return `${pageHeading("File manager", "Manage server files, plugins, and world saves.", `<button class="button button-dark button-small" data-action="upload-world">↑ &nbsp;Upload world</button><button class="button button-primary button-small" data-action="upload-jar">↑ &nbsp;Upload .jar</button>`)}
    <div class="notice"><strong>Demo file manager:</strong> Uploads are listed locally in this browser only. Connect a server backend for real file transfer.</div>
    <section class="panel"><div class="panel-heading"><div><h2>Survival SMP</h2><p>Root directory &nbsp; /</p></div><button class="text-link" data-action="new-folder">＋ New folder</button></div>
    <div class="toolbar" style="padding:13px 15px 0"><input class="search-field" id="file-search" placeholder="⌕  Search files..." aria-label="Search files"><select class="select-field" id="file-server-select" aria-label="Choose server">${state.servers.map((server) => `<option>${esc(server.name)}</option>`).join("")}</select></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>NAME</th><th>TYPE</th><th>SIZE</th><th>LAST MODIFIED</th><th></th></tr></thead><tbody id="file-table-body">${fileTableRows(state.files)}</tbody></table></div></section>
    <section class="panel section-spacer"><div class="panel-heading"><div><h2>Upload files</h2><p>Drag files here, or choose from your computer</p></div></div><label class="drop-zone" id="drop-zone"><span class="drop-icon">↑</span><strong>Drop files to upload</strong><p>JAR files up to 100 MB · World archives up to 2 GB</p><span class="button button-dark button-small">Choose files</span><input id="file-upload" type="file" multiple accept=".jar,.zip,.gz,.properties,.txt,.yml,.json"></label></section>`;
}

function fileTableRows(files) {
  if (!files.length) return `<tr><td colspan="5"><div class="empty-state"><strong>No files found</strong>Try another search or upload a file.</div></td></tr>`;
  return files.map((file, index) => `<tr><td class="file-name"><span class="file-icon">${fileIcon(file.type)}</span>${esc(file.name)}</td><td>${esc(file.type)}</td><td class="muted">${esc(file.size)}</td><td class="muted">${esc(file.modified)}</td><td><button class="table-actions" data-action="file-menu" data-index="${index}" aria-label="File actions">···</button></td></tr>`).join("");
}

function renderConsole() {
  if (currentUser && !currentUser.demo) {
    return `${pageHeading("Server console", "View output and send commands to a connected server.")}
      <section class="panel"><div class="empty-state"><strong>Hosted server console is being configured</strong>Console access will be connected to the managed server process, independently of the optional plugin API.</div></section>`;
  }
  return `${pageHeading("Server console", "View server output and send commands.", `<select class="select-field" id="console-server">${state.servers.map((server) => `<option value="${esc(server.id)}">${esc(server.name)}</option>`).join("")}</select>`)}
    <div class="notice"><strong>Demo console:</strong> Commands are not sent to a live Minecraft server.</div>
    <section class="console-window"><div class="console-toolbar"><span><i class="status-dot" style="display:inline-block;vertical-align:middle;margin-right:6px"></i> LIVE CONSOLE</span><span>Auto-scroll: ON &nbsp; <button class="text-link" data-action="clear-console">Clear</button></span></div><div class="console-output" id="console-output">
      <div class="console-line"><span class="time">[10:42:03]</span> <span class="tag">[Server thread/INFO]</span>: Starting minecraft server version 1.21.4</div>
      <div class="console-line"><span class="time">[10:42:04]</span> <span class="tag">[Server thread/INFO]</span>: Loading properties</div>
      <div class="console-line"><span class="time">[10:42:04]</span> <span class="tag">[Server thread/INFO]</span>: Default game type: SURVIVAL</div>
      <div class="console-line"><span class="time">[10:42:05]</span> <span class="tag">[Server thread/INFO]</span>: Preparing level "world"</div>
      <div class="console-line"><span class="time">[10:42:07]</span> <span class="tag">[Server thread/INFO]</span>: Preparing spawn area: 100%</div>
      <div class="console-line"><span class="time">[10:42:08]</span> <span class="tag">[Server thread/INFO]</span>: Done (3.842s)! For help, type "help"</div>
      <div class="console-line"><span class="time">[10:42:08]</span> <span class="tag">[Server thread/INFO]</span>: There are 12 of a max of 40 players online</div>
    </div><form class="console-input-row" id="console-form"><input id="console-command" autocomplete="off" placeholder="Enter a command (e.g. list, say Hello)"><button type="submit">Send command ↗</button></form></section>`;
}

function renderBackups() {
  if (currentUser && !currentUser.demo) {
    return `${pageHeading("Backups", "View and manage backups for your connected servers.")}
      <section class="panel"><div class="empty-state"><strong>Backup management is not connected</strong>No backup history or schedule is available until a backup integration is added.</div></section>`;
  }
  return `${pageHeading("Backups", "Protect your worlds with scheduled and manual backups.", `<button class="button button-primary button-small" data-action="create-backup"><span class="plus">+</span> Create backup</button>`)}
    <div class="notice"><strong>Backups:</strong> These demo entries are for display only. Configure connected server storage to create and restore real backups.</div>
    <section class="panel"><div class="panel-heading"><div><h2>Recent backups</h2><p>Your latest world snapshots</p></div><span class="demo-badge"><span></span> DAILY SCHEDULE</span></div>${state.backups.map((backup) => `<div class="backup-row"><div class="backup-info"><span class="activity-icon">↻</span><span><strong>${esc(backup.name)}</strong><small>${esc(backup.detail)}</small></span></div><div class="backup-size">${esc(backup.size)}</div><button class="mini-action" data-action="backup-menu" aria-label="Backup actions">···</button></div>`).join("") || `<div class="empty-state"><strong>No backups yet</strong>Create a backup to protect a world.</div>`}</section>
    <section class="panel resource-panel"><div class="panel-heading"><div><h2>Backup schedule</h2><p>Automatic backups keep your progress safe</p></div><button class="text-link" data-page="settings">Edit schedule →</button></div><div class="resource-body"><div><div class="resource-label"><span>Frequency</span><strong>Daily</strong></div><div class="resource-note">Next backup: Tomorrow at 9:00 AM</div></div><div><div class="resource-label"><span>Retention</span><strong>7 days</strong></div><div class="resource-note">Older backups are removed automatically</div></div></div></section>`;
}

function renderSettings() {
  if (currentUser && !currentUser.demo) {
    return `${pageHeading("Settings", "Account and workspace preferences.")}
      <section class="panel"><div class="empty-state"><strong>Workspace settings are not available yet</strong>Signed in as ${esc(currentUser.username)}.</div></section>`;
  }
  return `${pageHeading("Settings", "Manage workspace preferences and account details.")}
    <div class="settings-grid"><section class="panel settings-nav"><button class="settings-tab active">General</button><button class="settings-tab" data-action="setting-info">Notifications</button><button class="settings-tab" data-action="setting-info">Security</button><button class="settings-tab" data-action="setting-info">Billing</button></section>
    <section class="panel settings-content"><h2>Workspace settings</h2><p>Update your workspace name and default preferences.</p>
    <div class="settings-field"><label for="workspace-name">Workspace name</label><input id="workspace-name" class="form-control" value="Stonebridge SMP"></div>
    <div class="settings-field"><label>Default region</label><select class="form-control"><option>North America — East</option><option>Europe — West</option><option>Asia Pacific</option></select></div>
    <div class="settings-field"><label>Daily backups</label><button class="toggle on" data-action="toggle-setting" aria-label="Toggle daily backups"></button></div>
    <div class="settings-field"><label>Maintenance alerts</label><button class="toggle on" data-action="toggle-setting" aria-label="Toggle maintenance alerts"></button></div>
    <div style="padding-top:16px;text-align:right"><button class="button button-primary button-small" data-action="save-settings">Save changes</button></div></section></div>`;
}

function renderInfrastructure() {
  const demo = currentUser?.demo;
  const sampleStats = `<div class="stats-grid"><div class="stat-card"><div class="stat-label">Node CPU <span class="stat-icon">⌁</span></div><div class="stat-value">32<small>%</small></div><div class="stat-meta">Sample data · not live</div></div><div class="stat-card"><div class="stat-label">Memory <span class="stat-icon">▤</span></div><div class="stat-value">6.8<small>GB used</small></div><div class="stat-meta">Sample data · not live</div></div><div class="stat-card"><div class="stat-label">Node uptime <span class="stat-icon">◷</span></div><div class="stat-value">14<small>days</small></div><div class="stat-meta">Sample data · not live</div></div></div>`;
  return `${pageHeading("Infrastructure", "Proxmox VM metrics for site administrators only.")}
    <div class="notice"><strong>Admin-only:</strong> Live metrics are fetched by the backend and are not exposed to regular user accounts.</div>
    <section class="panel" id="proxmox-stats">${demo ? sampleStats : `<div class="empty-state"><strong>Loading Proxmox metrics…</strong>Stats are requested from the protected admin API.</div>`}</section>`;
}

function renderPlans() {
  if (!currentUser?.isAdmin || currentUser.demo) {
    return `${pageHeading("Plans & accounts", "Assign hosting plans to Discord accounts.")}<div class="notice">Live plan management is available to signed-in site administrators.</div>`;
  }
  return `${pageHeading("Plans & accounts", "Set server, CPU, memory, and disk limits for each hosting plan.", `<button class="button button-primary button-small" data-action="create-plan"><span class="plus">+</span> Create plan</button>`)}
    <div class="notice"><strong>Admin-only:</strong> Plan limits and assignments are stored by the backend. Provisioning enforcement will be connected with the server-creation API; no VM is created from this page yet.</div>
    <section class="panel"><div class="panel-heading"><div><h2>Hosting plans</h2><p>Per-server resource caps and maximum server count</p></div></div><div id="admin-plans"><div class="empty-state"><strong>Loading plans…</strong></div></div></section>
    <section class="panel section-spacer"><div class="panel-heading"><div><h2>Discord accounts</h2><p>Only accounts that have signed in are listed.</p></div></div><div id="admin-accounts"><div class="empty-state"><strong>Loading accounts…</strong></div></div></section>`;
}

async function loadAdminPlans() {
  const plansRoot = document.getElementById("admin-plans");
  const accountsRoot = document.getElementById("admin-accounts");
  if (!plansRoot || !accountsRoot) return;
  try {
    const [plansResponse, accountsResponse] = await Promise.all([
      fetch("/api/admin/plans", { credentials: "same-origin" }),
      fetch("/api/admin/accounts", { credentials: "same-origin" }),
    ]);
    const [plansResult, accountsResult] = await Promise.all([plansResponse.json(), accountsResponse.json()]);
    if (!plansResponse.ok) throw new Error(plansResult.error || `Plans request failed (${plansResponse.status}).`);
    if (!accountsResponse.ok) throw new Error(accountsResult.error || `Accounts request failed (${accountsResponse.status}).`);
    adminPlans = plansResult;
    plansRoot.innerHTML = adminPlans.length
      ? `<div class="servers-grid">${adminPlans.map((plan) => `<article class="server-card">
          <div class="server-card-top"><div class="server-name"><span class="server-glyph">◇</span><span><strong>${esc(plan.name)}</strong><small>${plan.assignedUsers} assigned account${plan.assignedUsers === 1 ? "" : "s"}</small></span></div><button class="mini-action" data-action="edit-plan" data-id="${esc(plan.id)}" aria-label="Edit ${esc(plan.name)}">···</button></div>
          <div class="server-card-body"><div><div class="stat-label">SERVERS</div><div class="stat-value" style="font-size:15px;margin-top:8px">${plan.maxServers === null ? "Unlimited" : esc(plan.maxServers)}</div></div><div><div class="stat-label">VCPU / SERVER</div><div class="stat-value" style="font-size:15px;margin-top:8px">${esc(plan.maxVcpusPerServer)}</div></div><div><div class="stat-label">RAM / SERVER</div><div class="stat-value" style="font-size:15px;margin-top:8px">${esc(plan.maxRamMbPerServer)}<small>MiB</small></div></div><div><div class="stat-label">DISK / SERVER</div><div class="stat-value" style="font-size:15px;margin-top:8px">${esc(plan.maxDiskGbPerServer)}<small>GB</small></div></div></div>
        </article>`).join("")}</div>`
      : `<div class="empty-state"><strong>No plans configured</strong>Create a hosting plan to assign it to users.</div>`;
    accountsRoot.innerHTML = accountsResult.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>DISCORD ACCOUNT</th><th>PLAN</th><th>LAST SEEN</th></tr></thead><tbody>${accountsResult.map((account) => `<tr><td class="file-name">${esc(account.username)}<small class="muted">${esc(account.id)}</small></td><td><select class="select-field" data-account-plan="${esc(account.id)}"><option value="">No plan</option>${adminPlans.map((plan) => `<option value="${esc(plan.id)}" ${account.planId === plan.id ? "selected" : ""}>${esc(plan.name)}</option>`).join("")}</select></td><td class="muted">${esc(account.lastSeenAt ? new Date(account.lastSeenAt).toLocaleString() : "—")}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty-state"><strong>No Discord accounts yet</strong>Accounts appear here after their first sign-in.</div>`;
  } catch (error) {
    console.error("Could not load plan management data:", error);
    plansRoot.innerHTML = `<div class="empty-state"><strong>Could not load plans and accounts</strong>${esc(error.message)}</div>`;
    accountsRoot.innerHTML = "";
  }
}

function renderMinecraft() {
  if (!currentUser || currentUser.demo) {
    return `${pageHeading("Optional plugin API", "Connect BadApple servers to your authenticated website account.")}
      <div class="notice"><strong>Sign-in required:</strong> Sign in with Discord to manage server connections for your account. Demo mode cannot access or store API credentials.</div>`;
  }
  return `${pageHeading("Optional plugin API", "Connect BadApple servers to your authenticated website account.")}
    <div class="notice"><strong>Keep keys private:</strong> The API key is sent to this website's backend over HTTPS and encrypted at rest. Server API hosts must be explicitly allowlisted by the site administrator.</div>
    <section class="panel settings-content">
      <h2>Connect a server</h2>
      <p>Run <code>/api</code> in game to generate a key. Enter the plugin API URL separately; it must use HTTPS with a valid certificate and an administrator-allowlisted hostname.</p>
      <form id="minecraft-connect-form">
        <div class="settings-field"><label for="minecraft-name">Server name</label><input id="minecraft-name" name="name" class="form-control" maxlength="48" required></div>
        <div class="settings-field"><label for="minecraft-url">HTTPS API base URL</label><input id="minecraft-url" name="apiUrl" class="form-control" type="url" placeholder="https://server.example.com" required></div>
        <div class="settings-field"><label for="minecraft-key">BadApple API key</label><input id="minecraft-key" name="apiKey" class="form-control" type="password" autocomplete="off" required></div>
        <button class="button button-primary button-small" type="submit">Connect server</button>
      </form>
    </section>
    <section class="panel section-spacer"><div class="panel-heading"><div><h2>Connected servers</h2><p>Server credentials are never returned to the browser after saving.</p></div></div><div id="minecraft-server-list"><div class="empty-state"><strong>Loading connections...</strong></div></div></section>`;
}

async function loadMinecraftServers() {
  const root = document.getElementById("minecraft-server-list");
  if (!root) return;
  try {
    const response = await fetch("/api/minecraft/servers", { credentials: "same-origin" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    if (!result.length) {
      root.innerHTML = `<div class="empty-state"><strong>No BadApple servers connected</strong>Generate a key in game with /api, then connect it above.</div>`;
      return;
    }
    root.innerHTML = result.map((server) => `<article class="server-card section-spacer">
      <div class="server-card-top"><div class="server-name"><span class="server-glyph">▦</span><span><strong>${esc(server.name)}</strong><small>${esc(server.apiUrl)}</small></span></div><button class="mini-action" data-action="minecraft-unlink" data-id="${esc(server.id)}" aria-label="Disconnect server">×</button></div>
      <div class="row-actions">
        <button class="button button-dark button-small" data-action="minecraft-resource" data-id="${esc(server.id)}" data-resource="server">Status</button>
        <button class="button button-dark button-small" data-action="minecraft-resource" data-id="${esc(server.id)}" data-resource="players">Players</button>
        <button class="button button-dark button-small" data-action="minecraft-resource" data-id="${esc(server.id)}" data-resource="groups">Groups</button>
        <button class="button button-dark button-small" data-action="minecraft-group-create" data-id="${esc(server.id)}">Create group</button>
        <button class="button button-dark button-small" data-action="minecraft-group-prefix" data-id="${esc(server.id)}">Set prefix</button>
        <button class="button button-dark button-small" data-action="minecraft-player-group" data-id="${esc(server.id)}">Assign rank</button>
        <button class="button button-dark button-small" data-action="minecraft-track-action" data-id="${esc(server.id)}" data-track-action="promote">Promote</button>
        <button class="button button-dark button-small" data-action="minecraft-track-action" data-id="${esc(server.id)}" data-track-action="demote">Demote</button>
      </div>
      <pre class="console-output" id="minecraft-output-${esc(server.id)}" aria-live="polite">Choose a server action to load live data.</pre>
    </article>`).join("");
  } catch (error) {
    console.error("Could not load Minecraft API connections:", error);
    root.innerHTML = `<div class="empty-state"><strong>Could not load connected servers</strong>${esc(error.message)}</div>`;
  }
}

async function loadMinecraftResource(id, resource) {
  const output = document.getElementById(`minecraft-output-${id}`);
  if (!output) return;
  output.textContent = "Loading...";
  try {
    const response = await fetch(`/api/minecraft/servers/${encodeURIComponent(id)}/${resource}`, { credentials: "same-origin" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    output.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    output.textContent = `Request failed: ${error.message}`;
  }
}

async function runMinecraftAction(id, action, payload) {
  const response = await fetch(`/api/minecraft/servers/${encodeURIComponent(id)}/actions`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  showToast("Minecraft server action completed.");
  await loadMinecraftResource(id, action.startsWith("set-player") || action === "promote" || action === "demote" ? "players" : "groups");
}

function renderPage() {
  const renderers = { overview: renderOverview, servers: renderServers, files: renderFiles, console: renderConsole, backups: renderBackups, settings: renderSettings, infrastructure: renderInfrastructure, minecraft: renderMinecraft, plans: renderPlans };
  document.getElementById("page-content").innerHTML = renderers[activePage]();
  const serverCount = document.getElementById("server-nav-count");
  serverCount.textContent = String(state.servers.length);
  serverCount.hidden = Boolean(currentUser && !currentUser.demo);
  if (activePage === "infrastructure" && !currentUser?.demo) loadProxmoxStats();
  if (activePage === "plans" && currentUser?.isAdmin && !currentUser.demo) loadAdminPlans();
  if (activePage === "minecraft") {
    if (currentUser?.demo) {
      document.getElementById("minecraft-server-list").innerHTML = `<div class="empty-state"><strong>Sign in with Discord to connect servers</strong>Demo mode cannot access or store API credentials.</div>`;
    } else {
      loadMinecraftServers();
    }
  }
}

async function loadProxmoxStats() {
  const panel = document.getElementById("proxmox-stats");
  if (!panel) return;
  try {
    const response = await fetch("/api/admin/proxmox/status", { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Proxmox stats request failed (${response.status}).`);
    const stats = await response.json();
    if (activePage !== "infrastructure") return;
    const memoryUsed = (stats.memoryUsedBytes / 1024 ** 3).toFixed(1);
    const memoryTotal = (stats.memoryTotalBytes / 1024 ** 3).toFixed(1);
    const uptimeDays = Math.floor(stats.uptimeSeconds / 86400);
    const cpuPercent = Math.min(100, Math.max(0, Number(stats.cpuUsagePercent)));
    const running = stats.status === "running";
    panel.innerHTML = `<div class="panel-heading"><div><h2>Proxmox VM: ${esc(stats.name)} · ${esc(stats.node)}</h2><p>Live metrics · fetched securely by the backend</p></div><span class="server-status ${running ? "" : "offline"}"><i></i>${running ? "Running" : "Stopped"}</span></div><div class="resource-body"><div><div class="resource-label"><span>CPU usage</span><strong>${esc(stats.cpuUsagePercent)}%</strong></div><div class="meter"><span style="width:${cpuPercent}%"></span></div></div><div><div class="resource-label"><span>Memory</span><strong>${esc(memoryUsed)} GB / ${esc(memoryTotal)} GB</strong></div><div class="meter blue"><span style="width:${stats.memoryTotalBytes ? Math.min(100, (stats.memoryUsedBytes / stats.memoryTotalBytes) * 100) : 0}%"></span></div></div><div class="resource-note">VM uptime: ${uptimeDays} days</div></div>`;
  } catch (error) {
    console.error("Could not load Proxmox admin stats:", error);
    if (activePage === "infrastructure") {
      panel.innerHTML = `<div class="empty-state"><strong>Could not load Proxmox metrics</strong>${esc(error.message)} Check the backend configuration and try again.</div>`;
    }
  }
}

function openModal({ title, subtitle, content, submitText = "Create server", cancelText = "Cancel", submitDisabled = false, onSubmit }) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><form class="modal" id="modal-form"><div class="modal-heading"><h2>${title}</h2><button type="button" class="modal-close" data-action="close-modal" aria-label="Close">×</button></div><p class="modal-subtitle">${subtitle}</p>${content}<div class="modal-actions"><button type="button" class="button button-dark button-small" data-action="close-modal">${cancelText}</button><button type="submit" class="button button-primary button-small" ${submitDisabled ? "disabled" : ""}>${submitText}</button></div></form></div>`;
  root.querySelector("#modal-backdrop").addEventListener("click", (event) => {
    if (event.target.id === "modal-backdrop") closeModal();
  });
  root.querySelector("#modal-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!onSubmit) return;
    const form = event.currentTarget;
    const submitButton = form.querySelector("[type=submit]");
    submitButton.disabled = true;
    try {
      await onSubmit(new FormData(form));
    } catch (error) {
      console.error("Could not submit modal form:", error);
      showToast(error.message || "The request could not be completed.");
    } finally {
      if (form.isConnected && !submitDisabled) submitButton.disabled = false;
    }
  });
}

function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

function editPlanModal(plan = null) {
  const isEditing = Boolean(plan);
  const fixedServerCount = isEditing && ["plan-1", "plan-2", "plan-3"].includes(plan.id);
  const serverCountFields = fixedServerCount
    ? `<label for="plan-max-servers">Maximum servers per account</label><input class="form-control" id="plan-max-servers" name="maxServers" type="text" value="${plan.maxServers === null ? "Unlimited" : esc(plan.maxServers)}" readonly>`
    : `<label for="plan-max-servers">Maximum servers per account</label><input class="form-control" id="plan-max-servers" name="maxServers" type="number" min="1" max="100" value="${isEditing && plan.maxServers !== null ? esc(plan.maxServers) : 1}" ${isEditing && plan.maxServers === null ? "disabled" : ""} required>
      <label><input id="plan-unlimited" name="unlimited" type="checkbox" ${isEditing && plan.maxServers === null ? "checked" : ""}> Unlimited server count</label>`;
  openModal({
    title: isEditing ? `Edit ${esc(plan.name)}` : "Create a plan",
    subtitle: "Limits are enforced by the hosting backend when servers are provisioned.",
    submitText: isEditing ? "Save plan" : "Create plan",
    content: `<label for="plan-name">Plan name</label><input class="form-control" id="plan-name" name="name" maxlength="48" value="${isEditing ? esc(plan.name) : ""}" required>
      ${serverCountFields}
      <label for="plan-max-vcpus">Maximum vCPU per server</label><input class="form-control" id="plan-max-vcpus" name="maxVcpusPerServer" type="number" min="1" max="64" value="${isEditing ? esc(plan.maxVcpusPerServer) : 4}" required>
      <label for="plan-max-ram">Maximum RAM per server (MiB)</label><input class="form-control" id="plan-max-ram" name="maxRamMbPerServer" type="number" min="1024" max="524288" value="${isEditing ? esc(plan.maxRamMbPerServer) : 4096}" required>
      <label for="plan-max-disk">Maximum disk per server (GB)</label><input class="form-control" id="plan-max-disk" name="maxDiskGbPerServer" type="number" min="1" max="4096" value="${isEditing ? esc(plan.maxDiskGbPerServer) : 32}" required>`,
    onSubmit: async (data) => {
      const payload = {
        name: String(data.get("name") || ""),
        maxServers: fixedServerCount ? plan.maxServers : data.get("unlimited") === "on" ? null : Number(data.get("maxServers")),
        maxVcpusPerServer: Number(data.get("maxVcpusPerServer")),
        maxRamMbPerServer: Number(data.get("maxRamMbPerServer")),
        maxDiskGbPerServer: Number(data.get("maxDiskGbPerServer")),
      };
      const response = await fetch(isEditing ? `/api/admin/plans/${encodeURIComponent(plan.id)}` : "/api/admin/plans", {
        method: isEditing ? "PUT" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Plan save failed (${response.status}).`);
      closeModal();
      showToast(isEditing ? "Plan updated." : "Plan created.");
      await loadAdminPlans();
    },
  });
  const unlimitedCheckbox = document.getElementById("plan-unlimited");
  const serverLimitInput = document.getElementById("plan-max-servers");
  if (unlimitedCheckbox && serverLimitInput) {
    unlimitedCheckbox.addEventListener("change", () => {
      serverLimitInput.disabled = unlimitedCheckbox.checked;
    });
  }
}

async function assignAccountPlan(discordId, planId) {
  try {
    const response = await fetch(`/api/admin/accounts/${encodeURIComponent(discordId)}/plan`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: planId || null }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Plan assignment failed (${response.status}).`);
    showToast(planId ? "Plan assigned." : "Plan removed.");
    await loadAdminPlans();
  } catch (error) {
    console.error("Could not assign account plan:", error);
    showToast(error.message);
    await loadAdminPlans();
  }
}

function createServerModal() {
  if (currentUser && !currentUser.demo) {
    openModal({
      title: "Create a Minecraft server",
      subtitle: "Your assigned plan will set the limits for each server.",
      content: `<div id="create-server-plan" class="modal-notice">Loading your plan…</div><div class="modal-notice">Automated VM provisioning is being configured. No server or public port will be created yet.</div>`,
      submitText: "Provisioning not ready",
      cancelText: "Close",
      submitDisabled: true,
    });
    fetch("/api/account/plan", { credentials: "same-origin" })
      .then(async (response) => {
        const plan = await response.json();
        if (!response.ok) throw new Error(plan.error || `Plan lookup failed (${response.status}).`);
        const summary = plan.id
          ? `${esc(plan.name)} · ${plan.maxServers === null ? "unlimited servers" : `${esc(plan.maxServers)} server${plan.maxServers === 1 ? "" : "s"}`} · ${esc(plan.maxVcpusPerServer)} vCPU · ${esc(plan.maxRamMbPerServer)} MiB RAM · ${esc(plan.maxDiskGbPerServer)} GB disk per server.`
          : "No hosting plan is assigned to your account yet. Contact the site administrator.";
        const planElement = document.getElementById("create-server-plan");
        if (planElement) planElement.textContent = summary;
      })
      .catch((error) => {
        const planElement = document.getElementById("create-server-plan");
        if (planElement) planElement.textContent = `Could not load your plan: ${error.message}`;
      });
    return;
  }
  openModal({
    title: "Create a server",
    subtitle: "Choose your server details. In this demo, your server is added locally and not provisioned on a host.",
    content: `<label for="server-name">Server name</label><input class="form-control" id="server-name" name="name" maxlength="32" placeholder="e.g. Skyblock Adventure" required>
      <label for="server-software">Server software</label><select class="form-control" id="server-software" name="software"><option>Paper</option><option>Vanilla</option><option>Fabric</option><option>Forge</option><option>Purpur</option></select>
      <label for="server-version">Minecraft version</label><select class="form-control" id="server-version" name="version"><option>1.21.4</option><option>1.21.3</option><option>1.20.1</option><option>1.19.4</option></select>
      <label for="server-ram">Memory allocation</label><select class="form-control" id="server-ram" name="ram"><option value="2">2 GB</option><option value="4" selected>4 GB</option><option value="6">6 GB</option><option value="8">8 GB</option></select>
      <div class="modal-notice">This creates a demo server entry. Live provisioning requires a connected hosting provider.</div>`,
    onSubmit: (data) => {
      const name = String(data.get("name") || "").trim();
      if (!name) return;
      state.servers.push({ id: `server-${Date.now()}`, name, software: String(data.get("software")), version: String(data.get("version")), address: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "new-server"}.stonebridge.gg`, players: 0, maxPlayers: 20, ram: Number(data.get("ram")), status: "offline", cpu: 0 });
      saveState();
      closeModal();
      renderPage();
      showToast(`${name} added to your demo dashboard.`);
    },
  });
}

function uploadModal(kind) {
  const isWorld = kind === "world";
  openModal({
    title: isWorld ? "Upload a world" : "Upload a server JAR",
    subtitle: "Select a file from your device. This demo stores only the file name in your browser.",
    content: `<label for="modal-file">${isWorld ? "World archive (.zip)" : "Server JAR (.jar)"}</label><input class="form-control" id="modal-file" name="file" type="file" accept="${isWorld ? ".zip,.tar,.gz" : ".jar"}" required><div class="modal-notice">Real file transfers require connecting this panel to your server's storage.</div>`,
    submitText: "Add to file list",
    onSubmit: (data) => {
      const file = data.get("file");
      if (!(file instanceof File) || !file.name) return;
      const size = file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`;
      state.files.unshift({ name: file.name, type: isWorld ? "World" : "JAR", size, modified: "Just now" });
      saveState();
      closeModal();
      renderPage();
      showToast(`${file.name} added to the demo file list.`);
    },
  });
}

function addBackup() {
  const now = new Date();
  state.backups.unshift({ name: "Manual backup", detail: `Survival SMP · ${now.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} at ${now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`, size: "1.24 GB" });
  saveState();
  renderPage();
  showToast("Demo backup added to your backup list.");
}

function toggleServer(id) {
  const server = state.servers.find((item) => item.id === id);
  if (!server) return;
  server.status = server.status === "online" ? "offline" : "online";
  if (server.status === "offline") server.players = 0;
  saveState();
  renderPage();
  showToast(`${server.name} is now ${server.status} in the demo.`);
}

function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  for (const file of files) {
    const ext = file.name.split(".").pop().toLowerCase();
    const size = file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`;
    state.files.unshift({ name: file.name, type: ext === "jar" ? "JAR" : ext === "zip" || ext === "gz" ? "World" : "File", size, modified: "Just now" });
  }
  saveState();
  renderPage();
  showToast(`${files.length} file${files.length === 1 ? "" : "s"} added to the demo file list.`);
}

function submitCommand() {
  const input = document.getElementById("console-command");
  const output = document.getElementById("console-output");
  const command = input.value.trim();
  if (!command) return;
  const line = document.createElement("div");
  line.className = "console-line";
  line.innerHTML = `<span class="time">[${new Date().toLocaleTimeString([], { hour12: false })}]</span> <span class="tag">[Demo/INFO]</span>: <span class="command-text"></span>`;
  line.querySelector(".command-text").textContent = `> ${command} — command preview only; not sent to a server.`;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
  input.value = "";
}

document.getElementById("demo-login").addEventListener("click", () => {
  state = loadState();
  currentUser = { name: "Jordan Davis", isAdmin: true, demo: true };
  document.getElementById("login-screen").hidden = true;
  document.getElementById("app").hidden = false;
  document.getElementById("admin-nav").hidden = false;
  document.getElementById("plans-nav").hidden = true;
  document.querySelectorAll(".admin-nav").forEach((item) => item.hidden = false);
  document.querySelectorAll(".auth-nav").forEach((item) => item.hidden = true);
  setAccountIdentity(currentUser.name, "Stonebridge SMP", "Demo admin");
  document.getElementById("session-badge").innerHTML = "<span></span> DEMO MODE";
  document.getElementById("account-mode-notice").hidden = true;
  renderPage();
});
document.getElementById("discord-login").addEventListener("click", (event) => {
  if (window.location.protocol === "file:") {
    event.preventDefault();
    showToast("Discord sign-in requires the Node.js backend to be running.");
  }
});
document.getElementById("sign-out").addEventListener("click", async () => {
  if (currentUser && !currentUser.demo) {
    try {
      const response = await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(`Sign-out failed (${response.status}).`);
    } catch (error) {
      console.error("Could not sign out:", error);
      showToast("Could not sign out. Please try again.");
      return;
    }
  }
  currentUser = null;
  document.getElementById("admin-nav").hidden = true;
  document.getElementById("plans-nav").hidden = true;
  document.querySelectorAll(".admin-nav").forEach((item) => item.hidden = true);
  document.querySelectorAll(".auth-nav").forEach((item) => item.hidden = true);
  document.getElementById("account-mode-notice").hidden = true;
  document.getElementById("app").hidden = true;
  document.getElementById("login-screen").hidden = false;
});
document.getElementById("help-link").addEventListener("click", (event) => {
  event.preventDefault();
  showToast("Help center link will be available when support is connected.");
});

async function restoreDiscordSession() {
  if (window.location.protocol === "file:") return;
  try {
    const response = await fetch("/api/me", { credentials: "same-origin" });
    if (response.status === 401) return;
    if (!response.ok) throw new Error(`Account lookup failed (${response.status}).`);
    const result = await response.json();
    if (!result.authenticated) return;
    currentUser = { ...result.user, demo: false };
    state = emptyLiveState();
    document.getElementById("login-screen").hidden = true;
    document.getElementById("app").hidden = false;
    document.getElementById("admin-nav").hidden = !currentUser.isAdmin;
    document.getElementById("plans-nav").hidden = !currentUser.isAdmin;
    document.querySelectorAll(".admin-nav").forEach((item) => item.hidden = !currentUser.isAdmin);
    document.querySelectorAll(".auth-nav").forEach((item) => item.hidden = false);
    setAccountIdentity(currentUser.username, "My workspace", currentUser.isAdmin ? "Site administrator" : "Discord account");
    document.getElementById("session-badge").innerHTML = "<span></span> DISCORD SIGN-IN";
    document.getElementById("account-mode-notice").hidden = false;
    if (new URLSearchParams(window.location.search).has("auth")) showToast("Discord sign-in failed. Please try again.");
    renderPage();
  } catch (error) {
    console.error("Could not restore Discord session:", error);
  }
}
restoreDiscordSession();

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-page]");
  if (nav) {
    event.preventDefault();
    setPage(nav.dataset.page);
    return;
  }
  const control = event.target.closest("[data-action]");
  if (!control) return;
  const { action, id } = control.dataset;
  if (action === "create-server") createServerModal();
  else if (action === "create-plan") editPlanModal();
  else if (action === "edit-plan") editPlanModal(adminPlans.find((plan) => plan.id === id));
  else if (action === "upload-jar") uploadModal("jar");
  else if (action === "upload-world") uploadModal("world");
  else if (action === "close-modal") closeModal();
  else if (action === "toggle-server") toggleServer(id);
  else if (action === "create-backup" || action === "quick-backup") addBackup();
  else if (action === "toggle-setting") control.classList.toggle("on");
  else if (action === "save-settings") showToast("Workspace settings saved in demo mode.");
  else if (action === "setting-info") showToast("This preference will be available when account services are connected.");
  else if (action === "activity-info") showToast("Showing recent workspace activity.");
  else if (action === "clear-console") document.getElementById("console-output").innerHTML = "";
  else if (action === "server-menu") showToast("Server actions are available from the server card.");
  else if (action === "backup-menu") showToast("Restore and download require a connected server host.");
  else if (action === "file-menu") showToast("File actions require a connected server host.");
  else if (action === "new-folder") showToast("Folder creation requires a connected server host.");
  else if (action === "minecraft-resource") loadMinecraftResource(id, control.dataset.resource);
  else if (action === "minecraft-unlink") {
    if (window.confirm("Disconnect this Minecraft server?")) {
      fetch(`/api/minecraft/servers/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" })
        .then((response) => {
          if (!response.ok) throw new Error(`Disconnect failed (${response.status}).`);
          loadMinecraftServers();
        })
        .catch((error) => showToast(error.message));
    }
  } else if (action === "minecraft-group-create") {
    const name = window.prompt("New group name:");
    if (name) runMinecraftAction(id, "create-group", { name }).catch((error) => showToast(error.message));
  } else if (action === "minecraft-group-prefix") {
    const name = window.prompt("Group name:");
    const prefix = name && window.prompt("New group prefix:");
    if (name && prefix !== null) runMinecraftAction(id, "set-prefix", { name, prefix }).catch((error) => showToast(error.message));
  } else if (action === "minecraft-player-group") {
    const player = window.prompt("Online player name:");
    const group = player && window.prompt("Existing group name:");
    if (player && group) runMinecraftAction(id, "set-player-group", { player, group }).catch((error) => showToast(error.message));
  } else if (action === "minecraft-track-action") {
    const player = window.prompt("Online player name:");
    const track = player && window.prompt("Track name:");
    if (player && track) runMinecraftAction(id, control.dataset.trackAction, { player, track }).catch((error) => showToast(error.message));
  }
});

document.addEventListener("submit", (event) => {
  if (event.target.id === "minecraft-connect-form") {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const submitButton = form.querySelector("[type=submit]");
    submitButton.disabled = true;
    fetch("/api/minecraft/servers", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        apiUrl: data.get("apiUrl"),
        apiKey: data.get("apiKey"),
      }),
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Connection failed (${response.status}).`);
        form.reset();
        showToast("Minecraft server connected.");
        return loadMinecraftServers();
      })
      .catch((error) => showToast(error.message))
      .finally(() => { submitButton.disabled = false; });
  }
  if (event.target.id === "console-form") {
    event.preventDefault();
    submitCommand();
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "file-search") {
    const query = event.target.value.toLowerCase();
    document.getElementById("file-table-body").innerHTML = fileTableRows(state.files.filter((file) => file.name.toLowerCase().includes(query)));
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "file-upload") addFiles(event.target.files);
  if (event.target.matches("[data-account-plan]")) {
    assignAccountPlan(event.target.dataset.accountPlan, event.target.value);
  }
});

document.addEventListener("dragover", (event) => {
  const zone = event.target.closest("#drop-zone");
  if (zone) {
    event.preventDefault();
    zone.classList.add("dragover");
  }
});
document.addEventListener("dragleave", (event) => {
  const zone = event.target.closest("#drop-zone");
  if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("dragover");
});
document.addEventListener("drop", (event) => {
  const zone = event.target.closest("#drop-zone");
  if (!zone) return;
  event.preventDefault();
  zone.classList.remove("dragover");
  addFiles(event.dataTransfer.files);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});
