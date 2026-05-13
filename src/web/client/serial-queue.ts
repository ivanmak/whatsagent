export type SerialQueueMap = Record<string, Promise<void> | undefined>;

export function enqueueSerial(queue: SerialQueueMap, key: string, job: () => Promise<void> | void): Promise<void> {
  const prev = queue[key] ?? Promise.resolve();
  let next: Promise<void>;
  next = prev
    .catch(() => undefined)
    .then(() => job())
    .catch(() => undefined)
    .finally(() => {
      if (queue[key] === next) delete queue[key];
    });
  queue[key] = next;
  return next;
}
