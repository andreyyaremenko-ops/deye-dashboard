/** Онлайн-радіо для екрана. Ті самі станції, що в акваріумі (assets/radio.json). Усі — mp3-стріми. */
export interface RadioStation { id: string; title: string; url: string }

export const RADIO_STATIONS: readonly RadioStation[] = [
  { id: "relax",     title: "Radio Relax",      url: "https://online.radiorelax.ua/RadioRelax" },
  { id: "lounge",    title: "Lounge FM",        url: "https://cast.mediaonline.net.ua/loungefm" },
  { id: "jazz",      title: "Radio Jazz",       url: "https://online.radiojazz.ua/RadioJazz" },
  { id: "classic",   title: "Classic Radio",    url: "https://online.classicradio.ua/ClassicRadio" },
  { id: "melodia",   title: "Мелодія FM",       url: "https://online.melodiafm.ua/MelodiaFM" },
  { id: "promin",    title: "Радіо Промінь",    url: "https://radio.ukr.radio/ur2-mp3" },
  { id: "bayraktar", title: "Радіо Байрактар",  url: "https://online.radiobayraktar.ua/RadioBayraktar" },
  { id: "nashe",     title: "Наше Радіо",       url: "https://online.nasheradio.ua/NasheRadio" },
  { id: "hitfm",     title: "Хіт FM",           url: "https://online.hitfm.ua/HitFM" },
  { id: "kissfm",    title: "Kiss FM",          url: "https://online.kissfm.ua/KissFM" },
  { id: "nrj",       title: "NRJ Україна",      url: "https://cast.mediaonline.net.ua/nrj" },
  { id: "roks",      title: "Радіо ROKS",       url: "https://online.radioroks.ua/RadioROKS" },
  { id: "ur1",       title: "Українське радіо", url: "https://radio.ukr.radio/ur1-mp3" },
  { id: "kultura",   title: "Радіо Культура",   url: "https://radio.ukr.radio/ur3-mp3" },
];

export const radioById = (id: string) => RADIO_STATIONS.find((s) => s.id === id);
