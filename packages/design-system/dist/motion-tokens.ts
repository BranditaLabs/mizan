/* Generated from tokens/tokens.json by scripts/build.mjs. Do not edit. */
export const motion = {
  "duration": {
    "instant": 80,
    "fast": 150,
    "base": 200,
    "slow": 300,
    "moderate": 450,
    "glide": 600,
    "reveal": 900,
    "drift": 24000,
    "tip": 2600,
    "merge": 380,
    "settle": 720,
    "fall": 620,
    "ripple": 1400,
    "roll": 700,
    "route": 280,
    "exit": 150
  },
  "easing": {
    "enter": "cubic-bezier(0.23, 1, 0.32, 1)",
    "expand": "cubic-bezier(0.32, 0.72, 0, 1)",
    "exit": "cubic-bezier(0.4, 0, 1, 1)",
    "standard": "cubic-bezier(0.2, 0, 0, 1)",
    "spring": "cubic-bezier(0.34, 1.56, 0.64, 1)",
    "springSoft": "cubic-bezier(0.34, 1.7, 0.64, 1)",
    "pour": "cubic-bezier(0.22, 1, 0.36, 1)",
    "settle": "cubic-bezier(.34,1.32,.5,1)"
  },
  "easingAlias": {
    "default": "enter",
    "sheet": "expand"
  },
  "reduced": {
    "instant": 0,
    "fast": 0,
    "base": 80,
    "slow": 120,
    "moderate": 120,
    "glide": 120,
    "reveal": 120,
    "drift": 0,
    "tip": 0,
    "merge": 120,
    "settle": 120,
    "fall": 0,
    "ripple": 0,
    "roll": 0,
    "route": 120,
    "exit": 80
  },
  "pressScale": 0.98,
  "distance": {
    "rise": 8,
    "reveal": 28,
    "row": 14,
    "lean": 7
  },
  "stagger": {
    "list": 50,
    "grid": 70,
    "cap": 8
  },
  "scroll": {
    "hideAfterDown": 36,
    "showAfterUp": 6,
    "resizeHold": 450,
    "miniAfter": 120,
    "solidAfter": 8
  },
  "easingReduced": {
    "settle": "linear"
  },
  "angle": {
    "tip": 18,
    "tipHold": 8
  },
  "angleReduced": {
    "tip": 0,
    "tipHold": 8
  },
  "spring": {
    "pair": {
      "k": 110,
      "c": 13
    },
    "level": {
      "k": 60,
      "z": 0.9,
      "massK": [
        150,
        95,
        60
      ],
      "massC": [
        14,
        12,
        10.5
      ]
    },
    "gauge": {
      "k": 70,
      "z": 0.5,
      "massK": [
        160,
        100,
        64
      ],
      "massZ": 0.55
    },
    "vessels": {
      "k": 55,
      "z": 0.42
    },
    "breakeven": {
      "k": 60,
      "z": 0.45
    },
    "bullseye": {
      "massK": [
        150,
        95,
        60
      ],
      "massZ": 0.55
    },
    "fill": {
      "smoothing": 7
    }
  },
  "goo": {
    "loader": {
      "pair": 3.2,
      "level": 3,
      "transfer": 2.4,
      "drop": 2.4,
      "fill": 1.6
    },
    "loaderMatrix": {
      "a": 36,
      "b": -16.5
    },
    "instrument": {
      "gauge": 3,
      "vessels": 2.4,
      "breakeven": 2.2,
      "bullseye": 3
    },
    "instrumentMatrix": {
      "a": 22,
      "b": -10
    }
  }
} as const;
