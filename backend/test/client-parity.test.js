import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const webClientPath = join(root, "web", "src", "api", "client.js");
const mobileClientPath = join(root, "mobile", "src", "api", "client.js");

const webClient = existsSync(webClientPath) ? readFileSync(webClientPath, "utf8") : "";
const mobileClient = existsSync(mobileClientPath) ? readFileSync(mobileClientPath, "utf8") : null;

// Static (quoted) endpoint paths used by each client, e.g. "/auth/login".
// Template literals with ${...} are normalised by dropping the placeholder,
// so web `/grammar${...query}` and mobile `/grammar` compare equal, as do
// web `/classrooms/${id}` and mobile `/classrooms/${id}`.
function staticPaths(source) {
  const out = new Set();
  for (const match of source.matchAll(/[`"'](\/(?:[A-Za-z0-9\-_./${}]+))[`"']/g)) {
    let p = match[1].replaceAll(/\$\{[^}]*\}/g, "");
    if (p.length > 1) p = p.replace(/\/+$/, "");
    if (p === "/api/v1") continue; // default base URL, not an endpoint
    out.add(p);
  }
  return out;
}

function validSkills(source) {
  const match = source.match(/validSkills\s*=\s*\[([^\]]*)\]/);
  assert.ok(match, "client must declare a validSkills allow-list");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
}

test("web client contains all essential CEFR practice partner endpoints", () => {
  assert.ok(webClient, "web client must exist");
  const web = staticPaths(webClient);
  assert.ok(web.size > 15, "expected a rich web endpoint set");

  const requiredEndpoints = [
    "/auth/register",
    "/auth/login",
    "/auth/me",
    "/classrooms",
    "/classrooms/join",
    "/sessions",
    "/vocabulary",
    "/grammar",
    "/pronunciation",
    "/sentence-structure",
    "/quiz/start",
    "/quiz/answer",
    "/quiz/finish",
    "/progress",
    "/recommendations",
    "/engine/status",
  ];

  for (const ep of requiredEndpoints) {
    assert.ok(
      [...web].some((p) => p.startsWith(ep) || ep.startsWith(p)),
      `Web client missing endpoint: ${ep}`
    );
  }
});

test("web and mobile clients hit the same endpoint set when mobile is present", (t) => {
  if (!mobileClient) {
    t.skip("mobile directory not present in workspace, skipping mobile parity check");
    return;
  }
  const web = staticPaths(webClient);
  const mobile = staticPaths(mobileClient);
  assert.deepEqual(
    [...mobile].sort(),
    [...web].sort(),
    "mobile-only or web-only endpoints break platform parity",
  );
});

test("web and mobile clients allow the same quiz skills when mobile is present", (t) => {
  if (!mobileClient) {
    t.skip("mobile directory not present in workspace, skipping mobile skills check");
    return;
  }
  assert.deepEqual(validSkills(mobileClient), validSkills(webClient));
});
