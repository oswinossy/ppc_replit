/**
 * Amazon Advertising API Client
 *
 * Handles OAuth2 authentication and report retrieval from
 * the Amazon Ads API (v3 Reporting) for Sponsored Products,
 * Sponsored Brands, and Sponsored Display campaigns.
 *
 * Prerequisites:
 *   1. Register an app at https://advertising.amazon.com/API/docs/en-us/guides/get-started/overview
 *   2. Complete OAuth authorization grant flow to obtain a refresh token
 *   3. Set the required environment variables (see .env.example)
 *
 * Regional endpoints:
 *   NA: https://advertising-api.amazon.com
 *   EU: https://advertising-api-eu.amazon.com
 *   FE: https://advertising-api-fe.amazon.com
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface AmazonAdsTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number; // epoch ms
}

interface AmazonAdsConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  profileId: string;
  region: 'na' | 'eu' | 'fe';
}

export interface ReportRequest {
  reportType: 'spSearchTerm' | 'spPlacement' | 'sbSearchTerm' | 'sbPlacement' | 'sdMatchedTarget' | 'sdTargeting';
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

interface ReportResponse {
  reportId: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  url?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

const REGIONAL_ENDPOINTS: Record<string, string> = {
  na: 'https://advertising-api.amazon.com',
  eu: 'https://advertising-api-eu.amazon.com',
  fe: 'https://advertising-api-fe.amazon.com',
};

/**
 * Maps our report types to the Amazon Ads v3 reporting configuration.
 * See: https://advertising.amazon.com/API/docs/en-us/guides/reporting/v3/overview
 */
const REPORT_TYPE_CONFIG: Record<string, { recordType: string; adProduct: string; metrics: string[] }> = {
  spSearchTerm: {
    recordType: 'searchTerm',
    adProduct: 'SPONSORED_PRODUCTS',
    metrics: [
      'impressions', 'clicks', 'cost', 'costPerClick', 'clickThroughRate',
      'purchases1d', 'purchases7d', 'purchases14d', 'purchases30d',
      'sales1d', 'sales7d', 'sales14d', 'sales30d',
      'unitsSoldClicks1d', 'unitsSoldClicks7d', 'unitsSoldClicks14d', 'unitsSoldClicks30d',
      'purchasesSameSku1d', 'purchasesSameSku7d', 'purchasesSameSku14d', 'purchasesSameSku30d',
      'attributedSalesSameSku1d', 'attributedSalesSameSku7d', 'attributedSalesSameSku14d', 'attributedSalesSameSku30d',
      'keywordId', 'keyword', 'keywordBid', 'keywordType', 'matchType',
      'searchTerm', 'targeting',
      'campaignId', 'campaignName', 'campaignStatus', 'campaignBudgetAmount', 'campaignBudgetCurrencyCode', 'campaignBudgetType',
      'adGroupId', 'adGroupName',
      'acosClicks7d', 'acosClicks14d', 'roasClicks7d', 'roasClicks14d',
    ],
  },
  spPlacement: {
    recordType: 'placement',
    adProduct: 'SPONSORED_PRODUCTS',
    metrics: [
      'impressions', 'clicks', 'cost', 'costPerClick', 'clickThroughRate',
      'purchases1d', 'purchases7d', 'purchases14d', 'purchases30d',
      'sales1d', 'sales7d', 'sales14d', 'sales30d',
      'unitsSoldClicks1d', 'unitsSoldClicks7d', 'unitsSoldClicks14d', 'unitsSoldClicks30d',
      'campaignId', 'campaignName', 'placementClassification',
      'acosClicks14d', 'roasClicks14d',
    ],
  },
  sbSearchTerm: {
    recordType: 'searchTerm',
    adProduct: 'SPONSORED_BRANDS',
    metrics: [
      'impressions', 'clicks', 'cost', 'purchases', 'sales', 'unitsSold',
      'purchasesClicks', 'salesClicks',
      'keywordId', 'keywordText', 'keywordBid', 'keywordType', 'matchType', 'adKeywordStatus',
      'searchTerm',
      'campaignId', 'campaignName', 'campaignStatus', 'campaignBudgetAmount', 'campaignBudgetCurrencyCode', 'campaignBudgetType',
      'adGroupId', 'adGroupName',
    ],
  },
  sbPlacement: {
    recordType: 'placement',
    adProduct: 'SPONSORED_BRANDS',
    metrics: [
      'impressions', 'clicks', 'cost', 'purchases', 'sales', 'unitsSold',
      'viewableImpressions', 'viewabilityRate',
      'newToBrandPurchases', 'newToBrandSales', 'newToBrandUnitsSold',
      'campaignId', 'campaignName', 'campaignStatus', 'costType',
    ],
  },
  sdMatchedTarget: {
    recordType: 'matchedTarget',
    adProduct: 'SPONSORED_DISPLAY',
    metrics: [
      'impressions', 'clicks', 'cost', 'sales', 'purchases', 'unitsSold',
      'salesClicks', 'purchasesClicks',
      'targetingId', 'targetingText', 'targetingExpression', 'matchedTargetAsin',
      'campaignId', 'campaignName',
      'adGroupId', 'adGroupName',
      'newToBrandPurchases', 'newToBrandSales',
      'detailPageViews', 'detailPageViewsClicks',
    ],
  },
  sdTargeting: {
    recordType: 'targeting',
    adProduct: 'SPONSORED_DISPLAY',
    metrics: [
      'impressions', 'clicks', 'cost', 'sales', 'purchases', 'unitsSold',
      'salesClicks', 'purchasesClicks',
      'targetingId', 'targetingText', 'targetingExpression',
      'campaignId', 'campaignName',
      'adGroupId', 'adGroupName',
      'newToBrandPurchases', 'newToBrandSales', 'newToBrandUnitsSold',
      'detailPageViews',
      'viewabilityRate', 'addToCartRate',
    ],
  },
};

