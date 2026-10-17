import localFont from 'next/font/local';

// The files live in the repository (SIL Open Font License, texts next to them): the build needs no
// network, and nothing is requested from outside at runtime. Variable fonts cut to the weights the
// tokens use and to Latin and Cyrillic, from google/fonts.
export const onest = localFont({
  src: './fonts/Onest-Variable.woff2',
  weight: '400 600',
  variable: '--font-onest',
  display: 'swap',
});

export const jetbrainsMono = localFont({
  src: './fonts/JetBrainsMono-Variable.woff2',
  weight: '400 500',
  variable: '--font-jetbrains-mono',
  display: 'swap',
});
