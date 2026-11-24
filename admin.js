const API = "https://tokendesk.onrender.com";
const $ = (id) => document.getElementById(id);
let adminSecret = "";

function showMessage(text, type = "") {
  $("adminMessage").textContent = text;
  $("adminMessage").className = `message ${type}`.trim();
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}
async function adminFetch(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": adminSecret,
      ...(options.headers || {})
    }
  });
  let data = {};
  try { data = await response.json(); } catch { /* ignore non-JSON */ }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function loadRequests() {
  $("requestsList").innerHTML = '<p class="muted">Loading…</p>';
  try {
    const data = await adminFetch("/api/admin/subscription-requests");
    if (!data.requests.length) {
      $("requestsList").innerHTML = '<div class="empty-state"><strong>No pending requests</strong><p class="muted">New requests will appear here.</p></div>';
      return true;
    }
    $("requestsList").innerHTML = data.requests.map((r) => `
      <article class="admin-request">
        <h3>${escapeHtml(r.request_code)}</h3>
        <p><strong>Shop:</strong> ${escapeHtml(r.shop_name)}</p>
        <p><strong>Owner:</strong> ${escapeHtml(r.owner_name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(r.email)}</p>
        <p><strong>Plan:</strong> ${Number(r.plan_days)} days</p>
        <p><strong>Amount:</strong> ₹${Number(r.amount_inr)}</p>
        <p class="muted small">Created: ${new Date(r.created_at).toLocaleString()}</p>
        <button class="primary-btn issue-code-btn" type="button" data-request-code="${escapeHtml(r.request_code)}">Payment verified — generate code</button>
      </article>`).join("");

    document.querySelectorAll(".issue-code-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        const requestCode = button.dataset.requestCode;
        const confirmed = window.confirm(`Have you checked your UPI/bank app and confirmed the exact amount for ${requestCode} is received? Only continue after real verification.`);
        if (!confirmed) return;
        button.disabled = true;
        try {
          const result = await adminFetch(`/api/admin/subscription-requests/${encodeURIComponent(requestCode)}/issue-code`, { method: "POST", body: "{}" });
          $("issuedCode").textContent = result.activationCode;
          $("issuedDetails").textContent = `${result.planDays}-day plan. Expires: ${new Date(result.expiresAt).toLocaleString()}. Send this code to the matching customer only.`;
          $("issuedPanel").classList.remove("hidden");
          $("issuedPanel").scrollIntoView({ behavior: "smooth", block: "start" });
          await loadRequests();
        } catch (error) {
          showMessage(error.message, "error");
          button.disabled = false;
        }
      });
    });
    return true;
  } catch (error) {
    $("requestsList").innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`;
    return false;
  }
}

$("adminLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  adminSecret = $("adminSecret").value;
  showMessage("Checking admin access…");
  try {
    const loaded = await loadRequests();
    if (!loaded) throw new Error("Could not open requests. Check the admin key and backend deployment.");
    $("requestsPanel").classList.remove("hidden");
    $("adminSecret").value = "";
    showMessage("Admin access verified. Keep this page private.", "success");
  } catch (error) {
    adminSecret = "";
    showMessage(error.message, "error");
  }
});

$("reloadRequests").addEventListener("click", loadRequests);
$("copyIssuedCode").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("issuedCode").textContent);
    $("issuedDetails").textContent += " Code copied.";
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents($("issuedCode"));
    selection.removeAllRanges();
    selection.addRange(range);
    $("issuedDetails").textContent = "Select and copy the displayed code.";
  }
});
