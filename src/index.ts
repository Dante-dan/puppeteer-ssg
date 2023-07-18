import puppeteer from 'puppeteer';
import { ssr } from './server-side-render';
import { runConcurrentTasks } from './run-concurrent-task';
import type { ssrResult, ssrOptions } from './server-side-render';
import { existsSync, mkdirSync, rmdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export type { ssrResult, ssrOptions };
export type setupOptions = {
  url: string[];
  concurrentNumber: number;
} & ssrOptions;

const DIST_PATH = join(process.cwd(), 'dist', 'ssr');
const PAGE_PATH = join(DIST_PATH, 'page');
if (existsSync(PAGE_PATH)) {
  rmdirSync(PAGE_PATH, { recursive: true });
}
mkdirSync(PAGE_PATH, { recursive: true });

export async function setup({ url, concurrentNumber = 5, blockList, allowStylesheetHost }: setupOptions, cb: (param: { path: string } & ssrResult) => {}) {
  const browser = await puppeteer.launch();
  const ssrAll = url.map((str) => ssr({ url: str, browser, blockList, allowStylesheetHost }));
  const result = await runConcurrentTasks(ssrAll, concurrentNumber);
  result.forEach((ssrResult) => {
    const { url, html, ttRenderMs } = ssrResult;
    const urlObj = new URL(url);
    const path = join(PAGE_PATH, urlObj.host, urlObj.pathname);
    mkdirSync(path, { recursive: true });
    const filePath = join(path, 'index.html' + urlObj.search);
    writeFileSync(filePath, html);
    cb({ path: filePath, ...ssrResult });
  });
  await browser.close();
}
