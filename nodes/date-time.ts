import { z } from "zod";
import type { NodeDefinition } from "./types";

const timestamp = z.union([z.string().min(1).max(100), z.number().finite()]);
const formatInput = z.object({
  timestamp,
  timeZone: z.string().min(1).max(100).default("UTC"),
  style: z.enum(["iso", "date", "time", "datetime", "weekday"]).default("datetime"),
}).strict();
const compareInput = z.object({ left: timestamp, right: timestamp }).strict();
const durationInput = z.object({
  start: timestamp,
  end: timestamp,
  unit: z.enum(["milliseconds", "seconds", "minutes", "hours", "days"]).default("seconds"),
  decimals: z.number().int().min(0).max(6).default(2),
}).strict();
const output = z.object({ value: z.string(), epochMs: z.number().finite() }).strict();

function epoch(value: string | number): number {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("DATETIME_INVALID_TIMESTAMP");
  return parsed;
}

export const dateTimeNode: NodeDefinition = {
  id: "date_time", name: "Date & Time", icon: "calendar-clock", category: "data", version: 1,
  auth: { type: "none" }, triggers: [],
  actions: [
    {
      id: "format_timestamp", name: "Format timestamp",
      description: "Formats an ISO timestamp or epoch-millisecond value using an explicit IANA time zone. Styles: ISO, date, time, datetime or weekday.",
      inputSchema: formatInput, outputSchema: output,
      async run(_ctx, raw) {
        const input = formatInput.parse(raw);
        const value = epoch(input.timestamp);
        if (input.style === "iso") return { value: new Date(value).toISOString(), epochMs: value };
        let dateStyle: Intl.DateTimeFormatOptions["dateStyle"];
        let timeStyle: Intl.DateTimeFormatOptions["timeStyle"];
        if (input.style === "date") dateStyle = "medium";
        else if (input.style === "time") timeStyle = "medium";
        else if (input.style === "weekday") dateStyle = "full";
        else { dateStyle = "medium"; timeStyle = "short"; }
        try {
          const formatter = new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone, dateStyle, timeStyle });
          return { value: formatter.format(new Date(value)), epochMs: value };
        } catch { throw new Error("DATETIME_TIME_ZONE_INVALID"); }
      },
    },
    {
      id: "compare_dates", name: "Compare dates",
      description: "Compares two timestamps and returns their chronological order and exact difference in milliseconds.",
      inputSchema: compareInput,
      outputSchema: z.object({ comparison: z.enum(["before", "equal", "after"]), differenceMs: z.number().finite(), differenceSeconds: z.number().finite() }).strict(),
      async run(_ctx, raw) {
        const input = compareInput.parse(raw);
        const left = epoch(input.left);
        const right = epoch(input.right);
        return { comparison: left < right ? "before" : left > right ? "after" : "equal", differenceMs: right - left, differenceSeconds: (right - left) / 1000 };
      },
    },
    {
      id: "calculate_duration", name: "Calculate duration",
      description: "Calculates a signed duration between start and end timestamps in milliseconds, seconds, minutes, hours or days.",
      inputSchema: durationInput,
      outputSchema: z.object({ duration: z.number().finite(), unit: z.string(), milliseconds: z.number().finite() }).strict(),
      async run(_ctx, raw) {
        const input = durationInput.parse(raw);
        const milliseconds = epoch(input.end) - epoch(input.start);
        const divisor = { milliseconds: 1, seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 }[input.unit];
        const factor = 10 ** input.decimals;
        return { duration: Math.round((milliseconds / divisor) * factor) / factor, unit: input.unit, milliseconds };
      },
    },
  ],
};
