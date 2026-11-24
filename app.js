const API = "https://tokendesk.onrender.com";
// This is publicly visible on the website. Use an approved business contact number.
const WHATSAPP_NUMBER = "918090279768";
const $ = (id) => document.getElementById(id);
let authToken = localStorage.getItem("tokendesk_token") || "";
let currentShopCode = "";
let currentShopName = "";
let toastTimer;

function setMessage(element, text, type = "") {
  element.textContent = text;
  element.className = `message ${type}`.trim();
}
function showToast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const response = await fetch(`${API}${path}`, { ...options, headers });
  let data = {};
  try { data = await response.json(); } catch { /* non-JSON response */ }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function switchAuth(showRegister) {
  $("loginForm").classList.toggle("hidden", showRegister);
  $("registerForm").classList.toggle("hidden", !showRegister);
  $("showLogin").classList.toggle("active", !showRegister);
  $("showRegister").classList.toggle("active", showRegister);
  setMessage($("authMessage"), "");
}
$("showLogin").addEventListener("click", () => switchAuth(false));
$("showRegister").addEventListener("click", () => switchAuth(true));

$("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  setMessage($("authMessage"), "Creating your account…");
  try {
    const registeredEmail = $("registerEmail").value;
    await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        shopName: $("shopName").value,
        ownerName: $("ownerName").value,
        email: registeredEmail,
        password: $("registerPassword").value
      })
    });
    $("registerForm").reset();
    switchAuth(false);
    $("loginEmail").value = registeredEmail;
    setMessage($("authMessage"), "Account created. Please log in.", "success");
  } catch (error) {
    setMessage($("authMessage"), error.message, "error");
  } finally {
    button.disabled = false;
  }
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  setMessage($("authMessage"), "Logging in…");
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: $("loginEmail").value, password: $("loginPassword").value })
    });
    authToken = data.token;
    localStorage.setItem("tokendesk_token", authToken);
    await showDashboard();
  } catch (error) {
    setMessage($("authMessage"), error.message, "error");
  } finally {
    button.disabled = false;
  }
});

async function showDashboard() {
  const data = await api("/api/shop/me");
  currentShopCode = data.shop.public_code;
  currentShopName = data.shop.shop_name;
  $("authArea").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
  $("welcomeTitle").textContent = `Welcome, ${data.shop.shop_name}`;
  renderSubscriptionStatus(data.shop);
  const orderLink = `${window.location.origin}/order.html?shop=${encodeURIComponent(currentShopCode)}`;
  $("shopLink").value = orderLink;
  renderQr(orderLink);
  await loadOrders();
}

function renderQr(link) {
  const target = $("qrCode");
  target.innerHTML = "";
  if (window.QRCode) {
    new QRCode(target, { text: link, width: 160, height: 160, correctLevel: QRCode.CorrectLevel.M });
  } else {
    target.textContent = "QR library unavailable. Copy and share the link instead.";
  }
}

async function loadOrders() {
  $("ordersList").innerHTML = '<p class="muted">Loading orders…</p>';
  try {
    const data = await api("/api/shop/orders");
    if (!data.orders.length) {
      $("ordersList").innerHTML = '<div class="empty-state"><div class="empty-icon">□</div><strong>No orders yet</strong><p class="muted">Share your shop link or QR code to receive your first order.</p></div>';
      return;
    }
    $("ordersList").innerHTML = data.orders.map((order) => `
      <article class="order-card">
        <div class="order-card-top"><div><span class="token-label">TOKEN</span><strong class="order-token">${escapeHtml(order.order_token || "—")}</strong></div><span class="status-badge status-${escapeHtml(order.status)}">${escapeHtml(order.status)}</span></div>
        <h3>${escapeHtml(order.customer_name)}</h3>
        <p class="order-description">${escapeHtml(order.description)}</p>
        <div class="order-bottom"><span class="muted small">${new Date(order.created_at).toLocaleString()}</span>
          <label class="status-control">Update status
            <select data-order-id="${escapeHtml(order.id)}" class="status-select">
              ${["pending", "processing", "ready", "completed", "cancelled"].map(status => `<option value="${status}" ${order.status === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}
            </select>
          </label>
        </div>
      </article>`).join("");
    document.querySelectorAll(".status-select").forEach((select) => {
      select.addEventListener("change", async () => {
        select.disabled = true;
        try {
          await api(`/api/shop/orders/${encodeURIComponent(select.dataset.orderId)}/status`, {
            method: "PATCH", body: JSON.stringify({ status: select.value })
          });
          showToast("Order status updated");
        } catch (error) {
          showToast(error.message);
          await loadOrders();
        } finally {
          select.disabled = false;
        }
      });
    });
  } catch (error) {
    $("ordersList").innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`;
  }
}
function statusLabel(status) {
  return ({ pending: "Received", processing: "Preparing", ready: "Ready", completed: "Completed", cancelled: "Cancelled" })[status] || status;
}

$("refreshBtn").addEventListener("click", loadOrders);
$("logoutBtn").addEventListener("click", () => {
  authToken = "";
  localStorage.removeItem("tokendesk_token");
  currentShopCode = "";
  $("dashboard").classList.add("hidden");
  $("authArea").classList.remove("hidden");
  $("loginForm").reset();
  showToast("Logged out");
});
$("copyLinkBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("shopLink").value); showToast("Shop link copied"); }
  catch { $("shopLink").select(); showToast("Select and copy the link"); }
});
$("shareLinkBtn").addEventListener("click", async () => {
  const link = $("shopLink").value;
  if (navigator.share) {
    try { await navigator.share({ title: "Order from our shop", text: "Place your order here", url: link }); }
    catch { /* user closed share sheet */ }
  } else {
    try { await navigator.clipboard.writeText(link); showToast("Shop link copied"); }
    catch { showToast("Use the Copy link button"); }
  }
});

