
const API = "https://tokendesk.onrender.com";

let token = localStorage.getItem("tokendesk_token");

const auth = document.getElementById("auth");
const dashboard = document.getElementById("dashboard");
const msg = document.getElementById("msg");
const dashmsg = document.getElementById("dashmsg");

function show(type) {
  document.getElementById("login").hidden = type !== "login";
  document.getElementById("register").hidden = type !== "register";
  msg.textContent = "";
}

async function request(path, options = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error || "Request failed");
  }

  return data;
}

document.getElementById("register").addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "Registering...";

  const f = new FormData(e.target);

  const body = {
    shopName: f.get("shopName"),
    ownerName: f.get("ownerName"),
    email: f.get("email"),
    password: f.get("password")
  };

  try {
    await request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(body)
    });

    msg.textContent = "Account created! Now login.";
    show("login");
  } catch (error) {
    msg.textContent = error.message;
  }
});

document.getElementById("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "Logging in...";

  const f = new FormData(e.target);

  try {
    const data = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: f.get("email"),
        password: f.get("password")
      })
    });

    token = data.token;

    if (!token) throw new Error("Login token missing");

    localStorage.setItem("tokendesk_token", token);
    await refresh();
  } catch (error) {
    msg.textContent = error.message;
  }
});

async function refresh() {
  try {
    const data = await request("/api/shop/me");

    auth.hidden = true;
    dashboard.hidden = false;

    document.getElementById("shop").textContent =
      data.shop?.shopName || data.shop?.shop_name || "My Shop";

    document.getElementById("status").textContent =
      "Account logged in";

    await loadOrders();
    dashmsg.textContent = "";
  } catch (error) {
    logout();
    msg.textContent = error.message;
  }
}

async function loadOrders() {
  const list = document.getElementById("orders");
  list.innerHTML = "";

  try {
    const data = await request("/api/shop/orders");
    const orders = data.orders || data;

    if (!Array.isArray(orders) || orders.length === 0) {
      list.innerHTML = "<li>No orders yet</li>";
      return;
    }

    orders.forEach(order => {
      const li = document.createElement("li");
      li.textContent =
        `${order.customer_name || order.customerName || "Customer"} — ` +
        `${order.description || ""} — ${order.status || ""}`;
      list.appendChild(li);
    });
  } catch (error) {
    dashmsg.textContent = error.message;
  }
}

function pay(plan) {
  dashmsg.textContent =
    "Payments are not activated yet. Plan selected: " + plan + " days.";
}

function logout() {
  token = null;
  localStorage.removeItem("tokendesk_token");

  dashboard.hidden = true;
  auth.hidden = false;

  document.getElementById("login").reset();
  document.getElementById("register").reset();
  document.getElementById("orders").innerHTML = "";
  dashmsg.textContent = "";
}

if (token) {
  refresh();
} else {
  show("login");
    }
