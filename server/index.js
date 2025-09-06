import "dotenv/config";
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();

// 同时支持 JSON 与 text/plain
app.use(express.json({ limit: "1mb" }));
app.use(express.text({ type: "text/plain", limit: "1mb" }));

// CORS：先放开，联通后再收紧
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.options("*", cors());

// 健康检查
app.get("/health", (_, res) => res.json({ ok: true }));

app.post("/chat", async (req, res) => {
  // 兼容 text/plain：把字符串体当 JSON 解析
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const {
    messages,
    stream = false,                 // 非流式最稳
    model = "gpt-4o-mini",
    max_tokens = 512,
    temperature = 0.7
  } = body || {};

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: { message: "OPENAI_API_KEY missing" } });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: "messages required" } });
  }

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, messages, stream: false, max_tokens, temperature })
    });
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: { message: `Upstream request failed: ${String(e)}` } });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`AI proxy listening on :${port}`));
