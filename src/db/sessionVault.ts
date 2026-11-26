const VAULT_IDB_NAME = 'blessed_finance_vault_v1';
const KEY_STORE = 'keys';
const VAULT_STORE = 'vault';
const CRYPTO_KEY_ID = 'device_key';
const TOKEN_RECORD_ID = 'session_token';
const SNAPSHOT_CACHE_PREFIX = 'snapshot_';

interface EncryptedBlob {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

function hasIndexedDB(): boolean {
  return typeof globalThis.indexedDB !== 'undefined' && Boolean(globalThis.crypto?.subtle);
}

function openVaultIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(VAULT_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE);
      }
      if (!db.objectStoreNames.contains(VAULT_STORE)) {
        db.createObjectStore(VAULT_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Falha ao abrir cofre local.'));
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error || new Error('Falha ao ler cofre local.'));
  });
}

function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Falha ao gravar no cofre local.'));
  });
}

function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Falha ao limpar cofre local.'));
  });
}

async function getOrCreateKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(db, KEY_STORE, CRYPTO_KEY_ID);
  if (existing) return existing;
  const key = await globalThis.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  await idbPut(db, KEY_STORE, CRYPTO_KEY_ID, key);
  return key;
}

export async function saveEncryptedSessionToken(token: string): Promise<void> {
  if (!hasIndexedDB()) return;
  const idb = await openVaultIDB();
  try {
    const key = await getOrCreateKey(idb);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(token);
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      encoded
    );
    const blob: EncryptedBlob = { iv, ciphertext: new Uint8Array(ciphertext) };
    await idbPut(idb, VAULT_STORE, TOKEN_RECORD_ID, blob);
  } catch {
    // ignore storage errors in restricted browsing modes
  } finally {
    idb.close();
  }
}

export async function loadEncryptedSessionToken(): Promise<string | null> {
  if (!hasIndexedDB()) return null;
  const idb = await openVaultIDB();
  try {
    const blob = await idbGet<EncryptedBlob>(idb, VAULT_STORE, TOKEN_RECORD_ID);
    const key = await idbGet<CryptoKey>(idb, KEY_STORE, CRYPTO_KEY_ID);
    if (!blob || !key) return null;
    const iv = blob.iv instanceof Uint8Array ? blob.iv : new Uint8Array(blob.iv);
    const ciphertext =
      blob.ciphertext instanceof Uint8Array ? blob.ciphertext : new Uint8Array(blob.ciphertext);
    const decrypted = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource
    );
    return new TextDecoder().decode(decrypted) || null;
  } catch {
    return null;
  } finally {
    idb.close();
  }
}

export async function clearEncryptedSessionToken(): Promise<void> {
  if (!hasIndexedDB()) return;
  const idb = await openVaultIDB();
  try {
    await idbDelete(idb, VAULT_STORE, TOKEN_RECORD_ID);
  } catch {
    // ignore
  } finally {
    idb.close();
  }
}

export async function saveCachedFamilySnapshot(familyId: string, snapshot: unknown): Promise<void> {
  if (!hasIndexedDB()) return;
  const idb = await openVaultIDB();
  try {
    await idbPut(idb, VAULT_STORE, `${SNAPSHOT_CACHE_PREFIX}${familyId}`, snapshot);
  } catch {
    // ignore
  } finally {
    idb.close();
  }
}

export async function loadCachedFamilySnapshot<T>(familyId: string): Promise<T | null> {
  if (!hasIndexedDB()) return null;
  const idb = await openVaultIDB();
  try {
    return (await idbGet<T>(idb, VAULT_STORE, `${SNAPSHOT_CACHE_PREFIX}${familyId}`)) ?? null;
  } catch {
    return null;
  } finally {
    idb.close();
  }
}
