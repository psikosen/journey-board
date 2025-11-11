const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export class AdaptiveFrameScheduler {
  constructor(options = {}) {
    this.baselineInterval = options.baselineInterval ?? 5000;
    this.minInterval = options.minInterval ?? 2000;
    this.maxInterval = options.maxInterval ?? 15000;
    this.motionThreshold = options.motionThreshold ?? 0.12;
    this.idleThreshold = options.idleThreshold ?? 0.02;
    this.smoothing = options.smoothing ?? 0.35;
    this._smoothedDelta = 0;
    this._currentInterval = this.baselineInterval;
  }

  registerDelta(delta) {
    const normalized = clamp(delta ?? 0, 0, 1);
    this._smoothedDelta =
      this.smoothing * normalized + (1 - this.smoothing) * this._smoothedDelta;
    this._currentInterval = this.#computeInterval();
    return this._currentInterval;
  }

  #computeInterval() {
    if (this._smoothedDelta >= this.motionThreshold) {
      const intensity = clamp(
        (this._smoothedDelta - this.motionThreshold) / (1 - this.motionThreshold),
        0,
        1,
      );
      const span = this.baselineInterval - this.minInterval;
      return Math.round(this.baselineInterval - intensity * span);
    }

    if (this._smoothedDelta <= this.idleThreshold) {
      const deficit = 1 - this._smoothedDelta / Math.max(this.idleThreshold, 0.0001);
      const span = this.maxInterval - this.baselineInterval;
      return Math.round(this.baselineInterval + clamp(deficit, 0, 1) * span);
    }

    return this.baselineInterval;
  }

  currentInterval() {
    return this._currentInterval;
  }
}
