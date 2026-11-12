// The layout and draft passes are generators that yield between pages and
// sections, so a long book does not hold the server's one thread: the job
// runs them a slice at a time (finishSliced), giving the tables' requests
// their turn between slices; tests and tools run them straight through
// (finish). A crafted 800-page book of the densest pages the reading
// allows is about 30 seconds of work, which unsliced would be 30 seconds of
// a frozen server.

export function finish<T>(work: Generator<void, T>): T {
  for (;;) {
    const step = work.next();
    if (step.done) return step.value;
  }
}

export async function finishSliced<T>(work: Generator<void, T>, sliceMs = 20): Promise<T> {
  let started = Date.now();
  for (;;) {
    const step = work.next();
    if (step.done) return step.value;
    if (Date.now() - started >= sliceMs) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      started = Date.now();
    }
  }
}
