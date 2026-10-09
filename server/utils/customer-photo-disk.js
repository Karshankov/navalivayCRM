import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const customerAvatarDir = path.resolve(
  process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads'),
  'customer-avatars',
);

export function getCustomerAvatarDiskPath(customerId) {
  return path.join(customerAvatarDir, `${customerId}.jpg`);
}

export function hasCustomerPhotoOnDisk(customerId) {
  if (!customerId) {
    return false;
  }
  return fs.existsSync(getCustomerAvatarDiskPath(customerId));
}

export function readCustomerPhotoFromDisk(customerId) {
  const filePath = getCustomerAvatarDiskPath(customerId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return {
    body: fs.readFileSync(filePath),
    contentType: 'image/jpeg',
  };
}