import { FixtureConnector } from './fixture.js';
import { JsonLdConnector } from './jsonld.js';
import { BrowserConnector } from './browser.js';

const REGISTRY = {
  fixture: { ctor: FixtureConnector, version: '1.0.0' },
  jsonld: { ctor: JsonLdConnector, version: '1.0.0' },
  browser: { ctor: BrowserConnector, version: '1.0.0' },
};

export function createConnector(source, deps = {}) {
  const registration = REGISTRY[source.connector];
  if (!registration) throw new Error(`unknown connector type: ${source.connector}`);
  const connector = new registration.ctor(source, source.config || {}, deps);
  connector.version = registration.version;
  return connector;
}

export function connectorVersion(type) {
  return REGISTRY[type]?.version || null;
}

export function connectorManifest() {
  return Object.fromEntries(Object.entries(REGISTRY).map(([type, value]) => [type, value.version]));
}

export { FixtureConnector, JsonLdConnector, BrowserConnector };
