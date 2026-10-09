/**
 * Seed catalogue transcribed from the four photographs of the shop's 2025 price list.
 *
 * Every entry keeps the PRINTED serial number, English name, Tamil name and rate exactly as read from
 * the photographs. Where the print is unclear, inconsistent or the unit is not shown, `review` holds the
 * reason and the product is seeded with review_status = 'needs_review' so the owner must confirm it.
 * Nothing here invents stock, purchase cost or tax rates.
 */

export interface SeedCategory {
  key: string;
  nameEn: string;
  nameTa: string;
  defaultUnit: string;
  /** Pack-size note printed in the category heading. */
  note?: string;
  discountRule: 'inherit' | 'never';
  review?: string;
}

export const SEED_CATEGORIES: SeedCategory[] = [
  { key: 'sparklers', nameEn: 'Sparklers', nameTa: 'கம்பி மத்தாப்பு', defaultUnit: 'Box', note: '10 Pcs/Box', discountRule: 'inherit' },
  { key: 'ground', nameEn: 'Ground Chakkaram', nameTa: 'தரைச்சக்கரம்', defaultUnit: 'Box', discountRule: 'inherit' },
  { key: 'flowerpot', nameEn: 'Flower Pot', nameTa: 'பூந்தொட்டி', defaultUnit: 'Box', discountRule: 'inherit' },
  { key: 'twinkling', nameEn: 'Twinkling Stars', nameTa: 'சாட்டை', defaultUnit: 'Box', discountRule: 'inherit' },
  { key: 'rocket', nameEn: 'Rocket', nameTa: 'ராக்கெட்', defaultUnit: 'Box', discountRule: 'inherit' },
  { key: 'single', nameEn: 'Single Shot', nameTa: 'ஒற்றை வெடி', defaultUnit: 'Pkt', discountRule: 'inherit' },
  { key: 'bomb', nameEn: 'Bomb', nameTa: 'பாம்', defaultUnit: 'Box', discountRule: 'inherit' },
  { key: 'gaint', nameEn: 'Gaint & Deluxe Crackers', nameTa: 'ஜெயிண்ட் / டீலக்ஸ் பட்டாசு', defaultUnit: 'Pkt', discountRule: 'inherit' },
  { key: 'wala', nameEn: 'Wala Crackers', nameTa: 'சரம் பட்டாசு', defaultUnit: 'Box', discountRule: 'inherit' },
  { key: 'sky', nameEn: 'Sky Shot', nameTa: 'ஸ்கை சாட் பட்டாசு', defaultUnit: 'Pkt', discountRule: 'inherit' },
  { key: 'multi', nameEn: 'Multicolour Shot', nameTa: 'மல்டி கலர் ஷாட்', defaultUnit: 'Box', discountRule: 'inherit' },
  { key: 'fancy', nameEn: 'Fancy Items', nameTa: '', defaultUnit: 'Box', discountRule: 'inherit', review: 'No Tamil heading is printed for this section.' },
  { key: 'matches', nameEn: 'Colour Matches', nameTa: '', defaultUnit: 'Box', discountRule: 'inherit', review: 'No Tamil heading is printed for this section.' },
  {
    key: 'gift',
    nameEn: 'Gift Boxes',
    nameTa: '',
    defaultUnit: 'Box',
    discountRule: 'never',
    review: "Printed heading reads 'GIFT BOXES - NO DISCOUNT'. Seeded as non-discountable; confirm. No Tamil heading is printed.",
  },
];

export interface SeedProduct {
  /** Serial number exactly as printed on the list. */
  no: number;
  cat: string;
  en: string;
  ta: string;
  /** Rate in whole rupees exactly as printed. */
  rate: number;
  /** Unit printed on the list; undefined when the cell was blank. */
  unit?: string;
  review?: string;
}

const SP = 'Printed English spelling kept as-is; may be a printing error - confirm.';
const TA = 'Tamil text read from a photograph; confirm spelling.';
const NOUNIT = 'Unit cell is blank on the printed list - unit inherited from the section heading; confirm.';

