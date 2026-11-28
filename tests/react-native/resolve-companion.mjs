export async function resolve(specifier, context, next) {
  if (specifier === '@zcashlabs/zcash.js-native') {
    return { url: new URL('./companion-stub.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
