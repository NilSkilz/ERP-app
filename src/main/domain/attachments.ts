import { app } from 'electron';
import { join, extname, sep } from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { Db, DbLike } from '../db/client.js';
import { variantAttachments } from '../db/schema.js';

export interface AttachmentInput {
  variantId: number;
  filename: string;
  mimeType: string;
  data: Uint8Array;
  caption?: string | null;
}

export function assetsDir(): string {
  return join(app.getPath('userData'), 'assets');
}

// Some OSes return empty `file.type` for SVG (and a few other formats), so
// we sniff a sensible mime from the filename extension when the supplied
// one is missing or generic. The mime is what the renderer uses to decide
// whether to thumbnail vs. show a file icon; the protocol handler still
// sets the response Content-Type per extension regardless.
const MIME_BY_EXT: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
};

function resolveMimeType(filename: string, provided: string): string {
  const trusted = provided && provided !== 'application/octet-stream' ? provided : '';
  if (trusted) return trusted;
  const ext = extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export async function addVariantAttachment(db: Db, input: AttachmentInput) {
  if (!input.filename?.trim()) throw new Error('filename is required');
  if (!input.data || input.data.byteLength === 0) {
    throw new Error('attachment data is empty');
  }
  // 20 MB ceiling — generous for diagrams, defensive against accidental
  // huge-file imports.
  if (input.data.byteLength > 20 * 1024 * 1024) {
    throw new Error('attachment exceeds 20 MB limit');
  }

  const ext = (extname(input.filename) || '.bin').toLowerCase();
  const uuid = randomUUID();
  const relativePath = `variants/${input.variantId}/${uuid}${ext}`;
  const absolutePath = join(assetsDir(), relativePath);

  await mkdir(join(absolutePath, '..'), { recursive: true });
  await writeFile(absolutePath, input.data);

  return db
    .insert(variantAttachments)
    .values({
      variant_id: input.variantId,
      filename: input.filename,
      storage_path: relativePath,
      mime_type: resolveMimeType(input.filename, input.mimeType),
      size_bytes: input.data.byteLength,
      caption: input.caption ?? null,
    })
    .returning()
    .get();
}

export function listVariantAttachments(db: DbLike, variantId: number) {
  return db
    .select()
    .from(variantAttachments)
    .where(eq(variantAttachments.variant_id, variantId))
    .orderBy(asc(variantAttachments.sort_order), asc(variantAttachments.id))
    .all();
}

export async function deleteVariantAttachment(db: Db, attachmentId: number) {
  const row = db
    .select()
    .from(variantAttachments)
    .where(eq(variantAttachments.id, attachmentId))
    .get();
  if (!row) throw new Error(`Attachment ${attachmentId} not found`);

  const absolutePath = join(assetsDir(), row.storage_path);
  // Defensive: never let storage_path escape the assets dir
  const safeBase = assetsDir() + sep;
  if (!absolutePath.startsWith(safeBase) && absolutePath !== assetsDir()) {
    throw new Error('Refusing to delete file outside assets directory');
  }

  try {
    await unlink(absolutePath);
  } catch (err) {
    console.warn(`[attachments] could not remove ${absolutePath}:`, err);
  }

  db.delete(variantAttachments).where(eq(variantAttachments.id, attachmentId)).run();
  return { deleted: true as const };
}

export function updateAttachmentCaption(
  db: DbLike,
  attachmentId: number,
  caption: string | null
) {
  return db
    .update(variantAttachments)
    .set({ caption })
    .where(eq(variantAttachments.id, attachmentId))
    .returning()
    .get();
}
