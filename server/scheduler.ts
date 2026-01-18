import cron from 'node-cron';
import { detectBidChanges } from './utils/bidChangeDetector';
import { generateDailyRecommendations } from './utils/recommendationGenerator';

let schedulerInitialized = false;

export function startScheduler() {
  if (schedulerInitialized) {
    console.log('[Scheduler] Already initialized, skipping duplicate registration');
    return;
  }
  
  schedulerInitialized = true;
  console.log('[Scheduler] Initializing bid change detection scheduler...');

  // Bid change detection at 2:00 AM UTC
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

  // Daily bid recommendations generation at 3:00 AM UTC (after bid change detection)
  cron.schedule('0 3 * * *', async () => {
    console.log('[Scheduler] Running daily bid recommendations generation at', new Date().toISOString());
    
    try {
      const result = await generateDailyRecommendations();
      console.log(`[Scheduler] Daily recommendations generated: ${result.total} recommendations across ${result.countries} countries`);
    } catch (error) {
      console.error('[Scheduler] Daily recommendations generation failed:', error);
    }
  }, {
    timezone: 'UTC'
  });

  console.log('[Scheduler] Bid change detection scheduled to run daily at 2:00 AM UTC');
  console.log('[Scheduler] Bid recommendations scheduled to run daily at 3:00 AM UTC');
}
