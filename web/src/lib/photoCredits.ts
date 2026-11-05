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
  { file: 'fjord-nesting-side-tables.jpg', photographer: 'Sam Moghadam', url: 'https://unsplash.com/photos/brown-wooden-table-on-white-background-xej3GOtAQ-o' },
  { file: 'dune-boucle-lounge-chair.jpg', photographer: 'Kevin Shek', url: 'https://unsplash.com/photos/a-white-couch-sitting-on-top-of-a-white-floor-kcxZ-YUZ8VE' },
  { file: 'birch-floating-shelf.jpg', photographer: 'Josh Davies', url: 'https://unsplash.com/photos/empty-light-wooden-shelf-on-a-cream-wall-Er2gvVJ8EiQ' },
  { file: 'woven-rattan-stool.jpg', photographer: 'Mark Huang', url: 'https://unsplash.com/photos/a-wicker-chair-sitting-on-top-of-a-cement-floor-TFQ3g4l1hVI' },
  { file: 'olive-wood-serving-board.jpg', photographer: 'Mockup Graphics', url: 'https://unsplash.com/photos/brown-wooden-chopping-board-on-white-background-OOv2sCKwYAA' },
  { file: 'speckled-stoneware-mug-pair.jpg', photographer: 'Katja Vogt', url: 'https://unsplash.com/photos/two-white-ceramic-mug-CipURjPCXOo' },
  { file: 'ceramic-pour-over-set.jpg', photographer: 'Madeline Liu', url: 'https://unsplash.com/photos/black-ceramic-coffee-dripper-on-a-clear-glass-carafe-ed4DYzyS96s' },
  { file: 'white-brass-cutlery-set.jpg', photographer: 'David Billings', url: 'https://unsplash.com/photos/pair-of-white-and-brass-fork-and-breadknife-NID5iadR7RE' },
  { file: 'seagrass-lidded-baskets.jpg', photographer: 'Arum Wahyuni', url: 'https://unsplash.com/photos/stylish-pillows-blankets-and-baskets-decorate-a-wooden-table-isrVLrfwm9A' },
  { file: 'round-oak-wall-mirror.jpg', photographer: 'Spacejoy', url: 'https://unsplash.com/photos/brown-wooden-framed-mirror-on-white-wall-g3KbcDWrBUM' },
  { file: 'stone-sphere-bookend.jpg', photographer: 'Shoham Avisrur', url: 'https://unsplash.com/photos/decorative-spheres-books-and-pearl-bracelet-on-shelf-TcMZavwOn0U' },
  { file: 'walnut-serving-tray.jpg', photographer: 'Ben Schnell', url: 'https://unsplash.com/photos/white-ceramic-mug-on-brown-wooden-serving-tray-UvdavRxRZ3c' },
];

/** The credit for an image path such as /catalogue/reed-carafe.jpg, if it is one of ours. */
export const creditFor = (src: string | undefined) => PHOTO_CREDITS.find((c) => src === `/catalogue/${c.file}`);
