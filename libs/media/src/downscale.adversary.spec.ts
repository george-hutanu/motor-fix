// @traces 1191-FR-004
import { downscale } from './downscale';

interface Fakes {
  blobBytes: number;
  close: jest.Mock;
  convertToBlob: jest.Mock;
  drawn: [number, number][];
  sizes: [number, number][];
}

function install(width: number, height: number, blobBytes: number): Fakes {
  const fakes: Fakes = {
    blobBytes,
    close: jest.fn(),
    convertToBlob: jest.fn(
      async () => new Blob([new Uint8Array(fakes.blobBytes)]),
    ),
    drawn: [],
    sizes: [],
  };
  Object.assign(globalThis, {
    createImageBitmap: jest.fn(async () => ({
      close: fakes.close,
      height,
      width,
    })),
    OffscreenCanvas: class {
      constructor(w: number, h: number) {
        fakes.sizes.push([w, h]);
      }
      getContext() {
        return {
          drawImage: (
            _b: unknown,
            _x: number,
            _y: number,
            w: number,
            h: number,
          ) => fakes.drawn.push([w, h]),
        };
      }
      convertToBlob = fakes.convertToBlob;
    },
  });
  return fakes;
}

const original = (name = 'foto.png', type = 'image/png', bytes = 5000) =>
  new File([new Uint8Array(bytes)], name, { type });

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'createImageBitmap');
  Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
});

describe('downscale at the edge of 2048 px', () => {
  it('sends a photo whose long side is exactly 2048 px untouched', async () => {
    const fakes = install(2048, 1536, 10);
    const file = original();

    expect(await downscale(file)).toBe(file);
    expect(fakes.sizes).toEqual([]);
    expect(fakes.close).toHaveBeenCalledTimes(1);
  });

  it('shrinks a photo one pixel past 2048 to 2048 on its long side', async () => {
    const fakes = install(2049, 1000, 10);

    const result = await downscale(original());

    expect(fakes.sizes).toEqual([[2048, 1000]]);
    expect(result.type).toBe('image/jpeg');
  });

  it('keeps a portrait photo upright with the long side on the height', async () => {
    const fakes = install(3000, 4000, 10);

    await downscale(original());

    expect(fakes.sizes).toEqual([[1536, 2048]]);
  });

  it('keeps the aspect of a square photo', async () => {
    const fakes = install(4096, 4096, 10);

    await downscale(original());

    expect(fakes.sizes).toEqual([[2048, 2048]]);
  });

  it('asks the decoder to apply the EXIF orientation', async () => {
    install(4000, 3000, 10);

    await downscale(original());

    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(File), {
      imageOrientation: 'from-image',
    });
  });

  it('encodes at JPEG quality 0.82', async () => {
    const fakes = install(4000, 3000, 10);

    await downscale(original());

    expect(fakes.convertToBlob).toHaveBeenCalledWith({
      quality: 0.82,
      type: 'image/jpeg',
    });
  });

  it('names the copy .jpg whatever the original extension', async () => {
    install(4000, 3000, 10);

    expect(
      (await downscale(original('IMG_0001.HEIC', 'image/heic'))).name,
    ).toBe('IMG_0001.jpg');
    expect((await downscale(original('no-extension'))).name).toBe(
      'no-extension.jpg',
    );
    expect((await downscale(original('a.b.c.webp', 'image/webp'))).name).toBe(
      'a.b.c.jpg',
    );
  });

  it('sends the original when the copy is not smaller', async () => {
    install(4000, 3000, 5000);
    const file = original('foto.png', 'image/png', 5000);

    expect(await downscale(file)).toBe(file);
  });

  it('sends the copy when it is one byte smaller than the original', async () => {
    install(4000, 3000, 4999);

    const result = await downscale(original('foto.png', 'image/png', 5000));

    expect(result.size).toBe(4999);
    expect(result.type).toBe('image/jpeg');
  });

  it('sends the original and closes the bitmap when the encoder throws', async () => {
    const fakes = install(4000, 3000, 10);
    fakes.convertToBlob.mockRejectedValue(new Error('out of memory'));
    const file = original();

    expect(await downscale(file)).toBe(file);
    expect(fakes.close).toHaveBeenCalledTimes(1);
  });

  it('sends the original when the decoder rejects the bytes', async () => {
    install(4000, 3000, 10);
    (createImageBitmap as jest.Mock).mockRejectedValue(
      new DOMException('bad image', 'InvalidStateError'),
    );
    const file = original('lie.jpg', 'image/jpeg');

    expect(await downscale(file)).toBe(file);
  });

  it('sends the original for a strip so thin its shrunk side would be zero pixels', async () => {
    const fakes = install(100_000, 1, 10);
    fakes.convertToBlob.mockRejectedValue(new DOMException('empty canvas'));
    const file = original();

    expect(await downscale(file)).toBe(file);
  });

  it('sends the original when only one of the two APIs exists', async () => {
    install(4000, 3000, 10);
    Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
    const file = original();

    expect(await downscale(file)).toBe(file);
  });

  it('sends the original for a 0 by 0 bitmap', async () => {
    install(0, 0, 10);
    const file = original();

    expect(await downscale(file)).toBe(file);
  });
});
