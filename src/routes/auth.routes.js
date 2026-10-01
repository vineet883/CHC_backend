const express = require("express");

const {
  register,
  login,
  me
} = require("../controllers/auth.controller");

const authenticate = require("../middleware/auth.middleware");

const router = express.Router();


// POST /api/auth/register
router.post("/register", register);


// POST /api/auth/login
router.post("/login", login);


// GET /api/auth/me
router.get("/me", authenticate, me);


module.exports = router;