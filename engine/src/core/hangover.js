// 宿醉（机制约定）

import { HANGOVER_PEAK_MIN, HANGOVER_END } from './constants.js';

export function createHangoverSnapshot(peak, now) {
  if (peak < HANGOVER_PEAK_MIN) return null;
  const h0 = Math.min(2, Math.max(0, (peak - 6) / 4));
  const halfLifeHours = 4 + 0.5 * Math.max(0, peak - 10);
  return {
    initial: h0,
    halfLifeHours,
    startTime: now
  };
}

export function snapshotValue(snap, now) {
  const hours = (now - snap.startTime) / 3600000;
  if (hours < 0) return snap.initial;
  return snap.initial * Math.pow(2, -hours / snap.halfLifeHours);
}

export function pruneHangoverSnapshots(snapshots, now) {
  return (snapshots || []).filter((s) => snapshotValue(s, now) >= HANGOVER_END);
}

export function currentHangover(snapshots, now) {
  if (!snapshots || snapshots.length === 0) return 0;
  let maxH = 0;
  for (const s of snapshots) {
    const h = snapshotValue(s, now);
    if (h > maxH) maxH = h;
  }
  return maxH;
}
