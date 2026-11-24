const API = "https://tokendesk.onrender.com";
const params = new URLSearchParams(window.location.search);
const shopCode = params.get("shop") || "";
const $ = (id) => document.getElementById(id);
let recognition = null;

async function loadShop() {
  if (!/^[a-f0-9]{12}$/i.test(shopCode)) throw new Error("Shop link is not valid.");
  const response = await fetch(`${API}/api/public/shops/${encodeURIComponent(shopCode)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Shop unavailable");
  $("shopTitle").textContent = data.shop.shop_name;
  document.title = `Order from ${data.shop.shop_name} | TokenDesk`;
}

$("voiceBtn").addEventListener("click", () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    $("voiceMessage").textContent = "Is browser mein voice typing supported nahi hai. Keyboard ka microphone use kar sakte hain.";
    return;
  }
  if (recognition) {
    recognition.stop();
    recognition = null;
    $("voiceBtn").textContent = "🎙️ Hindi voice input";
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = "hi-IN";
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.onstart = () => {
    $("voiceBtn").textContent = "Listening… tap to stop";
    $("voiceMessage").textContent = "Bolna shuru karein…";
  };
  recognition.onresult = (event) => {
    const spoken = event.results?.[0]?.[0]?.transcript || "";
    const input = $("description");
    input.value = `${input.value}${input.value ? " " : ""}${spoken}`;
  };
  recognition.onerror = (event) => {
    $("voiceMessage").textContent = event.error === "not-allowed" ? "Microphone permission allow karein." : "Voice input nahi chal saka. Keyboard microphone try karein.";
  };
  recognition.onend = () => {
    $("voiceBtn").textContent = "🎙️ Hindi voice input";
    recognition = null;
  };
  recognition.start();
});

$("orderForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("placeOrderBtn");
  button.disabled = true;
  $("orderMessage").textContent = "Sending your order…";
  try {
    const response = await fetch(`${API}/api/public/shops/${encodeURIComponent(shopCode)}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerName: $("customerName").value, description: $("description").value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Order could not be sent");
    $("orderForm").classList.add("hidden");
    $("orderMessage").textContent = "Your order has been sent to the shop.";
    $("generatedToken").textContent = data.orderToken;
    $("trackLink").href = `track.html?shop=${encodeURIComponent(shopCode)}&token=${encodeURIComponent(data.orderToken)}`;
    $("successPanel").classList.remove("hidden");
  } catch (error) {
    $("orderMessage").textContent = error.message;
    $("orderMessage").className = "message error";
  } finally {
    button.disabled = false;
  }
});

loadShop().catch((error) => {
  $("shopTitle").textContent = "Shop not found";
  $("orderForm").classList.add("hidden");
  $("orderMessage").textContent = error.message;
  $("orderMessage").className = "message error";
});
