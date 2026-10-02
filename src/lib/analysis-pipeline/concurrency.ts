export function createSingleFlightRunner<T>(
  run: (key: string) => Promise<T>,
): (key: string) => Promise<T> {
  const inFlight = new Map<string, Promise<T>>();

  return (key) => {
    const existing = inFlight.get(key);
    if (existing) return existing;

    const current = Promise.resolve().then(() => run(key));
    inFlight.set(key, current);

    const clear = () => {
      if (inFlight.get(key) === current) inFlight.delete(key);
    };
    void current.then(clear, clear);

    return current;
  };
}
