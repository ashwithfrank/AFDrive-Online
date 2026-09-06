"use strict";

const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const { supabaseService } = require("../lib/supabase");

const router = express.Router();

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.REGISTER_RATE_LIMIT_PER_15MIN || 10),
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/agent/register — see shared/protocol.md, section 1.
router.post("/api/agent/register", registerLimiter, express.json(), async (req, res) => {
  const { pairing_code: pairingCode, display_name: displayName, device_hint: deviceHint } =
    req.body || {};

  if (!pairingCode || typeof pairingCode !== "string") {
    return res.status(400).json({ error: "pairing_code is required" });
  }

  const { data: pairing, error: pairingError } = await supabaseService
    .from("pairing_codes")
    .select("code, owner_id, expires_at, used_at")
    .eq("code", pairingCode.trim().toUpperCase())
    .maybeSingle();

  if (pairingError || !pairing) {
    return res.status(400).json({ error: "Invalid or unknown pairing code." });
  }
  if (pairing.used_at) {
    return res.status(400).json({ error: "This pairing code has already been used." });
  }
  if (new Date(pairing.expires_at) < new Date()) {
    return res.status(400).json({ error: "This pairing code has expired. Generate a new one." });
  }

  const deviceSecret = crypto.randomBytes(32).toString("hex");
  const deviceSecretHash = await bcrypt.hash(deviceSecret, 12);

  const { data: server, error: insertError } = await supabaseService
    .from("servers")
    .insert({
      owner_id: pairing.owner_id,
      display_name: (displayName || "My AFDrive").slice(0, 80),
      device_hint: (deviceHint || "").slice(0, 120),
      device_secret_hash: deviceSecretHash,
      is_public: false,
      status: "offline",
    })
    .select("id")
    .single();

  if (insertError || !server) {
    return res.status(500).json({ error: "Could not register this device. Try again." });
  }

  await supabaseService
    .from("pairing_codes")
    .update({ used_at: new Date().toISOString(), server_id: server.id })
    .eq("code", pairing.code);

  await supabaseService.from("audit_log").insert({
    server_id: server.id,
    user_id: pairing.owner_id,
    event: "server_registered",
  });

  // The plaintext device_secret is returned exactly once, here. The
  // relay only ever stores the bcrypt hash from this point forward.
  res.json({ device_id: server.id, device_secret: deviceSecret });
});

module.exports = router;
