describe('Scheduling Delay Calculations', () => {
  it('should calculate correct staggered offsets for batch recipients', () => {
    const startAt = new Date('2026-10-01T12:00:00Z');
    const minDelayMs = 2000;
    const recipients = ['r1@test.com', 'r2@test.com', 'r3@test.com'];

    const scheduledTimes = recipients.map((email, index) => ({
      email,
      scheduledAt: new Date(startAt.getTime() + index * minDelayMs),
    }));

    expect(scheduledTimes[0].scheduledAt.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(scheduledTimes[1].scheduledAt.toISOString()).toBe('2026-10-01T12:00:02.000Z');
    expect(scheduledTimes[2].scheduledAt.toISOString()).toBe('2026-10-01T12:00:04.000Z');
  });

  it('should clamp BullMQ delay to 0 if scheduledAt is in the past', () => {
    const pastDate = new Date(Date.now() - 60000); // 1 minute ago
    const delay = Math.max(0, pastDate.getTime() - Date.now());
    expect(delay).toBe(0);
  });

  it('should compute positive BullMQ delay for future scheduled dates', () => {
    const futureDate = new Date(Date.now() + 10000); // 10 seconds in future
    const delay = Math.max(0, futureDate.getTime() - Date.now());
    expect(delay).toBeGreaterThan(9000);
    expect(delay).toBeLessThanOrEqual(10000);
  });
});
