import { Algorithm, hash, verify } from "@node-rs/argon2";

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(encodedHash: string, password: string): Promise<boolean> {
  return verify(encodedHash, password);
}
