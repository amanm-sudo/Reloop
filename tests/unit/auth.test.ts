import { describe, expect, it } from 'vitest';
import { credentialsSchema, hashPassword, registrationSchema, verifyPassword } from '@/lib/auth';

describe('password hashing', () => {
  it('uses Argon2id', async () => {
    // src/lib/auth.ts cannot name the algorithm explicitly (ambient const enum vs
    // isolatedModules), so it relies on the library default. This asserts that default.
    const digest = await hashPassword('a-sufficiently-long-password');
    expect(digest.startsWith('$argon2id$')).toBe(true);
  });

  it('round-trips a correct password and rejects a wrong one', async () => {
    const digest = await hashPassword('a-sufficiently-long-password');
    await expect(verifyPassword('a-sufficiently-long-password', digest)).resolves.toBe(true);
    await expect(verifyPassword('not-the-password', digest)).resolves.toBe(false);
  });

  it('salts, so identical passwords produce different digests', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password-here'), hashPassword('same-password-here')]);
    expect(a).not.toBe(b);
  });

  it('treats a malformed stored hash as a failed login, not a crash', async () => {
    await expect(verifyPassword('anything', 'not-a-hash')).resolves.toBe(false);
  });
});

describe('credential validation', () => {
  it('normalises email casing and whitespace', () => {
    const parsed = credentialsSchema.parse({
      email: '  Ananya@Example.COM ',
      password: 'ten-characters-minimum',
    });
    expect(parsed.email).toBe('ananya@example.com');
  });

  it('rejects short passwords', () => {
    const parsed = credentialsSchema.safeParse({ email: 'a@b.com', password: 'short' });
    expect(parsed.success).toBe(false);
  });

  it('defaults new accounts to DONOR', () => {
    const parsed = registrationSchema.parse({
      email: 'a@b.com',
      password: 'ten-characters-minimum',
      displayName: 'Ananya',
    });
    expect(parsed.role).toBe('DONOR');
  });
});
