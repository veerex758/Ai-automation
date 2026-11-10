import assert from "node:assert/strict";
import test from "node:test";
import { isPublicAddress } from "../nodes/safe-http";

test("only public global-unicast IPv6 targets are eligible", () => {
  for (const address of ["::", "::1", "fc00::1", "fd00::1", "fe80::1", "ff02::1", "2001:0::1", "2001:2::1", "2001:10::1", "2001:20::1", "2001:db8::1", "2002::1", "64:ff9b::a00:1", "3fff::1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test("IPv4-mapped IPv6 targets inherit IPv4 safety classification", () => {
  assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
  assert.equal(isPublicAddress("::ffff:7f00:1"), false);
  assert.equal(isPublicAddress("::ffff:169.254.169.254"), false);
  assert.equal(isPublicAddress("::ffff:8.8.8.8"), true);
  assert.equal(isPublicAddress("::ffff:808:808"), true);
});
