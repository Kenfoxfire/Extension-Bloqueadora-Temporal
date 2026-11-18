import test from "node:test";
import assert from "node:assert/strict";
import { compileConfig, findDomain, networkRules, sessionAllowRule } from "../rules.mjs";

const config = compileConfig({
  defaults: { maxSessions: 8, waitSeconds: 20, appMinutes: 5 },
  groups: [{ id: "redes", domains: ["example.com", "social.test"], waitSeconds: 10 }]
});

test("aplica valores predeterminados y ajustes por grupo a todos los subdominios", () => {
  assert.deepEqual(config.groups[0], {
    id: "redes",
    domains: ["example.com", "social.test"],
    maxSessions: 8,
    waitSeconds: 10,
    appMinutes: 5
  });
  assert.equal(findDomain(config, "https://a.example.com/ruta").domain, "example.com");
  assert.equal(findDomain(config, "https://example.com.evil.test/"), null);
});

test("crea una redirección que conserva la URL y una excepción por pestaña y dominio", () => {
  const rule = networkRules(config, "extension-id")[0];
  assert.deepEqual(rule.condition, {
    requestDomains: ["example.com", "social.test"],
    regexFilter: "^(https?://(?:[^/?#]+\\.)?(?:example\\.com|social\\.test)(?::\\d+)?(?:/[^#]*)?(?:#.*)?)$",
    resourceTypes: ["main_frame"]
  });
  assert.equal(rule.action.redirect.regexSubstitution,
    "chrome-extension://extension-id/gate.html#\\0");
  const pattern = new RegExp(rule.condition.regexFilter);
  for (const url of [
    "https://example.com/a?x=1",
    "http://sub.example.com/a",
    "https://social.test/"
  ]) assert.equal(pattern.test(url), true, url);
  assert.equal(pattern.test("https://example.com.evil.test/"), false);
  const originalUrl = "https://sub.example.com/a?x=1#section";
  const redirectUrl = rule.action.redirect.regexSubstitution.replace("\\0", originalUrl);
  assert.equal(new URL(redirectUrl).hash.slice(1), originalUrl);
  assert.deepEqual(sessionAllowRule(4, 12, "example.com").condition, {
    requestDomains: ["example.com"],
    tabIds: [12],
    resourceTypes: ["main_frame"]
  });
});

test("rechaza configuraciones inválidas o dominios ambiguos", () => {
  for (const invalid of [
    {},
    { groups: [] },
    { groups: [{ id: "same", domains: ["example.com"] }, { id: "same", domains: ["other.test"] }] },
    { groups: [{ id: "one", domains: ["example.com"] }, { id: "two", domains: ["sub.example.com"] }] },
    { groups: [{ id: "bad", domains: ["https://example.com/path"] }] },
    { groups: [{ id: "bad", domains: ["example.com"], maxSessions: 0 }] }
  ]) assert.throws(() => compileConfig(invalid));
});
