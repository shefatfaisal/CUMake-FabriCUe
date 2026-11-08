import {Capacitor, registerPlugin} from '@capacitor/core';

const bridge = registerPlugin('SmartLaundryAppCheck');
export async function nativeAIConfiguration() {
  if (Capacitor.getPlatform() !== 'ios') throw Error('Native Gemini verification currently supports iOS only.');
  if (!Capacitor.isPluginAvailable('SmartLaundryAppCheck')) {
    throw Error('Rebuild the iPhone app with the native Firebase App Check bridge.');
  }
  return bridge.configuration();
}
export async function nativeAILimitedUseToken() {
  const result = await bridge.limitedUseToken();
  if (!result.token || !Number.isFinite(result.expireTimeMillis) || result.expireTimeMillis <= Date.now()) {
    throw Error('iOS returned an invalid App Check token.');
  }
  return result;
}
