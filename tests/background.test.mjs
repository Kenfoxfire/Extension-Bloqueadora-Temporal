import test from "node:test";
import assert from "node:assert/strict";

test("comparte el cupo del grupo e inicia acceso temporal por pestaña", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  const events = {};
  const values = {};
  const dynamicRules = [];
  const sessionRules = [];
  const tabUpdates = [];
  let messageListener;

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      defaults: { maxSessions: 1, waitSeconds: 0, appMinutes: 1 },
      groups: [{ id: "shared", domains: ["example.com", "social.test"] }]
    })
  });
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: values[key] }),
        set: async (changes) => Object.assign(values, changes)
      }
    },
    declarativeNetRequest: {
      isRegexSupported: async () => ({ isSupported: true }),
      getDynamicRules: async () => [],
      updateDynamicRules: async ({ addRules }) => dynamicRules.push(...addRules),
      updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
        for (let index = sessionRules.length - 1; index >= 0; index--) {
          if (removeRuleIds.includes(sessionRules[index].id)) sessionRules.splice(index, 1);
        }
        sessionRules.push(...addRules);
      }
    },
    webNavigation: {
      onCommitted: { addListener: (callback) => { events.committed = callback; } }
    },
    alarms: {
      onAlarm: { addListener: (callback) => { events.alarm = callback; } },
      create: () => {},
      clear: () => {}
    },
    tabs: {
      onRemoved: { addListener: (callback) => { events.removed = callback; } },
      update: async (tabId, update) => { tabUpdates.push({ tabId, ...update }); },
      get: async (tabId) => ({ id: tabId, url: "https://example.com/page" })
    },
    scripting: {
      executeScript: async (options) => { events.script = options; }
    },
    runtime: {
      id: "test",
      getURL: (path) => `chrome-extension://test/${path}`,
      onMessage: { addListener: (callback) => { messageListener = callback; } }
    }
  };

  try {
    await import(`../background.mjs?${Date.now()}`);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(dynamicRules.length, 1);

    const request = (type, tabId, targetUrl) => new Promise((resolve) => {
      assert.equal(messageListener(
        { type, targetUrl },
        { tab: { id: tabId }, url: "chrome-extension://test/gate.html#target" },
        resolve
      ), true);
    });

    assert.deepEqual(await request("gate:getState", 11, "https://example.com/page"),
      { status: "waiting", waitSeconds: 0 });
    const started = await request("gate:start", 11, "https://example.com/page");
    assert.equal(started.ok, true);
    assert.equal(values.usage.shared.count, 1);
    assert.equal(sessionRules.length, 1);
    assert.deepEqual(sessionRules[0].condition.tabIds, [11]);
    assert.deepEqual(tabUpdates, [{ tabId: 11, url: "https://example.com/page" }]);

    events.committed({
      frameId: 0,
      tabId: 11,
      url: "https://example.com/page"
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(events.script.target.tabId, 11);

    assert.deepEqual(await request("gate:getState", 12, "https://social.test/"),
      { status: "blocked" });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});