// ─── Client ───────────────────────────────────────────────────────────────────

export class AmazonAdsClient {
  private config: AmazonAdsConfig;
  private tokens: AmazonAdsTokens | null = null;
  private baseUrl: string;

  constructor() {
    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    const clientSecret = process.env.AMAZON_ADS_CLIENT_SECRET;
    const refreshToken = process.env.AMAZON_ADS_REFRESH_TOKEN;
    const profileId = process.env.AMAZON_ADS_PROFILE_ID;
    const region = (process.env.AMAZON_ADS_REGION || 'eu') as 'na' | 'eu' | 'fe';

    if (!clientId || !clientSecret || !refreshToken || !profileId) {
      throw new Error(
        'Missing Amazon Ads credentials. Set AMAZON_ADS_CLIENT_ID, ' +
        'AMAZON_ADS_CLIENT_SECRET, AMAZON_ADS_REFRESH_TOKEN, and AMAZON_ADS_PROFILE_ID.'
      );
    }

    this.config = { clientId, clientSecret, refreshToken, profileId, region };
    this.baseUrl = REGIONAL_ENDPOINTS[region];
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  private async refreshAccessToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.tokens && Date.now() < this.tokens.expires_at - 60_000) {
      return this.tokens.access_token;
    }

    console.log('[AmazonAds] Refreshing access token...');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.config.refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Token refresh failed (${resp.status}): ${text}`);
    }

    const data = await resp.json() as { access_token: string; refresh_token: string; token_type: string; expires_in: number };

    this.tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || this.config.refreshToken,
      token_type: data.token_type,
      expires_in: data.expires_in,
      expires_at: Date.now() + data.expires_in * 1000,
    };

    console.log('[AmazonAds] Token refreshed, expires in', data.expires_in, 'seconds');
    return this.tokens.access_token;
  }

  private async apiHeaders(): Promise<Record<string, string>> {
    const token = await this.refreshAccessToken();
    return {
      'Authorization': `Bearer ${token}`,
      'Amazon-Advertising-API-ClientId': this.config.clientId,
      'Amazon-Advertising-API-Scope': this.config.profileId,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  // ── Reports (v3) ─────────────────────────────────────────────────────────

  /**
   * Request an async report from the Amazon Ads v3 Reporting API.
   * Returns the reportId to poll for completion.
   */
  async requestReport(req: ReportRequest): Promise<string> {
    const config = REPORT_TYPE_CONFIG[req.reportType];
    if (!config) {
      throw new Error(`Unknown report type: ${req.reportType}`);
    }

    const headers = await this.apiHeaders();
    const url = `${this.baseUrl}/reporting/reports`;

    const payload = {
      reportDate: req.startDate, // for single-day; v3 also supports timeUnit
      configuration: {
        adProduct: config.adProduct,
        reportTypeId: config.recordType,
        columns: config.metrics,
        timeUnit: 'DAILY',
        format: 'GZIP_JSON',
      },
      startDate: req.startDate,
      endDate: req.endDate,
    };

    console.log(`[AmazonAds] Requesting ${req.reportType} report (${req.startDate} → ${req.endDate})...`);

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Report request failed (${resp.status}): ${text}`);
    }

    const data = await resp.json() as { reportId: string };
    console.log(`[AmazonAds] Report queued: ${data.reportId}`);
    return data.reportId;
  }

  /**
   * Poll a report until it completes. Returns the download URL.
   * Amazon typically completes reports in 30s–5min.
   */
  async waitForReport(reportId: string, maxWaitMs = 600_000): Promise<string> {
    const headers = await this.apiHeaders();
    const url = `${this.baseUrl}/reporting/reports/${reportId}`;
    const started = Date.now();

    while (Date.now() - started < maxWaitMs) {
      const resp = await fetch(url, { headers });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Report status check failed (${resp.status}): ${text}`);
      }

      const data = await resp.json() as ReportResponse;

      if (data.status === 'COMPLETED' && data.url) {
        console.log(`[AmazonAds] Report ${reportId} ready`);
        return data.url;
      }

      if (data.status === 'FAILED') {
        throw new Error(`Report ${reportId} failed`);
      }

      // Wait before polling again (exponential backoff: 5s, 10s, 20s, capped at 30s)
      const elapsed = Date.now() - started;
      const delay = Math.min(5000 * Math.pow(2, Math.floor(elapsed / 15000)), 30000);
      await new Promise(r => setTimeout(r, delay));
    }

    throw new Error(`Report ${reportId} timed out after ${maxWaitMs / 1000}s`);
  }

  /**
   * Download a completed report from its URL.
   * Amazon serves reports as gzipped JSON.
   */
  async downloadReport(downloadUrl: string): Promise<any[]> {
    const resp = await fetch(downloadUrl);

    if (!resp.ok) {
      throw new Error(`Report download failed (${resp.status})`);
    }

    // The response may be gzipped — the fetch API auto-decompresses
    const text = await resp.text();

    // Amazon v3 reports return newline-delimited JSON or a JSON array
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Try newline-delimited JSON
      return text
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    }
  }

  /**
   * High-level: request, wait, and download a report in one call.
   */
  async fetchReport(req: ReportRequest): Promise<any[]> {
    const reportId = await this.requestReport(req);
    const downloadUrl = await this.waitForReport(reportId);
    return this.downloadReport(downloadUrl);
  }

  // ── Profiles ──────────────────────────────────────────────────────────────

  /**
   * List all advertising profiles accessible with the current credentials.
   * Useful for discovering profile IDs during initial setup.
   */
  async listProfiles(): Promise<any[]> {
    const headers = await this.apiHeaders();
    // Profile listing doesn't require the Scope header
    delete (headers as any)['Amazon-Advertising-API-Scope'];

    const resp = await fetch(`${this.baseUrl}/v2/profiles`, { headers });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`List profiles failed (${resp.status}): ${text}`);
    }

    return resp.json();
  }

  // ── Health Check ──────────────────────────────────────────────────────────

  /**
   * Verify that credentials are valid and the API is reachable.
   */
  async healthCheck(): Promise<{ ok: boolean; profileId: string; region: string; error?: string }> {
    try {
      await this.refreshAccessToken();
      return { ok: true, profileId: this.config.profileId, region: this.config.region };
    } catch (err: any) {
      return { ok: false, profileId: this.config.profileId, region: this.config.region, error: err.message };
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _client: AmazonAdsClient | null = null;

/**
 * Get the shared Amazon Ads API client instance.
 * Returns null if credentials are not configured (graceful degradation).
 */
export function getAmazonAdsClient(): AmazonAdsClient | null {
  if (_client) return _client;

  if (
    !process.env.AMAZON_ADS_CLIENT_ID ||
    !process.env.AMAZON_ADS_CLIENT_SECRET ||
    !process.env.AMAZON_ADS_REFRESH_TOKEN ||
    !process.env.AMAZON_ADS_PROFILE_ID
  ) {
    return null;
  }

  try {
    _client = new AmazonAdsClient();
    return _client;
  } catch (err) {
    console.warn('[AmazonAds] Client initialization failed:', err);
    return null;
  }
}
