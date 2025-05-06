export function handleCosmosError(e: any) {
  if (e && typeof e.message === 'string') {
    if (e.message.includes('rate limit')) {
      console.error('[Cosmos][RateLimit]', e.message);
      // Ici, tu pourrais ajouter une logique de retry/backoff
    }
    // Ajoute ici d'autres gestions d'erreur spécifiques Cosmos
  }
  throw e;
}
