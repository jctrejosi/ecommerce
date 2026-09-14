import { apiFetch, getRefreshToken, persistTokens } from "./client";
import type { Customer, CustomerAddress } from "./types";

export interface CustomerAuthResponse {
  accessToken: string;
  refreshToken: string;
  customer: Customer;
}

export interface CustomerLoginData {
  email: string;
  password: string;
}
export interface CustomerRegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  acceptsTerms: boolean;
  acceptsMarketing?: boolean;
}

export interface CustomerAddressInput {
  alias?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  reference?: string;
  deliveryInstructions?: string;
}

export interface CustomerPaymentMethod {
  id: number;
  methodType?: string;
  last4?: string;
  brand?: string;
  phone?: string;
  cardholderName?: string;
  isDefault?: boolean;
}

export const authApi = {
  async register(data: CustomerRegisterData): Promise<CustomerAuthResponse> {
    const res = await apiFetch<CustomerAuthResponse>("/customer-auth/register", {
      method: "POST",
      body: data,
    });
    await persistTokens(res.accessToken, res.refreshToken);
    return res;
  },

  /** Login social (google/facebook): valida el token en el backend. */
  async socialLogin(
    provider: "google" | "facebook",
    accessToken: string,
    userData?: {
      email?: string;
      name?: string;
      picture?: string;
      id?: string;
    },
  ): Promise<CustomerAuthResponse> {
    const res = await apiFetch<CustomerAuthResponse>("/customer-auth/social-login", {
      method: "POST",
      body: { provider, accessToken, userData },
    });
    await persistTokens(res.accessToken, res.refreshToken);
    return res;
  },

  async login(data: CustomerLoginData): Promise<CustomerAuthResponse> {
    const res = await apiFetch<CustomerAuthResponse>("/customer-auth/login", {
      method: "POST",
      body: data,
    });
    await persistTokens(res.accessToken, res.refreshToken);
    return res;
  },

  getProfile(): Promise<Customer> {
    return apiFetch<Customer>("/customer-auth/me", { auth: true });
  },

  updateProfile(data: Partial<Customer>): Promise<Customer> {
    return apiFetch<Customer>("/customer-auth/me", {
      method: "PUT",
      auth: true,
      body: data,
    });
  },

  async logout(): Promise<void> {
    const refreshToken = await getRefreshToken();
    await persistTokens(null, null);
    if (!refreshToken) return;
    try {
      await apiFetch("/customer-auth/logout", {
        method: "POST",
        body: { refreshToken },
      });
    } catch {
      // sesión local ya limpia
    }
  },

  getAddresses(): Promise<CustomerAddress[]> {
    return apiFetch<CustomerAddress[]>("/customer-auth/addresses", {
      auth: true,
    });
  },
  createAddress(data: CustomerAddressInput): Promise<{ id: number }> {
    return apiFetch("/customer-auth/addresses", {
      method: "POST",
      auth: true,
      body: data,
    });
  },
  updateAddress(id: number, data: CustomerAddressInput): Promise<{ id: number }> {
    return apiFetch(`/customer-auth/addresses/${id}`, {
      method: "PUT",
      auth: true,
      body: data,
    });
  },
  deleteAddress(id: number): Promise<{ success: boolean }> {
    return apiFetch(`/customer-auth/addresses/${id}`, {
      method: "DELETE",
      auth: true,
    });
  },
  setDefaultAddress(id: number): Promise<{ success: boolean }> {
    return apiFetch(`/customer-auth/addresses/${id}/default`, {
      method: "POST",
      auth: true,
    });
  },

  getPaymentMethods(): Promise<CustomerPaymentMethod[]> {
    return apiFetch<CustomerPaymentMethod[]>("/customer-auth/payment-methods", {
      auth: true,
    });
  },
  createPaymentMethod(data: unknown): Promise<{ id: number }> {
    return apiFetch("/customer-auth/payment-methods", {
      method: "POST",
      auth: true,
      body: data,
    });
  },
  updatePaymentMethod(id: number, data: unknown): Promise<{ id: number }> {
    return apiFetch(`/customer-auth/payment-methods/${id}`, {
      method: "PUT",
      auth: true,
      body: data,
    });
  },
  deletePaymentMethod(id: number): Promise<{ success: boolean }> {
    return apiFetch(`/customer-auth/payment-methods/${id}`, {
      method: "DELETE",
      auth: true,
    });
  },
};
