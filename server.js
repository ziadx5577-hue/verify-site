import "dotenv/config";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import axios from "axios";
import {
  getProducts,
  getStats,
  findOrder,
  createOrder,
  confirmOrder,
  setOrderLogMessage,
  reserveNitroDelivery,
  updateOrderDelivery
} from "./src/store.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || "development-secret-change-me",
  resave: false,
  saveUninitialized: false,
  proxy: true,
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

function getWebhookUrl({ wait = false } = {}) {
  const raw = process.env.DISCORD_LOG_WEBHOOK_URL;
  if (!raw) return null;

  const url = new URL(raw);
  if (wait) url.searchParams.set("wait", "true");
  return url.toString();
}

async function sendLog(title, description, color = 0x9aa3ad, components = undefined) {
  const webhook = getWebhookUrl({ wait: true });
  if (!webhook) return null;

  const payload = {
    embeds: [{
      title,
      description,
      color,
      timestamp: new Date().toISOString()
    }]
  };

  if (components) payload.components = components;

  const response = await axios.post(webhook, payload, { timeout: 10000 });
  return response.data;
}

async function updateLogMessage(messageId, title, description, color = 0x9aa3ad) {
  const webhook = getWebhookUrl();
  if (!webhook || !messageId) return;

  await axios.patch(
    `${webhook}/messages/${messageId}`,
    {
      embeds: [{
        title,
        description,
        color,
        timestamp: new Date().toISOString()
      }],
      components: []
    },
    { timeout: 10000 }
  );
}

function botHeaders() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN_MISSING");

  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json"
  };
}

async function giveCustomerRole(discordId) {
  const { DISCORD_GUILD_ID, DISCORD_CUSTOMER_ROLE_ID } = process.env;

  if (!DISCORD_GUILD_ID || !DISCORD_CUSTOMER_ROLE_ID) {
    throw new Error("بيانات رتبة العميل ناقصة في ملف .env");
  }

  await axios.put(
    `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${DISCORD_CUSTOMER_ROLE_ID}`,
    {},
    { headers: botHeaders(), timeout: 10000 }
  );
}

async function sendDiscordDm(discordId, content) {
  const dmChannel = await axios.post(
    "https://discord.com/api/v10/users/@me/channels",
    { recipient_id: discordId },
    { headers: botHeaders(), timeout: 10000 }
  );

  await axios.post(
    `https://discord.com/api/v10/channels/${dmChannel.data.id}/messages`,
    {
      content,
      allowed_mentions: { parse: [] }
    },
    { headers: botHeaders(), timeout: 10000 }
  );
}

function formatPrice(price) {
  return `${(price / 100).toFixed(2)} ريال`;
}

function orderBaseDescription(order, paymentName) {
  return `**🆔 رقم الطلب:**
${order.id}

**👤 العميل:**
<@${order.discordId}>
${order.discordUsername || "غير معروف"}

**📦 المنتج:**
${order.productName}

**💰 السعر:**
${formatPrice(order.price)}

**💳 طريقة الدفع:**
${paymentName}`;
}

app.get("/api/products", async (_req, res) => res.json(await getProducts()));
app.get("/api/stats", async (_req, res) => res.json(await getStats()));

app.get("/api/me", (req, res) => {
  if (!req.session.discord) {
    return res.json({ loggedIn: false });
  }

  res.json({
    loggedIn: true,
    user: req.session.discord
  });
});

