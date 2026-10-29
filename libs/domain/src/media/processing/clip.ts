import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MEDIA_LIMITS } from '@motor-fix/contracts';
import { trace } from '@opentelemetry/api';

const tracer = () => trace.getTracer('motorfix');

// What ffmpeg said last, enough to see why it failed and never a whole log.
const TAIL_BYTES = 2048;

// The clip is longer than its kind allows; converting it again cannot help.
export class ClipTooLong extends Error {
  constructor(readonly seconds: number) {
    super(`the clip runs ${seconds} seconds`);
    this.name = 'ClipTooLong';
  }
}

class ToolFailed extends Error {
  constructor(
    tool: string,
    readonly exitCode: number | null,
    stderr: string,
  ) {
    super(`${tool} exited ${exitCode ?? 'on a signal'}: ${stderr}`);
    this.name = 'ToolFailed';
  }
}

// The attempt's time ran out between two runs.
class OutOfTime extends Error {
  constructor(tool: string) {
    super(`no time left to run ${tool}`);
    this.name = 'OutOfTime';
  }
}

// Runs a tool with an argument list: no shell, so nothing in a file name or
// a value is ever read as a command. The tool gets only the time left
// before the attempt's deadline, and is killed outright when that ends.
function run(tool: 'ffmpeg' | 'ffprobe', args: string[], deadline: number) {
  const left = deadline - Date.now();
  if (left <= 0) return Promise.reject(new OutOfTime(tool));
  return new Promise<string>((resolve, reject) => {
    const child = spawn(tool, args, {
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: left,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-TAIL_BYTES);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new ToolFailed(tool, code, stderr.trim())),
    );
  });
}

// The shorter side at most 720 px, never enlarged, both sides even as
// H.264 needs.
const SHORT = MEDIA_LIMITS.clipShortSidePx;
const SCALE = `scale=w='if(lt(iw,ih),trunc(min(${SHORT},iw)/2)*2,-2)':h='if(lt(iw,ih),-2,trunc(min(${SHORT},ih)/2)*2)'`;
const THUMB = MEDIA_LIMITS.thumbPx;
const THUMB_SCALE = `scale=w='min(${THUMB},iw)':h='min(${THUMB},ih)':force_original_aspect_ratio=decrease`;

const LIMIT = MEDIA_LIMITS.conversionTimeoutMs;

// The real length, in seconds, as the container states it.
async function lengthOf(source: string, deadline: number): Promise<number> {
  const said = await run(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      source,
    ],
    deadline,
  );
  const duration = Number(said.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('the clip has no readable length');
  }
  return duration;
}

async function transcode(
  source: string,
  dir: string,
  duration: number,
  deadline: number,
) {
  const output = join(dir, 'clip.mp4');
  const poster = join(dir, 'thumb.jpg');
  await run(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-i',
      source,
      '-map',
      '0:v:0',
      '-an',
      '-vf',
      SCALE,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      output,
    ],
    deadline,
  );
  await run(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-ss',
      duration >= 1 ? '1' : '0',
      '-i',
      output,
      '-frames:v',
      '1',
      '-vf',
      THUMB_SCALE,
      poster,
    ],
    deadline,
  );
  return { file: await readFile(output), thumbnail: await readFile(poster) };
}

// A clip or kept recording as the driver plays it: H.264 MP4 with no sound,
// its index first so it starts before it has all loaded, and a JPEG
// thumbnail from its first second. The real length is read before
// converting; a clip past `maxSeconds` (plus the rounding margin) is
// refused. The conversion limit is one budget for the whole attempt, every
// ffprobe and ffmpeg run sharing it, so an attempt ends before the job's
// lock does.
export function convertClip(
  input: Buffer,
  options: { maxSeconds?: number },
): Promise<{ file: Buffer; seconds: number; thumbnail: Buffer }> {
  return tracer().startActiveSpan('media.convert', async (span) => {
    const deadline = Date.now() + LIMIT;
    const dir = await mkdtemp(join(tmpdir(), 'media-'));
    try {
      const source = join(dir, 'source');
      await writeFile(source, input);
      const duration = await lengthOf(source, deadline);
      const seconds = Math.max(1, Math.round(duration));
      span.setAttributes({ 'media.kind': 'clip', 'media.seconds': seconds });
      const most = options.maxSeconds;
      if (
        most !== undefined &&
        duration > most + MEDIA_LIMITS.clipToleranceSeconds
      ) {
        throw new ClipTooLong(seconds);
      }
      const converted = await transcode(source, dir, duration, deadline);
      span.setAttribute('media.exit_code', 0);
      return { ...converted, seconds };
    } catch (error) {
      span.setAttribute(
        'media.exit_code',
        error instanceof ToolFailed ? (error.exitCode ?? -1) : -1,
      );
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
      await rm(dir, { force: true, recursive: true });
    }
  });
}
