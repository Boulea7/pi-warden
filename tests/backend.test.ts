import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DECISIONS_BACKENDS, TypeSafeIntegrationError, createTypeSafe, noul, openUsageLedger } from "pi-typesafe";
import { backendName, bufferedFetch, describeBackend, disclosureFor, judgeOptions, loginStoresKey, resolveJudgmentBackend } from "../src/backend.js";

const gateway = { label: "Acme judge gateway", host: "https://gw.acme.example", path: "/judge/v1/decide", keyEnv: "ACME_JUDGE_KEY", defaultModel: "jev-1.13" };

test("resolveJudgmentBackend: names pass through, junk is refused instead of silently mapped to typesafe", () => {
  assert.deepEqual(resolveJudgmentBackend("typesafe"), { typesafeBackend: "typesafe" });
  assert.deepEqual(resolveJudgmentBackend("openrouter"), { typesafeBackend: "openrouter" });
  assert.deepEqual(resolveJudgmentBackend("commandcode"), { typesafeBackend: "commandcode" });
  assert.deepEqual(resolveJudgmentBackend(undefined), { typesafeBackend: "typesafe" });
  assert.deepEqual(resolveJudgmentBackend(null), { typesafeBackend: "typesafe" });
  for (const junk of ["", "azure", 42]) {
    const resolution = resolveJudgmentBackend(junk);
    assert.equal(resolution.typesafeBackend, undefined, `${JSON.stringify(junk)} must not fall back to typesafe`);
    assert.ok(resolution.backendRefusal, "the refusal message is kept for the notice and the status line");
  }
  assert.match(resolveJudgmentBackend("azure").backendRefusal!, /Unknown judgment backend "azure"/);
});

test("resolveJudgmentBackend: an endpoint object is kept as written, and one pi-typesafe refuses is refused here too", () => {
  assert.equal(resolveJudgmentBackend(gateway).typesafeBackend, gateway, "the object passes through unchanged; pi-typesafe validates it on every call");
  const bad = resolveJudgmentBackend({ label: "Acme judge gateway", host: "http://gw.acme.example", keyEnv: "ACME_JUDGE_KEY" });
  assert.equal(bad.typesafeBackend, undefined);
  assert.match(bad.backendRefusal!, /absolute https/);
});

test("loginStoresKey is true for every named backend and false for an endpoint", () => {
  assert.equal(loginStoresKey("typesafe"), true);
  assert.equal(loginStoresKey("openrouter"), true);
  assert.equal(loginStoresKey("commandcode"), true);
  assert.equal(loginStoresKey("liquid"), true);
  assert.equal(loginStoresKey("subq"), true);
  assert.equal(loginStoresKey(gateway), false, "an endpoint object never gets the TypeSafe login store");
});

test("backendName shows the registry name or the endpoint label", () => {
  assert.equal(backendName("typesafe"), "typesafe");
  assert.equal(backendName("openrouter"), "openrouter");
  assert.equal(backendName(gateway), "Acme judge gateway");
});

test("describeBackend names the label, host, and model sent", () => {
  assert.equal(describeBackend("typesafe"), "TypeSafe at api.typesafe.ai, model jev-latest");
  assert.equal(describeBackend("commandcode"), "Command Code at api.commandcode.ai, model typesafe/jev");
  assert.equal(describeBackend(gateway), "Acme judge gateway at gw.acme.example, model jev-1.13");
});

test("disclosureFor: typesafe returns the original text unchanged", () => {
  const text = "pi-warden sends to api.typesafe.ai: your latest request";
  assert.equal(disclosureFor("typesafe", text), text);
});

test("disclosureFor: openrouter replaces the host in the disclosure", () => {
  const text = "pi-warden sends to api.typesafe.ai: your latest request";
  const result = disclosureFor("openrouter", text);
  assert.match(result, /openrouter\.ai/);
  assert.doesNotMatch(result, /api\.typesafe\.ai/);
  assert.equal(result, "pi-warden sends to openrouter.ai: your latest request");
});

test("disclosureFor: an endpoint object replaces the host with its own", () => {
  const text = "pi-warden sends to api.typesafe.ai: your latest request";
  assert.equal(disclosureFor(gateway, text), "pi-warden sends to gw.acme.example: your latest request");
});

test("judgeOptions: typesafe backend omits the backend field", () => {
  const opts = judgeOptions({ maxRequests: 10, timeoutMs: 3000, typesafeBackend: "typesafe" });
  assert.equal(opts.maxRequests, 10);
  assert.equal(opts.timeoutMs, 3000);
  assert.equal("backend" in opts, false, "default backend should not be forwarded");
});

test("judgeOptions: commandcode and openrouter are forwarded as names", () => {
  assert.equal((judgeOptions({ maxRequests: 10, timeoutMs: 3000, typesafeBackend: "commandcode" }) as Record<string, unknown>).backend, "commandcode");
  assert.equal((judgeOptions({ maxRequests: 10, timeoutMs: 3000, typesafeBackend: "openrouter" }) as Record<string, unknown>).backend, "openrouter");
});

test("judgeOptions: an endpoint object reaches createTypeSafe unchanged", () => {
  const opts = judgeOptions({ maxRequests: 10, timeoutMs: 3000, typesafeBackend: gateway });
  assert.equal(opts.backend, gateway);
});

