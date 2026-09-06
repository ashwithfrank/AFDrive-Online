"use strict";

require("dotenv").config();

const http = require("http");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { Server: SocketIOServer } = require("socket.io");

const { attachAgentSocketHandlers } = require("./routes/agentSocket");
const proxyRouter = require("./routes/proxy");
const agentRegisterRouter = require("./routes/agentRegister");
const adminActionsRouter = require("./routes/adminActions");

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: false }, // Agents connect via the socket.io client library, not a browser page
  maxHttpBufferSize: 1e6, // 1MB per Socket.IO frame; large payloads are already chunked (see shared/protocol.md)
});

app.set("trust proxy", 1); // if deployed behind a load balancer/CDN

// This process no longer serves any human-facing page — the frontend is
// a separate static site (see /site) deployed on GitHub Pages. Every
// route here is an API called either by that static site's JavaScript
// (over CORS, authenticated with a Supabase access token) or by an
// AFDrive Agent (agent/tunnel_client.py, agent/setup_cli.py).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  helmet({
    contentSecurityPolicy: false, // no HTML views are rendered by this process anymore
  })
);
app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin/non-browser tools (no Origin header) and any
      // configured static-site origin. Reject everything else so a
      // random third-party page can't drive the relay from a visitor's
      // browser using their still-valid Supabase session.
      if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed by CORS policy"));
    },
    credentials: false, // auth is a Bearer token in the Authorization header, never a cookie
  })
);

// IMPORTANT ORDERING: the proxy route needs the raw, unparsed request
// stream (see routes/proxy.js) so it is mounted before any body-parsing
// middleware.
app.use(proxyRouter);

app.use(express.json());
app.use(agentRegisterRouter);
app.use(adminActionsRouter);

app.get("/health", (req, res) => res.json({ ok: true }));

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found." });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (err && err.message === "Origin not allowed by CORS policy") {
    return res.status(403).json({ ok: false, error: "Origin not allowed." });
  }
  res.status(500).json({ ok: false, error: "Something went wrong." });
});

attachAgentSocketHandlers(io);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`AFDrive relay listening on :${PORT}`);
});
