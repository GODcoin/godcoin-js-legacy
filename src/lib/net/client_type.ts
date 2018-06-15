export enum ClientType {
  NODE = 'node',
  WALLET = 'wallet',
}

export function toEnum(str: string): ClientType|undefined {
  switch (str) {
    case 'node':
      return ClientType.NODE;
    case 'wallet':
      return ClientType.WALLET;
  }
}
