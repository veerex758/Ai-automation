const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fieldMatches(field: string, value: number, min: number, max: number, dow = false): boolean {
  return field.split(",").some((part) => {
    const [base, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error("CRON_INVALID_STEP");
    let start = min, end = max;
    if (base !== "*") {
      const range = base.split("-");
      if (range.length === 1) {
        start = end = Number(range[0]);
      } else if (range.length === 2) {
        start = Number(range[0]); end = Number(range[1]);
      } else throw new Error("CRON_INVALID_FIELD");
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new Error("CRON_FIELD_OUT_OF_RANGE");
    }
    const normalized = dow && value === 0 ? [0, 7] : [value];
    return normalized.some((candidate) => candidate >= start && candidate <= end && (candidate - start) % step === 0);
  });
}

function partsAt(date: Date, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    minute: Number(value.minute), hour: Number(value.hour), day: Number(value.day),
    month: Number(value.month), weekday: weekdays.indexOf(value.weekday),
  };
}

export function validateCronExpression(expression: string): void {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("CRON_REQUIRES_FIVE_FIELDS");
  fieldMatches(fields[0], 0, 0, 59);
  fieldMatches(fields[1], 0, 0, 23);
  fieldMatches(fields[2], 1, 1, 31);
  fieldMatches(fields[3], 1, 1, 12);
  fieldMatches(fields[4], 0, 0, 7, true);
}

export function nextCronOccurrence(expression: string, timezone: string, after = new Date()): string {
  validateCronExpression(expression);
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(after); }
  catch { throw new Error("CRON_INVALID_TIMEZONE"); }
  const [minute, hour, day, month, weekday] = expression.trim().split(/\s+/);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, minute: "numeric", hour: "numeric", day: "numeric",
    month: "numeric", weekday: "short", hourCycle: "h23",
  });
  const start = Math.floor(after.getTime() / 60000) * 60000 + 60000;
  const limit = start + 366 * 5 * 24 * 60 * 60000;
  const domWildcard = day === "*";
  const dowWildcard = weekday === "*";
  for (let timestamp = start; timestamp <= limit; timestamp += 60000) {
    const date = new Date(timestamp);
    const parts = partsAt(date, formatter);
    const dayMatches = fieldMatches(day, parts.day, 1, 31);
    const weekdayMatches = fieldMatches(weekday, parts.weekday, 0, 7, true);
    const calendarMatches = domWildcard ? weekdayMatches : dowWildcard ? dayMatches : dayMatches || weekdayMatches;
    if (fieldMatches(minute, parts.minute, 0, 59) &&
        fieldMatches(hour, parts.hour, 0, 23) &&
        fieldMatches(month, parts.month, 1, 12) && calendarMatches) {
      return date.toISOString();
    }
  }
  throw new Error("CRON_NO_OCCURRENCE_WITHIN_HORIZON");
}
