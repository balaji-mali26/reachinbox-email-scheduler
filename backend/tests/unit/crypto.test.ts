import { encryptToken, decryptToken } from '../../src/utils/crypto';

describe('AES-256-GCM Token Encryption', () => {
  it('should encrypt and decrypt a Slack token correctly', () => {
    const rawToken = 'mock-slack-token-payload-abc-123-xyz';
    const encrypted = encryptToken(rawToken);

    expect(encrypted.encryptedToken).toBeDefined();
    expect(encrypted.tokenIv).toBeDefined();
    expect(encrypted.tokenTag).toBeDefined();
    expect(encrypted.encryptedToken).not.toEqual(rawToken);

    const decrypted = decryptToken(
      encrypted.encryptedToken,
      encrypted.tokenIv,
      encrypted.tokenTag
    );

    expect(decrypted).toEqual(rawToken);
  });

  it('should fail decryption if ciphertext or tag is tampered with', () => {
    const rawToken = 'mock-slack-token-payload-for-tamper-test';
    const encrypted = encryptToken(rawToken);

    const tamperedCipher = encrypted.encryptedToken.slice(0, -2) + 'ff';

    expect(() => {
      decryptToken(tamperedCipher, encrypted.tokenIv, encrypted.tokenTag);
    }).toThrow();
  });
});
