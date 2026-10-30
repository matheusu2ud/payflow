export const APP_NAME = 'PayFlow';

export type TenantRole = 'OWNER' | 'ADMIN' | 'FINANCE' | 'VIEWER';
export type PaymentMethod = 'PIX' | 'CARD' | 'BOLETO';
export type ChargeStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELED' | 'EXPIRED';

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

export interface CompanySummary {
  id: string;
  name: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  balance: number;
  reservedBalance: number;
}
