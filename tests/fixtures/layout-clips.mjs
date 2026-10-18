export const clips = Array.from({ length: 728 }, (_, i) => ({
  id: `clip-${i}`, title: `Research ${i}`, url: `https://example.test/${i}`,
  source: i < 385 ? 'large' : i < 580 ? `medium-${i % 15}` : `small-${i % 148}`,
  tags: i % 2 ? ['shared', 'second'] : ['shared'],
  props: { dims: [['1200x900', '900x1200', '1600x900'][i % 3]] },
}));