test("judgeOptions on Bun carries a fetch that keeps the SDK out of the body stream; on Node it adds nothing", () => {
  const onBun = process.versions?.bun !== undefined;
  const opts = judgeOptions({ maxRequests: 10, timeoutMs: 3000, typesafeBackend: gateway });
  assert.equal(typeof opts.fetch, onBun ? "function" : "undefined", "the transport is injected only where the SDK's buffering breaks responses");
});

test("bufferedFetch: a response whose clone() has no body survives the SDK's buffering, and its body stays readable", async () => {
  const body = JSON.stringify({ model: "jev-1.13-free", answers: { q1: { type: "noul", noul: 0.42 } }, usage: { input_tokens: 10, output_tokens: 1 } });
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(body);
  }).listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    // The SDK's attempt() attaches a signal for its timeout, and its bufferResponse() drains a
    // clone first. Reproduce both, then the parseBody() read that Bun breaks.
    const controller = new AbortController();
    const fetch = bufferedFetch();
    const response = await fetch(`http://127.0.0.1:${port}/judge`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json");
    const reader = response.clone().body?.getReader();
    assert.equal(reader, undefined, "the clone has no body, so the SDK's buffering returns early instead of locking the original stream");
    const parsed = JSON.parse(await response.text());
    assert.equal(parsed.answers.q1.noul, 0.42, "the original body stays readable after the buffering step");
  } finally {
    server.close();
  }
});

test("bufferedFetch: a non-2xx body still parses, and its status and headers pass through", async () => {
  const server = createServer((request, response) => {
    response.writeHead(422, { "content-type": "application/json", "retry-after": "2" });
    response.end('{"error":{"message":"bad"}}');
  }).listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const response = await bufferedFetch()(`http://127.0.0.1:${port}/judge`, {});
    assert.equal(response.status, 422);
    assert.equal(response.headers.get("retry-after"), "2");
    assert.equal(JSON.parse(await response.text()).error.message, "bad");
  } finally {
    server.close();
  }
});

test("backend hosts come from pi-typesafe's registry, not a local copy", () => {
  for (const backend of ["typesafe", "openrouter", "commandcode"] as const) {
    const host = new URL(DECISIONS_BACKENDS[backend].host).host;
    assert.match(describeBackend(backend), new RegExp(host.replace(/[.]/g, "\\.")));
  }
});

test("createTypeSafe(judgeOptions) sends a real judgment and parses the answer on this runtime", async () => {
  // The SDK's attempt() arms a timeout signal on every request and then buffers the response; on Bun,
  // that buffering used to leave the body unreadable, so this is the call that regressed.
  const answer = { model: "jev-1.13", answers: { risky: { type: "noul", noul: 0.42 } }, usage: { input_tokens: 10, output_tokens: 1 } };
  const seen: { url: string | undefined; body: unknown } = { url: undefined, body: undefined };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      seen.url = request.url;
      seen.body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(answer));
    });
  }).listen(0);
  const dir = mkdtempSync(join(tmpdir(), "pi-warden-judge-transport-"));
  try {
    const { port } = server.address() as AddressInfo;
    const judge = createTypeSafe({
      ...judgeOptions({ maxRequests: 2, timeoutMs: 5000, typesafeBackend: { label: "Local judge", host: `http://127.0.0.1:${port}`, keyEnv: "LOCAL_JUDGE_KEY", defaultModel: "jev-1.13" } }),
      apiKey: "local-test-key",
      ledger: openUsageLedger({ path: join(dir, "usage.json") }),
    });
    const result = await judge.evaluate({ state: "Approve this pull request", questions: { risky: noul("Is this change risky?") } });
    assert.equal(result.answers.risky.noul, 0.42, "the parsed answer comes back, so the transport left the body readable");
    assert.equal(seen.url, "/v1/systemone");
    assert.equal((seen.body as { model?: string }).model, "jev-1.13");
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a judge that accepts the request and never answers still times out on this runtime", async () => {
  // The shim reads the body itself before handing the response back, so a server that answers the
  // headers and never ends the body is the one path where its own body read could swallow the SDK's
  // timeout. The abort has to reach that read and reject the call, on Node and on Bun alike.
  let requests = 0;
  const held = new Set<Socket>();
  const server = createServer(() => {
    requests += 1;
    // Accept the request and never answer it.
  });
  server.on("connection", (socket: Socket) => {
    held.add(socket);
    socket.on("close", () => held.delete(socket));
  });
  server.listen(0);
  const dir = mkdtempSync(join(tmpdir(), "pi-warden-judge-timeout-"));
  try {
    const { port } = server.address() as AddressInfo;
    const judge = createTypeSafe({
      ...judgeOptions({ maxRequests: 2, timeoutMs: 150, typesafeBackend: { label: "Silent judge", host: `http://127.0.0.1:${port}`, keyEnv: "LOCAL_JUDGE_KEY", defaultModel: "jev-1.13" } }),
      apiKey: "local-test-key",
      ledger: openUsageLedger({ path: join(dir, "usage.json") }),
    });
    await assert.rejects(
      judge.evaluate({ state: "Approve this pull request", questions: { risky: noul("Is this change risky?") } }),
      (error: unknown) => {
        assert.ok(error instanceof TypeSafeIntegrationError, `expected pi-typesafe's timeout error, got ${String(error)}`);
        assert.equal(error.code, "timeout", "the timeout reaches the caller, not an unreadable-body failure");
        return true;
      },
    );
    // pi-typesafe constructs its client with retry: { maxRetries: 0 }, so a timed-out call is never re-sent.
    assert.equal(requests, 1, "a timed-out judgment is sent once, not retried");
  } finally {
    for (const socket of held) socket.destroy();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
