// LED panel presets shared by the LED Wall Calculator and the Pixel Map Maker.
// Panels: pixels and size from the maker's spec page; power and weight from the manufacturer spec
//      too, but rental stock varies, so the page says to check the rental house's sheet
// mm: panel width × height; px: pixels wide × high; max/typ: watts per panel; kg: per panel
window.LED_PANELS = [
  // roevisual.com/en/products/black-pearl-2v2 (2.84 mm, 176×176, 500×500 mm, 9.35 kg, 190 W max / 95 W avg)
  { id: 'bp2v2', make: 'ROE Visual', name: 'Black Pearl BP2V2', mm: [500, 500], px: [176, 176], max: 190, typ: 95, kg: 9.35 },
  // roevisual.com/nl-en/products/carbon-full-spectrum-led-panels (CB5MKII 5.77 mm, 104×208, 600×1200 mm, 12.2 kg, 480/240 W)
  { id: 'cb5mk2', make: 'ROE Visual', name: 'Carbon CB5 MKII', mm: [600, 1200], px: [104, 208], max: 480, typ: 240, kg: 12.2 },
  // same page (CB5MKII Half 104×104, 600×600 mm, 6.5 kg, 250/125 W)
  { id: 'cb5mk2h', make: 'ROE Visual', name: 'Carbon CB5 MKII half', mm: [600, 600], px: [104, 104], max: 250, typ: 125, kg: 6.5 },
  // roevisual.com/nl-en/ruby (RB2.6 2.604 mm, 192×192, 500×500 mm, 8.5 kg, 160/80 W)
  { id: 'rb26', make: 'ROE Visual', name: 'Ruby RB2.6', mm: [500, 500], px: [192, 192], max: 160, typ: 80, kg: 8.5 },
  // roevisual.com/zh-cn/products/vanish-8-touring (V8T 8.9 mm, 112×112, 1000×1000 mm, 18.2 kg, 480/240 W)
  { id: 'v8t', make: 'ROE Visual', name: 'Vanish V8T', mm: [1000, 1000], px: [112, 112], max: 480, typ: 240, kg: 18.2 },
  // Absen Polaris indoor datasheet (novelty.fr/download/materiel_fiches_techniques/absen_pl2-5_ft.pdf):
  // PL2.5 Pro 200×200, 500×500 mm, 9.6 kg, 510/170 W/m² (× 0.25 m² = 127.5/42.5 W)
  { id: 'pl25pro', make: 'Absen', name: 'PL2.5 Pro (Polaris)', mm: [500, 500], px: [200, 200], max: 127.5, typ: 42.5, kg: 9.6 },
  // same datasheet: PL2.9 168×168, 9 kg, 450/150 W/m² (112.5/37.5 W)
  { id: 'pl29', make: 'Absen', name: 'PL2.9 (Polaris)', mm: [500, 500], px: [168, 168], max: 112.5, typ: 37.5, kg: 9 },
  // same datasheet: PL3.9 128×128, 9 kg, 510/170 W/m² (127.5/42.5 W)
  { id: 'pl39', make: 'Absen', name: 'PL3.9 (Polaris)', mm: [500, 500], px: [128, 128], max: 127.5, typ: 42.5, kg: 9 },
  // infiled.com/products-infiled/il-rss-irdbmk2-2-6-lite/ (2.6 mm, 192×192, 500×500 mm, 8 kg, 150/50 W)
  { id: 'dbmk2', make: 'INFiLED', name: 'DBmk2 2.6 Lite', mm: [500, 500], px: [192, 192], max: 150, typ: 50, kg: 8 },
  // infiled.com/products-infiled/il-rss-irar3-9-ad/ (3.91 mm, 128×256, 500×1000 mm, 11.3 kg, 360/120 W)
  { id: 'ar39', make: 'INFiLED', name: 'AR3.9 AD', mm: [500, 1000], px: [128, 256], max: 360, typ: 120, kg: 11.3 },
  // unilumin.com/media/upload/UpadIV.pdf (UpadIV2 2.6 mm, 192×192, 500×500 mm, 6.3 kg, 120/40 W;
  // the sheet's power row is unlabelled by model, 120/40 W matches 4Wall's Upad IV 2.6 sheet)
  { id: 'upad4', make: 'Unilumin', name: 'Upad IV 2.6', mm: [500, 500], px: [192, 192], max: 120, typ: 40, kg: 6.3 },
  // generic panels: common sizes, with round planning figures for power and weight (not a real product)
  { id: 'g26', make: 'Generic', name: '2.6 mm, 500 × 500', mm: [500, 500], px: [192, 192], max: 180, typ: 60, kg: 8, generic: true },
  { id: 'g39', make: 'Generic', name: '3.9 mm, 500 × 500', mm: [500, 500], px: [128, 128], max: 180, typ: 60, kg: 8, generic: true },
  { id: 'g39t', make: 'Generic', name: '3.9 mm, 500 × 1000', mm: [500, 1000], px: [128, 256], max: 360, typ: 120, kg: 13, generic: true },
];
