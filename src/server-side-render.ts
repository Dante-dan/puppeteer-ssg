import type { Browser } from 'puppeteer';
const RENDER_CACHE = new Map();
const RESOURCE_CACHE = new Map();

export type ssrResult = {
  url: string;
  html: string;
  ttRenderMs: number;
};

export type ssrOptions = {
  blockList?: RegExp[];
  allowStylesheetHost?: string[];
  waitForSelector?: string;
  waitForTimeout?: number;
  allowRequestType?: string[];
};

export async function ssr({
  url,
  browser,
  blockList,
  allowStylesheetHost = [],
  waitForSelector: selector,
  waitForTimeout: timeout,
  allowRequestType,
}: {
  url: string;
  browser: Browser;
} & ssrOptions): Promise<ssrResult> {
  const renderUrl = new URL(url);
  renderUrl.searchParams.set('headless', '1');
  renderUrl.hash = '';
  url = renderUrl.href;
  if (RENDER_CACHE.has(url)) {
    return { url, html: RENDER_CACHE.get(url), ttRenderMs: 0 };
  }

  const stylesheetContents = {};

  const start = Date.now();
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);

    page.on('request', (req) => {
      // Ignore requests for resources that don't produce DOM (images, stylesheets, media).
      if (!allowRequestType.includes(req.resourceType())) {
        return req.abort();
      }
      // Ignore third-party requests.
      if (blockList.find((regex) => req.url().match(regex))) {
        return req.abort();
      }
      // use cached resource if available
      if (req.resourceType() === 'stylesheet' || req.resourceType() === 'script') {
        const cachedResponse = RESOURCE_CACHE.get(req.url());
        if (cachedResponse) {
          return req.respond(cachedResponse);
        }
      }
      // Pass through all other requests.
      req.continue();
    });
    // 1. Stash the responses of local stylesheets.
    page.on('response', async (resp) => {
      const responseUrl = resp.url();
      const resourceType = resp.request().resourceType();
      const isStylesheet = resourceType === 'stylesheet';
      if (isStylesheet) {
        // 处理样式表
        if (allowStylesheetHost.length === 0) {
          // 如果没有设置允许的样式表域名，则缓存所有样式表
          stylesheetContents[responseUrl] = await resp.text();
        } else if (allowStylesheetHost.includes(new URL(responseUrl).host)) {
          stylesheetContents[responseUrl] = await resp.text();
        }
      }
      if (
        resourceType === 'script' ||
        resourceType === 'document' ||
        resourceType === 'stylesheet' ||
        resourceType === 'media' ||
        resourceType === 'font' ||
        resourceType === 'manifest'
      ) {
        RESOURCE_CACHE.set(responseUrl, resp.request().responseForRequest());
      }
    });
    // networkidle0 waits for the network to be idle (no requests for 500ms).
    // The page's JS has likely produced markup by this point, but wait longer
    // if your site lazy loads, etc.
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 0 });
    if (selector) {
      await page.waitForSelector(selector);
    }
    await page.waitForNetworkIdle({ idleTime: timeout || 10000, timeout: 0 });
    await page.$$eval(
      'link[rel="stylesheet"]',
      (links, content) => {
        links.forEach((link) => {
          const cssText = content[link.href];
          if (cssText) {
            const style = document.createElement('style');
            style.textContent = cssText;
            link.replaceWith(style);
          }
        });
      },
      stylesheetContents,
    );
  } catch (err) {
    console.error(err);
    throw new Error('page.goto/waitForSelector timed out.');
  }

  const html = await page.content(); // serialized HTML of page DOM.
  await page.close();
  const ttRenderMs = Date.now() - start;
  console.info(`Headless rendered page in: ${ttRenderMs}ms`);

  RENDER_CACHE.set(url, html); // cache rendered page.

  return { url, html, ttRenderMs };
}
