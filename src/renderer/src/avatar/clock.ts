// Advance deadlines, rather than rounding each render to the next browser callback.
// At a 45Hz display, resetting to "now + 33ms" would unnecessarily reduce 3D to 22.5FPS.
export class FramePacer {
  private deadline = 0;
  reset() { this.deadline = 0; }
  due(timestamp: number): boolean {
    if (timestamp + 0.5 < this.deadline) return false;
    const interval = 1000 / 30;
    this.deadline = this.deadline === 0 ? timestamp + interval :
      this.deadline + (Math.floor(Math.max(0, timestamp - this.deadline) / interval) + 1) * interval;
    return true;
  }
}