(async function init() {
  if (!authToken) return;
  try { await showDashboard(); }
  catch {
    authToken = "";
    localStorage.removeItem("tokendesk_token");
    $("authArea").classList.remove("hidden");
  }
})();


function renderSubscriptionStatus(shop) {
  const target = $("subscriptionStatus");
  const expiry = shop.subscription_expires_at;
  if (shop.subscription_active && expiry) {
    target.textContent = `Subscription active until ${new Date(expiry).toLocaleString()}.`;
    target.className = "message success";
  } else {
    target.textContent = "No active paid subscription. Choose a plan to request activation.";
    target.className = "message";
  }
}


async function beginSubscription(planDays, button) {
  button.disabled = true;
  setMessage($("activationMessage"), "Creating payment request…");
  try {
    const request = await api("/api/subscription/requests", {
      method: "POST",
      body: JSON.stringify({ planDays })
    });

    $("subscriptionCheckout").classList.remove("hidden");
    $("checkoutTitle").textContent = `${request.planDays}-day plan payment`;
    $("paymentRequestCode").textContent = request.requestCode;
    $("paymentAmount").textContent = `₹${request.amount}`;
    $("paymentPhone").textContent = request.paymentPhone;

    const message = [
      "Hello TokenDesk, I want to activate my shop subscription.",
      `Shop: ${currentShopName}`,
      `Request ID: ${request.requestCode}`,
      `Plan: ${request.planDays} days`,
      `Amount: INR ${request.amount}`,
      "UPI transaction reference/UTR: (I will fill this after payment)",
      "Please verify the payment in your receiving account and send my activation code here."
    ].join("\n");
    $("whatsappRequestLink").href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
    setMessage($("activationMessage"), "Request created. UPI app mein mobile number se payment karein (agar app support kare). Receiver ka naam aur exact amount verify karein; phir UTR WhatsApp par bhejein.", "success");
    $("subscriptionCheckout").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setMessage($("activationMessage"), error.message, "error");
  } finally {
    button.disabled = false;
  }
}

document.querySelectorAll(".plan-buy-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const planDays = Number(button.dataset.planDays);
    beginSubscription(planDays, button);
  });
});

$("activateCodeBtn").addEventListener("click", async () => {
  const button = $("activateCodeBtn");
  const code = $("activationCodeInput").value.trim().toUpperCase();
  if (!code) {
    setMessage($("activationMessage"), "Enter your activation code.", "error");
    return;
  }
  button.disabled = true;
  setMessage($("activationMessage"), "Checking code…");
  try {
    const result = await api("/api/subscription/redeem", {
      method: "POST",
      body: JSON.stringify({ code })
    });
    $("activationCodeInput").value = "";
    setMessage($("activationMessage"), `${result.message}. ${result.planDays}-day plan active until ${new Date(result.subscriptionExpiresAt).toLocaleString()}.`, "success");
    const profile = await api("/api/shop/me");
    renderSubscriptionStatus(profile.shop);
    showToast("Subscription activated");
  } catch (error) {
    setMessage($("activationMessage"), error.message, "error");
  } finally {
    button.disabled = false;
  }
});

$("activationCodeInput").addEventListener("input", () => {
  $("activationCodeInput").value = $("activationCodeInput").value.replace(/[^a-f0-9]/gi, "").toUpperCase().slice(0, 16);
});
