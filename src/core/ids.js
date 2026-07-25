// L1 core — ARCHITECTURE.md §5.7. uint32, monotonic, never reused. 0 is null.

let next = 1;

export const NULL_ID = 0;

export function allocId() {
  const id = next;
  next = (next + 1) >>> 0;
  if (next === 0) next = 1;
  return id;
}

export function resetIds() {
  next = 1;
}

export function peekNextId() {
  return next;
}
