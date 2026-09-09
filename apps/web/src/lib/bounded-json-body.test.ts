import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedJsonBody } from "./bounded-json-body";

describe("bounded public JSON body", () => {
  afterEach(() => vi.useRealTimers());
  it("parses a small body and rejects declared or streamed overflow", async () => {
    await expect(boundedJsonBody(new Request("https://app.example", {method:"POST",body:'{"ok":true}'}))).resolves.toEqual({ok:true});
    await expect(boundedJsonBody(new Request("https://app.example", {method:"POST",headers:{"content-length":"90000"},body:"{}"}))).rejects.toThrow("BODY_LIMIT");
    await expect(boundedJsonBody(new Request("https://app.example", {method:"POST",body:'{"large":true}'}),4)).rejects.toThrow("BODY_LIMIT");
  });
  it("cancels a stalled stream at the deadline", async () => {
    vi.useFakeTimers();
    const cancel=vi.fn();
    const request=new Request("https://app.example", {method:"POST",body:new ReadableStream({cancel}),duplex:"half"} as RequestInit);
    const assertion=expect(boundedJsonBody(request)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
  });
});
