import { downscale } from './downscale';

interface Drawn {
  width: number;
  height: number;
  type?: string;
  quality?: number;
}

const original = (name = 'atelier.jpg', size = 6_000_000) => {
  const file = new File([new Uint8Array(16)], name, { type: 'image/jpeg' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

// jsdom has neither API; these stand in for a browser that decodes the photo
// at the given size and encodes the canvas into `out` bytes.
function browserWith(
  width: number,
  height: number,
  out = 1_500_000,
  { failDecode = false } = {},
) {
  const drawn: Drawn[] = [];
  const decoded: unknown[] = [];
  const close = jest.fn();
  const g = globalThis as Record<string, unknown>;
  g['createImageBitmap'] = jest.fn(async (_file: Blob, options: unknown) => {
    decoded.push(options);
    if (failDecode) throw new DOMException('bad image', 'InvalidStateError');
    return { close, height, width };
  });
  g['OffscreenCanvas'] = class {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}
    getContext() {
      return { drawImage: jest.fn() };
    }
    async convertToBlob(options: { type: string; quality: number }) {
      drawn.push({ height: this.height, width: this.width, ...options });
      const blob = new Blob([new Uint8Array(4)], { type: options.type });
      Object.defineProperty(blob, 'size', { value: out });
      return blob;
    }
  };
  return { close, decoded, drawn };
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g['createImageBitmap'];
  delete g['OffscreenCanvas'];
});

describe('a photo shrunk in the browser before it is sent', () => {
  // @traces 1191-FR-004
  it('sends a 4,000 x 3,000 photo as a 2,048 x 1,536 JPEG at quality 0.82, upright and smaller', async () => {
    const { close, decoded, drawn } = browserWith(4000, 3000);
    const file = original('atelier.jpeg');

    const sent = await downscale(file);

    expect(drawn).toEqual([
      { height: 1536, quality: 0.82, type: 'image/jpeg', width: 2048 },
    ]);
    expect(decoded).toEqual([{ imageOrientation: 'from-image' }]);
    expect(sent).not.toBe(file);
    expect(sent.type).toBe('image/jpeg');
    expect(sent.name).toBe('atelier.jpg');
    expect(sent.size).toBeLessThan(file.size);
    expect(close).toHaveBeenCalled();
  });

  // @traces 1191-FR-004
  it('keeps the aspect of a portrait photo, its long side at 2,048', async () => {
    const { drawn } = browserWith(3024, 4032);

    await downscale(original('telefon.heic'));

    expect(drawn[0]).toMatchObject({ height: 2048, width: 1536 });
  });

  // @traces 1191-FR-004
  it('sends a photo of at most 2,048 px as it is', async () => {
    const { drawn } = browserWith(2048, 1365);
    const file = original();

    expect(await downscale(file)).toBe(file);
    expect(drawn).toEqual([]);
  });

  // @traces 1191-FR-004
  it('sends the original in a browser without the decoding and canvas APIs', async () => {
    const file = original();

    expect(await downscale(file)).toBe(file);
  });

  // @traces 1191-FR-004
  it('sends the original when the photo cannot be decoded', async () => {
    browserWith(4000, 3000, 1_000, { failDecode: true });
    const file = original();

    expect(await downscale(file)).toBe(file);
  });

  // @traces 1191-FR-004
  it('sends the original when the shrunk copy is not smaller', async () => {
    const file = original('mic.png', 900_000);
    browserWith(4000, 3000, 900_000);

    expect(await downscale(file)).toBe(file);
  });
});
