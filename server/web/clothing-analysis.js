// Kept independent of the SDK so model output is validated before touching a form.
export function validateClothingAnalysis(value, types, colors) {
  if (!value || typeof value.isClothing !== 'boolean') throw Error('Invalid analysis');
  if (!value.isClothing) throw Error('Choose a photo showing one clothing item.');
  if (!types.includes(value.type) || !colors.includes(value.color)
      || !Number.isInteger(value.wearLimit) || value.wearLimit < 1 || value.wearLimit > 30) {
    throw Error('Gemini could not identify this item. Please set its details manually.');
  }
  return {type: value.type, color: value.color, wearLimit: value.wearLimit};
}

export function imagePart(photo) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
  if (!match || photo.length > 2800000) throw Error('Choose a JPEG, PNG, or WebP photo under 2 MB.');
  return {inlineData: {mimeType: match[1], data: match[2]}};
}

export function useLocalAppCheckDebug(location, native = false) {
  return !native && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    && ['http:', 'https:'].includes(location.protocol);
}
