import * as cbor from 'cbor';

declare module 'cbor' {
  export function decodeAll(input: Buffer | string): Promise<any[]>;
  export function decodeFirst(input: Buffer | string): Promise<any>;
}
