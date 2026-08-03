// @vitest-environment node
import http, { type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  classifyUpstreamError,
  customFetch,
  UpstreamAbortError,
  UpstreamTimeoutError,
} from "./iptv-upstream.server";

let server: Server;
let origin = "";
let redirectClosed = false;
let cancelledClosed = false;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/headers-first") {
      res.writeHead(200, { "content-type": "video/mp2t" });
      res.flushHeaders();
      setTimeout(() => res.write(Buffer.from([1, 2, 3])), 80);
      setTimeout(() => res.end(Buffer.from([4, 5, 6])), 300);
      return;
    }
    if (req.url === "/progress") {
      res.writeHead(200);
      res.flushHeaders();
      let sent = 0;
      const timer = setInterval(() => {
        res.write("x");
        sent += 1;
        if (sent === 11) {
          clearInterval(timer);
          res.end();
        }
      }, 1_000);
      return;
    }
    if (req.url === "/idle") {
      res.writeHead(200);
      res.write("x");
      return;
    }
    if (req.url === "/redirect") {
      res.on("close", () => {
        redirectClosed = true;
      });
      res.writeHead(302, { location: "/final" });
      res.end("discard me");
      return;
    }
    if (req.url === "/final") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("redirected");
      return;
    }
    if (req.url === "/range") {
      const range = req.headers.range;
      res.writeHead(range === "bytes=2-4" ? 206 : 400, {
        "content-range": "bytes 2-4/10",
        "accept-ranges": "bytes",
        "content-length": "3",
      });
      res.end("234");
      return;
    }
    if (req.url === "/cancel") {
      req.on("close", () => {
        cancelledClosed = true;
      });
      res.writeHead(200);
      res.write("first");
      const timer = setInterval(() => res.write("more"), 20);
      res.on("close", () => clearInterval(timer));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server failed");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("customFetch streaming client", () => {
  it("resolves after headers, before the complete body", async () => {
    const started = Date.now();
    const response = await customFetch(`${origin}/headers-first`, { idleTimeoutMs: 1_000 });
    expect(Date.now() - started).toBeLessThan(150);
    expect((await response.arrayBuffer()).byteLength).toBe(6);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });

  it("does not kill a slow stream while bytes keep progressing", async () => {
    const response = await customFetch(`${origin}/progress`, {
      headersTimeoutMs: 100,
      idleTimeoutMs: 1_500,
    });
    expect(await response.text()).toBe("xxxxxxxxxxx");
  }, 15_000);

  it("aborts an idle response with a consistently classified AbortError", async () => {
    const response = await customFetch(`${origin}/idle`, { idleTimeoutMs: 60 });
    await expect(response.text()).rejects.toMatchObject({ name: "AbortError" });
    expect(classifyUpstreamError(new UpstreamTimeoutError("idle"))).toBe("idle_timeout");
    expect(classifyUpstreamError(new UpstreamAbortError())).toBe("client_abort");
  });

  it("follows redirects and drains the redirect response", async () => {
    const response = await customFetch(`${origin}/redirect`);
    expect(await response.text()).toBe("redirected");
    expect(response.url).toBe(`${origin}/final`);
    expect(redirectClosed).toBe(true);
  });

  it("forwards Range and preserves 206 range response headers", async () => {
    const response = await customFetch(`${origin}/range`, { headers: { Range: "bytes=2-4" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("3");
  });

  it("closes the native upstream request when the web body is cancelled", async () => {
    const response = await customFetch(`${origin}/cancel`);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel("viewer left");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(cancelledClosed).toBe(true);
  });
});
