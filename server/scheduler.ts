import cron from 'node-cron';
import { detectBidChanges } from './utils/bidChangeDetector';
import { generateDailyRecommendations } from './utils/recommendationGenerator';
import { syncAmazonAdsData } from './utils/amazonAdsSync';
import { getAmazonAdsClient } from './amazonAdsClient';

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

  // Amazon Ads data sync at 1:00 AM UTC (before bid change detection)
  // Only runs if Amazon Ads credentials are configured
  if (getAmazonAdsClient()) {
    cron.schedule('0 1 * * *', async () => {
      console.log('[Scheduler] Running daily Amazon Ads data sync at', new Date().toISOString());

      try {
        const result = await syncAmazonAdsData();
        console.log(`[Scheduler] Amazon Ads sync complete: ${result.totalRows} rows across ${result.results.length} report types`);
        if (!result.success) {
          const failures = result.results.filter(r => r.error);
          console.warn(`[Scheduler] Some reports failed:`, failures.map(f => `${f.reportType}: ${f.error}`));
        }
      } catch (error) {
        console.error('[Scheduler] Amazon Ads data sync failed:', error);
      }
    }, {
      timezone: 'UTC'
    });

    console.log('[Scheduler] Amazon Ads data sync scheduled to run daily at 1:00 AM UTC');
  } else {
    console.log('[Scheduler] Amazon Ads credentials not configured — skipping ads sync schedule');
  }

  console.log('[Scheduler] Bid change detection scheduled to run daily at 2:00 AM UTC');
  console.log('[Scheduler] Bid recommendations scheduled to run daily at 3:00 AM UTC');
}
