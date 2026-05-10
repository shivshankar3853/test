function validateSignal(s) {
  if (!s) return false;

  if (!s.TT || !s.TS || !s.Q) {
    return { ok: false, error: "Missing required fields" };
  }

  if (isNaN(Number(s.Q)) || Number(s.Q) <= 0) {
    return { ok: false, error: "Invalid quantity" };
  }

  return { ok: true };
}

module.exports = { validateSignal };