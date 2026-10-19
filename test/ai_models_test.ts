import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  fetchModelList,
  forwardModelsProxy,
  modelAfterProviderChange,
  ModelListError,
  modelsRequestHeaders,
  modelsUrlFromEndpoint,
  parseModelsResponse,
} from "@intehrgrator/core/ai/models.ts";
import { REDACTED_KEY } from "@intehrgrator/core/ai/redact.ts";

Deno.test("modelsUrlFromEndpoint derives <base>/models for provider quirks", () => {
  const cases: Array<[string, string]> = [
    [
      "https://api.openai.com/v1/chat/completions",
      "https://api.openai.com/v1/models",
    ],
    [
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      "https://generativelanguage.googleapis.com/v1beta/openai/models",
    ],
    [
      "https://openrouter.ai/api/v1/chat/completions",
      "https://openrouter.ai/api/v1/models",
    ],
    [
      "http://127.0.0.1:11434/v1/chat/completions",
      "http://127.0.0.1:11434/v1/models",
    ],
    [
      "http://127.0.0.1:1234/v1/chat/completions/",
      "http://127.0.0.1:1234/v1/models",
    ],
    [
      "https://router.huggingface.co/v1/chat/completions",
      "https://router.huggingface.co/v1/models",
    ],
    [
      "https://opencode.ai/zen/v1/chat/completions?x=1",
      "https://opencode.ai/zen/v1/models",
    ],
    ["https://example.test/v1", "https://example.test/v1/models"],
    ["https://example.test/v1/models", "https://example.test/v1/models"],
  ];
  for (const [endpoint, expected] of cases) {
    assertEquals(modelsUrlFromEndpoint(endpoint), expected, endpoint);
  }
  for (const bad of ["", "not a url", "ftp://x/v1/chat/completions"]) {
    try {
      modelsUrlFromEndpoint(bad);
      throw new Error(`expected failure for ${bad}`);
    } catch (err) {
      assertEquals((err as ModelListError).kind, "endpoint");
    }
  }
});

Deno.test("modelsRequestHeaders: Bearer, Anthropic extras, none for keyless local", () => {
  assertEquals(
    modelsRequestHeaders("https://api.openai.com/v1/models", "sk-1")
      .authorization,
    "Bearer sk-1",
  );
  const anthropic = modelsRequestHeaders(
    "https://api.anthropic.com/v1/models",
    "ak-1",
  );
  assertEquals(anthropic["x-api-key"], "ak-1");
  assertEquals(anthropic["anthropic-version"], "2023-06-01");
  assertEquals(
    modelsRequestHeaders("http://127.0.0.1:11434/v1/models", "").authorization,
    undefined,
  );
});

Deno.test("parseModelsResponse handles OpenAI, Gemini, Ollama and bare lists", () => {
  assertEquals(
    parseModelsResponse({
      object: "list",
      data: [{ id: "gpt-4.1" }, { id: "gpt-4.1-mini" }],
    }),
    [
      "gpt-4.1",
      "gpt-4.1-mini",
    ],
  );
  assertEquals(
    parseModelsResponse({
      data: [{ id: "models/gemini-3.8-flash" }, {
        id: "models/gemini-3.8-pro",
      }],
    }),
    [
      "gemini-3.8-flash",
      "gemini-3.8-pro",
    ],
  );
  assertEquals(
    parseModelsResponse({
      models: [{ name: "llama3:8b" }, { model: "gpt-oss:20b" }],
    }),
    [
      "gpt-oss:20b",
      "llama3:8b",
    ],
  );
  assertEquals(parseModelsResponse(["b", "a", "a", { id: "c" }]), [
    "a",
    "b",
    "c",
  ]);
  assertEquals(parseModelsResponse({ nothing: true }), []);
  assertEquals(parseModelsResponse(null), []);
});

Deno.test("fetchModelList GETs <base>/models with the key and parses the list", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchStub = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify({ data: [{ id: "m2" }, { id: "m1" }] }), {
        status: 200,
      }),
    );
  }) as typeof fetch;
  const models = await fetchModelList(
    "https://api.openai.com/v1/chat/completions",
    "sk-test",
    { fetch: fetchStub },
  );
  assertEquals(models, ["m1", "m2"]);
  assertEquals(calls[0]!.url, "https://api.openai.com/v1/models");
  assertEquals(calls[0]!.init?.method, "GET");
  assertEquals(
    (calls[0]!.init?.headers as Record<string, string>).authorization,
    "Bearer sk-test",
  );
});

