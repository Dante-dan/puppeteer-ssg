import puppeteer from 'puppeteer';
import { ssr } from './server-side-render';
import { runConcurrentTasks } from './run-concurrent-task';
import type { ssrResult, ssrOptions } from './server-side-render';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

export type { ssrResult, ssrOptions };
export type setupOptions = {
  url: string[];
  concurrentNumber?: number;
} & ssrOptions;

export type setupResult = ({ path: string } & ssrResult)[];

export const DEFAULT_ALLOW_REQUEST_TYPE = ['document', 'script', 'xhr', 'fetch', 'stylesheet', 'other'];
export const DEFAULT_BLOCK_LIST = [/analytics\.js/, /google-analytics/, /clarity/, /cloudflareinsights/];

const DIST_PATH = join(process.cwd(), 'dist', 'ssr');
const PAGE_PATH = join(DIST_PATH, 'page');
if (existsSync(PAGE_PATH)) {
  rmSync(PAGE_PATH, { recursive: true });
}
mkdirSync(PAGE_PATH, { recursive: true });

export async function setup({
  url,
  concurrentNumber,
  blockList = DEFAULT_BLOCK_LIST,
  allowStylesheetHost,
  waitForSelector,
  waitForTimeout,
  concatStylesheetToHtml,
  allowRequestType = DEFAULT_ALLOW_REQUEST_TYPE,
}: setupOptions): Promise<setupResult> {
  const browser = await puppeteer.launch({ args: ['--disable-web-security'], ignoreHTTPSErrors: true, headless: 'new' });
  const ssrAll = url.map(
    (str) => () =>
      ssr({
        url: str,
        browser,
        blockList,
        allowStylesheetHost,
        waitForSelector,
        waitForTimeout,
        allowRequestType,
        concatStylesheetToHtml,
      }),
  );
  const result = await runConcurrentTasks(ssrAll, concurrentNumber);
  const results = result.map((ssrResult) => {
    const { url, html, ttRenderMs } = ssrResult;
    const urlObj = new URL(url);
    const path = join(PAGE_PATH, urlObj.host, urlObj.pathname);
    mkdirSync(path, { recursive: true });
    urlObj.searchParams.delete('headless');
    const filePath = join(path, 'index' + urlObj.search + '.html');
    writeFileSync(filePath, html);
    return { path: filePath, ...ssrResult };
  });
  await browser.close();
  return results;
}
