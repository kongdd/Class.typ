import assert from 'node:assert/strict';
import { embedSrc } from '../src/embed.ts';

const earth =
  'https://earth.nullschool.net/zh-cn/#2020/09/23/0000Z/wind/isobaric/850hPa/overlay=total_precipitable_water/orthographic=-263.52,31.69,1689/loc=96.671,22.707';

assert.equal(embedSrc('https://youtu.be/aqz-KE-bpKQ'), 'https://www.youtube.com/embed/aqz-KE-bpKQ');
assert.equal(
  embedSrc('https://www.bilibili.com/video/BV1xx411c7mD'),
  'https://www.bilibili.com/blackboard/html5mobileplayer.html?bvid=BV1xx411c7mD&page=1&high_quality=1&danmaku=0',
);
assert.equal(embedSrc(earth), earth);
assert.equal(embedSrc('https://earth.nullschool.net.example.com/'), null);
console.log('embed test passed');
