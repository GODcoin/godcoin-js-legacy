import * as ByteBuffer from 'bytebuffer';

export * from './type_deserializer';
export * from './type_serializer';
export * from './object_type';

export type Serializer = (buf: ByteBuffer, value: any) => void;
export type Deserializer = (buf: ByteBuffer) => any;
export type ObjectDeserializer = (buf: ByteBuffer, obj?: any) => any;
