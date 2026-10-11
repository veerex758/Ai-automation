/* global module */
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @param {unknown} value */
function isValidEmail(value) {
  return typeof value === "string" && emailPattern.test(value.trim());
}

/** @param {unknown} value */
function isHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

module.exports = { isValidEmail, isHttpsUrl };
