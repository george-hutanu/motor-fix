// The responsive copies every listing photo gets: each width in each format.
export const IMAGE_WIDTHS = [320, 640, 960, 1600] as const;
export const IMAGE_FORMATS = ['avif', 'webp'] as const;

type ImageWidth = (typeof IMAGE_WIDTHS)[number];
type ImageFormat = (typeof IMAGE_FORMATS)[number];

export const variantFile = (width: ImageWidth, format: ImageFormat) =>
  `${width}.${format}`;

// Every variant's key under a photo's variant path.
export const variantKeys = (path: string) =>
  IMAGE_WIDTHS.flatMap((width) =>
    IMAGE_FORMATS.map((format) => `${path}/${variantFile(width, format)}`),
  );
