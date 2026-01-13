import cron from 'node-cron';
import { detectBidChanges } from './utils/bidChangeDetector';

let schedulerInitialized = false;

export function startScheduler() {
  if (schedulerInitialized) {
    console.log('[Scheduler] Already initialized, skipping duplicate registration');
    return;
  }
  
  schedulerInitialized = true;
  console.log('[Scheduler] Initializing bid change detection scheduler...');

  cron.schedule('0 2 * * *', async () => {
    console.log('[Scheduler] Running daily bid change detection at', new Date().toISOString());
    
    try {
      const result = await detectBidChanges();
      console.log(`[Scheduler] Bid change detection complete: ${result.total} changes (${result.products} products, ${result.brands} brands)`);
    } catch (error) {
      console.error('[Scheduler] Bid change detection failed:', error);
    }
  }, {
    timezone: 'UTC'
  });

  console.log('[Scheduler] Bid change detection scheduled to run daily at 2:00 AM UTC');
}
