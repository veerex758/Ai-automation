import assert from "node:assert/strict";
import test from "node:test";
import { isUnsafeAddress } from "../lib/workflows/safe-http-transport";

test("IPv4 private, loopback, link-local and reserved targets are rejected", () => {
  for (const address of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "224.0.0.1"]) {
    assert.equal(isUnsafeAddress(address), true, address);
  }
});

test("public IPv4 targets remain eligible", () => {
  for (const address of ["1.1.1.1", "8.8.8.8", "93.184.216.34"]) {
    assert.equal(isUnsafeAddress(address), false, address);
  }
});

test("IPv6 rejects non-global and special-purpose ranges", () => {
  for (const address of ["::", "::1", "fc00::1", "fd00::1", "fe80::1", "ff02::1", "2001:db8::1", "2001:2::1", "2002::1", "64:ff9b::a00:1"]) {
    assert.equal(isUnsafeAddress(address), true, address);
  }
});

test("IPv6 global-unicast targets remain eligible", () => {
  for (const address of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isUnsafeAddress(address), false, address);
  }
});

test("IPv4-mapped IPv6 inherits IPv4 restrictions", () => {
  assert.equal(isUnsafeAddress("::ffff:127.0.0.1"), true);
  assert.equal(isUnsafeAddress("::ffff:7f00:1"), true);
  assert.equal(isUnsafeAddress("::ffff:8.8.8.8"), false);
});
