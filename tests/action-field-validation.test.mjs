import test from "node:test";
import assert from "node:assert/strict";
import validation from "../lib/workflows/action-field-validation.cjs";

const { isValidEmail, isHttpsUrl } = validation;

test("accepts common valid email addresses", () => {
  assert.equal(isValidEmail("ops@example.com"), true);
  assert.equal(isValidEmail("first.last+alerts@example.co.uk"), true);
});

test("rejects malformed email addresses and whitespace", () => {
  for (const value of ["", "not-an-email", "missing@domain", "two@@example.com", "has space@example.com", "ops@example .com"]) {
    assert.equal(isValidEmail(value), false, value);
  }
});

test("accepts HTTPS URLs only", () => {
  assert.equal(isHttpsUrl("https://example.com/hook"), true);
  assert.equal(isHttpsUrl("https://example.com"), true);
});

test("rejects insecure or malformed URLs", () => {
  for (const value of ["", "http://example.com/hook", "javascript:alert(1)", "not a URL"]) {
    assert.equal(isHttpsUrl(value), false, value);
  }
});
