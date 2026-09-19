const jwt = require("jsonwebtoken");

/**
 * Verifies the Bearer token on the request and attaches the decoded
 * payload ({ id, role }) to req.user. Rejects the request if the token
 * is missing or invalid.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed authorization header" });
  }

  const token = header.split(" ")[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Restricts a route to one or more roles. Use after requireAuth.
 * Example: router.post("/vendors", requireAuth, requireRole("VENDOR"), handler)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `This action requires one of these roles: ${roles.join(", ")}` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
