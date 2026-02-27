import postgres from "postgres";
import * as fs from 'fs';
import * as path from 'path';

export async function createAcosTargetsTable(): Promise<void> {
  const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');
  const sql = postgres(connectionUrl, { ssl: 'require' });
  
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS s_acos_target_campaign (
        campaign_id TEXT PRIMARY KEY,
        country TEXT NOT NULL,
        campaign_name TEXT NOT NULL,
        acos_target NUMERIC NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    console.log('s_acos_target_campaign table created/verified');
  } finally {
    await sql.end();
  }
}

export async function importAcosTargetsFromCSV(): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');
  const sql = postgres(connectionUrl, { ssl: 'require' });
  
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const batch: { campaignId: string; country: string; campaignName: string; acosTarget: number }[] = [];
  
  try {
    const csvPath = path.join(process.cwd(), 'attached_assets', 'ACOS_Target_Per_Campaign_ID_1768724351197.csv');
    let csvContent = fs.readFileSync(csvPath, 'utf-8');
    
    // Remove BOM if present
    if (csvContent.charCodeAt(0) === 0xFEFF) {
      csvContent = csvContent.slice(1);
    }
    
    const lines = csvContent.split('\n');
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const parts = line.split(',');
      if (parts.length < 4) {
        errors.push(`Line ${i + 1}: Invalid format`);
        skipped++;
        continue;
      }
      
      const country = parts[0].trim();
      const campaignName = parts.slice(1, -2).join(',').trim();
      const campaignId = parts[parts.length - 2].trim();
      const acosTargetStr = parts[parts.length - 1].trim();
      
      if (!campaignId) {
        skipped++;
        continue;
      }
      
      const acosTarget = parseFloat(acosTargetStr.replace('%', '')) / 100;
      
      if (isNaN(acosTarget)) {
        errors.push(`Line ${i + 1}: Invalid ACOS target "${acosTargetStr}"`);
        skipped++;
        continue;
      }
      
      batch.push({ campaignId, country, campaignName, acosTarget });
    }
    
    // Sequential insert with progress logging
    if (batch.length > 0) {
      console.log(`Starting import of ${batch.length} ACOS targets...`);
      for (let i = 0; i < batch.length; i++) {
        const r = batch[i];
        await sql`
          INSERT INTO s_acos_target_campaign (campaign_id, country, campaign_name, acos_target)
          VALUES (${r.campaignId}, ${r.country}, ${r.campaignName}, ${r.acosTarget})
          ON CONFLICT (campaign_id) DO UPDATE SET
            country = EXCLUDED.country,
            campaign_name = EXCLUDED.campaign_name,
            acos_target = EXCLUDED.acos_target
        `;
        imported++;
        if (imported % 500 === 0) {
          console.log(`Imported ${imported} / ${batch.length} ACOS targets...`);
        }
      }
      console.log(`Completed import of ${imported} ACOS targets`);
    }
    
    return { imported, skipped, errors: errors.slice(0, 10) };
  } finally {
    await sql.end();
  }
}

export async function getAcosTargetForCampaign(campaignId: string): Promise<number | null> {
  const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');
  const sql = postgres(connectionUrl, { ssl: 'require' });

  try {
    const result = await sql`
      SELECT acos_target FROM s_acos_target_campaign
      WHERE campaign_id = ${campaignId}
    `;

    if (result.length > 0) {
      return Number(result[0].acos_target);
    }
    return null;
  } catch (err) {
    console.warn('Could not fetch ACOS target for campaign', campaignId, err);
    return null;
  } finally {
    await sql.end();
  }
}
