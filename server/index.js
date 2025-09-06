// index.js
// 最小可用的海外网关：默认非流式，支持按需流式；显式放开 CORS 与预检
import "dotenv/config";
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();

// 解析 JSON
app.use(express.json({ limit: "1mb" }));

/**
 * CORS 设置：
 * - 初期联通：origin: "*" 方便前端调试
 * - 上线后：建议把 "*" 改成你的前端域名数组，例如：
 *   origin: ["https://xxx.pages.dev", "https://yourdomain.com"]
 */
const allowOrigin =
  process.env.CORS_ORIGINS?.split(",").map(s => s.trim()).filter(Boolean) ?? ["*"];

app.use(cors({
  origin: allowOrigin.length ? allowOrigin : "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// 预检（有些环境需要显式处理）
app.options("*", cors());

// 健康检查
app.get("/health", (_, res) => res.json({ ok: true }));

/**
 * 统一聊天入口：
 * body: { messages: [...], stream?: boolean, model?: string, max_tokens?, temperature? }
 * - 默认 stream=false（国内网络更稳）
 * - 需要逐字打印体验时，前端传 { stream: true } 即可
 */
app.post("/chat", async (req, res) => {
  const {
    messages,
    stream = false,                  // 默认非流式，稳
    model = "gpt-4o-mini",           // 低成本模型
    max_tokens = 512,                // 控费
    temperature = 0.7
  } = req.body || {};

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: { message: "OPENAI_API_KEY missing" } });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: "messages required" } });
  }

  // 请求体（可按需扩展）
  const payload = {
    model,
    messages,
    stream,          // 前端决定是否流式
    max_tokens,
    temperature
  };

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
    });

    // 非流式：拿整包 JSON 转发（最稳）
    if (!stream) {
      const data = await r.json();
      return res.status(r.ok ? 200 : r.status).json(data);
    }

    // 流式（SSE）转发：国内网络可能不稳定，失败时建议前端降级为非流式
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return res.status(r.status).send(errText || "Upstream error");
    }

    // 透传上游的 SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      // 对部分代理/平台禁用缓冲（若无效也没关系）
      "X-Accel-Buffering": "no"
    });

    for await (const chunk of r.body) {
      res.write(chunk);
    }
    res.end();
  } catch (e) {
    // 网络/上游异常
    res.status(502).json({ error: { message: `Upstream request failed: ${String(e)}` } });
  }
});

// 端口（本地开发用；Vercel 会忽略）
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`AI proxy listening on :${port}`));
