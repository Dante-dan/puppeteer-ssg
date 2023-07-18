import puppeteer from 'puppeteer';
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
};

export async function ssr({
  url,
  browser,
  blockList,
  allowStylesheetHost,
}: {
  url: string;
  browser: Browser;
} & ssrOptions): Promise<ssrResult> {
  const renderUrl = new URL(url);
  renderUrl.searchParams.set('headless', '');
  renderUrl.hash = '';
  url = renderUrl.href;
  if (RENDER_CACHE.has(url)) {
    return { url, html: RENDER_CACHE.get(url), ttRenderMs: 0 };
  }

  const stylesheetContents = {};

  const start = Date.now();
  browser = await puppeteer.launch();
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);

    page.on('request', (req) => {
      // Ignore requests for resources that don't produce DOM (images, stylesheets, media).
      const allowList = ['document', 'script', 'xhr', 'fetch', 'stylesheet'];
      if (!allowList.includes(req.resourceType())) {
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
          return req.respond({
            body: cachedResponse,
            status: 200,
          });
        }
      }
      // Pass through all other requests.
      req.continue();
    });
    // 1. Stash the responses of local stylesheets.
    page.on('response', async (resp) => {
      const responseUrl = resp.url();
      const isStylesheet = resp.request().resourceType() === 'stylesheet';
      if (isStylesheet && allowStylesheetHost.includes(new URL(responseUrl).host)) {
        stylesheetContents[responseUrl] = await resp.text();
      }
      RESOURCE_CACHE.set(responseUrl, await resp.buffer());
    });
    // networkidle0 waits for the network to be idle (no requests for 500ms).
    // The page's JS has likely produced markup by this point, but wait longer
    // if your site lazy loads, etc.
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#tap');
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
