import { executeLearning, learningError, deliverLearningNotices } from './learning.js';

// Separate namespace: no weekly data, project grants, qualification or equipment fields.
export class LearningRecords {
  constructor(state, env) { this.state = state; this.env = env; this.queue = Promise.resolve(); }
  serial(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  fetch(request) {
    if (request.method === 'GET' && new URL(request.url).pathname === '/_learning-storage-check')
      return this.state.storage.get('health').then(() => Response.json({ ok: true, version: 'learning-text-v1' }));
    return this.serial(() => executeLearning(request, this.env, this.state.storage)
      .catch(error => learningError(request, this.env, error)));
  }
  alarm() {
    // A slow notification must not hold the student-save queue.
    if (!this.delivery) this.delivery = deliverLearningNotices(this.env, this.state.storage).finally(() => { this.delivery = null; });
    return this.delivery;
  }
}
