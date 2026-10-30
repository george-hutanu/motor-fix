import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MEDIA_LIMITS } from '@motor-fix/contracts';
import sharp from 'sharp';

import { ClipTooLong, convertClip } from './clip';

// No video file in the repository: each fixture is drawn by ffmpeg here. A
// host without ffmpeg fails these tests, never skips them.
const work = mkdtempSync(join(tmpdir(), 'clip-spec-'));
afterAll(() => rmSync(work, { force: true, recursive: true }));
afterEach(() => jest.restoreAllMocks());

function made(
  seconds: number,
  size: string,
  format: 'mp4' | 'mov' | 'webm' = 'mp4',
): Buffer {
  const out = join(work, `${seconds}-${size}-${Math.random()}.${format}`);
  const codec =
    format === 'webm'
      ? [
          '-c:v',
          'libvpx-vp9',
          '-deadline',
          'realtime',
          '-cpu-used',
          '8',
          '-c:a',
          'libopus',
        ]
      : ['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac'];
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=${size}:rate=24:duration=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    ...codec,
    '-shortest',
    out,
  ]);
  return readFileSync(out);
}

function probe(file: Buffer) {
  const path = join(work, `probe-${Math.random()}.mp4`);
  writeFileSync(path, file);
  const info = JSON.parse(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,codec_name,width,height:format=format_name,duration',
      '-of',
      'json',
      path,
    ]).toString(),
  ) as {
    format: { duration: string; format_name: string };
    streams: {
      codec_name: string;
      codec_type: string;
      height?: number;
      width?: number;
    }[];
  };
  // faststart: the index (moov) sits before the media data (mdat).
  const head = file.subarray(0, 4096).toString('latin1');
  return { ...info, faststart: head.includes('moov') };
}

jest.setTimeout(120_000);

// @traces 333-FR-007
describe('converting a clip', () => {
  it('makes an H.264 MP4 with no sound, its shorter side at 720 px, and a JPEG thumbnail', async () => {
    const out = await convertClip(made(3, '1920x1080'), { maxSeconds: 60 });

    const info = probe(out.file);
    expect(info.format.format_name).toContain('mp4');
    expect(info.streams.map((s) => s.codec_type)).toEqual(['video']);
    expect(info.streams[0]).toMatchObject({
      codec_name: 'h264',
      height: 720,
      width: 1280,
    });
    expect(info.faststart).toBe(true);
    expect(out.seconds).toBe(3);
    const thumb = await sharp(out.thumbnail).metadata();
    expect(thumb.format).toBe('jpeg');
    expect(Math.max(thumb.width ?? 0, thumb.height ?? 0)).toBeLessThanOrEqual(
      480,
    );
  });

  it('keeps a portrait clip upright, its width at 720 px', async () => {
    const out = await convertClip(made(2, '1080x1920'), { maxSeconds: 60 });

    expect(probe(out.file).streams[0]).toMatchObject({
      height: 1280,
      width: 720,
    });
  });

  it('never enlarges a small clip', async () => {
    const out = await convertClip(made(2, '320x240'), { maxSeconds: 60 });

    expect(probe(out.file).streams[0]).toMatchObject({
      height: 240,
      width: 320,
    });
  });

  it.each(['mov', 'webm'] as const)('takes a %s', async (format) => {
    const out = await convertClip(made(2, '640x480', format), {
      maxSeconds: 60,
    });

    expect(probe(out.file).streams[0]).toMatchObject({ codec_name: 'h264' });
  });

  it('takes the first frame as the thumbnail of a clip shorter than a second', async () => {
    const out = await convertClip(made(0.5, '640x480'), { maxSeconds: 60 });

    expect((await sharp(out.thumbnail).metadata()).format).toBe('jpeg');
  });

  it('refuses a clip over 61 seconds before converting it', async () => {
    await expect(
      convertClip(made(63, '160x120'), { maxSeconds: 60 }),
    ).rejects.toBeInstanceOf(ClipTooLong);
  });

  it('takes a long kept recording when no limit is given', async () => {
    const out = await convertClip(made(63, '160x120'), {});

    expect(out.seconds).toBe(63);
  });

  it('fails on a file that is not a video', async () => {
    await expect(
      convertClip(Buffer.from('not a video'), { maxSeconds: 60 }),
    ).rejects.toThrow();
  });

  it('kills an ffmpeg run that reaches the attempt deadline', async () => {
    const clip = made(3, '1920x1080');
    const start = performance.now();
    let reads = 0;
    // The deadline is taken at the start and the probe runs a millisecond
    // later; from the transcode on, the clock stands 1 ms short of the
    // deadline. With 100 ms left a loaded machine could fire the kill timer
    // after ffmpeg had finished; no transcode of a 1080p clip ends in 1 ms.
    jest
      .spyOn(performance, 'now')
      .mockImplementation(() =>
        ++reads === 1
          ? start
          : reads === 2
            ? start + 1
            : start + MEDIA_LIMITS.conversionTimeoutMs - 1,
      );

    await expect(convertClip(clip, { maxSeconds: 60 })).rejects.toThrow(
      /ffmpeg exited on a signal/,
    );
  });

  it('converts a 45-second 720p clip with sound in under a minute', async () => {
    const clip = made(45, '1280x720');
    const started = performance.now();

    const out = await convertClip(clip, { maxSeconds: 60 });

    expect(performance.now() - started).toBeLessThan(60_000);
    expect(out.seconds).toBe(45);
  });
});
