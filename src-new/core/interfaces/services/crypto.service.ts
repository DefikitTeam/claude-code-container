// TODO: Define ICryptoService interface (15 LOC)
export interface ICryptoService {
  encrypt(data: string): Promise<string>;
  decrypt(encrypted: string): Promise<string>;
}
