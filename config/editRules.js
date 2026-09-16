// Instagram/Snapchat jaisa basic filter list — Cloudinary ke effect syntax
// ka mapping. Naya filter add karna ho to bas yahan ek line add karo.
const EDIT_FILTERS = {
    none: null,
    grayscale: "e_grayscale",
    sepia: "e_sepia",
    vintage: "e_sepia:80/e_brightness:-10",
    vivid: "e_saturation:50",
    cold: "e_blue:20",
    warm: "e_red:20",
    blur_bg: "e_blur:300",
};

module.exports = { EDIT_FILTERS };