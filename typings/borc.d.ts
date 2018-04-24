declare module 'borc' {
  export function encode(input: any): Buffer;
  export function decode(input: Buffer): any;
}
