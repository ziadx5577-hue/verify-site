const express = require("express");
const axios = require("axios");
const moment = require("moment-timezone");
const { Client, GatewayIntentBits } = require("discord.js");

const app = express();

// 🔥 بياناتك
const TOKEN = "حط_توكن_البوت";
const CLIENT_ID = "حط_client_id";
const CLIENT_SECRET = "حط_client_secret";
const REDIRECT_URI = "https://YOUR-APP.onrender.com/callback";

const GUILD_ID = "ايدي_السيرفر";
const ROLE_ID = "1472662974463344640";
const LOG_CHANNEL = "1488224035551838408";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.login(TOKEN);

// الصفحة الرئيسية
app.get("/", (req, res) => {
  const url =
    `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code&scope=identify guilds.join`;

  res.send(`
    <h1>🔐 Discord Verification</h1>
    <a href="${url}">
      <button style="padding:15px;font-size:18px;">Verify</button>
    </a>
  `);
});

// التفعيل
app.get("/callback", async (req, res) => {
  try {
    const code = req.query.code;

    const data = new URLSearchParams();
    data.append("client_id", CLIENT_ID);
    data.append("client_secret", CLIENT_SECRET);
    data.append("grant_type", "authorization_code");
    data.append("code", code);
    data.append("redirect_uri", REDIRECT_URI);

    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      data
    );

    const userRes = await axios.get(
      "https://discord.com/api/users/@me",
      {
        headers: {
          Authorization: `Bearer ${tokenRes.data.access_token}`
        }
      }
    );

    const user = userRes.data;

    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(user.id);

    await member.roles.add(ROLE_ID);

    const now = moment().tz("Asia/Riyadh");

    const logChannel = await client.channels.fetch(LOG_CHANNEL);
    await logChannel.send(`✅ ${user.username} تفعل`);

    res.send("✅ تم التفعيل ارجع للدسكورد");

  } catch (err) {
    console.log(err);
    res.send("❌ خطأ");
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
