import { timingSafeEqual } from "node:crypto";
import { Router } from "express";

// Runs `task` at most once at a time. Calls while it runs are folded into one follow-up run, so a burst
// of triggers (a webhook per transaction) costs at most two runs, and nothing that arrived mid-run is missed.
export function coalesce(task: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  const start = (): Promise<void> => {
    running = task()
      .catch(() => undefined)
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          void start();
        }
      });
    return running;
  };
  return () => {
    if (running) {
      again = true;
      return running;
    }
    return start();
  };
}

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

// Helius calls this when a transaction touches our program. The payload is only a nudge: the reconciler
// reads the chain itself, so nothing in the body is trusted. Helius sends the secret we configured as the
// Authorization header. Replies at once; Helius retries on slow or failed responses.
export function heliusWebhook(options: { secret: string; onActivity: () => void }): Router {
  const router = Router();
  router.post("/helius", (req, res) => {
    const given = req.headers.authorization ?? "";
    if (!sameSecret(given, options.secret)) return void res.sendStatus(401);
    const count = Array.isArray(req.body) ? req.body.length : 0;
    res.json({ ok: true, received: count });
    options.onActivity();
  });
  return router;
}
