import { describe, it, expect } from "vitest";
import { nextDayUTC } from "./dateRange";

describe("nextDayUTC", () => {
  it("advances a normal day", () => {
    expect(nextDayUTC("2026-06-17")).toBe("2026-06-18");
  });

  it("rolls over end-of-month (June 30 → July 01)", () => {
    expect(nextDayUTC("2026-06-30")).toBe("2026-07-01");
  });

  it("rolls over end-of-year (Dec 31 → Jan 01 next year)", () => {
    expect(nextDayUTC("2026-12-31")).toBe("2027-01-01");
  });

  it("handles leap-year day (Feb 28 → Feb 29 in 2024)", () => {
    expect(nextDayUTC("2024-02-28")).toBe("2024-02-29");
  });

  it("handles leap-year end (Feb 29 → Mar 01 in 2024)", () => {
    expect(nextDayUTC("2024-02-29")).toBe("2024-03-01");
  });
});
