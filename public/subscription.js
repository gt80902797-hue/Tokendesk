
"use strict";

const API = "https://tokendesk.onrender.com";
const WHATSAPP_NUMBER = "918090279768";
const PAYMENT_PHONE = "8090279768";

const $ = (id) => document.getElementById(id);

const authToken = localStorage.getItem("tokendesk_token") || "";

let selectedPlan = null;
let submitting = false;

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

// Login check
if (!authToken) {
  showMessage(
    $("subStatus"),
    "Please login to your shop account first.",
    "error"
  );
}

// Payment number
if ($("paymentPhone")) {
  $("paymentPhone").textContent = PAYMENT_PHONE;
}

// Select plan ONLY - no request created
function choosePlan(planDays) {
  if (!authToken) {
    showMessage($("subStatus"), "Please login first.", "error");
    return;
  }

  selectedPlan = Number(planDays);

  const prices = {
    30: 100,
    90: 270,
    365: 999
  };

  if (!prices[selectedPlan]) {
    showMessage($("subStatus"), "Invalid plan.", "error");
    return;
  }

  // Highlight selected card
  document.querySelectorAll("[data-card-plan]").forEach((card) => {
    card.classList.remove("selected");
  });

  const selectedCard = document.querySelector(
    `[data-card-plan="${selectedPlan}"]`
  );

  if (selectedCard) {
    selectedCard.classList.add("selected");
  }

  $("paymentBox").classList.remove("hidden");

  $("selectedPlanTitle").textContent =
    `${selectedPlan}-day subscription`;

  $("selectedPlanDays").textContent =
    `${selectedPlan} days`;

  $("amount").textContent =
    `₹${prices[selectedPlan]}`;

  $("utr").value = "";

  $("requestDetails").classList.add("hidden");
  $("requestCode").textContent = "-";

  showMessage($("requestMessage"), "");

  showMessage(
    $("subStatus"),
    "Plan selected. Complete payment and enter your UTR.",
    "success"
  );

  $("paymentBox").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

// Submit request ONLY when the WhatsApp button is clicked
async function submitSubscriptionRequest() {
  if (!authToken) {
    showMessage($("subStatus"), "Please login first.", "error");
    return;
  }

  if (!selectedPlan) {
    showMessage(
      $("requestMessage"),
      "Please select a subscription plan first.",
      "error"
    );
    return;
  }

  const utr = $("utr").value.trim();

  if (!utr) {
    showMessage(
      $("requestMessage"),
      "Please enter your UTR / transaction reference.",
      "error"
    );

    $("utr").focus();
    return;
  }

  if (utr.length < 6 || utr.length > 50) {
    showMessage(
      $("requestMessage"),
      "UTR must be between 6 and 50 characters.",
      "error"
    );

    $("utr").focus();
    return;
  }

  if (submitting) return;

  submitting = true;

  const button = $("whatsappLink");
  button.disabled = true;

  showMessage(
    $("requestMessage"),
    "Submitting your payment request...",
    ""
  );

  // Open a temporary tab immediately to avoid popup blocking
  const whatsappTab = window.open("about:blank", "_blank");

  try {
    const request = await api("/api/subscription/requests", {
      method: "POST",
      body: JSON.stringify({
        planDays: selectedPlan,
        utr: utr
      })
    });

    const requestCode = request.requestCode;

    $("requestCode").textContent = requestCode;
    $("requestDetails").classList.remove("hidden");

    const message = [
      "Hello TokenDesk, I want to activate my shop subscription.",
      `Request ID: ${requestCode}`,
      `Plan: ${request.planDays} days`,
      `Amount: INR ${request.amount}`,
      `UPI Transaction Reference / UTR: ${utr}`,
      "Please verify payment and send my activation code."
    ].join("\n");

    const whatsappURL =
      "https://wa.me/" +
      WHATSAPP_NUMBER +
      "?text=" +
      encodeURIComponent(message);

    showMessage(
      $("requestMessage"),
      "Request submitted successfully. Opening WhatsApp...",
      "success"
    );

    showMessage(
      $("subStatus"),
      "Your subscription request has been submitted.",
      "success"
    );

    // Open WhatsApp only after successful API request
    if (whatsappTab) {
      whatsappTab.location.href = whatsappURL;
    } else {
      window.location.href = whatsappURL;
    }

  } catch (error) {
    if (whatsappTab) {
      whatsappTab.close();
    }

    showMessage(
      $("requestMessage"),
      error.message || "Unable to submit request.",
      "error"
    );

  } finally {
    submitting = false;
    button.disabled = false;
  }
}

// Plan selection
document.querySelectorAll(".choose-plan").forEach((button) => {
  button.addEventListener("click", () => {
    choosePlan(button.dataset.plan);
  });
});

// Final request button
$("whatsappLink").addEventListener("click", submitSubscriptionRequest);

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

  showMessage(
    $("activationMessage"),
    "Checking activation code..."
  );

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
