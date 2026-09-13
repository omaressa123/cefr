import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const webClient = readFileSync(join(root, "web", "src", "api", "client.js"), "utf8");
const mobileClient = readFileSync(join(root, "mobile", "src", "api", "client.js"), "utf8");

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

test("web and mobile clients hit the same endpoint set", () => {
  const web = staticPaths(webClient);
  const mobile = staticPaths(mobileClient);
  assert.ok(web.size > 10, "expected a non-trivial web endpoint set");
  assert.deepEqual(
    [...mobile].sort(),
    [...web].sort(),
    "mobile-only or web-only endpoints break platform parity",
  );
});

test("web and mobile clients allow the same quiz skills", () => {
  assert.deepEqual(validSkills(mobileClient), validSkills(webClient));
});
