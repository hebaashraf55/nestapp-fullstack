/** Unsplash photographers for the seeded product photos (see web/public/catalogue/CREDITS.md). */
export const PHOTO_CREDITS: { file: string; photographer: string; url: string }[] = [
  { file: 'amber-tumbler-pair.jpg', photographer: 'Boglárka Salamon', url: 'https://unsplash.com/photos/a-couple-of-glasses-sitting-on-top-of-a-table-qcOxfbrgQDw' },
  { file: 'crescent-wall-light.jpg', photographer: 'Aleksandra Dementeva', url: 'https://unsplash.com/photos/two-modern-wall-lights-with-marble-and-gold-accents-CqUIbOcm778' },
  { file: 'dune-stoneware-vase.jpg', photographer: 'Marina Podrez', url: 'https://unsplash.com/photos/a-white-vase-with-yellow-and-white-flowers-in-it-uGU9UblmvUM' },
  { file: 'ember-pillar-candle-holder.jpg', photographer: 'Jessica Fadel', url: 'https://unsplash.com/photos/white-candle-on-black-candle-holder-JKO9dfkzHio' },
  { file: 'lantern-table-lamp.jpg', photographer: 'Bhautik Patel', url: 'https://unsplash.com/photos/a-modern-lamp-with-a-wooden-base-glows-softly-VdrwI_63-Po' },
  { file: 'mirage-espresso-set.jpg', photographer: 'Debby Hudson', url: 'https://unsplash.com/photos/a-cup-and-saucer-with-a-flower-in-it-uJ16Qvua6O8' },
  { file: 'nile-cotton-cushion.jpg', photographer: 'Sven Brandsma', url: 'https://unsplash.com/photos/three-assorted-color-throw-pillows-on-black-sofa-GWFFvub7Y1U' },
  { file: 'oasis-serving-bowl.jpg', photographer: '五玄土 ORIENTO', url: 'https://unsplash.com/photos/a-green-bowl-sitting-on-top-of-a-white-table-xVbGmm-gmHo' },
  { file: 'reed-carafe.jpg', photographer: 'GLOBENCER', url: 'https://unsplash.com/photos/clear-glass-bottle-with-red-lid-8IQXvtiDmgw' },
  { file: 'saffron-linen-throw.jpg', photographer: 'Artur Ament', url: 'https://unsplash.com/photos/a-stack-of-blankets-sitting-on-top-of-each-other-WB7wXI8S0SE' },
  { file: 'sandstone-table-runner.jpg', photographer: 'Kier in Sight Archives', url: 'https://unsplash.com/photos/a-close-up-of-a-piece-of-cloth-xzMUa1t4DBw' },
  { file: 'tide-wine-glasses.jpg', photographer: 'engin akyurt', url: 'https://unsplash.com/photos/clear-wine-glass-with-red-liquid-CF0xtRfFNiE' },
];

/** The credit for an image path such as /catalogue/reed-carafe.jpg, if it is one of ours. */
export const creditFor = (src: string | undefined) => PHOTO_CREDITS.find((c) => src === `/catalogue/${c.file}`);
