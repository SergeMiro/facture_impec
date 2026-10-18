import { describe, expect, it } from 'vitest';
import { Offline } from './api';
import { OfflineQueue, RETRY_DELAYS_MS, type Timers } from './offline';

function manualTimers() {
  const pending = new Map<number, { fn: () => void; ms: number }>();
  let id = 0;
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      pending.set(++id, { fn, ms });
      return id;
    },
    clearTimeout: (handle) => {
      pending.delete(handle as number);
    },
  };
  const fire = async () => {
    const [[key, next] = []] = [...pending];
    if (key === undefined || !next) throw new Error('nothing scheduled');
    pending.delete(key);
    next.fn();
    await new Promise((r) => setTimeout(r, 0));
    return next.ms;
  };
  return { timers, pending, fire };
}

describe('OfflineQueue', () => {
  it('waits longer after each failed try, then runs the action once the API answers', async () => {
    const { timers, fire } = manualTimers();
    const labels: string[][] = [];
    const queue = new OfflineQueue((l) => labels.push(l), timers);
    let online = false;
    let runs = 0;
    queue.add('sync', 'Vérification de la feuille', async () => {
      runs++;
      if (!online) throw new Offline('down');
    });
    expect(await fire()).toBe(RETRY_DELAYS_MS[0]);
    expect(await fire()).toBe(RETRY_DELAYS_MS[1]);
    online = true;
    expect(await fire()).toBe(RETRY_DELAYS_MS[2]);
    expect(runs).toBe(3);
    expect(queue.labels).toEqual([]);
    expect(labels.at(0)).toEqual(['Vérification de la feuille']);
    expect(labels.at(-1)).toEqual([]);
  });

  it('keeps one item per key, and retries at once when the connection is back', async () => {
    const { timers, pending } = manualTimers();
    const queue = new OfflineQueue(() => {}, timers);
    const ran: string[] = [];
    queue.add('sync', 'un', async () => {
      ran.push('un');
    });
    queue.add('sync', 'deux', async () => {
      ran.push('deux');
    });
    expect(queue.labels).toEqual(['deux']);
    queue.retryNow();
    await new Promise((r) => setTimeout(r, 0));
    expect(ran).toEqual(['deux']);
    expect(pending.size).toBe(0);
  });

  it('drops an action that failed for another reason: it reported that itself', async () => {
    const { timers, fire } = manualTimers();
    const queue = new OfflineQueue(() => {}, timers);
    queue.add('send', 'Envoi', async () => {
      throw new Error('refusée');
    });
    await fire();
    expect(queue.labels).toEqual([]);
  });
});
