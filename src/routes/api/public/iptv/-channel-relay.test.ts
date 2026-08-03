// @vitest-environment node
import http, { type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetGlobalIptvRelayForTests } from "@/lib/global-iptv-relay.server";
import { sealRelayUrl } from "@/lib/iptv-relay-token.server";
import { handleGlobalRelaySegment } from "./channel.$channelId.segment";

let server: Server;
let origin = "";
let handler: (request: http.IncomingMessage, response: http.ServerResponse) => void;

beforeAll(async () => {
  process.env.IPTV_PROXY_SIGNING_KEY = "public-route-test-signing-key-with-enough-entropy";
  server = http.createServer((request, response) => handler(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  origin = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => resetGlobalIptvRelayForTests());

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("public IPTV channel segment route", () => {
  it("preserves Range/206 headers and adds safe diagnostics", async () => {
    let range: string | undefined;
    handler = (request, response) => {
      range = request.headers.range;
      response.writeHead(206, {
        "content-type": "video/mp2t",
        "content-length": "8",
        "content-range": "bytes 8-15/16",
        "accept-ranges": "bytes",
      });
      response.end(Buffer.from([0x47, 0x40, 0, 0, 0, 0, 0, 0]));
    };
    const channelId = "1536951";
    const scope = `global-xtream:${channelId}`;
    const token = sealRelayUrl(scope, `${origin}/media.ts`);
    const response = await handleGlobalRelaySegment(
      new Request(`https://app.test/api/public/iptv/channel/${channelId}/segment?token=${token}`, {
        headers: { Range: "bytes=8-15" },
      }),
      channelId,
    );

    expect(range).toBe("bytes=8-15");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 8-15/16");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("8");
    expect(response.headers.get("x-iptv-cache")).toBe("miss");
    expect(response.headers.get("x-iptv-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("server-timing")).toContain("upstream_headers");
    expect(new Uint8Array(await response.arrayBuffer())).toHaveLength(8);
  });

  it("returns actual upstream 404 instead of a synthetic cached gap", async () => {
    handler = (_request, response) => response.writeHead(404).end();
    const channelId = "1536951";
    const scope = `global-xtream:${channelId}`;
    const token = sealRelayUrl(scope, `${origin}/missing.ts`);
    const response = await handleGlobalRelaySegment(
      new Request(`https://app.test/api/public/iptv/channel/${channelId}/segment?token=${token}`),
      channelId,
    );
    expect(response.status).toBe(404);
  });
});
