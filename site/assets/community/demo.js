function svgData({ width, height, from, to, accent, shape }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
    <rect width="${width}" height="${height}" rx="${Math.round(Math.min(width, height) * .06)}" fill="url(#g)"/>
    <circle cx="${Math.round(width * .68)}" cy="${Math.round(height * .30)}" r="${Math.round(Math.min(width, height) * .15)}" fill="#fff" opacity=".28"/>
    <path d="${shape}" fill="none" stroke="${accent}" stroke-width="${Math.max(16, Math.round(Math.min(width, height) * .04))}" stroke-linecap="round"/>
    <rect x="${Math.round(width * .16)}" y="${Math.round(height * .76)}" width="${Math.round(width * .60)}" height="${Math.round(height * .045)}" rx="${Math.round(height * .025)}" fill="#fff" opacity=".44"/>
  </svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

export function demoEntries() {
  const samples = [
    {
      id: 'demo-square',
      title: '方图构图示例',
      category: ['构图'],
      tags: ['1:1', '构图'],
      width: 900,
      height: 900,
      image: svgData({ width: 900, height: 900, from: '#b7a7ff', to: '#f4a4c7', accent: '#ffffff', shape: 'M120 650 C260 520 430 560 700 270' }),
    },
    {
      id: 'demo-portrait',
      title: '竖图人物示例',
      category: ['人物'],
      tags: ['2:3', '人物'],
      width: 832,
      height: 1216,
      image: svgData({ width: 832, height: 1216, from: '#7dc9d9', to: '#6f5cf2', accent: '#ece9fe', shape: 'M150 900 C290 540 520 520 690 260' }),
    },
    {
      id: 'demo-wide',
      title: '横图场景示例',
      category: ['场景'],
      tags: ['16:9', '场景'],
      width: 1280,
      height: 720,
      image: svgData({ width: 1280, height: 720, from: '#151923', to: '#445bd8', accent: '#f4a4c7', shape: 'M120 570 C360 320 740 440 1120 180' }),
    },
    {
      id: 'demo-tall',
      title: '长竖服装示例',
      category: ['服装'],
      tags: ['9:16', '服装'],
      width: 720,
      height: 1280,
      image: svgData({ width: 720, height: 1280, from: '#f4a4c7', to: '#9ed6c8', accent: '#ffffff', shape: 'M120 980 C220 640 440 610 600 300' }),
    },
  ];

  return samples.map(sample => ({
    id: sample.id,
    title: sample.title,
    prompt: 'sample composition, clean lighting, community preview card, ratio test',
    negative: 'lowres, bad anatomy',
    comment: '本地预览示例，用于检查不同比例卡片展示；生产 API 有真实数据时不会显示。',
    submitter: '预览示例',
    tags: sample.tags,
    category: sample.category,
    nsfw: false,
    images: [{ file: sample.image, width: sample.width, height: sample.height }],
    createdAt: 0,
    demo: true,
  }));
}
