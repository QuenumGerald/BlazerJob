import fetch from 'node-fetch';
import { HttpTaskConfig } from '../types';

/**
 * Fabrique une fonction de tâche HTTP pour BlazeJob
 */
export function makeHttpTaskFn(cfg: HttpTaskConfig) {
  return async () => {
    console.log('[DEBUG][HTTP] URL utilisée pour fetch:', cfg.url);
    const res = await fetch(cfg.url, {
      method: cfg.method ?? 'POST',
      headers: cfg.headers,
      body: cfg.body ? JSON.stringify(cfg.body) : undefined
    });
    if (!res.ok) {
      const text = await res.text();
      // Log la réponse pour debug
      console.log('[HTTP][response]', text);
      throw new Error(`[HTTP] Code de retour ${res.status} pour ${cfg.url}`);
    }
    const text = await res.text();
    console.log('[HTTP][response]', text);
  };
}
