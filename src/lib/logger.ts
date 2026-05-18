import { pino } from "pino";

export function makeLogger(level: string) {
  return pino({
    level,
    base: { service: "routy-edge" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof makeLogger>;