app.get("/api/payment-methods", (_req, res) => {
  const methods = paymentConfig();
  res.json(
    Object.entries(methods).map(([id, method]) => ({
      id,
      name: method.name,
      type: method.type
    }))
  );
});

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

    const token = await axios.post(
      "https://discord.com/api/oauth2/token",
      body,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10000
      }
    );

    const user = await axios.get(
      "https://discord.com/api/users/@me",
      {
        headers: {
          Authorization: `Bearer ${token.data.access_token}`
        },
        timeout: 10000
      }
    );

    req.session.discord = {
      id: user.data.id,
      username: user.data.username,
      globalName: user.data.global_name || user.data.username,
      avatar: user.data.avatar
        ? `https://cdn.discordapp.com/avatars/${user.data.id}/${user.data.avatar}.png?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${Number(user.data.discriminator || 0) % 5}.png`
    };

    await sendLog(
      "تسجيل دخول ديسكورد",
      `**المستخدم:** <@${user.data.id}>\n**الاسم:** ${user.data.username}`,
      0x57f287
    );

    res.redirect("/#products");
  } catch (error) {
    console.error(error.response?.data || error);

    try {
      await sendLog(
        "خلل في تسجيل الدخول",
        `\`\`\`${String(error.response?.data?.error_description || error.message).slice(0, 1500)}\`\`\``,
        0xed4245
      );
    } catch {}

    res.status(500).send("فشل تسجيل الدخول عبر ديسكورد");
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    if (!req.session.discord) {
      return res.status(401).json({
        error: "يجب تسجيل الدخول بديسكورد أولًا",
        login: "/auth/discord"
      });
    }

    const products = await getProducts();
    const product = products.find(
      (item) => item.id === req.body.productId && item.active
    );
    const method = paymentConfig()[req.body.paymentMethod];

    if (!product) {
      return res.status(404).json({ error: "المنتج غير متوفر" });
    }

    if (!method) {
      return res.status(400).json({ error: "طريقة الدفع غير صحيحة" });
    }

    if (method.type === "redirect" && !method.url) {
      return res.status(500).json({
        error: "رابط Apple Pay غير مضاف في ملف .env"
      });
    }

    const order = await createOrder({
      productId: product.id,
      productName: product.name,
      price: product.price,
      stockType: product.stockType || "manual",
      paymentMethod: req.body.paymentMethod,
      discordId: req.session.discord.id,
      discordUsername: req.session.discord.username
    });

    const confirmUrl =
      `${process.env.BASE_URL}/admin/confirm/${encodeURIComponent(order.id)}/${order.confirmToken}`;

    const logMessage = await sendLog(
      "🛒 طلب شراء جديد — بانتظار التأكيد",
      `${orderBaseDescription(order, method.name)}

**📊 الحالة:**
🟡 بانتظار تأكيد استلام المبلغ

✅ **[اضغط هنا لتأكيد الطلب وتسليمه](${confirmUrl})**`,
      0xfee75c
    );

    if (logMessage?.id) {
      await setOrderLogMessage(order.id, logMessage.id);
    }

    res.json({
      orderId: order.id,
      method: req.body.paymentMethod,
      redirectUrl: method.type === "redirect" ? method.url : null,
      details: method.type === "manual" ? method : null
    });
  } catch (error) {
    console.error(error.response?.data || error);

    try {
      await sendLog(
        "خلل في إنشاء طلب",
        `\`\`\`${String(error.message).slice(0, 1500)}\`\`\``,
        0xed4245
      );
    } catch {}

    res.status(500).json({
      error: "حدث خلل أثناء إنشاء الطلب"
    });
  }
});

app.get("/api/order/:orderId", async (req, res) => {
  const order = await findOrder(req.params.orderId);

  if (!order) {
    return res.status(404).json({ error: "الطلب غير موجود" });
  }

  if (!req.session.discord || req.session.discord.id !== order.discordId) {
    return res.status(403).json({ error: "غير مصرح" });
  }

  res.json({
    id: order.id,
    status: order.status,
    productName: order.productName,
    paymentMethod: order.paymentMethod,
    deliveryStatus: order.deliveryStatus || null
  });
});

