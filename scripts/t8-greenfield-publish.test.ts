import { describe, expect, it, vi } from "vitest";
import {
  T8_GREENFIELD_LEASE_DURATION_MS,
  T8_GREENFIELD_MAX_SEAL_POLLS,
  T8_GREENFIELD_SEAL_BACKOFF_MS,
  publicationConfiguration,
  readT8GreenfieldCliConfig,
  t8GreenfieldSealBackoffBudgetMs,
  t8GreenfieldSleep
} from "./t8-greenfield-publish.js";

describe("T8 Greenfield runtime scheduling", () => {
  it("keeps the configured lease longer than the complete bounded seal backoff", () => {
    const config = publicationConfiguration(readT8GreenfieldCliConfig({}));
    const backoffBudgetMs = t8GreenfieldSealBackoffBudgetMs(config.maxSealPolls, config.sealBackoffMs);
    expect(config.maxSealPolls).toBe(T8_GREENFIELD_MAX_SEAL_POLLS);
    expect(config.sealBackoffMs).toEqual([...T8_GREENFIELD_SEAL_BACKOFF_MS]);
    expect(config.leaseDurationMs).toBe(T8_GREENFIELD_LEASE_DURATION_MS);
    expect(config.leaseDurationMs).toBeGreaterThan(backoffBudgetMs);
    expect(backoffBudgetMs).toBe(31_000);
  });

  it("provides a real asynchronous timer for publisher seal polling", async () => {
    vi.useFakeTimers();
    try {
      let completed = false;
      const pending = t8GreenfieldSleep(25).then(() => {
        completed = true;
      });
      expect(completed).toBe(false);
      await vi.advanceTimersByTimeAsync(24);
      expect(completed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(completed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
