(() => {
  "use strict";
  let session = null;
  let expiryTimer = null;
  const $ = id => document.getElementById(id);
  const fmt = value => {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return "—";
    return n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(2) + " GB" : (n / 1024 ** 2).toFixed(0) + " MB";
  };
  async function api(path, options = {}) {
    const headers = { ...(options.body ? {"Content-Type":"application/json"} : {}), ...(session ? {Authorization:`Bearer ${session}`} : {}) };
    const response = await fetch(path, {...options, headers, cache:"no-store"});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  function signOut() {
    session = null; clearTimeout(expiryTimer);
    $("dashboard").classList.add("hidden");
    $("logout").classList.add("hidden");
    $("login-panel").classList.remove("hidden");
    $("owner-key").value = "";
  }
  async function refresh() {
    $("refresh").disabled = true;
    $("dashboard-error").textContent = "";
    try {
      const [serverData, botData] = await Promise.all([api("/v1/owner/servers"), api("/v1/owner/bots")]);
      const servers = serverData.servers || [];
      const bots = botData.bots || [];
      const total = servers.reduce((sum, server) => sum + Number(server.memory_total_bytes || 0), 0);
      const free = servers.reduce((sum, server) => sum + Number(server.memory_available_bytes || 0), 0);
      const used = Math.max(0, total - free);
      const running = bots.filter(bot => bot.status === "online").length;
      $("m-ram").textContent = total ? `${fmt(used)} / ${fmt(total)}` : "No server data";
      $("m-ram-detail").textContent = total ? `${fmt(free)} available across ${servers.length} server(s)` : "Waiting for server heartbeat";
      $("m-running").textContent = String(running);
      $("m-running-detail").textContent = `${bots.length} bot instance(s) registered`;
      $("last-updated").textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      $("dashboard-error").textContent = error.message === "owner_authentication_required" ? "Owner session expired. Sign in again." : error.message;
      if (error.message === "owner_authentication_required") signOut();
    } finally { $("refresh").disabled = false; }
  }
  $("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    $("login-error").textContent = "";
    const button = event.submitter;
    button.disabled = true;
    try {
      const result = await api("/v1/owner/login", {method:"POST", body:JSON.stringify({access_key:$("owner-key").value})});
      session = result.access_token;
      $("owner-key").value = "";
      $("login-panel").classList.add("hidden");
      $("dashboard").classList.remove("hidden");
      $("logout").classList.remove("hidden");
      expiryTimer = setTimeout(signOut, (result.expires_in_seconds || 1800) * 1000);
      await refresh();
    } catch (error) {
      $("login-error").textContent = error.message === "invalid_owner_credentials" ? "Invalid owner key. Check the key and try again." : error.message;
    } finally { button.disabled = false; }
  });
  async function botAction(action) {
    const id = $("bot-public-id").value.trim().toUpperCase();
    const result = $("bot-control-result");
    if (!/^HASA-[0-9]{4,}$/.test(id)) { result.textContent = "Enter a valid Bot ID, e.g. HASA-0001."; return; }
    $("bot-on").disabled = $("bot-off").disabled = true;
    result.textContent = "Sending " + action.toUpperCase() + " request…";
    try {
      await api("/v1/owner/bots/" + encodeURIComponent(id) + "/actions", {method:"POST", body:JSON.stringify({action})});
      result.textContent = "Request queued for " + id + ". Waiting for worker confirmation.";
      await refresh();
    } catch (error) {
      result.textContent = error.message === "bot_not_found" ? "Bot ID not found." : error.message;
    } finally { $("bot-on").disabled = $("bot-off").disabled = false; }
  }
  $("bot-on").addEventListener("click", () => void botAction("start"));
  $("bot-off").addEventListener("click", () => void botAction("stop"));
  $("logout").addEventListener("click", signOut);
  $("refresh").addEventListener("click", refresh);
  async function checkHealth() {
    try {
      const [healthResponse, readyResponse] = await Promise.all([
        fetch("/healthz", {cache:"no-store"}),
        fetch("/readyz", {cache:"no-store"})
      ]);
      const health = await healthResponse.json();
      const ready = await readyResponse.json();
      const ok = healthResponse.ok && health.status === "ok" && readyResponse.ok && ready.ready === true;
      $("api-state").textContent = ok ? "Service ready" : "Service error";
      $("api-state").classList.toggle("online", ok);
      $("api-state").classList.toggle("offline", !ok);
    } catch {
      $("api-state").textContent = "Service error";
      $("api-state").classList.add("offline");
    }
  }
  void checkHealth();
  setInterval(checkHealth, 30000);
  setInterval(() => { if (session) void refresh(); }, 30000);
})();