import crypto from "node:crypto";

/**
 * ID computation + cross-source merge (SPEC §4.1).
 */

function normalizeForHash(s) {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

export function computeId(headliner, date, venue) {
  const key = `${normalizeForHash(headliner)}|${date}|${normalizeForHash(venue)}`;
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 16);
}

const SOURCE_PRIORITY = { KKTIX: 1, "拓元": 2, "iNDIEVOX": 3, "FANSI GO": 4, "Ticket Plus": 5, manual: 6 };

// 2026-09-22 real bug (Max, MAHIRU: "你卡片內的連結還連錯不同場次"): Ticket
// Plus sometimes lists ONE real show as several separate "activities" for
// different sale mechanisms — a plain on-sale listing, a lottery-signup-only
// listing ("...登記抽選"), and an addon-purchase listing ("VIP PASS限量加購
// 登記抽選") — same headliner/date/venue, so they hash to the same baseId and
// get merged as if they were cross-platform duplicates of the same event
// (which is what this merge logic is FOR). The bug: ticket_url picked
// whichever listing happened to be scraped first, with no tie-break at all
// between same-source entries (SOURCE_PRIORITY only distinguishes across
// platforms) — for MAHIRU that landed on the VIP-addon lottery listing, not
// the actual general-sale page a buyer wants.
const SPECIAL_LISTING_RE = /登記抽選|抽選登記|限量加購|VIP PASS/;

function listingRank(event) {
  const sourceRank = SOURCE_PRIORITY[event.sources[0]?.name] ?? 99;
  return SPECIAL_LISTING_RE.test(event.title_raw) ? sourceRank + 0.5 : sourceRank;
}

function timeToMinutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Coarse time-of-day bucket, or null when the source didn't report a time at all. Kept as the PRIMARY split (unchanged) so ids for every already-correctly-split show stay stable — see clusterWithinBucket below for the part that changed. */
function timeBucket(time) {
  if (!time) return null;
  const hour = Number(time.split(":")[0]);
  return hour < 17 ? "day" : "evening";
}

// 2026-09-25 real bug (HANDOFF 9/24 待辦第 4 項: Disney in Concert 13:00 場
// and 16:30 場 merged into one card): both showtimes are < 17:00, so the
// day/evening split above put them in the same bucket. Fix is a SECOND,
// finer pass only within a bucket that itself contains multiple distinct
// times far enough apart to be different showtimes — not a wider primary
// split, which would change the id suffix (literally "-day"/"-evening",
// see mergeGroup's `id` param) for every show that was already correctly
// single-bucketed, silently dropping them from anyone's saved favorites/
// exclusions (both keyed by `id`, see src/state.js). A show that was
// previously wrongly merged into one card had no "old correct id" worth
// preserving anyway, so splitting it into fresh ids here is fine.
// 90 minutes comfortably absorbs realistic cross-platform reporting slop
// for the SAME show (door-vs-start time, one adapter rounding to the half
// hour) while still splitting anything as far apart as 13:00/16:30 (210
// min) — see dedup.test.mjs for both directions of this tradeoff.
const TIME_CLUSTER_GAP_MINUTES = 90;

/** Distinct reported times sharing one bucket -> Map<time, clusterKey>. Times within TIME_CLUSTER_GAP_MINUTES of the previous one (sorted) share a cluster; clusterKey is that cluster's earliest time, used only as an id suffix. */
function clusterWithinBucket(times) {
  const sorted = [...times].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
  const clusterOf = new Map();
  let clusterKey = null;
  let prevMinutes = null;
  for (const t of sorted) {
    const minutes = timeToMinutes(t);
    if (prevMinutes === null || minutes - prevMinutes > TIME_CLUSTER_GAP_MINUTES) clusterKey = t;
    clusterOf.set(t, clusterKey);
    prevMinutes = minutes;
  }
  return clusterOf;
}

