// filepath: c:\Users\HOME\Desktop\python\my_server\scripts\migrate_images_to_objects.js
require('dotenv').config();
const mongoose = require('mongoose');
const Post = require('../models/post');

(async ()=>{
  try {
    const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/my_server';
    await mongoose.connect(uri);
    console.log('[연결] MongoDB OK');

    const posts = await Post.find({});
    let changed = 0;
    for (const p of posts) {
      if (!p.images || !p.images.length) continue;
      // 문자열 배열 또는 객체인데 url 없는 경우만 변환
      if (typeof p.images[0] === 'string' || !p.images[0].url) {
        p.images = p.images.map((it, idx) => {
          if (typeof it === 'string') return { url: it, order: idx };
          if (it && it.url) return { url: it.url, order: typeof it.order === 'number' ? it.order : idx };
          if (it && it.path) return { url: it.path, order: idx };
          return null;
        }).filter(Boolean);
        await p.save();
        changed++;
        console.log('변환:', p._id.toString());
      }
    }
    console.log('변환된 문서 수:', changed);
  } catch(e){
    console.error('[오류]', e.message);
  } finally {
    await mongoose.disconnect();
    console.log('[종료]');
  }
})();