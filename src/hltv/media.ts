import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { engine } from './engine';

/**
 * Media image proxy: webviews cannot load hltv images directly (Cloudflare
 * challenges requests without the site cookies), so the panel asks the host;
 * we fetch through the parked engine page, cache to disk (fetch once per
 * session, like every other cache) and hand back a local file path.
 */
let cacheDir = path.join(os.tmpdir(), 'hltv-vscode-media');
const memory = new Map<string, string | null>(); // url → cached file path, or null = failed

export function setMediaDir(p: string): void {
  cacheDir = p;
  try {
    mkdirSync(cacheDir, { recursive: true });
  } catch {
    // read-only storage: fall back to tmp writes failing per-image
  }
}

/** Current media cache dir — webview panels must whitelist it in
 *  localResourceRoots or VSCode refuses to serve the cached files. */
export function mediaDir(): string {
  return cacheDir;
}

function cachedFileFor(url: string): string {
  const hash = createHash('sha1').update(url).digest('hex');
  const ext = /\.(png|gif|jpe?g|webp|svg)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'bin';
  return path.join(cacheDir, `${hash}.${ext === 'jpeg' ? 'jpg' : ext}`);
}

/** Returns an absolute path to the cached image file, or null on failure. */
export async function getMediaImage(url: string): Promise<string | null> {
  if (memory.has(url)) {
    return memory.get(url)!;
  }
  // SVGs are returned as data URIs: the webview resource server does not
  // serve local .svg files with an image content-type, so <img> refuses to
  // render them. Data URIs bypass the server and CSP allows data: in img-src.
  if (/\.svg(\?|$)/i.test(url)) {
    const b64 = await engine.fetchImageBase64(url).catch(() => null);
    const result = b64 ? `data:image/svg+xml;base64,${b64}` : null;
    memory.set(url, result);
    return result;
  }
  const file = cachedFileFor(url);
  let result: string | null = null;
  if (existsSync(file)) {
    result = file; // disk cache survives restarts too
  } else {
    const b64 = await engine.fetchImageBase64(url).catch((e) => {
      if (process.env.HLTV_DEBUG) {
        console.log(`[media] fetch threw ${url.slice(0, 70)}: ${String(e).split('\n')[0]}`);
      }
      return null;
    });
    if (b64) {
      try {
        writeFileSync(file, Buffer.from(b64, 'base64'));
        result = file;
      } catch {
        result = null; // cache dir not writable — image just won't persist
      }
    }
  }
  memory.set(url, result);
  return result;
}
