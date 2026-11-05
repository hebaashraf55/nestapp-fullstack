/** Unsplash photographers for the seeded product photos (see web/public/catalogue/CREDITS.md). */
export const PHOTO_CREDITS: { file: string; photographer: string; url: string }[] = [
  { file: 'amber-tumbler-pair.jpg', photographer: 'Boglárka Salamon', url: 'https://unsplash.com/photos/a-couple-of-glasses-sitting-on-top-of-a-table-qcOxfbrgQDw' },
  { file: 'crescent-wall-light.jpg', photographer: 'Wesley Shen', url: 'https://unsplash.com/photos/white-and-silver-round-wall-lamp-fEHErnpK1Y8' },
  { file: 'dune-stoneware-vase.jpg', photographer: 'Marina Podrez', url: 'https://unsplash.com/photos/a-white-vase-with-yellow-and-white-flowers-in-it-uGU9UblmvUM' },
  { file: 'ember-pillar-candle-holder.jpg', photographer: 'Jessica Fadel', url: 'https://unsplash.com/photos/white-candle-on-black-candle-holder-JKO9dfkzHio' },
  { file: 'lantern-table-lamp.jpg', photographer: 'Bhautik Patel', url: 'https://unsplash.com/photos/a-modern-lamp-with-a-wooden-base-glows-softly-VdrwI_63-Po' },
  { file: 'mirage-espresso-set.jpg', photographer: 'Debby Hudson', url: 'https://unsplash.com/photos/a-cup-and-saucer-with-a-flower-in-it-uJ16Qvua6O8' },
  { file: 'nile-cotton-cushion.jpg', photographer: 'Aleksandra Dementeva', url: 'https://unsplash.com/photos/a-beige-sofa-with-decorative-pillows-and-a-side-table-pYqXT6hoRbQ' },
  { file: 'oasis-serving-bowl.jpg', photographer: '五玄土 ORIENTO', url: 'https://unsplash.com/photos/a-green-bowl-sitting-on-top-of-a-white-table-xVbGmm-gmHo' },
  { file: 'reed-carafe.jpg', photographer: 'GLOBENCER', url: 'https://unsplash.com/photos/clear-glass-bottle-with-red-lid-8IQXvtiDmgw' },
  { file: 'saffron-linen-throw.jpg', photographer: 'Maria Kovalets', url: 'https://unsplash.com/photos/a-yellow-knitted-blanket-laying-on-a-wooden-floor-6F8Yk1gMvvs' },
  { file: 'sandstone-table-runner.jpg', photographer: 'Svitlana', url: 'https://unsplash.com/photos/white-textile-on-brown-wooden-table-HbiRi1Owk9k' },
  { file: 'tide-wine-glasses.jpg', photographer: 'engin akyurt', url: 'https://unsplash.com/photos/clear-wine-glass-with-red-liquid-CF0xtRfFNiE' },
];

/** The credit for an image path such as /catalogue/reed-carafe.jpg, if it is one of ours. */
export const creditFor = (src: string | undefined) => PHOTO_CREDITS.find((c) => src === `/catalogue/${c.file}`);
