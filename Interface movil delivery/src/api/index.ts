import { USE_MOCK } from "./client";
import { mockApi } from "./mock";
import { realApi } from "./real";
import type { DeliveryApi } from "./contract";

export const api: DeliveryApi = USE_MOCK ? mockApi : realApi;

export * from "./contract";
export * from "./types";
export { USE_MOCK, apiErrorMessage } from "./client";
export { getServerUrl, resolveServer } from "./server";
