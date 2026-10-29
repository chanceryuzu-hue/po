// Image loading: decoded bitmaps, a small concurrency limit so frames stream
// in without starving the rest of the page.

export type Bitmap = ImageBitmap | HTMLImageElement;

export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return img;
}

/** A decoded bitmap when the browser supports it, else a decoded <img>. */
export async function loadBitmap(src: string): Promise<Bitmap> {
  if ('createImageBitmap' in window) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${res.status} ${src}`);
    const blob = await res.blob();
    try {
      return await createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });
    } catch {
      /* fall through to <img> */
    }
  }
  return loadImage(src);
}

/** Loads a list of images with at most `limit` requests in flight. */
export async function loadAll(srcs: string[], limit = 6, onEach?: (done: number) => void): Promise<Bitmap[]> {
  const out: Bitmap[] = new Array(srcs.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < srcs.length) {
      const i = next++;
      out[i] = await loadBitmap(srcs[i]);
      onEach?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, srcs.length) }, worker));
  return out;
}

export function release(list: (Bitmap | null | undefined)[]) {
  for (const b of list) if (b && 'close' in b) (b as ImageBitmap).close();
}
