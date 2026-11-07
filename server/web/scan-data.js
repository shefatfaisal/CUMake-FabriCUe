// Raw scan totals are detections, not wear counts. Never deduplicate stored history.
export function readScans(value) {
  return Object.entries(value || {}).flatMap(([id, scan]) => {
    if (!scan || typeof scan.tagId !== 'string' || !scan.tagId.trim()
      || !Number.isSafeInteger(scan.receivedAt) || scan.receivedAt < 0) return [];
    return [{id, tagId: scan.tagId, receivedAt: scan.receivedAt, ...(scan.connectionId ? {connectionId: scan.connectionId} : {})}];
  }).sort((a, b) => b.receivedAt - a.receivedAt || b.id.localeCompare(a.id));
}

export function groupTags(scans) {
  const tags = new Map();
  for (const scan of scans) {
    const tag = tags.get(scan.tagId);
    if (tag) {
      tag.count++;
      tag.firstSeen = Math.min(tag.firstSeen, scan.receivedAt);
      tag.lastSeen = Math.max(tag.lastSeen, scan.receivedAt);
    } else tags.set(scan.tagId, {
      tagId: scan.tagId, count: 1, firstSeen: scan.receivedAt, lastSeen: scan.receivedAt
    });
  }
  return [...tags.values()].sort((a, b) => b.lastSeen - a.lastSeen || a.tagId.localeCompare(b.tagId));
}
