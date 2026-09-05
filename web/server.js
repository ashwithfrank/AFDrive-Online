"use strict";

require("dotenv").config();

const path = require("path");
const http = require("http");
const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const { Server: SocketIOServer } = require("socket.io");

const { attachAgentSocketHandlers } = require("./routes/agentSocket");
const proxyRouter = require("./routes/proxy");
const agentRegisterRouter = require("./routes/agentRegister");
const directoryRouter = require("./routes/directory");
const { router: authRouter } = require("./routes/auth");
const dashboardRouter = require("./routes/dashboard");

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: false }, // Agents connect via the socket.io client library, not a browser page
  maxHttpBufferSize: 1e6, // 1MB per Socket.IO frame; large payloads are already chunked (see shared/protocol.md)
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1); // if deployed behind a load balancer/CDN

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
      },
    },
  })
);

// IMPORTANT ORDERING: the proxy route needs the raw, unparsed request
// stream (see routes/proxy.js) so it is mounted before any body-parsing
// middleware. It only needs cookies (for the access check), never a
// parsed JSON/form body.
app.use(cookieParser());
app.use(proxyRouter);

// Everything past this point may safely use standard body parsing.
app.use(express.static(path.join(__dirname, "public")));
app.use(agentRegisterRouter);
app.use(directoryRouter);
app.use(authRouter);
app.use("/dashboard", dashboardRouter);

app.use((req, res) => {
  res.status(404).render("error", { code: 404, message: "Page not found." });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("error", { code: 500, message: "Something went wrong." });
});

attachAgentSocketHandlers(io);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`AFDrive Online listening on :${PORT}`);
});
