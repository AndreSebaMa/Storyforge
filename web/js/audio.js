let cached = { url: null, promise: null };

export function loadAudioData(url) {
  if (cached.url === url) return cached.promise;
  cached = {
    url,
    promise: (async () => {
      const buf = await (await fetch(url)).arrayBuffer();
      const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const ac = new Ctx(1, 2, 44100);
      const audio = await ac.decodeAudioData(buf);
      const n = audio.length;
      const mono = new Float32Array(n);
      for (let c = 0; c < audio.numberOfChannels; c++) {
        const d = audio.getChannelData(c);
        for (let i = 0; i < n; i++) mono[i] += d[i] / audio.numberOfChannels;
      }
      return { sampleRate: audio.sampleRate, data: mono, duration: audio.duration };
    })(),
  };
  cached.promise.catch(() => { cached = { url: null, promise: null }; });
  return cached.promise;
}

export function waveformPeaks(audio, stepMs = 10) {
  const per = Math.max(1, Math.round((audio.sampleRate * stepMs) / 1000));
  const n = Math.ceil(audio.data.length / per);
  const peaks = new Float32Array(n);
  let max = 1e-6;
  for (let i = 0; i < n; i++) {
    let m = 0;
    const end = Math.min(audio.data.length, (i + 1) * per);
    for (let k = i * per; k < end; k += 2) { const v = Math.abs(audio.data[k]); if (v > m) m = v; }
    peaks[i] = m;
    if (m > max) max = m;
  }
  for (let i = 0; i < n; i++) peaks[i] = Math.sqrt(peaks[i] / max);
  return { peaks, step: stepMs };
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const specCache = new Map();

export function spectrum(audio, times, opts) {
  const key = JSON.stringify([audio.data.length, times[0], times.length, times[times.length - 1], opts]);
  if (specCache.has(key)) return specCache.get(key);
  const N = 2048, sr = audio.sampleRate, data = audio.data;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const { bars, minFreq = 40, maxFreq = 12000, log = true } = opts;
  const ranges = [];
  for (let b = 0; b < bars; b++) {
    const f0 = log ? minFreq * Math.pow(maxFreq / minFreq, b / bars) : minFreq + (maxFreq - minFreq) * b / bars;
    const f1 = log ? minFreq * Math.pow(maxFreq / minFreq, (b + 1) / bars) : minFreq + (maxFreq - minFreq) * (b + 1) / bars;
    const i0 = Math.max(1, Math.floor(f0 * N / sr)), i1 = Math.max(i0 + 1, Math.ceil(f1 * N / sr));
    ranges.push([i0, Math.min(N / 2, i1)]);
  }
  const re = new Float32Array(N), im = new Float32Array(N);
  const out = times.map((t) => {
    const c = Math.floor(t / 1000 * sr) - N / 2;
    for (let i = 0; i < N; i++) {
      const s = c + i;
      re[i] = s >= 0 && s < data.length ? data[s] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    const v = new Float32Array(bars);
    for (let b = 0; b < bars; b++) {
      const [i0, i1] = ranges[b];
      let m = 0;
      for (let i = i0; i < i1; i++) m = Math.max(m, Math.hypot(re[i], im[i]));
      v[b] = Math.sqrt(m) * (1 + 1.5 * b / bars);
    }
    return v;
  });
  const pct = (arr) => { const s = Array.from(arr).sort((a, b) => a - b); return s[Math.floor(s.length * 0.95)] || 1; };
  const all = new Float32Array(out.length * bars);
  out.forEach((v, k) => all.set(v, k * bars));
  const g = pct(all);
  for (let b = 0; b < bars; b++) {
    const col = out.map((v) => v[b]);
    const norm = 0.5 * pct(col) + 0.5 * g || 1;
    for (const v of out) v[b] = Math.min(1, v[b] / norm);
  }
  specCache.set(key, out);
  if (specCache.size > 20) specCache.delete(specCache.keys().next().value);
  return out;
}
