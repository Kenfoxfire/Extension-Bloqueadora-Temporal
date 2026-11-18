import { compileConfig, findDomain, networkRules, sessionAllowRule } from "./rules.mjs";

const gatePage = chrome.runtime.getURL("gate.html");
const blockedPage = chrome.runtime.getURL("blocked.html");
let config;
let queue = Promise.resolve();

function serialize(operation) {
  const result = queue.then(operation);
  queue = result.catch(() => {});
  return result;
}

function localDayAtThree(now = new Date()) {
  const date = new Date(now);
  if (date.getHours() < 3) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function getUsage(group) {
  const day = localDayAtThree();
  const { usage = {} } = await chrome.storage.local.get("usage");
  const current = usage[group.id];
  return { usage, day, count: current?.day === day ? current.count : 0 };
}

async function initialize() {
  const response = await fetch(chrome.runtime.getURL("temporal-config.json"));
  if (!response.ok) throw new Error("No se pudo leer temporal-config.json.");
  config = compileConfig(await response.json());
  const rules = networkRules(config, chrome.runtime.id);
  for (const rule of rules) {
    const result = await chrome.declarativeNetRequest.isRegexSupported({
      regex: rule.condition.regexFilter,
      isCaseSensitive: false
    });
    if (!result.isSupported) {
      throw new Error(`Grupo ${rule.id}: regla de dominio no admitida (${result.reason}).`);
    }
  }
  const previous = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: previous.map(({ id }) => id),
    addRules: rules
  });
  await restoreSessions();
}

async function restoreSessions() {
  const { activeSessions = {} } = await chrome.storage.local.get("activeSessions");
  for (const [tabKey, session] of Object.entries(activeSessions)) {
    const tabId = Number(tabKey);
    if (session.expiresAt <= Date.now()) {
      await finishSession(tabId, session);
      continue;
    }
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [session.ruleId],
      addRules: [sessionAllowRule(session.ruleId, tabId, session.domain)]
    });
    chrome.alarms.create(`session-${tabId}`, { when: session.expiresAt });
  }
}

async function gateState(tabId, targetUrl) {
  await ready;
  const match = typeof targetUrl === "string" && /^https?:\/\//i.test(targetUrl)
    ? findDomain(config, targetUrl)
    : null;
  if (!match) return { status: "unavailable" };
  const { count } = await getUsage(match.group);
  if (count >= match.group.maxSessions) return { status: "blocked" };
  return { status: "waiting", waitSeconds: match.group.waitSeconds };
}

async function startSession(tabId, targetUrl) {
  return serialize(async () => {
    await ready;
    const url = typeof targetUrl === "string" && /^https?:\/\//i.test(targetUrl)
      ? targetUrl
      : null;
    const match = url && findDomain(config, url);
    if (!match) return { ok: false, error: "No se encontró el sitio que solicitó acceso." };

    const { usage, day, count } = await getUsage(match.group);
    if (count >= match.group.maxSessions) return { ok: false, blocked: true };
    const ruleId = 100000 + tabId;
    if (!Number.isSafeInteger(ruleId) || ruleId > 2147483647) {
      return { ok: false, error: "Chrome asignó un identificador de pestaña no compatible." };
    }
    const now = Date.now();
    const expiresAt = now + match.group.appMinutes * 60 * 1000;
    const activeSessions = (await chrome.storage.local.get("activeSessions")).activeSessions || {};
    const session = {
      groupId: match.group.id,
      domain: match.domain,
      expiresAt,
      ruleId
    };

    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId],
      addRules: [sessionAllowRule(ruleId, tabId, match.domain)]
    });
    try {
      usage[match.group.id] = { day, count: count + 1 };
      activeSessions[tabId] = session;
      await chrome.storage.local.set({ usage, activeSessions });
    } catch (error) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
      throw error;
    }

    chrome.alarms.create(`session-${tabId}`, { when: expiresAt });
    await chrome.tabs.update(tabId, { url });
    return { ok: true, expiresAt };
  });
}

async function finishSession(tabId, session) {
  return serialize(async () => {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [session.ruleId] });
    const { activeSessions = {} } = await chrome.storage.local.get("activeSessions");
    if (activeSessions[tabId]?.expiresAt !== session.expiresAt) return;
    delete activeSessions[tabId];
    await chrome.storage.local.set({ activeSessions });
    chrome.alarms.clear(`session-${tabId}`);
    try {
      const tab = await chrome.tabs.get(tabId);
      const match = config && findDomain(config, tab.url || "");
      if (match?.group.id === session.groupId) {
        await chrome.tabs.update(tabId, { url: blockedPage });
      }
    } catch (error) {
      if (error?.message && !/No tab with id/i.test(error.message)) throw error;
    }
  });
}

async function onAlarm(alarm) {
  const match = /^session-(\d+)$/.exec(alarm.name);
  if (!match) return;
  const tabId = Number(match[1]);
  const { activeSessions = {} } = await chrome.storage.local.get("activeSessions");
  const session = activeSessions[tabId];
  if (!session) return;
  if (session.expiresAt <= Date.now()) {
    await finishSession(tabId, session);
  } else {
    chrome.alarms.create(alarm.name, { when: session.expiresAt });
  }
}

async function onCommitted(details) {
  if (details.frameId !== 0) return;
  const { activeSessions = {} } = await chrome.storage.local.get("activeSessions");
  const session = activeSessions[details.tabId];
  if (!session) return;
  if (session.expiresAt <= Date.now()) {
    await finishSession(details.tabId, session);
    return;
  }
  const match = findDomain(config, details.url);
  if (match?.group.id !== session.groupId || match.domain !== session.domain) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      func: (expiresAt, lockPage) => {
        setTimeout(() => location.replace(lockPage), Math.max(0, expiresAt - Date.now()));
      },
      args: [session.expiresAt, blockedPage]
    });
  } catch (error) {
    console.error("Bloqueadora Temporal: no se pudo instalar el temporizador en la pestaña.", error);
  }
}

const ready = initialize();
ready.catch((error) =>
  console.error("Bloqueadora Temporal: configuración inválida; no se actualizaron las reglas.", error)
);

chrome.webNavigation.onCommitted.addListener((details) => {
  void onCommitted(details).catch((error) =>
    console.error("Bloqueadora Temporal: no se pudo comprobar la sesión.", error)
  );
});
chrome.alarms.onAlarm.addListener((alarm) => {
  void onAlarm(alarm).catch((error) =>
    console.error("Bloqueadora Temporal: no se pudo finalizar la sesión.", error)
  );
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void serialize(async () => {
    const { activeSessions = {} } = await chrome.storage.local.get("activeSessions");
    const session = activeSessions[tabId];
    if (!session) return;
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [session.ruleId] });
    delete activeSessions[tabId];
    await chrome.storage.local.set({ activeSessions });
    chrome.alarms.clear(`session-${tabId}`);
  }).catch((error) => console.error("Bloqueadora Temporal: no se pudo limpiar la pestaña.", error));
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["gate:getState", "gate:start"].includes(message?.type) ||
      sender.tab?.id === undefined || !sender.url?.startsWith(gatePage)) return;
  const operation = message.type === "gate:getState"
    ? gateState(sender.tab.id, message.targetUrl)
    : startSession(sender.tab.id, message.targetUrl);
  operation.then(sendResponse, (error) => {
    console.error("Bloqueadora Temporal: falló una operación de acceso.", error);
    sendResponse({ status: "error", ok: false, error: error.message });
  });
  return true;
});
