let products = [];
let selectedProductId = null;
const grid = document.getElementById("grid");
const toast = document.getElementById("toast");
const modal = document.getElementById("paymentModal");
const detailsBox = document.getElementById("paymentDetails");

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function render(list) {
  grid.innerHTML = list.map((product) => `
    <article class="card">
      <div class="visual"><span class="badge">${escapeHtml(product.badge)}</span><span class="product-icon">${escapeHtml(product.icon || "🛍️")}</span></div>
      <div class="card-body"><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description)}</p><div class="card-footer"><strong>${product.price ? `${(product.price / 100).toFixed(2)} ريال` : "حسب الطلب"}</strong><button ${product.active ? "" : "disabled"} data-buy="${escapeHtml(product.id)}">${product.active ? "شراء الآن" : "غير متوفر"}</button></div></div>
    </article>`).join("");
  document.querySelectorAll("[data-buy]").forEach((button) => button.addEventListener("click", () => openPayment(button.dataset.buy)));
}

async function openPayment(productId) {
  const me = await fetch("/api/me").then((response) => response.json());
  if (!me.loggedIn) {
    showToast("يجب تسجيل الدخول بديسكورد أولًا");
    setTimeout(() => location.href = "/auth/discord", 700);
    return;
  }
  selectedProductId = productId;
  const product = products.find((item) => item.id === productId);
  document.getElementById("selectedProduct").textContent = `${product.name} — ${(product.price / 100).toFixed(2)} ريال`;
  detailsBox.innerHTML = "";
  modal.classList.remove("hidden");
}

async function chooseMethod(paymentMethod) {
  detailsBox.innerHTML = "<p>جاري إنشاء الطلب...</p>";
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId: selectedProductId, paymentMethod })
  });
  const data = await response.json();

  if (response.status === 401 && data.login) return location.href = data.login;
  if (!response.ok) {
    detailsBox.innerHTML = `<p class="error-text">${escapeHtml(data.error || "حدث خطأ")}</p>`;
    return;
  }

  if (data.redirectUrl) {
    showToast(`تم إنشاء الطلب ${data.orderId} وجاري فتح Apple Pay`);
    setTimeout(() => location.href = data.redirectUrl, 700);
    return;
  }

  const d = data.details || {};
  detailsBox.innerHTML = `
    <div class="bank-details">
      <h3>رقم الطلب: ${escapeHtml(data.orderId)}</h3>
      ${d.accountName ? `<p><b>اسم المستفيد:</b> ${escapeHtml(d.accountName)}</p>` : ""}
      ${d.iban ? `<p><b>الآيبان:</b> <code>${escapeHtml(d.iban)}</code></p>` : ""}
      ${d.accountNumber ? `<p><b>رقم الحساب/الجوال:</b> <code>${escapeHtml(d.accountNumber)}</code></p>` : ""}
      ${d.qrImage ? `<img class="payment-qr" src="${escapeHtml(d.qrImage)}" alt="QR">` : ""}
      <p class="pending-note">بعد التحويل انتظر تأكيد الإدارة. ستصلك رتبة العميل بعد التأكد من وصول المبلغ.</p>
    </div>`;
}

document.querySelectorAll("[data-method]").forEach((button) => button.addEventListener("click", () => chooseMethod(button.dataset.method)));
document.getElementById("closeModal").addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", (event) => { if (event.target === modal) modal.classList.add("hidden"); });

document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-filter]").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  const filter = button.dataset.filter;
  render(filter === "all" ? products : products.filter((product) => product.category === filter));
}));

async function init() {
  products = await fetch("/api/products").then((response) => response.json());
  render(products);

  const stats = await fetch("/api/stats").then((response) => response.json());

  document.getElementById("rating").textContent =
    Number(stats.rating).toFixed(2);

  document.getElementById("reviewCount").textContent =
    `${stats.reviewCount}+`;

  document.getElementById("purchaseCount").textContent =
    stats.purchaseCount;

  await loadDiscordUser();
}
async function loadDiscordUser() {
  try {
    const response = await fetch("/api/me");
    const data = await response.json();

    if (!data.loggedIn || !data.user) return;

    const loginButton = document.getElementById("discordLogin");
    if (!loginButton) return;

    const username = data.user.globalName || data.user.username;

    loginButton.href = "#";
    loginButton.classList.add("discord-user");
    loginButton.title = `@${data.user.username}`;

    loginButton.innerHTML = `
      <img
        src="${data.user.avatar}"
        alt="${username}"
        class="discord-user-avatar"
      >
      <span class="discord-user-name">${username}</span>
    `;

    loginButton.addEventListener("click", (event) => {
      event.preventDefault();
    });
  } catch (error) {
    console.error("تعذر تحميل حساب ديسكورد:", error);
  }
}
init().catch(() => showToast("تعذر تحميل بيانات المتجر"));
