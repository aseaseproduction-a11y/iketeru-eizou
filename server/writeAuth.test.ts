import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { assertAllowedExternalMediaUrl } from "./externalMediaMetadata";
import type { TrpcContext } from "./_core/context";

function makeCtx(headers: Record<string, string> = {}, role?: "admin" | "user"): TrpcContext {
  return {
    req: { headers } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
    user: role
      ? ({
          id: 1,
          openId: "test-open-id",
          name: "Test",
          email: "test@example.com",
          loginMethod: "oauth",
          role,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastSignedIn: new Date(),
        } as TrpcContext["user"])
      : null,
  };
}

describe("writeProtectedProcedure on videos write mutations", () => {
  const prevKey = process.env.ADMIN_API_KEY;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = "super-secret-test-key-12345";
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prevKey;
  });

  it("rejects unauthenticated videos.delete with UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.videos.delete({ id: "test-id" })).rejects.toThrow("ADMIN_KEY_REQUIRED");
  });

  it("rejects wrong x-admin-api-key on videos.delete with UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller(makeCtx({ "x-admin-api-key": "wrong-key" }));
    await expect(caller.videos.delete({ id: "test-id" })).rejects.toThrow("ADMIN_KEY_REQUIRED");
  });

  it("rejects when ADMIN_API_KEY env is unset (fail-closed)", async () => {
    delete process.env.ADMIN_API_KEY;
    const caller = appRouter.createCaller(makeCtx({ "x-admin-api-key": "anything" }));
    await expect(caller.videos.delete({ id: "test-id" })).rejects.toThrow("ADMIN_KEY_REQUIRED");
  });

  it("rejects non-admin user without API key", async () => {
    const caller = appRouter.createCaller(makeCtx({}, "user"));
    await expect(caller.videos.delete({ id: "test-id" })).rejects.toThrow("ADMIN_KEY_REQUIRED");
  });

  it("rejects unauthenticated recordEmbedStatus, previewExternalMedia, and favorites mutations", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.videos.recordEmbedStatus({ id: "test-id", status: "restricted" })).rejects.toThrow("ADMIN_KEY_REQUIRED");
    await expect(caller.videos.previewExternalMedia({ platform: "vimeo", url: "https://vimeo.com/123" })).rejects.toThrow("ADMIN_KEY_REQUIRED");
    await expect(caller.favorites.createProfile({ displayName: "attacker" })).rejects.toThrow("ADMIN_KEY_REQUIRED");
  });
});

describe("SSRF allowlist in assertAllowedExternalMediaUrl", () => {
  it("blocks metadata IPs, localhost, http, and non-allowlisted domains", () => {
    expect(() => assertAllowedExternalMediaUrl("vimeo", "http://169.254.169.254/latest/meta-data/")).toThrow();
    expect(() => assertAllowedExternalMediaUrl("vimeo", "https://127.0.0.1/secret")).toThrow();
    expect(() => assertAllowedExternalMediaUrl("x", "https://localhost:4000/admin")).toThrow();
    expect(() => assertAllowedExternalMediaUrl("vimeo", "https://evil.example.com/vimeo.com")).toThrow();
    expect(() => assertAllowedExternalMediaUrl("vimeo", "http://vimeo.com/12345")).toThrow();
  });

  it("allows valid HTTPS allowlisted domains", () => {
    expect(assertAllowedExternalMediaUrl("vimeo", "https://vimeo.com/12345").hostname).toBe("vimeo.com");
    expect(assertAllowedExternalMediaUrl("x", "https://x.com/user/status/1").hostname).toBe("x.com");
    expect(assertAllowedExternalMediaUrl("tiktok", "https://www.tiktok.com/@a/video/1").hostname).toBe("www.tiktok.com");
  });
});
