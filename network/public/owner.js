(() => {
  "use strict";
  let session = null;
  let expiryTimer = null;
  let serverCache = [];
  const $ = id => document.getElementById(id);
  const fmtBytes = value => {
    if (value === null || value === undefined) return "—";
    const units = ["B","KB","MB","GB","TB"]; let n = Number(value), i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
  };
  const ago = value => {
    if (!value) return "Never";
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
    return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds/60)}m ago` : `${Math.floor(seconds/3600)}h ago`;
  };
  function notify(message) {
    $("notice").textContent = message; $("notice").classList.add("show");
    setTimeout(() => $("notice").classList.remove("show"), 3000);
  }
  async function api(path, options = {}) {
    const headers = { ...(options.body ? {"Content-Type":"application/json"} : {}), ...(session ? {Authorization:`Bearer ${session}`} : {}), ...(options.headers || {}) };
    const response = await fetch(path, {...options, headers, cache:"no-store"});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && session) signOut();
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
  }
  function showDashboard() {
    $("login-panel").classList.add("hidden"); $("dashboard").classList.remove("hidden"); $("logout").classList.remove("hidden");
  }
  function signOut() {
    session = null; clearTimeout(expiryTimer);
    $("dashboard").classList.add("hidden"); $("logout").classList.add("hidden"); $("login-panel").classList.remove("hidden");
    $("owner-key").value = "";
  }
  function renderServers(servers) {
    $("m-total").textContent = servers.length;
    $("m-online").textContent = servers.filter(s => s.status === "online").length;
    $("m-offline").textContent = servers.filter(s => !["online","disabled"].includes(s.status)).length;
    $("m-cpu").textContent = servers.reduce((n,s) => n + (Number(s.cpu_cores) || 0),0);
    const list = $("server-list"); list.replaceChildren();
    if (!servers.length) { const empty=document.createElement("div"); empty.className="empty"; empty.textContent="No servers registered yet. Create an enrollment ticket to add your first server."; list.append(empty); return; }
    for (const server of servers) {
      const card=document.createElement("article"); card.className="server";
      const top=document.createElement("div"); top.className="server-top";
      const name=document.createElement("div"); name.className="server-name"; name.textContent=server.label || server.hostname || server.id;
      const status=document.createElement("span"); status.className=`pill ${server.status || "pending"}`; status.textContent=server.status || "unknown";
      top.append(name,status); card.append(top);
      const facts=document.createElement("div"); facts.className="facts";
      const values=[
        ["Provider",server.provider || "—"],["Hostname",server.hostname || "Pending"],["OS",`${server.os_name || "—"} ${server.os_release || ""}`],
        ["CPU",server.cpu_cores ? `${server.cpu_cores} cores · load ${(server.load_average || []).map(n => Number(n).toFixed(2)).join("/") || "—"}` : "—"],["RAM",server.memory_total_bytes ? `${fmtBytes(server.memory_available_bytes)} free / ${fmtBytes(server.memory_total_bytes)}` : "—"],
        ["Disk",server.disk_total_bytes ? `${fmtBytes(server.disk_available_bytes)} free / ${fmtBytes(server.disk_total_bytes)}` : "—"],
        ["Agent",server.agent_version || "—"],["Heartbeat",ago(server.last_heartbeat_at)],["Server ID",server.id]
      ];
      for(const [label,value] of values){const item=document.createElement("div"),k=document.createElement("span"),v=document.createElement("b");k.textContent=label;v.textContent=value;item.append(k,v);facts.append(item)}
      card.append(facts);
      const actions=document.createElement("div");actions.className="server-actions";
      if(server.status!=="disabled"){const button=document.createElement("button");button.className="ghost";button.textContent="Revoke server";button.addEventListener("click",()=>revoke(server.id,server.label || server.id));actions.append(button)}
      card.append(actions);list.append(card);
    }
    $("last-updated").textContent=`Updated ${new Date().toLocaleTimeString()}`;
  }
  function renderBots(bots) {
    const list = $("bot-list"); list.replaceChildren();
    if (!bots.length) { const empty=document.createElement("div"); empty.className="empty"; empty.textContent="No customer bot instances have been registered yet."; list.append(empty); return; }
    const online = serverCache.filter(server => server.status === "online");
    for (const bot of bots) {
      const card=document.createElement("article"); card.className="server";
      const top=document.createElement("div"); top.className="server-top";
      const name=document.createElement("div"); name.className="server-name"; name.textContent=bot.display_name || bot.phone_e164 || bot.id;
      const status=document.createElement("span"); status.className=`pill ${bot.status || "offline"}`; status.textContent=bot.status || "unknown";
      top.append(name,status); card.append(top);
      const facts=document.createElement("div"); facts.className="facts";
      for (const [label,value] of [["WhatsApp",bot.phone_e164],["Bot ID",bot.id],["Assigned server",bot.server_label || "Not assigned"]]) {
        const item=document.createElement("div"),k=document.createElement("span"),v=document.createElement("b");
        k.textContent=label; v.textContent=value || "—"; item.append(k,v); facts.append(item);
      }
      card.append(facts);
      const actions=document.createElement("div"); actions.className="server-actions";
      const select=document.createElement("select"); select.setAttribute("aria-label","Choose hosting server");
      const placeholder=document.createElement("option"); placeholder.value=""; placeholder.textContent=online.length ? "Choose online server…" : "No online server"; select.append(placeholder);
      for (const server of online) {
        const option=document.createElement("option"); option.value=server.id;
        option.textContent=`${server.label || server.hostname} · ${server.cpu_cores || "?"} CPU · ${fmtBytes(server.memory_available_bytes)} free`;
        if (server.id === bot.server_id) option.selected=true;
        select.append(option);
      }
      const button=document.createElement("button"); button.className="secondary"; button.textContent=bot.whatsapp_registered ? "Session migration required" : bot.status === "failed" && select.value===bot.server_id ? "Reprovision" : "Assign server"; button.disabled=!online.length || Boolean(bot.whatsapp_registered) || (select.value===bot.server_id && bot.status !== "failed");
      select.disabled=Boolean(bot.whatsapp_registered);
      select.addEventListener("change",()=>{button.disabled=!online.length || Boolean(bot.whatsapp_registered) || (select.value===bot.server_id && bot.status !== "failed");});
      button.addEventListener("click",()=>assignBot(bot.id,select.value,button));
      actions.append(select,button); card.append(actions); list.append(card);
    }
  }
  async function refresh() {
    $("refresh").disabled=true;
    try {
      const [servers,bots]=await Promise.all([api("/v1/owner/servers"),api("/v1/owner/bots")]);
      serverCache=servers.servers || []; renderServers(serverCache); renderBots(bots.bots || []);
    } catch(error){notify(error.message)}
    finally{$("refresh").disabled=false}
  }
  async function assignBot(botId, serverId, button) {
    if (!serverId) { notify("Choose an online server first."); return; }
    if (!confirm("Assign this customer bot to the selected server?")) return;
    button.disabled=true;
    try {
      await api(`/v1/owner/bots/${encodeURIComponent(botId)}/assign-server`,{method:"POST",body:JSON.stringify({server_id:serverId})});
      notify("Bot assigned to server."); await refresh();
    } catch(error){
      notify(error.message === "server_low_memory" ? "Not enough free RAM on that server. Choose another server or free up memory." : error.message === "server_not_online" ? "That server is offline. Refresh and choose an online server." : error.message);
    }
    finally{button.disabled=false}
  }
  async function revoke(id,label) {
    if(!confirm(`Revoke ${label}? Its agent credential will stop working.`))return;
    try{await api(`/v1/owner/servers/${encodeURIComponent(id)}/revoke`,{method:"POST"});notify("Server access revoked.");await refresh()}
    catch(error){notify(error.message)}
  }
  $("login-form").addEventListener("submit",async event=>{
    event.preventDefault();$("login-error").textContent="";
    const button=event.submitter;button.disabled=true;
    try{
      const result=await api("/v1/owner/login",{method:"POST",body:JSON.stringify({access_key:$("owner-key").value})});
      session=result.access_token;$("owner-key").value="";showDashboard();
      expiryTimer=setTimeout(()=>{signOut();notify("Owner session expired. Sign in again.")},(result.expires_in_seconds || 1800)*1000);
      await refresh();
    }catch(error){$("login-error").textContent=error.message}
    finally{button.disabled=false}
  });
  $("logout").addEventListener("click",signOut);
  $("refresh").addEventListener("click",refresh);
  $("ticket-form").addEventListener("submit",async event=>{
    event.preventDefault();$("ticket-error").textContent="";
    const button=event.submitter;button.disabled=true;
    try{
      const result=await api("/v1/owner/server-enrollment-tickets",{method:"POST",body:JSON.stringify({label:$("server-label").value,provider:$("server-provider").value})});
      $("ticket-value").textContent=result.ticket;$("ticket-expiry").textContent=`Expires: ${new Date(result.expires_at).toLocaleString()}`;
      $("ticket-result").classList.remove("hidden");notify("One-time enrollment ticket created.");
    }catch(error){$("ticket-error").textContent=error.message}
    finally{button.disabled=false}
  });
  $("copy-ticket").addEventListener("click",async()=>{
    try{await navigator.clipboard.writeText($("ticket-value").textContent);notify("Ticket copied. Keep it secret.")}
    catch{notify("Clipboard unavailable. Select and copy the ticket manually.")}
  });
  setInterval(()=>{if(session)refresh()},30000);
  fetch("/healthz",{cache:"no-store"}).then(r=>r.json()).then(data=>{$("api-state").textContent="API online";$("api-state").classList.add("online");$("version").textContent=data.version || "—"}).catch(()=>{$("api-state").textContent="API unavailable"});
})();