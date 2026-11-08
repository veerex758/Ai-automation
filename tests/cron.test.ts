import { test } from "node:test";
import assert from "node:assert/strict";
import { nextCronOccurrence, validateCronExpression } from "../lib/workflows/cron";

test("cron calculator evaluates five-field expressions in an IANA timezone", () => {
  assert.equal(nextCronOccurrence("*/15 * * * *", "UTC", new Date("2026-11-04T10:07:00.000Z")), "2026-11-04T10:15:00.000Z");
  assert.equal(nextCronOccurrence("15 10 * * *", "Africa/Lagos", new Date("2026-11-04T09:07:00.000Z")), "2026-11-04T09:15:00.000Z");
});

test("cron validation rejects unsupported syntax and out-of-range values", () => {
  assert.throws(() => validateCronExpression("* * * *"), /CRON_REQUIRES_FIVE_FIELDS/);
  assert.throws(() => validateCronExpression("60 * * * *"), /CRON_FIELD_OUT_OF_RANGE/);
  assert.throws(() => nextCronOccurrence("* * * * *", "Not/A_Timezone"), /CRON_INVALID_TIMEZONE/);
});
