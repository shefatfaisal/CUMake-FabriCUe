export function toProfile(clothing, inLaundry = clothing.inLaundry === true) {
  return {id: clothing.id, name: clothing.name, type: clothing.type, color: clothing.color,
    colorName: clothing.colorName || '', limit: clothing.limit,
    limitMode: clothing.limitMode === 'auto' ? 'auto' : 'manual', rfid: clothing.rfid || null,
    photo: clothing.photo || null, inLaundry};
}
export function toSeed(clothing) {
  return {wears: clothing.wears || 0, washCount: clothing.washCount || 0,
    last: clothing.last || '', wornDates: clothing.wornDates || [], historyPartial: clothing.historyPartial === true};
}
export function fromCloud(item, photo) {
  const p = item.profile, t = item.tracking;
  return {...p, photo: photo || undefined, wears: t.wears, washCount: t.washCount || 0,
    last: t.last || '', wornDates: Object.keys(t.wornDates || {}).sort(),
    historyPartial: t.historyPartial === true};
}
export function signature(profile) { return JSON.stringify(profile); }
