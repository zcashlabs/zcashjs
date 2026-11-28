const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typedArray, 'byteLength').get;
const buffer = Object.getOwnPropertyDescriptor(typedArray, 'buffer').get;
const tag = Object.getOwnPropertyDescriptor(typedArray, Symbol.toStringTag).get;
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;

export function copyBytes(value, limit, message, minimum = 1) {
  if (!(value instanceof Uint8Array) || !ArrayBuffer.isView(value) ||
      tag.call(value) !== 'Uint8Array' || !(buffer.call(value) instanceof ArrayBuffer) ||
      byteLength.call(value) < minimum || byteLength.call(value) > limit) {
    throw new TypeError(message);
  }
  try {
    arrayBufferByteLength.call(buffer.call(value));
  } catch {
    throw new TypeError(message);
  }
  return new Uint8Array(value);
}
