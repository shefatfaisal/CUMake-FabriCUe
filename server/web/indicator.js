export const SIGNAL_LABELS = {a: 'Green · good to wear', b: 'Yellow · one wear remaining', c: 'Red · laundry due', d: 'Flashing red · missing-item alert'};
export const SCAN_GROUP_MS = 2000;

export function signalForItems(closet, ids) {
  let value = 'a';
  for (const id of ids) {
    const item = closet.items?.[String(id)];
    if (!item) continue;
    const remaining = Math.max(0, item.profile.limit - item.tracking.wears);
    if (remaining === 0) return 'c';
    if (remaining === 1) value = 'b';
  }
  return value;
}
export function command(closet, value, id, timestamp, source, itemIds = [], groupStartedAt = timestamp) {
  closet.output = {value, commandId: id, revision: (closet.output?.revision || 0) + 1,
    createdAt: timestamp, source, itemIds, groupStartedAt};
}
export function scanCommand(closet, itemId, scanId, timestamp) {
  const previous = closet.output;
  // Delayed older scans still count but cannot replace a newer physical command.
  if (previous && timestamp < previous.createdAt) return;
  const sameGroup = previous?.source === 'scan' && timestamp - previous.groupStartedAt <= SCAN_GROUP_MS;
  const ids = [...new Set([...(sameGroup ? previous.itemIds || [] : []), itemId])];
  command(closet, signalForItems(closet, ids), scanId, timestamp, 'scan', ids,
    sameGroup ? previous.groupStartedAt : timestamp);
}