/** In the exact order printed on the list (S.No 114 is printed between 18 and 19). */
export const SEED_PRODUCTS: SeedProduct[] = [
  // ---- Page 2 : Sparklers (10 Pcs/Box)
  { no: 1, cat: 'sparklers', en: '7 cm Green', ta: '7 cm கீரின்', rate: 16, unit: 'Box' },
  { no: 2, cat: 'sparklers', en: '10 cm Electric', ta: '10 cm சாதா', rate: 25, unit: 'Box' },
  { no: 3, cat: 'sparklers', en: '10 cm Colour', ta: '10 cm கலர்', rate: 35, unit: 'Box' },
  { no: 4, cat: 'sparklers', en: '12 cm Electric', ta: '12 cm சாதா', rate: 35, unit: 'Box' },
  { no: 5, cat: 'sparklers', en: '12 cm Colour', ta: '12 cm கலர்', rate: 45, unit: 'Box' },
  { no: 6, cat: 'sparklers', en: '12 cm Green', ta: '12 cm கீரின்', rate: 55, unit: 'Box' },
  { no: 7, cat: 'sparklers', en: '15 cm Electric', ta: '15 cm சாதா', rate: 55, unit: 'Box' },
  { no: 8, cat: 'sparklers', en: '15 cm Colour', ta: '15 cm கலர்', rate: 60, unit: 'Box' },
  { no: 9, cat: 'sparklers', en: '15 cm Green', ta: '15 cm கீரின்', rate: 65, unit: 'Box' },
  { no: 10, cat: 'sparklers', en: '30 cm Electric', ta: '30 cm சாதா', rate: 55, unit: 'Box' },
  { no: 11, cat: 'sparklers', en: '30 cm Colour', ta: '30 cm கலர்', rate: 60, unit: 'Box' },
  { no: 12, cat: 'sparklers', en: '30 cm Green', ta: '30 cm கீரின்', rate: 66, unit: 'Box', review: 'Printed rate 66.00 breaks the pattern of the neighbouring rows (65 / 55); printed value kept - verify.' },
  { no: 13, cat: 'sparklers', en: '50 cm Electric', ta: '50 cm சாதா', rate: 220, unit: 'Box' },
  { no: 14, cat: 'sparklers', en: '50 cm Colour', ta: '50 cm கலர்', rate: 230, unit: 'Box' },
  { no: 15, cat: 'sparklers', en: 'Rotted Kambi', ta: 'Rotted கம்பி', rate: 250, review: `${NOUNIT} ${SP} Tamil heading is partly in English script.` },
  // ---- Ground Chakaram
  { no: 16, cat: 'ground', en: 'Ground Chakaram Big (10 Pcs)', ta: 'தரைச்சக்கரம் பெரியது (10 No.)', rate: 60, unit: 'Box', review: 'Printed as "Ground Chakaram" (one k, one r); spelling kept as printed.' },
  { no: 17, cat: 'ground', en: 'Ground Chakaram Spl', ta: 'தரைச்சக்கரம் ஸ்பெஷல்', rate: 100, unit: 'Box' },
  { no: 18, cat: 'ground', en: 'Ground Chakaram DLX', ta: 'தரைச்சக்கரம் டீலக்ஸ்', rate: 180, unit: 'Box' },
  // ---- Flower Pot (S.No 114 is printed first in this section)
  { no: 114, cat: 'flowerpot', en: 'Flower Pot Small', ta: 'புஸ்வானம் சிறியது', rate: 60, unit: 'Box', review: 'Printed S.No is 114 but the row sits between S.No 18 and 19 (numbering irregularity). Original print order kept.' },
  { no: 19, cat: 'flowerpot', en: 'Flower Pot Big', ta: 'புஸ்வானம் பெரியது', rate: 90, unit: 'Box' },
  { no: 20, cat: 'flowerpot', en: 'Flower Pot Special', ta: 'புஸ்வானம் ஸ்பெஷல்', rate: 125, unit: 'Box' },
  { no: 21, cat: 'flowerpot', en: 'Flower Pot Asoka', ta: 'புஸ்வானம் அசோகா', rate: 180, unit: 'Box' },
  { no: 22, cat: 'flowerpot', en: 'Colour Koti', ta: 'கலர் கோட்டி', rate: 270, unit: 'Box' },
  { no: 23, cat: 'flowerpot', en: 'Colour Koti Super', ta: 'கலர் கோட்டி சூப்பர்', rate: 500, unit: 'Box' },
  { no: 24, cat: 'flowerpot', en: 'FP DLX (5 Pcs)', ta: 'FP டீலக்ஸ் (5 Pcs)', rate: 240, unit: 'Box' },
  { no: 25, cat: 'flowerpot', en: 'FP Super DLX (2 Pcs)', ta: 'FP சூப்பர் டீலக்ஸ் (2 Pcs)', rate: 180, unit: 'Box' },
  { no: 26, cat: 'flowerpot', en: 'Try Colour (5 Pcs)', ta: 'டிரை கலர் (5 Pcs)', rate: 400, unit: 'Box', review: `${SP} (printed "Try Colour"; the closing bracket is cut off in the photograph).` },
  // ---- Twinkling Stars
  { no: 27, cat: 'twinkling', en: '1½" Twinkling Stars', ta: '1½ சாட்டை', rate: 35, unit: 'Box', review: 'Inch mark is not printed after 1½ in the English column; assumed inches - confirm.' },
  { no: 28, cat: 'twinkling', en: '4" Twinkling Stars', ta: '4" சாட்டை', rate: 90, unit: 'Box' },
  { no: 29, cat: 'twinkling', en: '10 cm Pencil', ta: '10 cm பென்சில்', rate: 90, unit: 'Box' },
  // ---- Rocket
  { no: 30, cat: 'rocket', en: 'Rocket Bomb', ta: 'ராக்கெட் பாம்', rate: 90, unit: 'Box' },
  { no: 31, cat: 'rocket', en: '2 Sound Rocket', ta: '2 சவுண்ட் ராக்கெட்', rate: 170, unit: 'Box' },
  { no: 32, cat: 'rocket', en: 'Lunik Rocket', ta: 'லூனிக் ராக்கெட்', rate: 170, unit: 'Box', review: TA },
  // ---- Single Shot
  { no: 33, cat: 'single', en: '2¾ Kuruvi', ta: '2¾ குருவி', rate: 11, unit: 'Pkt' },
  { no: 34, cat: 'single', en: '3½ Lakshmi', ta: '3½ லட்சுமி', rate: 20, unit: 'Pkt' },
  { no: 35, cat: 'single', en: '4" Lakshmi', ta: '4 லட்சுமி', rate: 35, unit: 'Pkt' },
  { no: 36, cat: 'single', en: '4" Lakshmi Deluxe', ta: '4 லட்சுமி டீலக்ஸ்', rate: 45, unit: 'Pkt' },
  { no: 37, cat: 'single', en: '4" Gold Lakshmi', ta: '4 கோல்டு லட்சுமி', rate: 55, unit: 'Pkt' },
  { no: 38, cat: 'single', en: '2 Sound', ta: '2 சவுண்ட்', rate: 40, unit: 'Pkt' },
  // ---- Page 3 : Single Shot (continued)
  { no: 39, cat: 'single', en: 'Bijili Red (100 Nos.)', ta: 'பிஜிலி ரெட் (100 நெ.)', rate: 45, unit: 'Pkt' },
  { no: 40, cat: 'single', en: 'Stripped Bijili (100 Nos.)', ta: 'வரி பிஜிலி (100 நெ.)', rate: 55, unit: 'Pkt', review: SP },
  { no: 41, cat: 'single', en: 'Bijili Red (50 Nos.)', ta: 'பிஜிலி ரெட் (50 நெ.)', rate: 27, review: NOUNIT },
  // ---- Bomb
  { no: 42, cat: 'bomb', en: 'Auto Bomb', ta: 'ஆட்டோ பாம்', rate: 35, unit: 'Box' },
  { no: 43, cat: 'bomb', en: 'Hydrogen Bomb', ta: 'ஹைட்ரஜன் பாம்', rate: 90, unit: 'Box' },
  { no: 44, cat: 'bomb', en: 'King of King Bomb', ta: 'கிங் ஆப் கிங்', rate: 120, unit: 'Box' },
  { no: 45, cat: 'bomb', en: 'Classic Bomb', ta: 'கிளாசிக் பாம்', rate: 150, unit: 'Box' },
  { no: 46, cat: 'bomb', en: '555 Bomb', ta: '555 பாம்', rate: 170, unit: 'Box' },
  { no: 47, cat: 'bomb', en: 'King of King Special', ta: 'கிங் ஆப் கிங் ஸ்பெஷல்', rate: 330, unit: 'Box' },
  { no: 48, cat: 'bomb', en: '1/4 Kg Paper Bomb', ta: '1/4 கிலோ பேப்பர் பாம்', rate: 70, unit: 'Box' },
  { no: 49, cat: 'bomb', en: '1/2 Kg Paper Bomb', ta: '1/2 கிலோ பேப்பர் பாம்', rate: 140, unit: 'Box' },
  { no: 50, cat: 'bomb', en: '1 Kg Paper Bomb', ta: '1 கிலோ பேப்பர் பாம்', rate: 300, unit: 'Box' },
  // ---- Gaint & Deluxe Crackers
  { no: 51, cat: 'gaint', en: '28 Gaint', ta: '28 ஜெயிண்ட்', rate: 35, unit: 'Pkt', review: SP },
  { no: 52, cat: 'gaint', en: '56 Gaint', ta: '56 ஜெயிண்ட்', rate: 70, unit: 'Pkt', review: SP },
  { no: 53, cat: 'gaint', en: '24 Deluxe', ta: '24 டீலக்ஸ்', rate: 70, unit: 'Pkt' },
  { no: 54, cat: 'gaint', en: '50 Deluxe', ta: '50 டீலக்ஸ்', rate: 140, unit: 'Pkt' },
  { no: 55, cat: 'gaint', en: '100 Deluxe', ta: '100 டீலக்ஸ்', rate: 220, unit: 'Pkt' },
  // ---- Wala Crackers
  { no: 56, cat: 'wala', en: '100 Wala', ta: '100 வாலா', rate: 50, unit: 'Box' },
  { no: 57, cat: 'wala', en: '200 Wala', ta: '200 வாலா', rate: 100, unit: 'Box' },
  { no: 58, cat: 'wala', en: '1000 Wala Silver', ta: '1000 வாலா சில்வர்', rate: 220, unit: 'Box' },
  { no: 59, cat: 'wala', en: '1000 Wala Gold', ta: '1000 வாலா கோல்டு', rate: 440, unit: 'Box' },
  { no: 60, cat: 'wala', en: '2000 Wala Silver', ta: '2000 வாலா சில்வர்', rate: 440, unit: 'Box' },
  { no: 61, cat: 'wala', en: '2000 Wala Gold', ta: '2000 வாலா கோல்டு', rate: 880, unit: 'Box' },
  { no: 62, cat: 'wala', en: '5000 Wala Silver', ta: '5000 வாலா சில்வர்', rate: 1100, unit: 'Box' },
  { no: 63, cat: 'wala', en: '5000 Wala Gold', ta: '5000 வாலா கோல்டு', rate: 2200, unit: 'Box' },
  { no: 64, cat: 'wala', en: '10000 Wala Silver', ta: '10000 வாலா சில்வர்', rate: 2200, unit: 'Box' },
  { no: 65, cat: 'wala', en: '10000 Wala Gold', ta: '10000 வாலா கோல்டு', rate: 4400, unit: 'Box' },
  // ---- Sky Shot
  { no: 66, cat: 'sky', en: 'Sky Shot (10 Pcs)', ta: 'ஸ்கை சாட்', rate: 170, unit: 'Pkt' },
  { no: 67, cat: 'sky', en: 'Siran (2 Pcs)', ta: 'சைரன் (2 நெ.)', rate: 250, unit: 'Pkt', review: SP },
  { no: 68, cat: 'sky', en: 'Dancing Wheel', ta: 'டான்சிங் வீல்', rate: 100, unit: 'Pkt' },
  { no: 69, cat: 'sky', en: 'Ji Boomba (2 Pcs)', ta: 'ஜீ பூம் பா (2 நெ.)', rate: 480, unit: 'Pkt', review: TA },
  { no: 70, cat: 'sky', en: 'Cit Poot', ta: 'சிட் பூட்', rate: 35, unit: 'Pkt', review: SP },
  { no: 71, cat: 'sky', en: 'TIN Beer', ta: 'டின் பீர்', rate: 150, unit: 'Pkt' },
  { no: 72, cat: 'sky', en: '1¼ Chotta Fancy', ta: '1¼ சோட்டா பேன்சி', rate: 50, unit: 'Pkt', review: SP },
  { no: 73, cat: 'sky', en: '2" Colour Pipe (1 Pc)', ta: '2" கலர் பைப் (1 நெ)', rate: 180, unit: 'Pkt' },
  { no: 74, cat: 'sky', en: '2" Colour Pipe (3 Pcs)', ta: '2" கலர் பைப் (3 நெ.)', rate: 420, unit: 'Pkt' },
  { no: 75, cat: 'sky', en: '3½" Colour Pipe (1 Pcs)', ta: '3½" கலர் பைப் (1 நெ)', rate: 400, unit: 'Pkt' },
  { no: 76, cat: 'sky', en: '4" Colour Pipe (1 Pcs)', ta: '4" கலர் பைப் (1)', rate: 480, unit: 'Pkt' },
  { no: 77, cat: 'sky', en: '4" Double Ball', ta: '4" டபுள் பால்', rate: 650, unit: 'Pkt' },
  // ---- Page 4 : Multicolour Shot
  { no: 78, cat: 'multi', en: '7 Shot Multicolour', ta: '7 ஷாட் மல்டி கலர்', rate: 170, unit: 'Box' },
  { no: 79, cat: 'multi', en: '12 Shot Multicolour', ta: '12 ஷாட் மல்டி கலர்', rate: 240, unit: 'Box' },
  { no: 80, cat: 'multi', en: '30 Shot Multicolour', ta: '30 ஷாட் மல்டி கலர்', rate: 500, unit: 'Box' },
  { no: 81, cat: 'multi', en: '60 Shot Multicolour', ta: '60 ஷாட் மல்டி கலர்', rate: 1000, unit: 'Box' },
  { no: 82, cat: 'multi', en: '120 Shot Multicolour', ta: '120 ஷாட் மல்டி கலர்', rate: 2000, unit: 'Box' },
  { no: 83, cat: 'multi', en: '240 Shot Multicolour', ta: '240 ஷாட் மல்டி கலர்', rate: 4200, unit: 'Box' },
  // ---- Fancy Items
  { no: 84, cat: 'fancy', en: 'Photo flash', ta: 'போட்டோ பிளாஷ்', rate: 90, unit: 'Box' },
  { no: 85, cat: 'fancy', en: 'Peacock', ta: 'பீக்காக் மயில்', rate: 250, unit: 'Box' },
  { no: 86, cat: 'fancy', en: 'Bada Peacock', ta: 'பெரிய பீக்காக்', rate: 500, unit: 'Box' },
  { no: 87, cat: 'fancy', en: 'Helicopter', ta: 'ஹெலிகாப்டர்', rate: 120, unit: 'Box' },
  { no: 88, cat: 'fancy', en: 'Butterfly', ta: 'பட்டர் பிளை', rate: 100, unit: 'Box' },
  { no: 89, cat: 'fancy', en: 'Colour Smoke', ta: 'கலர் ஸ்மோக்', rate: 200, unit: 'Box' },
  { no: 90, cat: 'fancy', en: 'Smoke Stick', ta: 'ஸ்மோக் ஸ்டிக்', rate: 20, unit: 'Box' },
  { no: 91, cat: 'fancy', en: 'Chocolate', ta: 'சாக்லெட்', rate: 200, unit: 'Box' },
  { no: 92, cat: 'fancy', en: 'Emoji Fountain', ta: 'எமோஜி பவுண்டையின்', rate: 250, unit: 'Box', review: TA },
  { no: 93, cat: 'fancy', en: 'Kinder Joy', ta: 'கிண்டர் ஜாய்', rate: 330, unit: 'Box' },
  { no: 94, cat: 'fancy', en: 'Pappu Shower', ta: 'பப்பு சவர்', rate: 220, unit: 'Box', review: `${SP} ${TA}` },
  { no: 95, cat: 'fancy', en: '5 G Mobile', ta: '5 ஜி மொபைல்', rate: 100, unit: 'Box' },
  { no: 96, cat: 'fancy', en: 'Money Bank', ta: 'மணி பேங்க்', rate: 300, unit: 'Box' },
  { no: 97, cat: 'fancy', en: 'Juniper Green (6 Pcs)', ta: 'ஜுனிபர் கீரின் (6 பீஸ்)', rate: 170, unit: 'Box', review: TA },
  // ---- Colour Matches
  { no: 98, cat: 'matches', en: 'King (5 Colours)', ta: 'கிங் (5 கலர்ஸ்)', rate: 45, unit: 'Box' },
  { no: 99, cat: 'matches', en: 'King Super DLX', ta: 'கிங் சூப்பர் டீலக்ஸ்', rate: 55, unit: 'Box' },
  { no: 100, cat: 'matches', en: 'Hero Classic Matches', ta: 'ஹரோ கிளாசிக் மேஸ்', rate: 55, unit: 'Box', review: TA },
  { no: 101, cat: 'matches', en: 'VIP Mini Laptop', ta: 'விஜபி மினி லேப்டாப்', rate: 110, unit: 'Box' },
  { no: 102, cat: 'matches', en: 'Jackiechan Matches', ta: 'ஜாக்கிஜான்', rate: 150, unit: 'Box', review: SP },
  { no: 103, cat: 'matches', en: 'Big Boss', ta: 'பிக்பாஸ்', rate: 300, unit: 'Box' },
  { no: 104, cat: 'matches', en: 'Roll Cap', ta: 'ரோல் கேப்', rate: 55, unit: 'Box' },
  { no: 105, cat: 'matches', en: 'Ring Cap (5 Pcs)', ta: 'ரிங் கேப் (5 நெ)', rate: 66, unit: 'Box' },
  { no: 106, cat: 'matches', en: 'Pop Pop 1 Box', ta: 'பாப் பாப் 1 பாக்ஸ்', rate: 10, unit: 'Box' },
  { no: 107, cat: 'matches', en: 'Pop Pop Tube', ta: 'பாப் பாப் டியூப்', rate: 20, review: NOUNIT },
  { no: 108, cat: 'matches', en: 'Snake Egg', ta: 'பாம்பு முட்டை', rate: 20, review: NOUNIT },
  { no: 109, cat: 'matches', en: 'Fire Stick', ta: 'பெரிய ஊதுபத்தி', rate: 10, review: `${NOUNIT} The English name (Fire Stick) and Tamil name (large incense stick) do not clearly correspond.` },
  // ---- Gift Boxes - NO DISCOUNT
  { no: 110, cat: 'gift', en: '20 Items', ta: '20 அயிட்டம்', rate: 450, review: 'Unit not printed; section heading says NO DISCOUNT.' },
  { no: 111, cat: 'gift', en: '30 Items', ta: '30 அயிட்டம்', rate: 650, review: 'Unit not printed; section heading says NO DISCOUNT.' },
  { no: 112, cat: 'gift', en: '40 Items', ta: '40 அயிட்டம்', rate: 1000, review: 'Unit not printed; section heading says NO DISCOUNT.' },
  { no: 113, cat: 'gift', en: '50 Items', ta: '50 அயிட்டம்', rate: 1300, review: 'Unit not printed; section heading says NO DISCOUNT.' },
];

export const CATALOGUE_SOURCE = '2025 printed price list (photographs, pages 1-4)';
