(() => {
"use strict";
const $ = id => document.getElementById(id);
let token = null;
let pairingPollActive = false;
let pairingCompletionId = null;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "request_failed");
  return body;
}
function showError(id, message) { $(id).textContent = message; }
function showWorkspace() {
  $("auth").classList.add("hidden");
  $("workspace").classList.remove("hidden");
  $("logout").classList.remove("hidden");
}
async function loadDashboard() {
  const data = await api("/v1/customer/me");
  const c = data.customer, b = data.bot;
  $("customer-name").textContent = c.display_name || "there";
  $("customer-phone").textContent = c.phone_e164;
  
  $("account-status").textContent = b?.whatsapp_registered ? "Linked successfully" : "Not linked";
  $("bot-status").textContent = b?.status || "Not assigned";
  $("bot-version").textContent = b?.release_version ? `Version ${b.release_version}` : "Your assigned instance";
  $("runtime-status").textContent = b?.status || "Not provisioned";
  $("pairing-panel").classList.toggle("hidden", !b?.server_assigned || !b.runtime_provisioned || b.whatsapp_registered);
  $("unassigned-note").classList.toggle("hidden", Boolean(b?.server_assigned));
  $("provision-note").classList.toggle("hidden", !b?.server_assigned || Boolean(b.runtime_provisioned));
  $("pair-status").textContent = data.latest_pairing?.status || "None";
  $("pair-result").classList.toggle("hidden", !data.latest_pairing);
  if (data.latest_pairing) {
    $("pair-result").textContent = `Pairing request: ${data.latest_pairing.status}.`;
    if (data.latest_pairing.status === "code_ready") {
      void fetchPairingCode(data.latest_pairing.id);
      void waitForPairingCompletion(data.latest_pairing.id);
    }
    else if (["queued", "generating"].includes(data.latest_pairing.status)) void waitForPairingCode(data.latest_pairing.id);
  }
  if (b?.id) $("pair-phone").value = c.phone_e164;
  showWorkspace();
}
$("phone-access-form").addEventListener("submit", async event => {
  event.preventDefault(); showError("auth-error", "");
  const button = event.submitter;
  if (button) button.disabled = true;
  try {
    const result = await api("/v1/customer/phone-access", {
      method: "POST",
      body: JSON.stringify({ phone: $("phone-access-number").value.trim() })
    });
    token = result.access_token;
    await loadDashboard();
  } catch (error) {
    const messages = {
      invalid_phone: "Enter a valid international WhatsApp number, e.g. +94771234567.",
      phone_already_registered_unverified: "This number already has an unfinished bot registration. Contact the owner to recover it.",
      rate_limited: "Too many attempts. Wait one minute and try again.",
      customer_auth_unavailable: "The customer service is temporarily unavailable. Try again shortly."
    };
    showError("auth-error", messages[error.message] || "Could not continue. Check the number and try again.");
  } finally { if (button) button.disabled = false; }
});
$("logout").addEventListener("click", async () => {
  try { await api("/v1/customer/logout", { method: "POST", body: "{}" }); } catch {}
  token = null;
  $("workspace").classList.add("hidden");
  $("auth").classList.remove("hidden");
  $("logout").classList.add("hidden");
});
async function fetchPairingCode(pairingId) {
  try {
    const result = await api(`/v1/customer/pairing-requests/${encodeURIComponent(pairingId)}/code`);
    $("pair-result").classList.remove("hidden");
    $("pair-result").textContent = `Your WhatsApp pairing code: ${result.code} · Expires ${new Date(result.expires_at).toLocaleTimeString()}. Enter it in WhatsApp → Linked devices → Link with phone number.`;
    return true;
  } catch (error) {
    if (error.message === "pairing_code_expired_or_already_viewed") {
      $("pair-result").classList.remove("hidden");
      $("pair-result").textContent = "This one-time pairing code has expired or has already been displayed. Start a new pairing request if needed.";
      return true;
    }
    return false;
  }
}
async function waitForPairingCompletion(pairingId) {
  if (pairingCompletionId === pairingId) return;
  pairingCompletionId = pairingId;
  try {
    for (let attempt = 0; attempt < 90 && token; attempt += 1) {
      await wait(3000);
      const dashboard = await api("/v1/customer/me");
      const latest = dashboard.latest_pairing;
      if (!latest || latest.id !== pairingId) return;
      $("pair-status").textContent = latest.status;
      if (["paired", "expired", "failed", "cancelled"].includes(latest.status)) {
        $("pair-result").textContent = latest.status === "paired"
          ? "WhatsApp linked successfully. Your bot is OFF until the network owner activates it."
          : `Pairing request status: ${latest.status}. You can request a new code if needed.`;
        await loadDashboard();
        return;
      }
    }
  } catch {
    if (token) $("pair-error").textContent = "Could not refresh pairing status. Refresh your dashboard to check again.";
  } finally { if (pairingCompletionId === pairingId) pairingCompletionId = null; }
}
async function waitForPairingCode(pairingId) {
  if (pairingPollActive) return;
  pairingPollActive = true;
  try {
    for (let attempt = 0; attempt < 90 && token; attempt += 1) {
      await wait(2000);
      const dashboard = await api("/v1/customer/me");
      const latest = dashboard.latest_pairing;
      if (!latest || latest.id !== pairingId) break;
      if (latest.status === "code_ready") {
        if (await fetchPairingCode(pairingId)) { void waitForPairingCompletion(pairingId); return; }
      }
      if (["paired", "expired", "failed", "cancelled"].includes(latest.status)) {
        $("pair-result").textContent = `Pairing request status: ${latest.status}.`;
        return;
      }
      $("pair-status").textContent = latest.status;
    }
  } catch {
    if (token) $("pair-error").textContent = "Connection to the pairing worker was interrupted. Refresh your dashboard to check the status.";
  } finally { pairingPollActive = false; }
}
$("pair-form").addEventListener("submit", async event => {
  event.preventDefault(); showError("pair-error", "");
  try {
    const result = await api("/v1/customer/pairing-requests", { method: "POST", body: JSON.stringify({ phone: $("pair-phone").value }) });
    $("pair-result").classList.remove("hidden");
    $("pair-result").textContent = `Request received. Status: ${result.request.status}. Waiting for your assigned server to generate the real WhatsApp pairing code...`;
    $("pair-status").textContent = result.request.status;
    void waitForPairingCode(result.request.id);
  } catch (error) {
    showError("pair-error", error.message === "invalid_phone" ? "Enter a valid international number, e.g. +94771234567." : error.message === "server_unavailable" ? "Your bot is not assigned to an online server yet. Please contact support." : error.message === "worker_not_ready" ? "Your server bot worker is starting or disconnected. Please try again shortly." : error.message === "bot_not_ready" ? "Your bot is still being prepared or is already connecting. Refresh the dashboard and try again." : error.message === "already_paired" ? "Your WhatsApp account is already linked. Contact the network owner if you need it activated." : "Could not create the pairing request. Please try again.");
  }
});
})();