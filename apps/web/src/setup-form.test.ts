import { describe, expect, it } from 'vitest';
import { setupPayload, type SetupForm } from './setup-form.js';

const form: SetupForm = {
  companyName: 'Simon & Sons',
  timezone: 'Asia/Kolkata',
  leaveYearStartMonth: 1,
  leaveYearStartDay: 1,
  adminName: 'Ada Example',
  adminEmail: 'ada@example.invalid',
  adminPassword: 'a-long-password',
  loadSampleData: true,
  setupToken: 'hosted-token',
};

describe('setup form payload', () => {
  it('omits the token on an office installation and keeps the sample-data choice', () => {
    const body = setupPayload(form, false);
    expect(body).not.toHaveProperty('setupToken');
    expect(body.loadSampleData).toBe(true);
  });

  it('sends the token and refuses sample data when the server requires a token', () => {
    const body = setupPayload(form, true);
    expect(body.setupToken).toBe('hosted-token');
    expect(body.loadSampleData).toBe(false);
  });
});
