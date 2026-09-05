"use strict";

const express = require("express");
const { supabaseService } = require("../lib/supabase");
const registry = require("../lib/proxyRegistry");

const router = express.Router();

router.get("/", (req, res) => {
  res.render("landing");
});

router.get("/directory", async (req, res) => {
  const q = (req.query.q || "").trim();

  let query = supabaseService
    .from("servers")
    .select("id, display_name, status, last_seen_at")
    .eq("is_public", true)
    .is("revoked_at", null)
    .order("display_name", { ascending: true });

  if (q) {
    query = query.ilike("display_name", `%${q}%`);
  }

  const { data: servers } = await query;

  // The DB's `status` column can lag a few seconds behind an actual
  // disconnect; reconcile against the relay's own live socket registry
  // before showing anyone a green dot.
  const withLiveStatus = (servers || []).map((s) => ({
    ...s,
    online: registry.isAgentOnline(s.id),
  }));

  res.render("directory", { servers: withLiveStatus, q });
});

module.exports = router;
