import { summarizeAllBindings } from './bindings.js';
import { schemaSummary, SCHEMA_VERSION } from './schema.js';

export function buildV2Health(env) {
  const bindings = summarizeAllBindings(env);
  const configuredCount = Object.values(bindings).filter((item) => item.configured).length;
  const legacyCount = Object.values(bindings).filter((item) => item.legacyFallback).length;
  return {
    version: 2,
    mode: 'shadow',
    schemaVersion: SCHEMA_VERSION,
    productionCutover: false,
    writesEnabled: false,
    wikiRequiredForCoreBusiness: false,
    configuredBindingCount: configuredCount,
    legacyFallbackBindingCount: legacyCount,
    bindings,
    schemas: schemaSummary()
  };
}
