const MB = 1024 * 1024;
const IMAGES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const DOCUMENTS = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export interface FileRule {
  maxBytes: number;
  types: readonly string[];
}

// The one table of what each kind of file may be. API, worker and web app all
// read it; a story that stores a new kind of file adds its purpose here.
export const FILE_RULES = {
  garage_photo: { maxBytes: 10 * MB, types: IMAGES },
  legal_document: { maxBytes: 10 * MB, types: DOCUMENTS },
  mechanic_photo: { maxBytes: 10 * MB, types: IMAGES },
  message_photo: { maxBytes: 10 * MB, types: IMAGES },
  repair_invoice: { maxBytes: 10 * MB, types: DOCUMENTS },
} as const satisfies Record<string, FileRule>;

export type FilePurpose = keyof typeof FILE_RULES;

export const UPLOAD_URL_MINUTES = 15;
export const DOWNLOAD_URL_MINUTES = 5;
// A public profile is cached for 5 minutes, so its images outlive that by far.
export const PUBLIC_IMAGE_URL_MINUTES = 60;
