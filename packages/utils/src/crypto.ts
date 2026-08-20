import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import {
  bytesToHex,
  hexToBytes,
  managedNonce,
  utf8ToBytes,
} from "@noble/ciphers/utils.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

export type SymmetricEncryptOptions = {
  key: string;
  data: string;
};

/**
 * Derives a 32-byte XChaCha20-Poly1305 key via HKDF-SHA256.
 * Uses empty salt and domain-separated info so the raw AUTH_ENCRYPTION_KEY
 * is never used directly. Existing tokens encrypted with the old SHA-256(key)
 * derivation will fail to decrypt and must be re-issued (10-min OTP window).
 */
const deriveKey = (key: string): Uint8Array =>
  hkdf(
    sha256,
    utf8ToBytes(key),
    undefined,
    utf8ToBytes("feeblo/verification-otp/v1"),
    32
  );

export const symmetricEncrypt = async ({
  key,
  data,
}: SymmetricEncryptOptions) => {
  const keyAsBytes = deriveKey(key);
  const dataAsBytes = utf8ToBytes(data);
  const chacha = managedNonce(xchacha20poly1305)(keyAsBytes);
  return bytesToHex(chacha.encrypt(dataAsBytes));
};

export type SymmetricDecryptOptions = {
  key: string;
  data: string;
};

export const symmetricDecrypt = async ({
  key,
  data,
}: SymmetricDecryptOptions) => {
  const keyAsBytes = deriveKey(key);
  const dataAsBytes = hexToBytes(data);
  const chacha = managedNonce(xchacha20poly1305)(keyAsBytes);
  return new TextDecoder().decode(chacha.decrypt(dataAsBytes));
};
