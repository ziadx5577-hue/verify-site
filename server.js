import "dotenv/config";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import axios from "axios";
import { getProducts, getStats, findOrder, createOrder, confirmOrder } from "./src/store.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || "development-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use(express.static("public"));

function paymentConfig() {
  return {
    applepay: {
      name: "Apple Pay",
      type: "redirect",
      url: process.env.APPLE_PAY_URL || ""
    },
    alrajhi: {
      name: "مصرف الراجحي",
      type: "manual",
      accountName: process.env.ALRAJHI_ACCOUNT_NAME || "",
      iban: process.env.ALRAJHI_IBAN || "",
      accountNumber: process.env.ALRAJHI_ACCOUNT_NUMBER || "",
      qrImage: process.env.ALRAJHI_QR_IMAGE_URL || ""
    },
    urpay: {
      name: "urpay",
      type: "manual",
      accountName: process.env.URPAY_ACCOUNT_NAME || "",
      accountNumber: process.env.URPAY_NUMBER || "",
      qrImage: process.env.URPAY_QR_IMAGE_URL || ""
    }
  };
}

async function sendLog(title, description, color = 0x9aa3ad, components = undefined) {
  const webhook = process.env.DISCORD_LOG_WEBHOOK_URL;
  if (!webhook) return;

  const payload = {
    embeds: [{ title, description, color, timestamp: new Date().toISOString() }]
  };

  if (components) payload.components = components;
  await axios.post(webhook, payload, { timeout: 10000 });
}

async function giveCustomerRole(discordId) {
  const { DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_CUSTOMER_ROLE_ID } = process.env;
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID || !DISCORD_CUSTOMER_ROLE_ID) {
    throw new Error("بيانات رتبة العميل ناقصة في ملف .env");
  }

  await axios.put(
    `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${DISCORD_CUSTOMER_ROLE_ID}`,
    {},
    { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }, timeout: 10000 }
  );
}

app.get("/api/products", async (_req, res) => res.json(await getProducts()));
app.get("/api/stats", async (_req, res) => res.json(await getStats()));
app.get("/api/payment-methods", (_req, res) => {
  const methods = paymentConfig();
  res.json(Object.entries(methods).map(([id, method]) => ({ id, name: method.name, type: method.type })));
});
app.get("/api/me", (req, res) => res.json({ loggedIn: Boolean(req.session.discord), user: req.session.discord || null }));

app.get("/auth/discord", (_req, res) => {
  const redirectUri = `${process.env.BASE_URL}/auth/discord/callback`;
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", process.env.DISCORD_CLIENT_ID || "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "identify");
  res.redirect(url.toString());
});

