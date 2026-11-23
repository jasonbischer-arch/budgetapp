import * as SecureStore from 'expo-secure-store';

// Stores the Supabase session in the iPhone Keychain instead of plain app
// storage. Keychain entries are limited to about 2 KB and a session can be
// larger, so values are split across numbered chunks.
const CHUNK = 1800;
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const k = safeKey(key);
    const count = Number(await SecureStore.getItemAsync(`${k}.n`, options));
    if (!count) return null;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${k}.${i}`, options);
      if (part == null) return null;
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const k = safeKey(key);
    await this.removeItem(key);
    const count = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(`${k}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK), options);
    }
    await SecureStore.setItemAsync(`${k}.n`, String(count), options);
  },

  async removeItem(key: string): Promise<void> {
    const k = safeKey(key);
    const count = Number(await SecureStore.getItemAsync(`${k}.n`, options));
    for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${k}.${i}`, options);
    await SecureStore.deleteItemAsync(`${k}.n`, options);
  },
};
