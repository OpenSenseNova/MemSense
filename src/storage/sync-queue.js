export class SyncQueue {
  constructor() {
    this.jobs = [];
  }

  enqueue(job) {
    const item = { id: `sync_${Math.random().toString(36).slice(2, 9)}`, status: "queued", job };
    this.jobs.push(item);
    queueMicrotask(() => {
      item.status = "done";
      item.doneAt = Date.now();
    });
    return item;
  }

  stats() {
    const queued = this.jobs.filter((x) => x.status === "queued").length;
    const done = this.jobs.filter((x) => x.status === "done").length;
    return { total: this.jobs.length, queued, done };
  }
}
