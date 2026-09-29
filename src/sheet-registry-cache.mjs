export const SHEET_REGISTRY_MAX_AGE_MS = 5 * 60 * 1000;

export function isSheetRegistryStale(sheets, now = Date.now(), maxAgeMs = SHEET_REGISTRY_MAX_AGE_MS) {
  if (!Array.isArray(sheets) || sheets.length === 0) return true;
  const relevant = sheets.filter((sheet) => sheet?.baselineState !== "EXISTING_UNCONNECTED");
  if (relevant.length === 0) return true;
  return relevant.some((sheet) => {
    const discoveredAt = Date.parse(sheet?.lastDiscoveredAt || "");
    return !Number.isFinite(discoveredAt) || discoveredAt > now || now - discoveredAt > maxAgeMs;
  });
}
