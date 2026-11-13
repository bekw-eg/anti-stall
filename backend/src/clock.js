/** Источник времени. В тестах подставляется управляемые часы — системное время не трогаем. */
export const systemClock = { now: () => Date.now() };

export class FakeClock {
  constructor(start = Date.UTC(2026, 0, 5, 10, 0, 0)) {
    this.t = start;
  }
  now() {
    return this.t;
  }
  advance(ms) {
    this.t += ms;
    return this.t;
  }
  set(t) {
    this.t = t;
  }
}
