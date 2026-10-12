import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

export async function sha256(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
