// The durable outbound queue.
//
// Every mutation is applied to local state immediately and enqueued here. The
// queue lives in localStorage, so it survives reloads, crashes and being closed
// mid-flight: a write can only be lost if the queue itself is lost. Operations
// drain IN ORDER and a failure stops the drain with the item still in place
// (spec §9.1).

/** @typedef {{kind:'upsert', row:object} | {kind:'delete', id:string}} Op */

/**
 * Append an upsert. If the very last queued op is an upsert of the same row,
 * replace it: upserts are last-write-wins on the same id, so collapsing them
 * keeps the queue small without ever reordering work.
 */
export function queueUpsert(queue, row) {
  const last = queue[queue.length - 1];
  if (last && last.kind === 'upsert' && last.row.id === row.id) {
    return [...queue.slice(0, -1), { kind: 'upsert', row }];
  }
  return [...queue, { kind: 'upsert', row }];
}

/** Append a delete. Never collapsed — a delete after an upsert must stay ordered. */
export function queueDelete(queue, id) {
  const last = queue[queue.length - 1];
  if (last && last.kind === 'delete' && last.id === id) return queue;
  return [...queue, { kind: 'delete', id }];
}

/** Ids with a pending upsert — rows a server snapshot must not erase. */
export function pendingUpsertIds(queue) {
  const ids = new Set();
  for (const op of queue) {
    if (op.kind === 'upsert') ids.add(op.row.id);
    else ids.delete(op.id);
  }
  return ids;
}

/** Ids with a pending delete — rows a server snapshot must not resurrect. */
export function pendingDeleteIds(queue) {
  const ids = new Set();
  for (const op of queue) {
    if (op.kind === 'delete') ids.add(op.id);
    else ids.delete(op.row.id);
  }
  return ids;
}

/** Drop ops that aren't structurally sound (e.g. from a corrupted cache). */
export function sanitizeQueue(queue) {
  if (!Array.isArray(queue)) return [];
  return queue.filter((op) => {
    if (!op || typeof op !== 'object') return false;
    if (op.kind === 'upsert') return Boolean(op.row && typeof op.row.id === 'string');
    if (op.kind === 'delete') return typeof op.id === 'string' && op.id;
    return false;
  });
}
