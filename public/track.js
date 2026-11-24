const API = "https://tokendesk.onrender.com";
const params = new URLSearchParams(window.location.search);
const shopCode = params.get("shop") || "";
const suppliedToken = params.get("token") || "";
const $ = (id) => document.getElementById(id);
const statuses = [
  { key: "pending", label: "Order received" },
  { key: "processing", label: "Preparing" },
  { key: "ready", label: "Ready for pickup" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" }
];

async function checkStatus(token) {
  if (!/^[a-f0-9]{12}$/i.test(shopCode)) throw new Error("Shop link is invalid.");
  const response = await fetch(`${API}/api/public/shops/${encodeURIComponent(shopCode)}/track/${encodeURIComponent(token.trim().toUpperCase())}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Order not found");
  const order = data.order;
  $("trackedShop").textContent = order.shop_name;
  $("trackedToken").textContent = order.order_token;
  const isCancelled = order.status === "cancelled";
  const activeIndex = statuses.findIndex(item => item.key === order.status);
  $("statusTimeline").innerHTML = isCancelled
    ? '<div class="timeline-step cancelled active"><span></span><strong>Order cancelled</strong></div>'
    : statuses.slice(0, 4).map((item, index) => `<div class="timeline-step ${index <= activeIndex ? "active" : ""}"><span></span><strong>${item.label}</strong></div>`).join("");
  $("lastUpdate").textContent = `Order placed: ${new Date(order.created_at).toLocaleString()}`;
  $("trackResult").classList.remove("hidden");
  $("trackMessage").textContent = "Status updated successfully.";
  $("trackMessage").className = "message success";
}

$("trackForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("trackResult").classList.add("hidden");
  $("trackMessage").textContent = "Checking…";
  try { await checkStatus($("orderToken").value); }
  catch (error) {
    $("trackMessage").textContent = error.message;
    $("trackMessage").className = "message error";
  }
});

if (suppliedToken) {
  $("orderToken").value = suppliedToken;
  checkStatus(suppliedToken).catch((error) => {
    $("trackMessage").textContent = error.message;
    $("trackMessage").className = "message error";
  });
}
