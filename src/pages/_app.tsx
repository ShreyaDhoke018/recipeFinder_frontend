import type { AppProps } from 'next/app';
import { Toaster } from 'react-hot-toast';
import '../styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Component {...pageProps} />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#16213E',
            color: '#fff',
            border: '1px solid rgba(255,107,53,0.3)',
          },
          success: {
            iconTheme: { primary: '#FF6B35', secondary: '#fff' },
          },
        }}
      />
    </>
  );
}
