"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const { supabaseService, getUserFromToken } = require("../lib/supabase");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_PER_15MIN || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." },
});

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

router.get("/login", (req, res) => {
  res.render("login", { error: null, mode: "login" });
});

router.get("/signup", (req, res) => {
  res.render("login", { error: null, mode: "signup" });
});

router.post("/signup", loginLimiter, express.urlencoded({ extended: false }), async (req, res) => {
  const { email, password } = req.body;
  const { error } = await supabaseService.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no separate mail server assumed for this V1
  });
  if (error) {
    return res.status(400).render("login", { error: error.message, mode: "signup" });
  }
  res.redirect("/login?created=1");
});

router.post("/login", loginLimiter, express.urlencoded({ extended: false }), async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabaseService.auth.signInWithPassword({ email, password });

  // Deliberately generic — never reveal whether the email exists.
  if (error || !data?.session) {
    return res.status(401).render("login", { error: "Invalid email or password.", mode: "login" });
  }

  res.cookie("afd_sess", data.session.access_token, {
    ...COOKIE_OPTS,
    maxAge: data.session.expires_in * 1000,
  });
  res.redirect("/dashboard");
});

router.get("/logout", async (req, res) => {
  res.clearCookie("afd_sess", COOKIE_OPTS);
  res.redirect("/");
});

/** Express middleware: attaches req.user, or redirects to /login. */
async function requireUser(req, res, next) {
  const user = await getUserFromToken(req.cookies?.afd_sess);
  if (!user) {
    return res.redirect("/login?next=" + encodeURIComponent(req.originalUrl));
  }
  req.user = user;
  next();
}

module.exports = { router, requireUser };
