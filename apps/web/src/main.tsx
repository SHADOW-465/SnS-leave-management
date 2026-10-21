import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/instrument-sans';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@sns/ui/tokens.css';
import '@sns/ui/product.css';
import { ApiError } from './api.js';
import { App } from './App.js';
import { installNumberInputFix } from './number-input.js';

installNumberInputFix();

const client: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    // An expired session (idle or absolute limit) answers 401. Ask again who is signed in, so
    // the app falls back to sign-in, and drop the rest of the cache so the next person to
    // sign in on this browser never sees the previous person's data.
    onError: (err, query) => {
      if (!(err instanceof ApiError) || err.status !== 401 || query.queryKey[0] === 'me') return;
      void client
        .refetchQueries({ queryKey: ['me'] })
        .then(() => client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' }));
    },
  }),
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
