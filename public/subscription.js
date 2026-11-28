
"use strict";

const API = "https://tokendesk.onrender.com";
const WHATSAPP_NUMBER = "918090279768";

const $ = (id) => document.getElementById(id);

const authToken = localStorage.getItem("tokendesk_token") || "";

let currentRequest = null;

function showMessage(element, message, type = "") {
  if (!element) return;
  element.textContent = message;
  element.className = "message" + (type ? " " + type : "");
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(API + path, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

// Check login
if (!authToken) {
  showMessage(
    $("subStatus"),
    "Please login to your shop account first.",
    "error"
  );
}

// Select plan and create payment request
async function choosePlan(planDays, button) {
  if (!authToken) {
    showMessage($("subStatus"), "Please login first.", "error");
    return;
  }

  button.disabled = true;
  showMessage($("subStatus"), "Creating payment request...");

  try {
    const request = await api("/api/subscription/requests", {
      method: "POST",
      body: JSON.stringify({ planDays: Number(planDays) })
    });

    currentRequest = request;

    $("paymentBox").classList.remove("hidden");

    $("selectedPlanTitle").textContent =
      `${request.planDays}-day subscription`;

    $("paymentPhone").textContent =
      request.paymentPhone || "Check payment instructions";

    $("requestCode").textContent = request.requestCode;
    $("amount").textContent = `₹${request.amount}`;
    $("utr").value = "";

    updateWhatsAppLink();

    showMessage(
      $("subStatus"),
      "Payment request created. Complete payment and enter your UTR.",
      "success"
    );

    $("paymentBox").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

  } catch (error) {
    showMessage($("subStatus"), error.message, "error");
  } finally {
    button.disabled = false;
  }
}

// Update WhatsApp link
function updateWhatsAppLink() {
  if (!currentRequest) return;

  const utr = $("utr").value.trim();

  const message = [
    "Hello TokenDesk, I want to activate my shop subscription.",
    `Request ID: ${currentRequest.requestCode}`,
    `Plan: ${currentRequest.planDays} days`,
    `Amount: INR ${currentRequest.amount}`,
    `UPI Transaction Reference / UTR: ${utr || "Not entered"}`,
    "Please verify payment and send my activation code."
  ].join("\n");

  $("whatsappLink").href =
    "https://wa.me/" +
    WHATSAPP_NUMBER +
    "?text=" +
    encodeURIComponent(message);
}

// UTR changes update the WhatsApp message
$("utr").addEventListener("input", updateWhatsAppLink);

// Plan buttons
document.querySelectorAll(".choose-plan").forEach((button) => {
  button.addEventListener("click", () => {
    choosePlan(button.dataset.plan, button);
  });
});

// Activation code
$("activateBtn").addEventListener("click", async () => {
  const code = $("activationCode").value.trim();

  if (!code) {
    showMessage(
      $("activationMessage"),
      "Please enter your activation code.",
      "error"
    );
    return;
  }

  const button = $("activateBtn");
  button.disabled = true;

  showMessage($("activationMessage"), "Checking activation code...");

  try {
    const result = await api("/api/subscription/redeem", {
      method: "POST",
      body: JSON.stringify({ code })
    });

    showMessage(
      $("activationMessage"),
      result.message || "Subscription activated successfully!",
      "success"
    );

    $("activationCode").value = "";

    setTimeout(() => {
      window.location.href = "index.html";
    }, 1500);

  } catch (error) {
    showMessage(
      $("activationMessage"),
      error.message,
      "error"
    );
  } finally {
    button.disabled = false;
  }
});
