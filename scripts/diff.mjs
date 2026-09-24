/**
 * Compare this run's deduped events against the previous commit's
 * data/events.json (SPEC §4.2 step 7). Three jobs at once:
 *
 * 1. Carry over `first_seen_at` for events that already existed — normalize.mjs
 *    stamps every event with "now" since it has no memory of past runs; without
 *    this step, every event would look "new" on every single fetch, breaking
 *    新上架 (FR-23) entirely.
 * 2. Detect key-field changes (time/venue/status/price) for FR-34's "已更新"
 *    badge on the favorites page, and collect both into digest.json for
 *    new.html.
 * 3. Keep `id` stable across an artist-recognition change (see the comment
 *    on prevIdByRawId below) — a real, live bug (Max, 2026-09-25: "我發現我
 *    收藏的場次不見了"), not a hypothetical one.
 */

const WATCHED_FIELDS = ["date", "time", "venue", "status", "price_min", "price_max", "on_sale_at"];

function fieldsChanged(prev, next) {
  return WATCHED_FIELDS.filter((f) => JSON.stringify(prev[f]) !== JSON.stringify(next[f]));
}

/**
 * @param {object[]} previousEvents - last run's data/events.json `events` array (may be [])
 * @param {object[]} nextEvents - this run's deduped Event[] (id already set, first_seen_at/updated_at both "now")
 * @returns {{ events: object[], digest: { generated_at: string, added_ids: string[], updated: {id:string, fields:string[]}[] } }}
 */
export function diff(previousEvents, nextEvents) {
  const prevById = new Map(previousEvents.map((e) => [e.id, e]));

  // 2026-09-25 real bug (Max: favorited events silently vanishing from
  // favorites.html): dedup.mjs's id is `computeId(headliners[0] ?? title_raw,
  // date, venue)` — an event with an unrecognized artist has headliners: [],
  // so its id is hashed from title_raw. The MOMENT that artist gets added to
  // artists.yml and this event is renormalized, headliners[0] exists and the
  // id is hashed from the artist name instead — a completely different id,
  // even though it's the exact same real-world show. diff() used to match
  // purely by id, so this looked like a brand-new event (added_ids, fresh
  // first_seen_at — wrongly re-surfacing as "新上架" too) while the OLD id
  // just disappeared from the written events.json. Anyone who'd favorited/
  // excluded it under the old id (both keyed by id, src/state.js) silently
  // lost it — there is no way to un-lose it after the fact, since the
  // vanished id no longer maps to anything once written.
  //
  // Fix: raw_id+source is the one thing that's genuinely stable across a
  // recognition change (it's the platform's own permanent event page id,
  // completely independent of artists.yml). Build a reverse index from it to
  // the id that owned it last run, and when this run's freshly-computed id
  // doesn't match anything directly but one of its sources traces back to a
  // DIFFERENT previous id, keep using that old id instead of the new one.
  const prevIdByRawId = new Map();
  for (const e of previousEvents) {
    for (const s of e.sources) prevIdByRawId.set(`${s.name}::${s.raw_id}`, e.id);
  }

  const addedIds = [];
  const updated = [];
  const now = new Date().toISOString();

  const events = nextEvents.map((rawEvent) => {
    let event = rawEvent;
    if (!prevById.has(event.id)) {
      for (const s of event.sources) {
        const oldId = prevIdByRawId.get(`${s.name}::${s.raw_id}`);
        if (oldId && oldId !== event.id) {
          event = { ...rawEvent, id: oldId, merged_ids: [oldId] };
          break;
        }
      }
    }

    const prev = prevById.get(event.id);

    if (!prev) {
      addedIds.push(event.id);
      return event; // first_seen_at/updated_at already "now" — genuinely new.
    }

    const changed = fieldsChanged(prev, event);
    if (changed.length > 0) {
      updated.push({ id: event.id, fields: changed });
      return { ...event, first_seen_at: prev.first_seen_at, updated_at: now, updated_fields: changed };
    }

    return { ...event, first_seen_at: prev.first_seen_at, updated_at: prev.updated_at };
  });

  return { events, digest: { generated_at: now, added_ids: addedIds, updated } };
}
