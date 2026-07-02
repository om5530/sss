export interface Address {
  _id?: string;
  label?: string;
  fullAddress: string;
  area?: string;
  city?: string;
  pincode?: string;
  landmark?: string;
  isDefault?: boolean;
}

export interface User {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  avatar?: string;
  role: 'customer' | 'admin';
  addresses: Address[];
}

export interface ApiResponse {
  success: boolean;
  message?: string;
}

export interface AuthResponse extends ApiResponse {
  token: string;
  user: User;
}

export interface OtpRequestResponse extends ApiResponse {
  expiresInSeconds: number;
  devCode?: string;
}
