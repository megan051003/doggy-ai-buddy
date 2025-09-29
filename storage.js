// src/storage.js
export async function setApiKey(service, key) {
  await chrome.storage.local.set({ [service]: key });
}

export async function getApiKey(service) {
  const result = await chrome.storage.local.get(service);
  return result[service];
}
