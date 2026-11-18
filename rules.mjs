const DEFAULTS = Object.freeze({
  maxSessions: 8,
  waitSeconds: 20,
  appMinutes: 5
});

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function validateInteger(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name}: debe ser un entero entre ${minimum} y ${maximum}.`);
  }
  return value;
}

function normalizeDomain(value, groupId) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`Grupo ${groupId}: cada dominio debe ser texto sin espacios.`);
  }
  let url;
  try {
    url = new URL(`https://${value}`);
  } catch {
    throw new Error(`Grupo ${groupId}: dominio inválido "${value}".`);
  }
  if (url.hostname !== value.toLowerCase() || url.pathname !== "/" || url.search || url.hash ||
      url.port || url.username || url.password) {
    throw new Error(`Grupo ${groupId}: usa solo el dominio, sin protocolo, ruta ni puerto.`);
  }
  return url.hostname;
}

export function compileConfig(config) {
  if (!config || typeof config !== "object" || !Array.isArray(config.groups)) {
    throw new Error('El JSON debe contener una lista "groups".');
  }

  const defaults = {
    maxSessions: validateInteger(config.defaults?.maxSessions ?? DEFAULTS.maxSessions, "maxSessions", 1, 100000),
    waitSeconds: validateInteger(config.defaults?.waitSeconds ?? DEFAULTS.waitSeconds, "waitSeconds", 0, 86400),
    appMinutes: validateInteger(config.defaults?.appMinutes ?? DEFAULTS.appMinutes, "appMinutes", 1, 1440)
  };
  const ids = new Set();
  const domainOwners = [];
  const groups = config.groups.map((entry, index) => {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" ||
        !/^[a-zA-Z0-9_-]+$/.test(entry.id) || ids.has(entry.id)) {
      throw new Error(`Grupo ${index + 1}: id inválido o duplicado.`);
    }
    ids.add(entry.id);
    if (!Array.isArray(entry.domains) || entry.domains.length === 0) {
      throw new Error(`Grupo ${entry.id}: agrega al menos un dominio.`);
    }
    const domains = [...new Set(entry.domains.map((domain) => normalizeDomain(domain, entry.id)))];
    for (const domain of domains) {
      const overlap = domainOwners.find(({ existing }) =>
        domain === existing || domain.endsWith(`.${existing}`) || existing.endsWith(`.${domain}`)
      );
      if (overlap) {
        throw new Error(`Dominio "${domain}" se superpone con "${overlap.existing}" del grupo ${overlap.groupId}.`);
      }
      domainOwners.push({ existing: domain, groupId: entry.id });
    }
    return {
      id: entry.id,
      domains,
      maxSessions: validateInteger(entry.maxSessions ?? defaults.maxSessions, "maxSessions", 1, 100000),
      waitSeconds: validateInteger(entry.waitSeconds ?? defaults.waitSeconds, "waitSeconds", 0, 86400),
      appMinutes: validateInteger(entry.appMinutes ?? defaults.appMinutes, "appMinutes", 1, 1440)
    };
  });
  if (groups.length === 0) throw new Error("Agrega al menos un grupo de dominios.");
  return { defaults, groups };
}

export function findDomain(config, value) {
  let hostname;
  try {
    hostname = new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const group of config.groups) {
    const domain = group.domains.find((candidate) =>
      hostname === candidate || hostname.endsWith(`.${candidate}`)
    );
    if (domain) return { group, domain };
  }
  return null;
}

export function networkRules(config, extensionId) {
  return config.groups.map((group, index) => {
    const domains = group.domains.map((domain) => escapeRegex(domain)).join("|");
    const regexFilter = `^(https?://(?:[^/?#]+\\.)?(?:${domains})(?::\\d+)?(?:/[^#]*)?(?:#.*)?)$`;
    return {
      id: index + 1,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { regexSubstitution: `chrome-extension://${extensionId}/gate.html#\\0` }
      },
      condition: {
        requestDomains: group.domains,
        regexFilter,
        resourceTypes: ["main_frame"]
      }
    };
  });
}

export function sessionAllowRule(id, tabId, domain) {
  return {
    id,
    priority: 2,
    action: { type: "allow" },
    condition: {
      requestDomains: [domain],
      tabIds: [tabId],
      resourceTypes: ["main_frame"]
    }
  };
}
