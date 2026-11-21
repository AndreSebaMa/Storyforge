export const EASINGS = [
  'Linear', 'Out', 'In', 'InQuad', 'OutQuad', 'InOutQuad', 'InCubic', 'OutCubic', 'InOutCubic',
  'InQuart', 'OutQuart', 'InOutQuart', 'InQuint', 'OutQuint', 'InOutQuint', 'InSine', 'OutSine',
  'InOutSine', 'InExpo', 'OutExpo', 'InOutExpo', 'InCirc', 'OutCirc', 'InOutCirc', 'InElastic',
  'OutElastic', 'OutElasticHalf', 'OutElasticQuarter', 'InOutElastic', 'InBack', 'OutBack',
  'InOutBack', 'InBounce', 'OutBounce', 'InOutBounce',
];
export const E = Object.fromEntries(EASINGS.map((n, i) => [n, i]));

const PI = Math.PI;
const elasticC = (2 * PI) / 0.3;
const elasticC2 = 0.3 / 4;
const backC = 1.70158;
const backC2 = backC * 1.525;
const bounceC = 1 / 2.75;
const expoOff = Math.pow(2, -10);
const elOffFull = Math.pow(2, -11);
const elOffHalf = Math.pow(2, -10) * Math.sin((0.5 - elasticC2) * elasticC);
const elOffQuarter = Math.pow(2, -10) * Math.sin((0.25 - elasticC2) * elasticC);
const inOutElOff = Math.pow(2, -10) * Math.sin((1 - elasticC2 * 1.5) * elasticC / 1.5);

function outBounce(t) {
  if (t < bounceC) return 7.5625 * t * t;
  if (t < 2 * bounceC) return 7.5625 * (t -= 1.5 * bounceC) * t + 0.75;
  if (t < 2.5 * bounceC) return 7.5625 * (t -= 2.25 * bounceC) * t + 0.9375;
  return 7.5625 * (t -= 2.625 * bounceC) * t + 0.984375;
}

export function ease(id, t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  switch (id) {
    case 0: return t;
    case 2: case 3: return t * t;
    case 1: case 4: return t * (2 - t);
    case 5: return t < 0.5 ? t * t * 2 : --t * t * -2 + 1;
    case 6: return t * t * t;
    case 7: return --t * t * t + 1;
    case 8: return t < 0.5 ? t * t * t * 4 : --t * t * t * 4 + 1;
    case 9: return t * t * t * t;
    case 10: return 1 - --t * t * t * t;
    case 11: return t < 0.5 ? t * t * t * t * 8 : --t * t * t * t * -8 + 1;
    case 12: return t * t * t * t * t;
    case 13: return --t * t * t * t * t + 1;
    case 14: return t < 0.5 ? t * t * t * t * t * 16 : --t * t * t * t * t * 16 + 1;
    case 15: return 1 - Math.cos(t * PI * 0.5);
    case 16: return Math.sin(t * PI * 0.5);
    case 17: return 0.5 - 0.5 * Math.cos(PI * t);
    case 18: return Math.pow(2, 10 * (t - 1)) + expoOff * (t - 1);
    case 19: return -Math.pow(2, -10 * t) + 1 + expoOff * t;
    case 20: return t < 0.5
      ? 0.5 * (Math.pow(2, 20 * t - 10) + expoOff * (2 * t - 1))
      : 1 - 0.5 * (Math.pow(2, -20 * t + 10) + expoOff * (-2 * t + 1));
    case 21: return 1 - Math.sqrt(1 - t * t);
    case 22: return Math.sqrt(1 - --t * t);
    case 23: return (t *= 2) < 1 ? 0.5 - 0.5 * Math.sqrt(1 - t * t) : 0.5 * Math.sqrt(1 - (t -= 2) * t) + 0.5;
    case 24: return -Math.pow(2, -10 + 10 * t) * Math.sin((1 - elasticC2 - t) * elasticC) + elOffFull * (1 - t);
    case 25: return Math.pow(2, -10 * t) * Math.sin((t - elasticC2) * elasticC) + 1 - elOffFull * t;
    case 26: return Math.pow(2, -10 * t) * Math.sin((0.5 * t - elasticC2) * elasticC) + 1 - elOffHalf * t;
    case 27: return Math.pow(2, -10 * t) * Math.sin((0.25 * t - elasticC2) * elasticC) + 1 - elOffQuarter * t;
    case 28:
      if ((t *= 2) < 1) return -0.5 * (Math.pow(2, -10 + 10 * t) * Math.sin((1 - elasticC2 * 1.5 - t) * elasticC / 1.5) - inOutElOff * (1 - t));
      return 0.5 * (Math.pow(2, -10 * --t) * Math.sin((t - elasticC2 * 1.5) * elasticC / 1.5) - inOutElOff * t) + 1;
    case 29: return t * t * ((backC + 1) * t - backC);
    case 30: return --t * t * ((backC + 1) * t + backC) + 1;
    case 31: return (t *= 2) < 1
      ? 0.5 * t * t * ((backC2 + 1) * t - backC2)
      : 0.5 * ((t -= 2) * t * ((backC2 + 1) * t + backC2) + 2);
    case 32: return 1 - outBounce(1 - t);
    case 33: return outBounce(t);
    case 34: return t < 0.5 ? 0.5 - 0.5 * outBounce(1 - t * 2) : outBounce((t - 0.5) * 2) * 0.5 + 0.5;
    default: return t;
  }
}

export const EASING_OPTIONS = EASINGS.map((n, i) => [i, n]);
