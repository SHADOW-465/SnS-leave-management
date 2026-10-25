export type SetupForm = {
  companyName: string;
  timezone: string;
  leaveYearStartMonth: number;
  leaveYearStartDay: number;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  loadSampleData: boolean;
  setupToken: string;
};

/** Hosted setup sends the token and never asks to load the published sample organisation. */
export function setupPayload(form: SetupForm, setupTokenRequired: boolean) {
  const { setupToken, loadSampleData, ...rest } = form;
  return {
    ...rest,
    loadSampleData: setupTokenRequired ? false : loadSampleData,
    ...(setupTokenRequired ? { setupToken } : {}),
  };
}
