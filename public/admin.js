const API = "https://tokendesk.onrender.com";
const $ = (id) => document.getElementById(id);
let adminSecret = "";
let latestActivationCode = "";

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[ch]));
}
function showMessage(message, type = "") {
  const box = $("adminMessage");
  box.textContent = message;
  box.className = `message ${type}`;
  box.hidden = false;
}
async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": adminSecret,
      ...(options.headers || {})
    }
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}
async function loadRequests() {
  if (!adminSecret) {
    showMessage("Pehle Admin Secret enter karo.", "error");
    return;
  }
  const list = $("requestsList");
  list.innerHTML = '<div class="empty">Loading requests…</div>';
  $("refreshRequestsBtn").disabled = true;
  $("openRequestsBtn").disabled = true;
  try {
    const data = await api("/api/admin/subscription-requests");
    const requests = Array.isArray(data.requests) ? data.requests : [];
    if (!requests.length) {
      list.innerHTML = '<div class="empty">Abhi koi pending request nahi hai.</div>';
      showMessage("Pending requests successfully loaded.", "success");
      return;
    }
    list.innerHTML = requests.map(r => {
      const requestCode = escapeHTML(r.request_code);
      const utr = escapeHTML(r.utr || "");
      return `
        <article class="request">
          <div class="request-head">
            <strong class="code">${requestCode}</strong>
            <strong>₹${escapeHTML(r.amount_inr)}</strong>
          </div>
          <div class="details">
            <div class="detail"><small>Shop</small>${escapeHTML(r.shop_name)}</div>
            <div class="detail"><small>Owner</small>${escapeHTML(r.owner_name)}</div>
            <div class="detail"><small>Email</small>${escapeHTML(r.email)}</div>
            <div class="detail"><small>Plan</small>${escapeHTML(r.plan_days)} days</div>
            <div class="detail"><small>UTR / Transaction ID</small><strong>${utr || "Not provided"}</strong></div>
            <div class="detail"><small>Created</small>${escapeHTML(formatDate(r.created_at))}</div>
            <div class="detail"><small>Request expires</small>${escapeHTML(formatDate(r.expires_at))}</div>
          </div>
          <div class="actions">
            <button class="secondary" type="button" data-copy-utr="${requestCode}" data-utr="${utr}" ${utr ? "" : "disabled"}>Copy UTR</button>
            <button class="primary" type="button" data-issue="${requestCode}">Issue activation code</button>
            <button class="danger" type="button" data-cancel="${requestCode}">Cancel request</button>
          </div>
        </article>`;
    }).join("");
    showMessage(`${requests.length} pending request(s) loaded. Payment verify karke hi code issue karna.`, "success");
  } catch (error) {
    list.innerHTML = '<div class="empty">Requests load nahi ho paayi.</div>';
    showMessage(error.message, "error");
  } finally {
    $("refreshRequestsBtn").disabled = false;
    $("openRequestsBtn").disabled = false;
  }
}
async function issueCode(requestCode) {
  const confirmed = confirm(`Kya tumne receiving account mein is request ka payment verify kar liya hai?\n\n${requestCode}\n\nSirf actual payment confirm hone par OK karo.`);
  if (!confirmed) return;
  try {
    const data = await api(`/api/admin/subscription-requests/${encodeURIComponent(requestCode)}/issue-code`, {
      method: "POST", body: JSON.stringify({})
    });
    latestActivationCode = data.activationCode || "";
    $("activationResult").textContent =
      `Request: ${requestCode}\nActivation code: ${latestActivationCode}\nPlan: ${data.planDays} days\nExpires: ${formatDate(data.expiresAt)}`;
    $("activationResultCard").hidden = false;
    showMessage("Activation code issue ho gaya. Code ko shop owner tak safely pahunchao.", "success");
    await loadRequests();
  } catch (error) {
    showMessage(error.message, "error");
  }
}
async function cancelRequest(requestCode) {
  if (!confirm(`Request ${requestCode} cancel karni hai? Cancel hone ke baad is par activation code issue nahi ho sakega.`)) return;
  try {
    await api(`/api/admin/subscription-requests/${encodeURIComponent(requestCode)}/cancel`, {
      method: "POST", body: JSON.stringify({})
    });
    showMessage(`${requestCode} cancelled successfully.`, "success");
    await loadRequests();
  } catch (error) {
    showMessage(error.message, "error");
  }
}
$("adminLoginForm").addEventListener("submit", async event => {
  event.preventDefault();
  adminSecret = $("adminSecret").value.trim();
  if (!adminSecret) {
    showMessage("Admin Secret enter karo.", "error");
    return;
  }
  await loadRequests();
});
$("refreshRequestsBtn").addEventListener("click", loadRequests);
$("clearAdminBtn").addEventListener("click", () => {
  adminSecret = "";
  $("adminSecret").value = "";
  $("requestsList").innerHTML = '<div class="empty">Admin authentication ke baad requests yahan dikhenge.</div>';
  $("activationResultCard").hidden = true;
  showMessage("Admin secret cleared.", "");
});
$("requestsList").addEventListener("click", async event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.copyUtr) {
    const utr = button.dataset.utr || "";
    if (utr) {
      try { await navigator.clipboard.writeText(utr); showMessage("UTR copied.", "success"); }
      catch { showMessage("Clipboard access nahi mila. UTR ko manually select karke copy karo.", "error"); }
    }
  } else if (button.dataset.issue) {
    await issueCode(button.dataset.issue);
  } else if (button.dataset.cancel) {
    await cancelRequest(button.dataset.cancel);
  }
});
$("copyActivationBtn").addEventListener("click", async () => {
  if (!latestActivationCode) return;
  try {
    await navigator.clipboard.writeText(latestActivationCode);
    showMessage("Activation code copied.", "success");
  } catch {
    showMessage("Clipboard access nahi mila. Code ko manually select karke copy karo.", "error");
  }
});