app.get("/admin/confirm/:orderId/:token", async (req, res) => {
  let order;

  try {
    order = await findOrder(req.params.orderId);

    if (!order) {
      throw new Error("ORDER_NOT_FOUND");
    }

    if (order.confirmToken !== req.params.token) {
      throw new Error("INVALID_CONFIRM_TOKEN");
    }

    const paymentMethod =
      paymentConfig()[order.paymentMethod]?.name || order.paymentMethod;

    if (order.status === "paid") {
      return res.send(
        "<meta charset='utf-8'><body style='font-family:Arial;text-align:center;padding:60px;background:#0b0f14;color:white'><h1>الطلب مؤكد مسبقًا ✅</h1><p>لا يمكن تسليم نفس الطلب مرتين.</p></body>"
      );
    }

    await giveCustomerRole(order.discordId);

    let deliveryCode = order.deliveryCode || null;
    let dmSent = false;
    let deliveryText = "التسليم يدوي من الإدارة.";

    if (order.stockType === "nitro") {
      deliveryCode = await reserveNitroDelivery(order.id, order.productId);

      try {
        await sendDiscordDm(
          order.discordId,
          `السلام عليكم 👋

تم تأكيد طلبك من **Night Store** بنجاح ✅

**رقم الطلب:** ${order.id}
**المنتج:** ${order.productName}
**رابط النيترو:**
${deliveryCode}

شكرًا لتسوقك معنا 🤍`
        );

        dmSent = true;
        deliveryText = "✅ تم إرسال رابط النيترو للعميل في الخاص.";
      } catch (dmError) {
        console.error("DM delivery failed:", dmError.response?.data || dmError);
        deliveryText =
          `⚠️ تعذر إرسال الخاص للعميل.\n\n` +
          `**رابط النيترو للإرسال اليدوي:**\n${deliveryCode}`;
      }
    }

    await updateOrderDelivery(order.id, {
      deliveryCode,
      deliveryStatus:
        order.stockType === "nitro"
          ? (dmSent ? "dm_sent" : "dm_failed")
          : "manual",
      dmSentAt: dmSent ? new Date().toISOString() : null
    });

    order = await confirmOrder(req.params.orderId, req.params.token);

    const completedDescription = `${orderBaseDescription(order, paymentMethod)}

**🎁 التسليم:**
${deliveryText}

**🏷️ رتبة العميل:**
✅ تمت إضافة الرتبة

**📊 الحالة:**
✅ مكتمل`;

    if (order.logMessageId) {
      await updateLogMessage(
        order.logMessageId,
        "✅ تم تأكيد الطلب — مكتمل",
        completedDescription,
        dmSent || order.stockType !== "nitro" ? 0x57f287 : 0xfee75c
      );
    } else {
      await sendLog(
        "✅ تم تأكيد الطلب — مكتمل",
        completedDescription,
        dmSent || order.stockType !== "nitro" ? 0x57f287 : 0xfee75c
      );
    }

    const adminMessage =
      order.stockType === "nitro" && !dmSent
        ? `<h1>تم تأكيد الطلب ✅</h1>
           <p>تم إعطاء العميل الرتبة، لكن الخاص مقفل.</p>
           <p>انسخ رابط النيترو وأرسله له يدويًا:</p>
           <div style="background:#151b23;border:1px solid #34404d;border-radius:12px;padding:16px;word-break:break-all">${deliveryCode}</div>`
        : `<h1>تم تأكيد الطلب وتسليمه ✅</h1>
           <p>${order.stockType === "nitro"
             ? "تم إعطاء العميل الرتبة وإرسال رابط النيترو في الخاص."
             : "تم إعطاء العميل الرتبة، والتسليم يدوي من الإدارة."}</p>`;

    res.send(
      `<meta charset="utf-8">
       <body style="font-family:Arial;text-align:center;padding:60px;background:#0b0f14;color:white">
         <main style="max-width:700px;margin:auto">${adminMessage}</main>
       </body>`
    );
  } catch (error) {
    console.error(error.response?.data || error);

    const message =
      error.message === "NO_NITRO_STOCK"
        ? "لا يوجد مخزون نيترو متوفر لهذا المنتج."
        : error.message === "ORDER_NOT_FOUND"
          ? "الطلب غير موجود."
          : error.message === "INVALID_CONFIRM_TOKEN"
            ? "رابط التأكيد غير صحيح."
            : String(
                error.response?.data?.message ||
                error.message ||
                "حدث خطأ غير معروف"
              );

    try {
      const failedOrder = order || await findOrder(req.params.orderId);
      const paymentMethod = failedOrder
        ? (paymentConfig()[failedOrder.paymentMethod]?.name ||
          failedOrder.paymentMethod)
        : "غير معروف";

      const description = failedOrder
        ? `${orderBaseDescription(failedOrder, paymentMethod)}

**❌ سبب الفشل:**
\`\`\`${message.slice(0, 1200)}\`\`\`

**📊 الحالة:**
🔴 يحتاج تدخل إداري`
        : `**الطلب:** ${req.params.orderId}

\`\`\`${message.slice(0, 1200)}\`\`\``;

      if (failedOrder?.logMessageId) {
        await updateLogMessage(
          failedOrder.logMessageId,
          "❌ فشل تأكيد الطلب",
          description,
          0xed4245
        );
      } else {
        await sendLog(
          "❌ فشل تأكيد الطلب",
          description,
          0xed4245
        );
      }
    } catch {}

    res.status(500).send(
      `<meta charset="utf-8">
       <body style="font-family:Arial;text-align:center;padding:60px;background:#0b0f14;color:white">
         <h1>فشل تأكيد الطلب ❌</h1>
         <p>${message}</p>
       </body>`
    );
  }
});

app.use(async (error, req, res, _next) => {
  console.error(error);

  try {
    await sendLog(
      "خطأ في الموقع",
      `**المسار:** ${req.method} ${req.originalUrl}\n\`\`\`${String(error.message).slice(0, 1500)}\`\`\``,
      0xed4245
    );
  } catch {}

  res.status(500).json({
    error: "حدث خطأ داخلي"
  });
});

app.listen(PORT, async () => {
  console.log(`Night Store running on http://localhost:${PORT}`);

  try {
    await sendLog(
      "تم تشغيل الموقع",
      `الموقع يعمل الآن على المنفذ **${PORT}**.`,
      0x5865f2
    );
  } catch (error) {
    console.error("Webhook log failed:", error.message);
  }
});
