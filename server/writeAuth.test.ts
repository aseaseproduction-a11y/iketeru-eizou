import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
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
});