Deno.test("fetchModelList via desktop proxy POSTs endpoint + key", async () => {
  let seen: { url: string; body: unknown } | null = null;
  const fetchStub = ((url: string, init?: RequestInit) => {
    seen = { url, body: JSON.parse(String(init?.body)) };
    return Promise.resolve(
      new Response(JSON.stringify({ data: [{ id: "x" }] }), { status: 200 }),
    );
  }) as typeof fetch;
  await fetchModelList("https://api.openai.com/v1/chat/completions", "sk-p", {
    fetch: fetchStub,
    proxyUrl: "/api/v1/ai-models",
  });
  assertEquals(seen!.url, "/api/v1/ai-models");
  assertEquals(seen!.body, {
    endpoint: "https://api.openai.com/v1/models",
    apiKey: "sk-p",
  });
});

Deno.test("fetchModelList errors: auth, http, network, parse, empty — key redacted", async () => {
  const respond = (status: number, body: string) =>
    (() =>
      Promise.resolve(
        new Response(body, { status }),
      )) as unknown as typeof fetch;
  const key = "sk-secret-123456";
  const auth = await assertRejects(
    () =>
      fetchModelList("https://api.openai.com/v1/chat/completions", key, {
        fetch: respond(401, `{"error":"Incorrect API key provided: ${key}"}`),
      }),
    ModelListError,
  );
  assertEquals(auth.kind, "auth");
  assertEquals(auth.status, 401);
  assertStringIncludes(auth.message, "HTTP 401");
  assertEquals(auth.message.includes(key), false);
  assertStringIncludes(auth.message, REDACTED_KEY);
  const http = await assertRejects(
    () =>
      fetchModelList("https://x.test/v1/chat/completions", key, {
        fetch: respond(404, "nope"),
      }),
    ModelListError,
  );
  assertEquals([http.kind, http.status], ["http", 404]);
  const net = await assertRejects(
    () =>
      fetchModelList("https://x.test/v1/chat/completions", key, {
        fetch: (() =>
          Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch,
      }),
    ModelListError,
  );
  assertEquals(net.kind, "network");
  assertStringIncludes(net.message, "Failed to fetch");
  const parse = await assertRejects(
    () =>
      fetchModelList("https://x.test/v1/chat/completions", key, {
        fetch: respond(200, "<html>"),
      }),
    ModelListError,
  );
  assertEquals(parse.kind, "parse");
  const empty = await assertRejects(
    () =>
      fetchModelList("https://x.test/v1/chat/completions", key, {
        fetch: respond(200, '{"data":[]}'),
      }),
    ModelListError,
  );
  assertEquals(empty.kind, "empty");
});

Deno.test("forwardModelsProxy GETs the derived models URL server-side", async () => {
  let seen = "";
  const fetchStub = ((url: string, init?: RequestInit) => {
    seen = `${init?.method} ${url} ${
      (init?.headers as Record<string, string>).authorization
    }`;
    return Promise.resolve(
      new Response('{"data":[{"id":"a"}]}', { status: 200 }),
    );
  }) as typeof fetch;
  const res = await forwardModelsProxy({
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKey: "k",
  }, {
    fetch: fetchStub,
  });
  assertEquals(res.status, 200);
  assertEquals(seen, "GET https://api.openai.com/v1/models Bearer k");
  assertEquals((await forwardModelsProxy({ endpoint: "nope" })).status, 400);
});

Deno.test("modelAfterProviderChange drops stale models", () => {
  // OpenCode Zen's big-pickle is not an OpenAI model: switch to OpenAI's default.
  assertEquals(
    modelAfterProviderChange("big-pickle", "openai", undefined),
    "gpt-4.1",
  );
  // Known valid for the new provider (fetched list) → kept.
  assertEquals(
    modelAfterProviderChange("gpt-4o", "openai", ["gpt-4.1", "gpt-4o"]),
    "gpt-4o",
  );
  // No default (custom / OpenCode cloud runner) → cleared.
  assertEquals(modelAfterProviderChange("big-pickle", "custom", undefined), "");
  assertEquals(
    modelAfterProviderChange("big-pickle", "opencode-cloud", undefined),
    "",
  );
  assertEquals(
    modelAfterProviderChange("", "opencode-zen", undefined),
    "big-pickle",
  );
});