function mergeGroup(group, id) {
  // Pick the best-ranked listing as the base for title_raw/ticket_url/venue/
  // etc. (the "identity" of the merged card) — not just group[0], whichever
  // order the adapters happened to return it in. A special-purpose listing
  // (lottery signup, VIP addon) never wins this over a plain one, and across
  // platforms the existing SOURCE_PRIORITY order still applies.
  //
  // 2026-09-23 real bug (羊文学 10/24@高雄, confirmed live: register_info
  // correctly caught this show going SOLD_OUT and re-fetched it, but the
  // merged card still showed on_sale): KKTIX sometimes serves the SAME real
  // show under two different raw_ids from the same org — a real ticketed
  // page (own price tiers, own live status) plus a purely decorative
  // "info" page with no ticket table of its own (just a link over to the
  // real one). Both are same-source (KKTIX) and neither matches
  // SPECIAL_LISTING_RE, so they tied on listingRank — a tie `.sort()`
  // breaks by original array order, which has nothing to do with which one
  // actually carries real data, so the decorative page (price_min: null)
  // could silently win `base` over the real ticketed page's fresher
  // status. Tie-break by whether a listing actually has real price data
  // (price_min != null) before falling back to array order — a listing
  // with no ticket-tier data of its own is never the more authoritative
  // one to build the merged card's status from.
  const [base, ...rest] = [...group].sort((a, b) => {
    const rankDiff = listingRank(a) - listingRank(b);
    if (rankDiff !== 0) return rankDiff;
    return (b.price_min != null ? 1 : 0) - (a.price_min != null ? 1 : 0);
  });
  const result = { ...base, id, merged_ids: [id] };
  // 2026-09-22 real bug (Max, 音田雅則: "需登記抽選的標籤只適用於全部票券都
  // 要抽選的"): `is_lottery` USED to be "true if ANY merged listing mentions
  // 登記抽選/VIP PASS", which over-flagged shows where only a separate VIP
  // addon needs a lottery and the regular ticket (the plain listing that
  // correctly won as `base` above) is a normal sale. `is_lottery` is now
  // computed per-listing in normalize.mjs, scoped to that ONE listing's own
  // title+price text — `base` already carries the right value via the
  // spread above, nothing to do here. Deliberately NOT `group.some(...)`
  // anymore: only the listing that actually wins the card's title/link
  // should decide whether the badge shows, since that's the page a click
  // actually lands on.

  for (const event of rest) {
    result.sources = [...result.sources, ...event.sources];
    result.lineup = Array.from(new Set([...result.lineup, ...event.lineup]));
    result.tags_type = Array.from(new Set([...result.tags_type, ...event.tags_type]));
    result.tags_origin = Array.from(new Set([...result.tags_origin, ...event.tags_origin]));
    if (event.price_min != null && (result.price_min == null || event.price_min < result.price_min)) {
      result.price_min = event.price_min;
    }
    if (event.price_max != null && (result.price_max == null || event.price_max > result.price_max)) {
      result.price_max = event.price_max;
    }
  }
  return result;
}

/**
 * Given a group that's already one day/evening bucket (or the whole thing,
 * when there's only one bucket), applies the finer within-bucket time
 * clustering and merges each resulting cluster. `bucket` is the label used
 * for the OUTER split ("day"/"evening"), or null when there wasn't one —
 * passed through only so the id suffix scheme can stay unchanged for the
 * common case where clustering doesn't find a further split within it (see
 * the id-stability comment on TIME_CLUSTER_GAP_MINUTES above).
 */
function splitByCluster(group, baseId, bucket) {
  const distinctTimes = [...new Set(group.map((e) => e.time).filter(Boolean))];
  const clusterOf = distinctTimes.length >= 2 ? clusterWithinBucket(distinctTimes) : null;
  const clusterCount = clusterOf ? new Set(clusterOf.values()).size : 1;

  if (clusterCount <= 1) {
    // No further split needed — id suffix is exactly what it would have
    // been before this clustering pass existed.
    return [mergeGroup(group, bucket ? `${baseId}-${bucket}` : baseId)];
  }

  const firstCluster = clusterOf.get(distinctTimes[0]);
  const byCluster = new Map();
  for (const event of group) {
    const cluster = event.time ? clusterOf.get(event.time) : firstCluster;
    if (!byCluster.has(cluster)) byCluster.set(cluster, []);
    byCluster.get(cluster).push(event);
  }
  const results = [];
  for (const [cluster, clusterGroup] of byCluster) {
    const suffix = bucket ? `${bucket}-${cluster}` : cluster;
    results.push(mergeGroup(clusterGroup, `${baseId}-${suffix}`));
  }
  return results;
}

/**
 * @param {object[]} events - Event-shaped objects (no id yet), each already
 *   carrying a single-element `sources` array from whichever adapter found it.
 * @returns {object[]} deduped Event[] with id/merged_ids/sources/ticket_url set.
 */
export function dedupe(events) {
  const groups = new Map(); // baseId (headliner+date+venue) -> raw event[]

  for (const event of events) {
    const baseId = computeId(event.headliners[0] ?? event.title_raw, event.date, event.venue);
    if (!groups.has(baseId)) groups.set(baseId, []);
    groups.get(baseId).push(event);
  }

  const results = [];
  for (const [baseId, group] of groups) {
    const nonNullBuckets = [...new Set(group.map((e) => timeBucket(e.time)).filter(Boolean))];

    if (nonNullBuckets.length <= 1) {
      // Same headliner/date/venue and no conflicting time-of-day info — this
      // is one show, possibly reported with a missing/imprecise time by one
      // source (e.g. 拓元 never gives a time at all). Safe to merge — UNLESS
      // the within-bucket clustering pass below finds this "one bucket" is
      // actually two showtimes close enough together to both read as "day"
      // (13:00 + 16:30 — the real bug this file fixes), in which case
      // splitByCluster adds a suffix; otherwise it returns baseId unchanged,
      // exactly like before this change.
      results.push(...splitByCluster(group, baseId, null));
      continue;
    }

    // Two+ distinct time-of-day buckets under the same headliner/date/venue —
    // a matinee + evening show, not one event (SPEC §4.1 / dedup.test.mjs).
    // A time-less entry can't be placed with certainty here; it's folded into
    // whichever bucket appears first, a documented simplification for this
    // rare (3-shows-same-day) case rather than guessing further.
    const byBucket = new Map();
    for (const event of group) {
      const bucket = timeBucket(event.time) ?? nonNullBuckets[0];
      if (!byBucket.has(bucket)) byBucket.set(bucket, []);
      byBucket.get(bucket).push(event);
    }
    for (const [bucket, bucketGroup] of byBucket) {
      results.push(...splitByCluster(bucketGroup, baseId, bucket));
    }
  }

  return results;
}
