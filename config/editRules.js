// Instagram/Snapchat/Kinemaster jaisa filter list — Cloudinary ke effect
// syntax ka mapping. Naya filter add karna ho to bas yahan ek line add karo.
const EDIT_FILTERS = {
    none: null,

    // Basic
    grayscale: "e_grayscale",
    sepia: "e_sepia",
    vintage: "e_sepia:80/e_brightness:-10",
    vivid: "e_saturation:50",
    cold: "e_blue:20",
    warm: "e_red:20",
    blur_bg: "e_blur:300",

    // Instagram-jaisa mood filters
    clarendon: "e_contrast:30/e_saturation:20",
    juno: "e_saturation:40/e_brightness:10",
    gingham: "e_brightness:10/e_contrast:-10/e_saturation:-20",
    moon: "e_grayscale/e_brightness:10",
    lark: "e_saturation:15/e_brightness:5",
    crema: "e_sepia:30/e_saturation:-10",
    fade: "e_saturation:-30/e_brightness:10",

    // Dramatic / cinematic
    dramatic: "e_contrast:40/e_saturation:-10",
    noir: "e_grayscale/e_contrast:40",
    cinematic: "e_contrast:20/e_blue:10/e_saturation:-10",
    golden_hour: "e_red:15/e_brightness:10/e_saturation:10",
    cool_tone: "e_blue:30/e_saturation:-10",

    // Kinemaster/Snapchat jaisa creative/artistic
    sharpen: "e_sharpen:100",
    oil_paint: "e_oil_paint:30",
    cartoon: "e_cartoonify",
    pixelate: "e_pixelate:10",

    // Cloudinary ke built-in "art" style presets (bahut Insta-filter jaisa dikhte hai)
    art_audrey: "e_art:audrey",
    art_eucalyptus: "e_art:eucalyptus",
    art_peacock: "e_art:peacock",
    art_zorro: "e_art:zorro",
    art_incognito: "e_art:incognito",
    art_frost: "e_art:frost",
    art_primavera: "e_art:primavera",
};

module.exports = { EDIT_FILTERS };