app.get("/auth/discord/callback", async (req, res) => {
  try {
    const redirectUri = `${process.env.BASE_URL}/auth/discord/callback`;
    const body = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID || "",
      client_secret: process.env.DISCORD_CLIENT_SECRET || "",
      grant_type: "authorization_code",
      code: String(req.query.code || ""),
      redirect_uri: redirectUri
    });

    const token = await axios.post("https://discord.com/api/oauth2/token", body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000
    });
    const user = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token.data.access_token}` },
      timeout: 10000
    });

    req.session.discord = { id: user.data.id, username: user.data.username };
    await sendLog("تسجيل دخول ديسكورد", `**المستخدم:** <@${user.data.id}>\n**الاسم:** ${user.data.username}`, 0x57f287);
    res.redirect("/#products");
  } catch (error) {
    console.error(error.response?.data || error);
    try { await sendLog("خلل في تسجيل الدخول", `\`\`\`${String(error.response?.data?.error_description || error.message).slice(0, 1500)}\`\`\``, 0xed4245); } catch {}
    res.status(500).send("فشل تسجيل الدخول عبر ديسكورد");
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    if (!req.session.discord) return res.status(401).json({ error: "يجب تسجيل الدخول بديسكورد أولًا", login: "/auth/discord" });

    const products = await getProducts();
    const product = products.find((item) => item.id === req.body.productId && item.active);
    const method = paymentConfig()[req.body.paymentMethod];

    if (!product) return res.status(404).json({ error: "المنتج غير متوفر" });
    if (!method) return res.status(400).json({ error: "طريقة الدفع غير صحيحة" });
    if (method.type === "redirect" && !method.url) return res.status(500).json({ error: "رابط Apple Pay غير مضاف في ملف .env" });

    const order = await createOrder({
      productId: product.id,
      productName: product.name,
      price: product.price,
      paymentMethod: req.body.paymentMethod,
      discordId: req.session.discord.id,
      discordUsername: req.session.discord.username
    });

    const confirmUrl = `${process.env.BASE_URL}/admin/confirm/${encodeURIComponent(order.id)}/${order.confirmToken}`;
    await sendLog(
      "طلب شراء جديد — بانتظار التأكيد",
      `**رقم الطلب:** ${order.id}\n**المنتج:** ${product.name}\n**السعر:** ${(product.price / 100).toFixed(2)} ريال\n**طريقة الدفع:** ${method.name}\n**العميل:** <@${order.discordId}>\n\nاضغط الزر بعد التأكد من وصول المبلغ.`,
      0xfee75c,
      [{ type: 1, components: [{ type: 2, style: 5, label: "تأكيد استلام المبلغ", url: confirmUrl }] }]
    );

    res.json({
      orderId: order.id,
      method: req.body.paymentMethod,
      redirectUrl: method.type === "redirect" ? method.url : null,
      details: method.type === "manual" ? method : null
    });
  } catch (error) {
    console.error(error);
    try { await sendLog("خلل في إنشاء طلب", `\`\`\`${String(error.message).slice(0, 1500)}\`\`\``, 0xed4245); } catch {}
    res.status(500).json({ error: "حدث خلل أثناء إنشاء الطلب" });
  }
});

app.get("/api/order/:orderId", async (req, res) => {
  const order = await findOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: "الطلب غير موجود" });
  if (!req.session.discord || req.session.discord.id !== order.discordId) return res.status(403).json({ error: "غير مصرح" });
  res.json({ id: order.id, status: order.status, productName: order.productName, paymentMethod: order.paymentMethod });
});

app.get("/admin/confirm/:orderId/:token", async (req, res) => {
  try {
    const order = await confirmOrder(req.params.orderId, req.params.token);
    await giveCustomerRole(order.discordId);
    await sendLog(
      "تم تأكيد الدفع",
      `**رقم الطلب:** ${order.id}\n**المنتج:** ${order.productName}\n**المبلغ:** ${(order.price / 100).toFixed(2)} ريال\n**العميل:** <@${order.discordId}>\n**النتيجة:** تمت إضافة رتبة العميل.`,
      0x57f287
    );
    res.send("<meta charset='utf-8'><body style='font-family:Arial;text-align:center;padding:60px;background:#0b0f14;color:white'><h1>تم تأكيد الدفع ✅</h1><p>تم إعطاء العميل الرتبة بنجاح.</p></body>");
  } catch (error) {
    console.error(error.response?.data || error);
    try { await sendLog("فشل تأكيد الطلب", `**الطلب:** ${req.params.orderId}\n\`\`\`${String(error.response?.data?.message || error.message).slice(0, 1200)}\`\`\``, 0xed4245); } catch {}
    res.status(500).send("<meta charset='utf-8'><body style='font-family:Arial;text-align:center;padding:60px'><h1>فشل تأكيد الطلب</h1><p>راجع لوق ديسكورد وبيانات البوت.</p></body>");
  }
});

app.use(async (error, req, res, _next) => {
  console.error(error);
  try { await sendLog("خطأ في الموقع", `**المسار:** ${req.method} ${req.originalUrl}\n\`\`\`${String(error.message).slice(0, 1500)}\`\`\``, 0xed4245); } catch {}
  res.status(500).json({ error: "حدث خطأ داخلي" });
});

app.listen(PORT, async () => {
  console.log(`Night Store running on http://localhost:${PORT}`);
  try { await sendLog("تم تشغيل الموقع", `الموقع يعمل الآن على المنفذ **${PORT}**.`, 0x5865f2); } catch (error) { console.error("Webhook log failed:", error.message); }
});
