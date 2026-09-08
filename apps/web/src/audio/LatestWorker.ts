type Job<T> = {data: object; resolve: (value: T) => void; reject: (error: Error) => void; obsolete: boolean};
/** One running request and the latest queued request. Reuse a warm worker for
 * short compilations; bound how long obsolete heavy work can delay an edit. */
export class LatestWorker<T> {
  private worker: Worker | null = null;
  private running: Job<T> | null = null;
  private queued: Job<T> | null = null;
  private abortTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private url: string) {}
  request(data: object): Promise<T> {
    this.cancel();
    return new Promise((resolve, reject) => {this.queued = {data, resolve, reject, obsolete: false}; this.dispatch();});
  }
  private dispatch() {
    if (this.running || !this.queued) return;
    if (!this.worker) {
      this.worker = new Worker(this.url);
      const active = this.worker;
      this.worker.onmessage = ({data}) => {
        if (this.worker !== active) return;
        if (data.type === 'progress') return;
        const job = this.running; this.running = null;
        if (this.abortTimer) clearTimeout(this.abortTimer); this.abortTimer = null;
        if (job && !job.obsolete) data.error ? job.reject(Error(data.error)) : job.resolve(data);
        this.dispatch();
      };
      this.worker.onerror = () => {
        if (this.worker !== active) return;
        if (this.abortTimer) clearTimeout(this.abortTimer); this.abortTimer = null;
        this.running?.reject(Error('The audio renderer failed. Try a shorter MIDI.'));
        this.running = null; this.worker?.terminate(); this.worker = null; this.dispatch();
      };
    }
    this.running = this.queued; this.queued = null;
    try {this.worker.postMessage(this.running.data);}
    catch (error) {const job=this.running;this.running=null;job.reject(error instanceof Error?error:Error(String(error)));this.dispatch();}
  }
  cancel() {
    const error = new DOMException('Preparation cancelled', 'AbortError');
    this.queued?.reject(error); this.queued = null;
    if (this.running && !this.running.obsolete) {
      this.running.obsolete = true; this.running.reject(error);
      this.abortTimer = setTimeout(() => {
        this.worker?.terminate(); this.worker = null; this.running = null; this.abortTimer = null; this.dispatch();
      }, 100);
    }
  }
  dispose() {
    this.cancel(); if (this.abortTimer) clearTimeout(this.abortTimer); this.abortTimer = null;
    this.worker?.terminate(); this.worker = null; this.running = null;
  }
}
